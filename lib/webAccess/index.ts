import { join } from "node:path";
import type { Express, Request, RequestHandler, Response } from "express";
import { createAccessJwtVerifier, type AccessJwtResult } from "./accessJwt.js";
import { classifyWebRoute } from "./routePolicy.js";
import { createSpendGuard, type SpendGuard } from "./spendGuard.js";

export { classifyWebRoute } from "./routePolicy.js";
export { estimateMediaUsd } from "./spendGuard.js";

/**
 * Web deployment behind Cloudflare Access (devlog L9). Off unless
 * IMA2_WEB_ACCESS=cloudflare; then every request must carry a valid Access
 * token, remote-unsafe routes close and priced media jobs pass a spend guard.
 */
export interface WebAccessConfig {
  teamDomain: string;
  aud: string;
  allowedEmails: readonly string[];
  dailyCapUsd: number;
  requestCapUsd: number;
  timeZone: string;
  ledgerFile: string;
}

type Env = Readonly<Record<string, string | undefined>>;
const TEAM = /^[a-z0-9-]+$/;
const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const USER_COOKIE = "ima2_web_user";
const LOGOUT_URL = "/cdn-cgi/access/logout";

function positiveUsd(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + " must be a positive dollar amount");
  return value;
}

function teamDomain(raw: string | undefined): string {
  const team = (raw ?? "").trim().toLowerCase();
  if (TEAM_DOMAIN.test(team)) return team;
  if (TEAM.test(team)) return team + ".cloudflareaccess.com";
  throw new Error("IMA2_CF_ACCESS_TEAM must be a Cloudflare Access team name or <team>.cloudflareaccess.com");
}

export function loadWebAccessConfig(env: Env, configDir: string): WebAccessConfig | null {
  const mode = (env.IMA2_WEB_ACCESS ?? "").trim().toLowerCase();
  if (mode === "" || mode === "off") return null;
  if (mode !== "cloudflare") throw new Error("IMA2_WEB_ACCESS must be \"cloudflare\" or \"off\"");
  const aud = (env.IMA2_CF_ACCESS_AUD ?? "").trim();
  const domain = teamDomain(env.IMA2_CF_ACCESS_TEAM);
  if (!aud) throw new Error("IMA2_CF_ACCESS_AUD is required when IMA2_WEB_ACCESS=cloudflare");
  const timeZone = env.IMA2_WEB_SPEND_TIMEZONE?.trim() || "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone }); } catch { throw new Error("IMA2_WEB_SPEND_TIMEZONE is not a valid IANA time zone"); }
  return {
    teamDomain: domain,
    aud,
    allowedEmails: (env.IMA2_WEB_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    dailyCapUsd: positiveUsd(env, "IMA2_WEB_SPEND_DAILY_USD", 5),
    requestCapUsd: positiveUsd(env, "IMA2_WEB_SPEND_REQUEST_USD", 1),
    timeZone,
    ledgerFile: join(configDir, "web-spend-ledger.json"),
  };
}

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

export function createWebAccess(config: WebAccessConfig, deps: WebAccessDeps = {}) {
  const verifier = deps.verifier ?? createAccessJwtVerifier({ teamDomain: config.teamDomain, aud: config.aud, fetch: deps.fetch, now: deps.now });
  const spend: SpendGuard = createSpendGuard({ dailyCapUsd: config.dailyCapUsd, requestCapUsd: config.requestCapUsd, ledgerFile: config.ledgerFile, timeZone: config.timeZone, now: deps.now });
  const gate: RequestHandler = async (req, res, next) => {
    try {
      const token = assertionHeader(req);
      if (!token) return deny(res, 401, "WEB_ACCESS_REQUIRED", "Sign in through Cloudflare Access at this site's address.");
      const result = await verifier.verify(token);
      if (!result.ok) return deny(res, 401, "WEB_ACCESS_INVALID", "Your sign-in could not be verified. Sign in again.");
      if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(result.email)) {
        return deny(res, 403, "WEB_ACCESS_FORBIDDEN", "This account is not allowed on this instance.");
      }
      res.locals.webUser = { email: result.email };
      const route = classifyWebRoute(req.method, req.originalUrl || req.url);
      if (route.action === "deny") return deny(res, 403, route.code, route.message);
      if (req.method === "GET" && !/^\/(api|generated)(\/|$)/i.test(req.path)) {
        res.cookie(USER_COOKIE, result.email, { path: "/", secure: true, sameSite: "strict", httpOnly: false, maxAge: 86_400_000 });
      }
      next();
    } catch {
      deny(res, 503, "WEB_ACCESS_UNAVAILABLE", "Sign-in verification is unavailable. Try again shortly.");
    }
  };
  function registerRoutes(app: Express): void {
    app.get("/api/web/session", async (_req: Request, res: Response) => {
      const { entries: _entries, ...budget } = await spend.status();
      res.setHeader("Cache-Control", "no-store");
      res.json({ email: res.locals.webUser?.email ?? null, logoutUrl: LOGOUT_URL, spend: budget });
    });
  }
  return { config, spend, gate, registerRoutes };
}

export type WebAccess = ReturnType<typeof createWebAccess>;

export function webAccessFromEnv(env: Env, configDir: string): WebAccess | undefined {
  const config = loadWebAccessConfig(env, configDir);
  return config ? createWebAccess(config) : undefined;
}
