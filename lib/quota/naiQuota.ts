import type { RouteRuntimeContext } from "../runtimeContext.js";
import { fetchNaiSubscription } from "../naiSubscription.js";
import type { QuotaResult } from "./types.js";

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
