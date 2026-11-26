import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteJson } from "../atomicWrite.js";
import { MediaJobError } from "../providers/media/errors.js";
import type { MediaModelSpec, MediaPrice, MediaSubmitRequest } from "../providers/media/contract.js";

/**
 * Instance-wide spend guard for the shared-key web deployment. Every admitted
 * job is charged its estimate up front (no refunds: a failed upstream job may
 * still bill), so the daily total is an upper bound on real spend.
 */
export interface SpendEstimate { usd: number | null; basis: "exact" | "upper-bound" }
export interface SpendEntry { at: string; requestId: string; model: string; email: string; usd: number; basis: SpendEstimate["basis"] }
export interface SpendGuardOptions { dailyCapUsd: number; requestCapUsd: number; ledgerFile: string; timeZone: string; now?: () => number }
interface Ledger { version: 1; days: Record<string, { spentUsd: number; entries: SpendEntry[] }> }

const KEEP_DAYS = 31;
const round = (usd: number) => Math.round(usd * 10_000) / 10_000;
const money = (usd: number) => "$" + usd.toFixed(2);

function quantityFor(unit: MediaPrice["unit"], spec: MediaModelSpec, request: MediaSubmitRequest): { quantity: number; exact: boolean } | null {
  if (unit === "image") return { quantity: Math.max(1, Math.floor(request.count ?? 1)), exact: true };
  if (unit === "request") return { quantity: 1, exact: true };
  if (unit === "second") {
    if (typeof request.durationSec === "number" && request.durationSec > 0) return { quantity: Math.ceil(request.durationSec), exact: true };
    const longest = Math.max(0, ...(spec.params.durationsSec ?? []));
    return longest > 0 ? { quantity: longest, exact: false } : null;
  }
  if (unit === "minute" && typeof request.durationSec === "number" && request.durationSec > 0) {
    return { quantity: Math.ceil(request.durationSec / 60), exact: true };
  }
  if (unit === "character" && typeof request.prompt === "string" && request.prompt.length > 0) return { quantity: request.prompt.length, exact: true };
  return null;
}

function variantCandidates(request: MediaSubmitRequest): string[] {
  const quality = typeof request.vendorOptions?.quality === "string" ? request.vendorOptions.quality : undefined;
  const res = request.resolution;
  return [
    res && quality ? res + " · " + quality : undefined,
    res && request.audio ? res + "+audio" : undefined,
    res,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Published price for this request; the highest listed price when the variant cannot be matched. Never guesses a missing price. */
export function estimateMediaUsd(spec: MediaModelSpec, request: MediaSubmitRequest): SpendEstimate {
  for (const unit of [...new Set(spec.pricing.map((p) => p.unit))]) {
    const qty = quantityFor(unit, spec, request);
    if (!qty) continue;
    const prices = spec.pricing.filter((p) => p.unit === unit);
    const candidates = variantCandidates(request);
    const match = candidates.map((c) => prices.find((p) => p.variant === c)).find(Boolean)
      ?? (prices.length === 1 && prices[0]!.variant === undefined ? prices[0] : undefined);
    const usd = match ? match.usd : Math.max(...prices.map((p) => p.usd));
    return { usd: round(usd * qty.quantity), basis: match && qty.exact ? "exact" : "upper-bound" };
  }
  return { usd: null, basis: "upper-bound" };
}

export function createSpendGuard(options: SpendGuardOptions) {
  const now = options.now ?? Date.now;
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  let ledger: Ledger | null = null;
  let loading: Promise<Ledger> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const load = (): Promise<Ledger> => {
    if (ledger) return Promise.resolve(ledger);
    loading ??= readFile(options.ledgerFile, "utf8").then((text) => JSON.parse(text) as Ledger, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return { version: 1, days: {} } as Ledger;
      throw error;
    }).then((value) => { ledger ??= value; return ledger; });
    return loading;
  };
  const persist = (snapshot: Ledger) => {
    writes = writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(options.ledgerFile), { recursive: true });
      await atomicWriteJson(options.ledgerFile, snapshot);
    });
    return writes;
  };
  async function status() {
    const data = await load();
    const day = dayOf.format(now());
    const today = data.days[day];
    return { day, spentUsd: today?.spentUsd ?? 0, dailyCapUsd: options.dailyCapUsd, requestCapUsd: options.requestCapUsd, entries: today?.entries ?? [] };
  }
  async function admit(input: { requestId: string; model: string; email: string; estimate: SpendEstimate }) {
    const { usd, basis } = input.estimate;
    if (usd === null) {
      throw new MediaJobError("WEB_SPEND_UNPRICED", input.model + " has no published price, so this shared instance does not run it.", { status: 403 });
    }
    if (usd > options.requestCapUsd) {
      throw new MediaJobError("WEB_SPEND_REQUEST_CAP", "This request is estimated at " + money(usd) + ", above the " + money(options.requestCapUsd) + " per-request limit. Lower the duration, resolution, quality or count.", { status: 402 });
    }
    const data = await load();
    // Check and charge synchronously after the load so parallel admissions cannot overshoot.
    const day = dayOf.format(now());
    const today = data.days[day] ??= { spentUsd: 0, entries: [] };
    if (round(today.spentUsd + usd) > options.dailyCapUsd) {
      throw new MediaJobError("WEB_SPEND_DAILY_CAP", "Today's shared budget of " + money(options.dailyCapUsd) + " has " + money(Math.max(0, options.dailyCapUsd - today.spentUsd)) + " left; this request needs " + money(usd) + ". It resets at midnight " + options.timeZone + ".", { status: 429, category: "rate-limit" });
    }
    today.spentUsd = round(today.spentUsd + usd);
    today.entries.push({ at: new Date(now()).toISOString(), requestId: input.requestId, model: input.model, email: input.email, usd, basis });
    for (const old of Object.keys(data.days).sort().slice(0, -KEEP_DAYS)) delete data.days[old];
    await persist(data);
    return { day, usd, spentUsd: today.spentUsd };
  }
  return { admit, status };
}

export type SpendGuard = ReturnType<typeof createSpendGuard>;
