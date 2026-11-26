import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, verify as verifySignature } from "node:crypto";
import type { Request, Response } from "express";
import { createCertCache, decodeJwtPart, JWT_PART } from "./jwks.js";
import { loginPage, refusedPage, signedOutPage } from "./pages.js";
import { SESSION_COOKIE, SESSION_TTL_MS, subKey, type SessionSigner } from "./session.js";

/**
 * Google sign-in (OpenID Connect authorization code flow with PKCE S256).
 * Endpoints from https://accounts.google.com/.well-known/openid-configuration.
 * The pending state, nonce and PKCE verifier live in a short AES-GCM sealed
 * cookie scoped to /auth/google, so unauthenticated requests store nothing.
 */
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const PENDING_COOKIE = "ima2_oauth_pending";
const PENDING_MS = 10 * 60_000;
const RANDOM = /^[A-Za-z0-9_-]{43}$/;

export interface GoogleLoginOptions {
  clientId: string;
  clientSecret: string;
  origin: string;
  secret: string;
  allowed(email: string): boolean;
  sessions: SessionSigner;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

interface Pending { k: "pending"; s: string; n: string; v: string; r: string; e: number }
type Verified = { ok: true; email: string } | { ok: false; reason: string; email?: string };

const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Same-site path only: no scheme, no protocol-relative or backslash tricks. */
export function safeReturn(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return "/";
  return raw.startsWith("/auth/") ? "/" : raw;
}

function sealer(key: Buffer) {
  return {
    seal(value: Pending): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open(value: string | undefined): Pending | null {
      if (!value || !/^[A-Za-z0-9_-]{40,2000}$/.test(value)) return null;
      try {
        const raw = Buffer.from(value, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
        const parsed = JSON.parse(plain) as Pending;
        return parsed && parsed.k === "pending" ? parsed : null;
      } catch { return null; }
    },
  };
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createGoogleLogin(options: GoogleLoginOptions) {
  const now = options.now ?? Date.now;
  const get = options.fetch ?? globalThis.fetch;
  const redirectUri = options.origin + "/auth/google/callback";
  const keyFor = createCertCache(CERTS, get, now);
  const box = sealer(subKey(options.secret, "oauth-pending"));
  const pendingCookie = { path: "/auth/google", httpOnly: true, secure: true, sameSite: "lax" as const };
  const sessionCookie = { path: "/", httpOnly: true, secure: true, sameSite: "lax" as const };

  async function verifyIdToken(token: string, nonce: string): Promise<Verified> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !JWT_PART.test(p))) return { ok: false, reason: "malformed" };
    const [head, body, signature] = parts as [string, string, string];
    const header = decodeJwtPart(head), claims = decodeJwtPart(body);
    if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "malformed" };
    const key = await keyFor(header.kid);
    if (!key || !verifySignature("RSA-SHA256", Buffer.from(head + "." + body), key, Buffer.from(signature, "base64url"))) return { ok: false, reason: "signature" };
    if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return { ok: false, reason: "issuer" };
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(options.clientId)) return { ok: false, reason: "audience" };
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now()) return { ok: false, reason: "expired" };
    if (typeof claims.iat === "number" && claims.iat * 1000 > now() + 5 * 60_000) return { ok: false, reason: "issued in the future" };
    if (typeof claims.nonce !== "string" || !sameText(claims.nonce, nonce)) return { ok: false, reason: "nonce" };
    if (claims.email_verified !== true || typeof claims.email !== "string") return { ok: false, reason: "email not verified" };
    const email = claims.email.toLowerCase();
    return options.allowed(email) ? { ok: true, email } : { ok: false, reason: "not allowed", email };
  }

  function start(req: Request, res: Response): void {
    const pending: Pending = { k: "pending", s: random(), n: random(), v: random(48), r: safeReturn(req.query.return), e: now() + PENDING_MS };
    const challenge = createHash("sha256").update(pending.v).digest("base64url");
    const query = new URLSearchParams({
      client_id: options.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile",
      state: pending.s, nonce: pending.n, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    });
    res.setHeader("Cache-Control", "no-store");
    res.cookie(PENDING_COOKIE, box.seal(pending), { ...pendingCookie, maxAge: PENDING_MS });
    res.redirect(302, AUTHORIZE + "?" + query.toString());
  }

  async function exchange(code: string, verifier: string): Promise<string | null> {
    const response = await get(TOKEN, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: options.clientId, client_secret: options.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { id_token?: unknown };
    return typeof body.id_token === "string" ? body.id_token : null;
  }

  async function callback(req: Request, res: Response): Promise<void> {
    const pending = box.open(readCookie(req, PENDING_COOKIE));
    res.cookie(PENDING_COOKIE, "", { ...pendingCookie, maxAge: 0 });
    const refuse = (reason: string, kind: Parameters<typeof refusedPage>[1] = "failed", email?: string) => {
      console.warn("[web.google] sign-in refused:", reason);
      refusedPage(res, kind, email);
    };
    if (typeof req.query.error === "string") return refuse("provider error", req.query.error === "access_denied" ? "cancelled" : "failed");
    if (!pending || pending.e < now()) return refuse("no pending sign-in", "expired");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!RANDOM.test(state) || !sameText(state, pending.s) || !code) return refuse("state mismatch");
    let token: string | null;
    try { token = await exchange(code, pending.v); } catch { token = null; }
    if (!token) return refuse("token exchange failed");
    const verified = await verifyIdToken(token, pending.n);
    if ("reason" in verified) return refuse(verified.reason, verified.reason === "not allowed" ? "not-allowed" : "failed", verified.email);
    res.setHeader("Cache-Control", "no-store");
    res.cookie(SESSION_COOKIE, options.sessions.issue(verified.email), { ...sessionCookie, maxAge: SESSION_TTL_MS });
    res.redirect(302, safeReturn(pending.r));
  }

  function logout(req: Request, res: Response): void {
    if (req.headers.origin !== options.origin) {
      res.status(403).setHeader("Cache-Control", "no-store");
      res.type("text/plain").send("Origin not allowed");
      return;
    }
    const session = options.sessions.read(readCookie(req, SESSION_COOKIE));
    if (session) options.sessions.revoke(session);
    res.setHeader("Cache-Control", "no-store");
    res.cookie(SESSION_COOKIE, "", { ...sessionCookie, maxAge: 0 });
    res.redirect(303, "/auth/signed-out");
  }

  /** Handles /auth/*; returns false for anything else. */
  async function handle(req: Request, res: Response): Promise<boolean> {
    const route = req.method + " " + req.path;
    if (route === "GET /auth/login") loginPage(res, safeReturn(req.query.return));
    else if (route === "GET /auth/google/start") start(req, res);
    else if (route === "GET /auth/google/callback") await callback(req, res);
    else if (route === "POST /auth/logout") logout(req, res);
    else if (route === "GET /auth/signed-out") signedOutPage(res);
    else if (/^\/auth(\/|$)/.test(req.path)) res.status(404).type("text/plain").send("Not found");
    else return false;
    return true;
  }

  return { handle, currentSession: (req: Request) => options.sessions.read(readCookie(req, SESSION_COOKIE)) };
}
