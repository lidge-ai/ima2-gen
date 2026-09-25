import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Express, Request, RequestHandler, Response } from "express";
import type { RuntimeContext } from "./runtimeContext.js";
import { createLocalAccessPolicy, isLocalBind, localAccessError, protectedRequestPath, singleHeader } from "./localAccessPolicy.js";
import { createLanAuthThrottle, createLanSessionStore } from "./lanSessionStore.js";

const SESSION_PATH = /^\/api\/auth\/lan\/session$/i;
const CALLBACK_PATH = "/api/mcp/oauth/callback";
const BOOTSTRAP_BODY_BYTES = 1024;
const COMPAT_TOKEN_MAX_BYTES = 4096;

function tokenMatches(value: string | undefined, expected: string): boolean {
  if (value === undefined || !expected) return false;
  const actual = Buffer.from(value), wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function cookieName(origin: string): string {
  const suffix = createHash("sha256").update(origin).digest("hex").slice(0, 12);
  return `${origin.startsWith("https:") ? "__Host-" : ""}ima2_lan_${suffix}`;
}

function cookieOptions(origin: string): CookieOptions {
  return { path: "/", httpOnly: true, sameSite: "strict", secure: origin.startsWith("https:") };
}

function readCredentials(req: Request, name: string, maxBytes: number) {
  const header = singleHeader(req, "x-ima2-token", "LAN_TOKEN_REQUIRED");
  const params = new URLSearchParams((req.originalUrl || req.url).split("?").slice(1).join("?"));
  const queries = params.getAll("token");
  const invalidQuery = [...params.keys()].some(key => /^token[[.]/.test(key));
  if (queries.length > 1 || invalidQuery) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
  const query = queries[0];
  const cookies = name ? req.headers.cookie?.split(";").map(part => part.trim()) ?? [] : [];
  const matches = cookies.filter(part => part.split("=")[0] === name);
  if (matches.length > 1) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
  const cookie = matches[0]?.slice(name.length + 1);
  for (const value of [header, query, cookie]) {
    if (value !== undefined && Buffer.byteLength(value) > maxBytes) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
  }
  if (cookie !== undefined && !/^[\w-]{43}$/.test(cookie)) {
    throw localAccessError("LAN_TOKEN_REQUIRED", 401);
  }
  return { header, query, cookie, explicit: header ?? query };
}

function sendAccessError(res: Response, error: unknown): void {
  const safe = error as ReturnType<typeof localAccessError>;
  const known = typeof safe?.code === "string" && typeof safe?.status === "number";
  if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  res.status(known ? safe.status : 503).type("application/json").end(JSON.stringify({ error: {
    code: known ? safe.code : "LAN_SESSION_UNAVAILABLE",
    message: known ? safe.message : "LAN sessions are unavailable",
  } }));
}

function privateMediaHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie"); res.vary("X-Ima2-Token");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function trackResponse(store: ReturnType<typeof createLanSessionStore>, value: string, res: Response): void {
  const untrack = store.track(value, () => { res.end(); });
  const cleanup = () => {
    untrack(); res.off("finish", cleanup); res.off("close", cleanup);
  };
  res.once("finish", cleanup); res.once("close", cleanup);
  if (res.writableEnded || res.destroyed) cleanup();
}

/** Compatibility-only token guard. Production uses the shared policy instance. */
export function createLanApiGuard(host: string | undefined, token: string | undefined): RequestHandler {
  const expected = isLocalBind(host) ? "" : token || "";
  return (req, res, next) => {
    try {
      if (!expected || !/^\/api(?:\/|$)/i.test(req.path)) return next();
      if (req.method === "GET" && req.path.toLowerCase() === CALLBACK_PATH) return next();
      const credentials = readCredentials(req, "", COMPAT_TOKEN_MAX_BYTES);
      if (!tokenMatches(credentials.explicit, expected)) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
      next();
    } catch (error) { sendAccessError(res, error); }
  };
}

class LocalLanAccess {
  private readonly policy: ReturnType<typeof createLocalAccessPolicy>;
  private readonly lan: boolean;
  private readonly token: string;
  private readonly bounds: RuntimeContext["config"]["security"];
  private readonly store: ReturnType<typeof createLanSessionStore>;
  private readonly throttle: ReturnType<typeof createLanAuthThrottle>;
  private readonly tracked = new WeakSet<Response>();
  private readonly sessionState = new WeakMap<Request, { origin: string; credentials: ReturnType<typeof readCredentials> }>();

  constructor(ctx: RuntimeContext) {
    this.policy = createLocalAccessPolicy(ctx.config);
    this.lan = !isLocalBind(ctx.config.server.host); this.token = ctx.config.server.lanToken;
    this.bounds = ctx.config.security;
    const { lan, token, bounds } = this;
    if ((lan && !token) || Buffer.byteLength(token) > bounds.lanTokenMaxBytes) throw localAccessError("INVALID_LAN_TOKEN", 500);
    this.store = createLanSessionStore({ ttlMs: bounds.lanSessionTtlMs, maxSessions: bounds.lanMaxSessions });
    this.throttle = createLanAuthThrottle({ windowMs: bounds.lanAuthWindowMs, maxFailures: bounds.lanAuthMaxFailures, maxBuckets: bounds.lanAuthMaxBuckets });
  }
  readonly mediaHeaders: RequestHandler = (req, res, next) => {
    // The canonical raw prefix still receives headers when its tail has bad escapes.
    try { if (this.lan && protectedRequestPath(req).media) privateMediaHeaders(res); }
    catch {
      const prefix = (req.originalUrl || req.url).replace(/%([\da-f]{2})/ig, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (this.lan && /^\/generated(?:[/\\]|$)/i.test(prefix)) privateMediaHeaders(res);
    }
    next();
  };
  readonly guard: RequestHandler = (req, res, next) => {
    try {
      const { policy, lan, bounds } = this;
      const route = protectedRequestPath(req);
      if (!route.api && !route.media) return next();
      if (route.alias) throw localAccessError("LOCAL_PATH_REJECTED", 400);
      const rawPath = (req.originalUrl || req.url).split("?")[0]?.toLowerCase();
      if (req.method === "GET" && rawPath === CALLBACK_PATH) { policy.resolveHost(req); return next(); }
      const origin = policy.resolveOrigin(req);
      const credentials = lan ? readCredentials(req, cookieName(origin), bounds.lanTokenMaxBytes) : null;
      const viaCookie = !!credentials?.cookie && credentials.explicit === undefined;
      policy.checkBrowserRequest(req, origin, viaCookie);
      if (credentials) this.authorize(credentials, origin, res, req.socket.remoteAddress || "unknown");
      if (!res.writableEnded && !res.destroyed) next();
    } catch (error) { sendAccessError(res, error); }
  };
  private checkTokenCooldown(peer: string, res: Response): void {
    const retry = this.throttle.retryAfter(peer);
    if (retry) { res.setHeader("Retry-After", String(retry)); throw localAccessError("LAN_AUTH_RATE_LIMITED", 429); }
  }
  private validateToken(value: string | undefined, peer: string): void {
    if (tokenMatches(value, this.token)) return;
    this.throttle.fail(peer);
    throw localAccessError("LAN_TOKEN_REQUIRED", 401);
  }
  private authorize(credentials: ReturnType<typeof readCredentials>, origin: string, res: Response, peer: string) {
    const { store, tracked } = this;
    if (credentials.explicit !== undefined) {
      this.checkTokenCooldown(peer, res);
      this.validateToken(credentials.explicit, peer);
      return;
    }
    if (!credentials.cookie || !store.validate(credentials.cookie, origin)) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
    if (!tracked.has(res)) { tracked.add(res); trackResponse(store, credentials.cookie, res); }
  }
  private sessionCheck(req: Request, res: Response) {
    const { policy, lan, bounds, throttle } = this;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    const origin = policy.resolveOrigin(req);
    policy.checkBrowserRequest(req, origin, false);
    if (req.method !== "GET" && !singleHeader(req, "origin", "LOCAL_ORIGIN_REJECTED")) throw localAccessError("LOCAL_ORIGIN_REJECTED");
    const peer = req.socket.remoteAddress || "unknown";
    if (lan && req.method === "POST") this.checkTokenCooldown(peer, res);
    let credentials: ReturnType<typeof readCredentials>;
    try {
      credentials = lan ? readCredentials(req, cookieName(origin), bounds.lanTokenMaxBytes) : { header: undefined, query: undefined, cookie: undefined, explicit: undefined };
    } catch (error) { if (lan && req.method === "POST") throttle.fail(peer); throw error; }
    if (lan && req.method === "POST") this.validateToken(credentials.header, peer);
    if (lan && req.method === "GET" && credentials.explicit !== undefined) {
      this.checkTokenCooldown(peer, res);
      this.validateToken(credentials.explicit, peer);
    }
    if (lan && req.method === "DELETE" && !credentials.cookie) throw localAccessError("LAN_TOKEN_REQUIRED", 401);
    return { origin, credentials };
  }
  private sessionResult(req: Request, res: Response): void {
    const { sessionState, lan, store } = this;
    const { origin, credentials } = sessionState.get(req)!;
    if (req.method === "GET") {
      const session = credentials.cookie ? store.validate(credentials.cookie, origin) : null;
      res.json({ mode: lan ? "lan" : "local", authenticated: !lan || credentials.explicit !== undefined || !!session,
        expiresAt: lan && credentials.explicit === undefined ? session?.expiresAt ?? null : null });
      return;
    }
    if (req.method === "DELETE") {
      if (lan) { store.revoke(credentials.cookie!); res.clearCookie(cookieName(origin), cookieOptions(origin)); }
      res.status(204).end(); return;
    }
    if (!req.body || Array.isArray(req.body) || typeof req.body !== "object" || Object.keys(req.body).length) throw localAccessError("LAN_SESSION_BODY_INVALID", 400);
    if (req.aborted || res.destroyed) return;
    if (lan) {
      if (credentials.cookie && store.validate(credentials.cookie, origin)) store.revoke(credentials.cookie);
      const session = store.issue(origin);
      res.once("close", () => { if (!res.writableFinished) store.revoke(session.value); });
      try { res.cookie(cookieName(origin), session.value, cookieOptions(origin)); }
      catch { store.revoke(session.value); throw localAccessError("LAN_SESSION_UNAVAILABLE", 503); }
    }
    res.status(204).end();
  }
  registerSessionRoutes(app: Express, budget: RequestHandler): void {
    const check: RequestHandler = (req, res, next) => {
      try {
        if (!["GET", "POST", "DELETE"].includes(req.method)) return next("route");
        if (protectedRequestPath(req).alias) throw localAccessError("LOCAL_PATH_REJECTED", 400);
        this.sessionState.set(req, this.sessionCheck(req, res)); next();
      } catch (error) { sendAccessError(res, error); }
    };
    const parser = express.json({ limit: BOOTSTRAP_BODY_BYTES, strict: true, inflate: false });
    const body: RequestHandler = (req, res, next) => {
      if (req.method !== "POST") return next();
      if (!req.is("application/json")) return sendAccessError(res, localAccessError("LAN_SESSION_CONTENT_TYPE", 415));
      parser(req, res, error => error ? sendAccessError(res, localAccessError("LAN_SESSION_BODY_INVALID", 400)) : next());
    };
    app.all(SESSION_PATH, check, budget, body, (req, res) => {
      try { this.sessionResult(req, res); } catch (error) { sendAccessError(res, error); }
    });
  }
  readonly dispose = (): void => { this.store.dispose(); this.throttle.dispose(); };
}

export function createLocalLanAccess(ctx: RuntimeContext) {
  return new LocalLanAccess(ctx);
}
