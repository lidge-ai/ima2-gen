import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logWarn } from "../logger.js";
import { loadGrokCredentials } from "../xaiAuth.js";
import type { QuotaResult } from "./types.js";

function grokTierFromLimit(val: number): string {
  if (val >= 150_000) return "SuperGrok Heavy";
  if (val >= 15_000) return "SuperGrok";
  return `SuperGrok (${val} val)`;
}

interface GrokTokenCandidate {
  token: string;
  source: "grok-cli" | "ima2-session";
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
    for (const entry of Object.values(auth)) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.key !== "string" || !value.key.trim()) continue;
      candidates.push({
        token: value.key,
        source: "grok-cli",
        email: typeof value.email === "string" ? value.email : null,
        authMode: typeof value.auth_mode === "string" ? value.auth_mode : null,
        issuer: typeof value.oidc_issuer === "string" ? value.oidc_issuer : null,
        userId: typeof value.user_id === "string" ? value.user_id : null,
      });
    }
  } catch { /* best-effort: auth.json is optional; fall back to the next source */ }
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

export function parseGrokCreditsResponse(value: unknown): { percent: number | null; periodEnd: string; productUsage?: Array<{ product: string; percent: number }>; prepaidBalance?: number } | null {
  if (!value || typeof value !== "object") return null;
  const config = (value as Record<string, unknown>).config;
  if (!config || typeof config !== "object") return null;
  const currentPeriod = (config as Record<string, unknown>).currentPeriod;
  if (!currentPeriod || typeof currentPeriod !== "object") return null;
  const period = currentPeriod as Record<string, unknown>;
  if (period.type !== "USAGE_PERIOD_TYPE_WEEKLY" || typeof period.end !== "string" || !Number.isFinite(Date.parse(period.end))) return null;
  const rawPercent = (config as Record<string, unknown>).creditUsagePercent;
  if (rawPercent !== undefined && (typeof rawPercent !== "number" || !Number.isFinite(rawPercent))) return null;
  const data = config as Record<string, unknown>;
  const products = Array.isArray(data.productUsage) ? data.productUsage.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.product === "string" && typeof row.percent === "number" && Number.isFinite(row.percent)
      ? [{ product: row.product, percent: row.percent }] : [];
  }) : undefined;
  return {
    percent: typeof rawPercent === "number" ? Math.round(Math.min(100, Math.max(0, rawPercent))) : null,
    periodEnd: period.end,
    ...(products ? { productUsage: products } : {}),
    ...(typeof data.prepaidBalance === "number" && Number.isFinite(data.prepaidBalance) ? { prepaidBalance: data.prepaidBalance } : {}),
  };
}

async function fetchGrokWeeklyCredits(candidate: GrokTokenCandidate, clientVersion: string | null) {
  try {
    const response = await fetch(GROK_CREDITS_URL, {
      headers: {
        Authorization: `Bearer ${candidate.token}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        "x-authenticateresponse": "authenticate-response",
        ...(candidate.userId ? { "x-userid": candidate.userId } : {}),
        ...(clientVersion ? { "x-grok-client-version": clientVersion } : {}),
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
  const session = loadGrokCredentials(homeDir);
  if (session?.accessToken) {
    const weekly = await fetchGrokWeeklyCredits({ token: session.accessToken, source: "ima2-session", email: session.email ?? null,
      authMode: null, issuer: null, userId: session.accountId ?? null }, null);
    if (weekly) return { provider: "grok", source: "ima2-session", account: { email: session.email ?? null, plan: "SuperGrok" },
      windows: [{ label: "weekly", percent: weekly.percent, resetsAt: weekly.periodEnd }],
      ...(weekly.productUsage ? { productUsage: weekly.productUsage } : {}),
      ...(weekly.prepaidBalance !== undefined ? { prepaidBalance: weekly.prepaidBalance } : {}) };
  }
  if (session?.accessToken) candidates.push({ token: session.accessToken, source: "ima2-session",
    email: session.email ?? null, authMode: null, issuer: null, userId: session.accountId ?? null });
  if (!candidates.length) return { provider: "grok", authenticated: false, windows: [] };
  const clientVersion = readGrokClientVersion(homeDir, grokBinary);
  if (clientVersion) {
    for (const candidate of candidates.filter(isWeeklyCandidate)) {
      const weekly = await fetchGrokWeeklyCredits(candidate, clientVersion);
      if (weekly) {
        return {
          provider: "grok",
          source: "grok-cli",
          account: { email: candidate.email, plan: "SuperGrok" },
          windows: [{ label: "weekly", percent: weekly.percent, resetsAt: weekly.periodEnd }],
          ...(weekly.productUsage ? { productUsage: weekly.productUsage } : {}),
          ...(weekly.prepaidBalance !== undefined ? { prepaidBalance: weekly.prepaidBalance } : {}),
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
        source: candidate.source,
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
