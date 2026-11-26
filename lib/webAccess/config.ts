import { join } from "node:path";

/**
 * Settings for the shared web instance (devlog L9). IMA2_WEB_ACCESS picks the
 * sign-in: "cloudflare" trusts a Cloudflare Access token on every request,
 * "google" runs this app's own Google sign-in with a signed session cookie.
 */
interface CommonConfig {
  allowedEmails: readonly string[];
  dailyCapUsd: number;
  requestCapUsd: number;
  timeZone: string;
  ledgerFile: string;
}
export interface CloudflareAccessConfig extends CommonConfig { mode: "cloudflare"; teamDomain: string; aud: string }
export interface GoogleLoginConfig extends CommonConfig {
  mode: "google";
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** Exact public origin, e.g. https://ima2.lidgeai.com; the OAuth callback and write checks use it. */
  publicOrigin: string;
  revokedFile: string;
}
export type WebAccessConfig = CloudflareAccessConfig | GoogleLoginConfig;

type Env = Readonly<Record<string, string | undefined>>;
const TEAM = /^[a-z0-9-]+$/;
const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

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

function required(env: Env, name: string, mode: string): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(name + " is required when IMA2_WEB_ACCESS=" + mode);
  return value;
}

function httpsOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("IMA2_WEB_PUBLIC_ORIGIN must be an https origin such as https://ima2.example.com"); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || raw.replace(/\/$/, "") !== url.origin) {
    throw new Error("IMA2_WEB_PUBLIC_ORIGIN must be an https origin such as https://ima2.example.com");
  }
  return url.origin;
}

function common(env: Env, configDir: string): CommonConfig {
  const timeZone = env.IMA2_WEB_SPEND_TIMEZONE?.trim() || "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone }); } catch { throw new Error("IMA2_WEB_SPEND_TIMEZONE is not a valid IANA time zone"); }
  return {
    allowedEmails: (env.IMA2_WEB_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    dailyCapUsd: positiveUsd(env, "IMA2_WEB_SPEND_DAILY_USD", 5),
    requestCapUsd: positiveUsd(env, "IMA2_WEB_SPEND_REQUEST_USD", 1),
    timeZone,
    ledgerFile: join(configDir, "web-spend-ledger.json"),
  };
}

export function loadWebAccessConfig(env: Env, configDir: string): WebAccessConfig | null {
  const mode = (env.IMA2_WEB_ACCESS ?? "").trim().toLowerCase();
  if (mode === "" || mode === "off") return null;
  if (mode === "cloudflare") {
    const domain = teamDomain(env.IMA2_CF_ACCESS_TEAM);
    const aud = required(env, "IMA2_CF_ACCESS_AUD", mode);
    return { mode, teamDomain: domain, aud, ...common(env, configDir) };
  }
  if (mode === "google") {
    const clientId = required(env, "IMA2_GOOGLE_CLIENT_ID", mode);
    const clientSecret = required(env, "IMA2_GOOGLE_CLIENT_SECRET", mode);
    const sessionSecret = required(env, "IMA2_WEB_SESSION_SECRET", mode);
    if (Buffer.byteLength(sessionSecret) < 32) throw new Error("IMA2_WEB_SESSION_SECRET must be at least 32 bytes");
    const publicOrigin = httpsOrigin(required(env, "IMA2_WEB_PUBLIC_ORIGIN", mode));
    const shared = common(env, configDir);
    // Google accepts any account, so the allow list is the only gate: refuse to start without one.
    if (shared.allowedEmails.length === 0) throw new Error("IMA2_WEB_ALLOWED_EMAILS is required when IMA2_WEB_ACCESS=google");
    return { mode, clientId, clientSecret, sessionSecret, publicOrigin, revokedFile: join(configDir, "web-sessions-revoked.json"), ...shared };
  }
  throw new Error("IMA2_WEB_ACCESS must be \"cloudflare\", \"google\" or \"off\"");
}
