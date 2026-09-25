import type { Express } from "express";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";
import { fetchNaiSubscription } from "../lib/naiSubscription.js";
import { readChatgptAccess } from "../lib/chatgptAuth.js";
import { logWarn } from "../lib/logger.js";

export interface QuotaWindow {
  label: string;
  percent: number;
  resetsAt: string | null;
}

export interface QuotaResult {
  provider: string;
  account?: { email: string | null; plan: string | null } | null;
  windows: QuotaWindow[];
  error?: boolean;
  authenticated?: boolean;
  billing?: { usedUsd: number; limitUsd: number };
  nai?: { active: boolean; isNegative: boolean; anlasFixed: number; anlasPurchased: number; meter: "charge" | "missing" };
}

/** Same file GPT OAuth reads (ima2 store first, then Codex CLI files). */
function readCodexTokens(): { access_token: string; account_id: string } | null {
  const access = readChatgptAccess();
  return access ? { access_token: access.accessToken, account_id: access.accountId } : null;
}

async function fetchCodexUsage(tokens: { access_token: string; account_id: string }): Promise<QuotaResult> {
  try {
    const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "ChatGPT-Account-Id": tokens.account_id,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return { provider: "codex", authenticated: false, windows: [] };
      return { provider: "codex", error: true, windows: [] };
    }
    const data = await resp.json() as {
      email?: string | null;
      plan_type?: string | null;
      rate_limit?: {
        primary_window?: { used_percent?: number; reset_at?: number };
        secondary_window?: { used_percent?: number; reset_at?: number };
      };
    };
    const account = { email: data.email ?? null, plan: data.plan_type ?? null };
    const windows: QuotaWindow[] = [];
    if (data.rate_limit?.primary_window) {
      windows.push({
        label: "5h",
        percent: Math.round(data.rate_limit.primary_window.used_percent ?? 0),
        resetsAt: data.rate_limit.primary_window.reset_at
          ? new Date(data.rate_limit.primary_window.reset_at * 1000).toISOString()
          : null,
      });
    }
    if (data.rate_limit?.secondary_window) {
      windows.push({
        label: "7d",
        percent: Math.round(data.rate_limit.secondary_window.used_percent ?? 0),
        resetsAt: data.rate_limit.secondary_window.reset_at
          ? new Date(data.rate_limit.secondary_window.reset_at * 1000).toISOString()
          : null,
      });
    }
    return { provider: "codex", account, windows };
  } catch {
    return { provider: "codex", error: true, windows: [] };
  }
}

function grokTierFromLimit(val: number): string {
  if (val >= 150_000) return "SuperGrok Heavy";
  if (val >= 15_000) return "SuperGrok";
  return `SuperGrok (${val} val)`;
}

interface GrokTokenCandidate {
  token: string;
  source: string;
  email: string | null;
  authMode: string | null;
  issuer: string | null;
  userId: string | null;
}

const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const GROK_CREDITS_URL = `${GROK_BILLING_URL}?format=credits`;
const GROK_USER_URL = "https://cli-chat-proxy.grok.com/v1/user";

function readGrokTokenCandidates(homeDir = homedir()): GrokTokenCandidate[] {
  const candidates: GrokTokenCandidate[] = [];
  try {
    const auth = JSON.parse(readFileSync(join(homeDir, ".grok", "auth.json"), "utf8")) as Record<string, unknown>;
    for (const [scope, entry] of Object.entries(auth)) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.key !== "string" || !value.key.trim()) continue;
      candidates.push({
        token: value.key,
        source: scope.startsWith("https://auth.x.ai::") ? "grok:auth-json-oidc" : "grok:auth-json",
        email: typeof value.email === "string" ? value.email : null,
        authMode: typeof value.auth_mode === "string" ? value.auth_mode : null,
        issuer: typeof value.oidc_issuer === "string" ? value.oidc_issuer : null,
        userId: typeof value.user_id === "string" ? value.user_id : null,
      });
    }
  } catch { /* best-effort: auth.json is optional; fall back to the next source */ }
  try {
    // Same file lib/xaiAuth.ts owns; spelled out so quota keeps its narrow node:fs surface.
    const auth = JSON.parse(readFileSync(join(homeDir, ".progrok", "auth.json"), "utf8")) as { accessToken?: string };
    if (typeof auth.accessToken === "string" && auth.accessToken.trim()) {
      candidates.push({
        token: auth.accessToken,
        source: "ima2:grok-auth-json",
        email: null,
        authMode: null,
        issuer: null,
        userId: null,
      });
    }
  } catch { /* best-effort: Grok auth.json is optional; fall back to the next source */ }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.token)) return false;
    seen.add(candidate.token);
    return true;
  });
}

function isWeeklyCandidate(candidate: GrokTokenCandidate): boolean {
  return (candidate.authMode === "oidc" || candidate.authMode === "external")
    && candidate.issuer === "https://auth.x.ai"
    && Boolean(candidate.userId?.trim());
}

function readGrokClientVersion(homeDir = homedir(), grokBinary = "grok"): string | null {
  for (const [file, field] of [["version.json", "version"], ["models_cache.json", "grok_version"]] as const) {
    try {
      const data = JSON.parse(readFileSync(join(homeDir, ".grok", file), "utf8")) as Record<string, unknown>;
      if (typeof data[field] === "string" && data[field].trim()) return data[field].trim();
    } catch { /* best-effort: version files are optional; fall back to the CLI probe */ }
  }
  try {
    const output = execFileSync(grokBinary, ["version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function inspectGrokWeeklyEligibility(homeDir = homedir(), grokBinary = "grok") {
  const candidates = readGrokTokenCandidates(homeDir);
  const xaiCandidates = candidates.filter((candidate) =>
    (candidate.authMode === "oidc" || candidate.authMode === "external")
    && candidate.issuer === "https://auth.x.ai");
  const eligibleCandidates = xaiCandidates.filter(isWeeklyCandidate);
  const clientVersion = readGrokClientVersion(homeDir, grokBinary);
  const reason = candidates.length === 0 ? "no-auth"
    : xaiCandidates.length === 0 ? "no-xai-auth"
      : eligibleCandidates.length === 0 ? "missing-user-id"
        : !clientVersion ? "no-version"
          : "ok";
  return {
    eligible: reason === "ok",
    reason,
    candidateCount: eligibleCandidates.length,
    clientVersion,
  };
}

export function parseGrokCreditsResponse(value: unknown): { percent: number; periodEnd: string } | null {
  if (!value || typeof value !== "object") return null;
  const config = (value as Record<string, unknown>).config;
  if (!config || typeof config !== "object") return null;
  const currentPeriod = (config as Record<string, unknown>).currentPeriod;
  if (!currentPeriod || typeof currentPeriod !== "object") return null;
  const period = currentPeriod as Record<string, unknown>;
  if (period.type !== "USAGE_PERIOD_TYPE_WEEKLY" || typeof period.end !== "string" || !Number.isFinite(Date.parse(period.end))) return null;
  const rawPercent = (config as Record<string, unknown>).creditUsagePercent;
  if (rawPercent !== undefined && (typeof rawPercent !== "number" || !Number.isFinite(rawPercent))) return null;
  return {
    percent: Math.round(Math.min(100, Math.max(0, rawPercent as number | undefined ?? 0))),
    periodEnd: period.end,
  };
}

async function fetchGrokWeeklyCredits(candidate: GrokTokenCandidate, clientVersion: string) {
  try {
    const response = await fetch(GROK_CREDITS_URL, {
      headers: {
        Authorization: `Bearer ${candidate.token}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        "x-authenticateresponse": "authenticate-response",
        "x-userid": candidate.userId!,
        "x-grok-client-version": clientVersion,
        "x-grok-client-mode": "headless",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return parseGrokCreditsResponse(await response.json());
  } catch (err) {
    logWarn("quota", "grok_weekly_credits_failed", { errorName: err instanceof Error ? err.name : typeof err });
    return null;
  }
}

export async function fetchGrokBilling(homeDir = homedir(), grokBinary = "grok"): Promise<QuotaResult> {
  const candidates = readGrokTokenCandidates(homeDir);
  if (!candidates.length) return { provider: "grok", authenticated: false, windows: [] };

  const clientVersion = readGrokClientVersion(homeDir, grokBinary);
  if (clientVersion) {
    for (const candidate of candidates.filter(isWeeklyCandidate)) {
      const weekly = await fetchGrokWeeklyCredits(candidate, clientVersion);
      if (weekly) {
        return {
          provider: "grok",
          account: { email: candidate.email, plan: "SuperGrok" },
          windows: [{ label: "weekly", percent: weekly.percent, resetsAt: weekly.periodEnd }],
        };
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const headers = { Authorization: `Bearer ${candidate.token}` };
      const [billingRes, userRes] = await Promise.allSettled([
        fetch(GROK_BILLING_URL, { headers, signal: AbortSignal.timeout(8000) }),
        fetch(GROK_USER_URL, { headers, signal: AbortSignal.timeout(5000) }),
      ]);
      if (billingRes.status !== "fulfilled" || !billingRes.value.ok) continue;
      const billing = (await billingRes.value.json() as {
        config: { monthlyLimit: { val: number }; used: { val: number }; billingPeriodEnd: string };
      }).config;
      const limit = billing.monthlyLimit.val;
      const used = billing.used.val;
      let email = candidate.email;
      if (userRes.status === "fulfilled" && userRes.value.ok) {
        const user = await userRes.value.json() as { email?: string };
        email = user.email ?? email;
      }
      return {
        provider: "grok",
        account: { email, plan: grokTierFromLimit(limit) },
        windows: [{
          label: "monthly",
          percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
          resetsAt: billing.billingPeriodEnd,
        }],
        billing: { usedUsd: used / 100, limitUsd: limit / 100 },
      };
    } catch (err) { logWarn("quota", "grok_billing_failed", { errorName: err instanceof Error ? err.name : typeof err }); }
  }
  return { provider: "grok", authenticated: true, windows: [] };
}

export async function fetchNaiQuota(ctx: RouteRuntimeContext): Promise<QuotaResult> {
  const result = await fetchNaiSubscription(ctx);
  if (result.ok === false) return {
    provider: "nai", windows: [],
    ...(result.status === 401 ? { authenticated: false } : { error: true }),
  };
  const { active, tier, battery, anlas } = result.snapshot;
  const nextPercentAt = battery?.timeUntilNextPercentSec == null
    ? null : new Date(Date.now() + battery.timeUntilNextPercentSec * 1000);
  return {
    provider: "nai",
    account: { email: null, plan: active ? `Tier ${tier}` : "inactive" },
    windows: battery ? [{
      label: "v5-battery", percent: battery.percent,
      resetsAt: nextPercentAt && Number.isFinite(nextPercentAt.getTime()) ? nextPercentAt.toISOString() : null,
    }] : [],
    nai: {
      active, isNegative: battery?.isNegative ?? false,
      anlasFixed: anlas.fixed, anlasPurchased: anlas.purchased,
      meter: battery ? "charge" : "missing",
    },
  };
}

export function registerQuotaRoutes(app: Express, ctx: RouteRuntimeContext) {
  app.get("/api/quota", async (_req, res) => {
    try {
      const tokens = readCodexTokens();
      const [codex, grok, nai] = await Promise.all([
        tokens ? fetchCodexUsage(tokens) : Promise.resolve({ provider: "codex", authenticated: false, windows: [] } as QuotaResult),
        fetchGrokBilling(),
        fetchNaiQuota(ctx),
      ]);
      res.json({ codex, grok, nai });
    } catch (e: unknown) {
      res.status(500).json({ error: "Failed to fetch quota" });
    }
  });
}
