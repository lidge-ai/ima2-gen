import type { QuotaResult, QuotaWindow } from "./types.js";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
let observation: { identity: string; value: NonNullable<QuotaResult["credits"]> | null } | null = null;
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  for (const [unit, suffix] of [[86400, "d"], [3600, "h"], [60, "m"]] as const) {
    if (seconds % unit === 0) return `${seconds / unit}${suffix}`;
  }
  return `${seconds}s`;
}
function window(value: unknown, id: string, name?: string): QuotaWindow | null {
  const raw = object(value); if (!raw) return null;
  const duration = number(raw.limit_window_seconds);
  const seconds = duration !== null && duration > 0 ? duration : null;
  const percent = number(raw.used_percent);
  const reset = number(raw.reset_at);
  const date = reset === null ? null : new Date(reset * 1000);
  return { id, label: name ?? durationLabel(seconds), durationSeconds: seconds,
    percent: percent === null ? null : Math.round(percent),
    resetsAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null };
}
function addWindows(windows: QuotaWindow[], raw: unknown, prefix = "", name?: string): void {
  const limits = object(raw); if (!limits) return;
  for (const key of ["primary", "secondary", "tertiary"]) {
    const item = window(limits[`${key}_window`], `${prefix}${key}`, name);
    if (item) windows.push(item);
  }
}
function plan(value: unknown): string | null {
  const raw = string(value); if (!raw) return raw;
  const names: Record<string, string> = { prolite: "Pro 100", pro: "Pro 200", promax: "Pro 500",
    sci: "Academic Researchers (Plus)", sci_plus: "Academic Researchers (Plus)", business: "Enterprise",
    self_serve_business_prolite: "Business Premium" };
  return names[raw] ?? (raw.startsWith("enterprise") || raw === "ent26" ? "Enterprise" : raw);
}
function credits(data: ObjectValue, identity: string): NonNullable<QuotaResult["credits"]> | null {
  if (observation?.identity !== identity) observation = null;
  if (!("credits" in data)) return observation?.value ?? null;
  const raw = object(data.credits);
  const result = raw && typeof raw.has_credits === "boolean" && typeof raw.unlimited === "boolean"
    && (typeof raw.balance === "string" || typeof raw.balance === "number" || raw.balance === null)
    ? { hasCredits: raw.has_credits, unlimited: raw.unlimited, balance: raw.balance as string | number | null } : null;
  observation = { identity, value: result }; return result;
}
export function projectCodexUsage(value: unknown, identity: string): QuotaResult {
  const data = object(value) ?? {}; const windows: QuotaWindow[] = [];
  addWindows(windows, data.rate_limit);
  if (Array.isArray(data.additional_rate_limits)) data.additional_rate_limits.forEach((entry: unknown, index: number) => {
    const item = object(entry); if (!item) return;
    const prefix = `additional:${string(item.metered_feature) ?? "unknown"}:${string(item.limit_name) ?? ""}:`;
    const before = windows.length;
    addWindows(windows, item.rate_limit, prefix, string(item.limit_name) ?? undefined);
    for (const w of windows.slice(before)) w.id += `:${index}`;
  });
  const reset = object(data.rate_limit_reset_credits);
  const upsell = object(data.rate_limit_upsell);
  return { provider: "codex", account: { email: string(data.email), plan: plan(data.plan_type) }, windows,
    credits: credits(data, identity), resetCredits: reset ? { availableCount: number(reset.available_count),
      applicableAvailableCount: number(reset.applicable_available_count) } : null,
    upsell: upsell ? { buyReset: !!upsell.buy_reset, viewUsage: !!upsell.view_usage } : null };
}
