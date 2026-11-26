import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { createAccessJwtVerifier, type AccessJwtResult } from "./accessJwt.js";
import { loadWebAccessConfig, type WebAccessConfig } from "./config.js";
import { createGoogleLogin, fromThisSite } from "./googleLogin.js";
import { classifyWebRoute } from "./routePolicy.js";
import { createSessionSigner } from "./session.js";
import { createSpendGuard, type SpendGuard } from "./spendGuard.js";

export { classifyWebRoute } from "./routePolicy.js";
export { estimateMediaUsd } from "./spendGuard.js";
export { loadWebAccessConfig } from "./config.js";
export type { WebAccessConfig } from "./config.js";

/**
 * Web deployment gate (devlog L9). Off unless IMA2_WEB_ACCESS is set.
 * "cloudflare": every request carries a verified Cloudflare Access token.
 * "google": this app's Google sign-in and a signed session cookie; writes must
 * come from the public origin. Both then close remote-unsafe routes, put the
 * email on the request and the UI, and send priced media jobs through the
 * spend guard.
 */
type Env = Readonly<Record<string, string | undefined>>;
const USER_COOKIE = "ima2_web_user";
const MODE_COOKIE = "ima2_web_auth";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function deny(res: Response, status: number, code: string, message: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message } });
}

/** Raw headers, so a duplicated assertion is refused instead of joined. */
function assertionHeader(req: Request): string | null {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === "cf-access-jwt-assertion") values.push(req.rawHeaders[i + 1] ?? "");
  }
  return values.length === 1 && values[0] ? values[0] : null;
}

export interface WebAccessDeps {
  verifier?: { verify(token: string): Promise<AccessJwtResult> };
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

function wantsPage(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && !/^\/(api|generated)(\/|$)/i.test(req.path)
    && /text\/html/i.test(String(req.headers.accept ?? ""));
}

export function createWebAccess(config: WebAccessConfig, deps: WebAccessDeps = {}) {
  const clock = deps.now ? { now: deps.now } : {};
  const fetchDep = deps.fetch ? { fetch: deps.fetch } : {};
  const spend: SpendGuard = createSpendGuard({ dailyCapUsd: config.dailyCapUsd, requestCapUsd: config.requestCapUsd, ledgerFile: config.ledgerFile, timeZone: config.timeZone, ...clock });
  const allowed = (email: string) => config.allowedEmails.length === 0 || config.allowedEmails.includes(email);
  const logout = config.mode === "google" ? { url: "/auth/logout", method: "POST" } : { url: "/cdn-cgi/access/logout", method: "GET" };

  /** After sign-in: allow list, write origin, route policy, then the email on the request and the badge cookies. */
  function admit(req: Request, res: Response, next: NextFunction, email: string): void {
    if (!allowed(email)) return deny(res, 403, "WEB_ACCESS_FORBIDDEN", "This account is not allowed on this instance.");
    if (config.mode === "google" && !READ_METHODS.has(req.method) && !fromThisSite(req, config.publicOrigin)) {
      return deny(res, 403, "WEB_ORIGIN_REJECTED", "Changes must come from this site's own pages.");
    }
    res.locals.webUser = { email };
    const route = classifyWebRoute(req.method, req.originalUrl || req.url);
    if (route.action === "deny") return deny(res, 403, route.code, route.message);
    if (req.method === "GET" && !/^\/(api|generated)(\/|$)/i.test(req.path)) {
      const badge = { path: "/", secure: true, sameSite: "strict" as const, httpOnly: false, maxAge: 86_400_000 };
      res.cookie(USER_COOKIE, email, badge);
      res.cookie(MODE_COOKIE, config.mode, badge);
    }
    next();
  }

  let gate: RequestHandler;
  if (config.mode === "cloudflare") {
    const verifier = deps.verifier ?? createAccessJwtVerifier({ teamDomain: config.teamDomain, aud: config.aud, ...fetchDep, ...clock });
    gate = async (req, res, next) => {
      try {
        const token = assertionHeader(req);
        if (!token) return deny(res, 401, "WEB_ACCESS_REQUIRED", "Sign in through Cloudflare Access at this site's address.");
        const result = await verifier.verify(token);
        if (!result.ok) return deny(res, 401, "WEB_ACCESS_INVALID", "Your sign-in could not be verified. Sign in again.");
        admit(req, res, next, result.email);
      } catch {
        deny(res, 503, "WEB_ACCESS_UNAVAILABLE", "Sign-in verification is unavailable. Try again shortly.");
      }
    };
  } else {
    const sessions = createSessionSigner({ secret: config.sessionSecret, revokedFile: config.revokedFile, ...clock });
    const google = createGoogleLogin({ clientId: config.clientId, clientSecret: config.clientSecret, origin: config.publicOrigin, secret: config.sessionSecret, allowed, sessions, ...fetchDep, ...clock });
    gate = async (req, res, next) => {
      try {
        if (await google.handle(req, res)) return;
        const session = google.currentSession(req);
        if (!session || !allowed(session.email)) {
          if (wantsPage(req)) {
            res.setHeader("Cache-Control", "no-store");
            return res.redirect(302, "/auth/login?return=" + encodeURIComponent(req.originalUrl || req.url));
          }
          return deny(res, 401, "WEB_LOGIN_REQUIRED", "Sign in at this site's address first.");
        }
        admit(req, res, next, session.email);
      } catch {
        deny(res, 503, "WEB_ACCESS_UNAVAILABLE", "Sign-in is unavailable. Try again shortly.");
      }
    };
  }

  async function handleSession(_req: Request, res: Response): Promise<void> {
    const { entries: _entries, ...budget } = await spend.status();
    res.setHeader("Cache-Control", "no-store");
    res.json({ email: res.locals.webUser?.email ?? null, logoutUrl: logout.url, logoutMethod: logout.method, spend: budget });
  }
  function registerRoutes(app: Express): void {
    app.get("/api/web/session", (req: Request, res: Response, next: NextFunction) => { handleSession(req, res).catch(next); });
  }
  return { config, spend, gate, handleSession, registerRoutes };
}

export type WebAccess = ReturnType<typeof createWebAccess>;

export function webAccessFromEnv(env: Env, configDir: string): WebAccess | undefined {
  const config = loadWebAccessConfig(env, configDir);
  return config ? createWebAccess(config) : undefined;
}
