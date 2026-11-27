import type { MediaLocalEstimate, MediaPrice } from "./contract.js";
import type { MediaKeySnapshot } from "./credentials.js";
import { MediaJobError } from "./errors.js";
import { defaultDuration, quoteFor, quoteUnit, roundUsd, type MediaQuote } from "./priceQuote.js";
import { selectMediaRoute, type MediaRegistry } from "./registry.js";
import type { MediaJobBody } from "./validate.js";

export interface MediaEstimate {
  model: string;
  adapter: string;
  route: "direct" | "aggregator" | "local";
  hasKey: boolean;
  unit: "image" | "second" | "request";
  /** One image and the route's default clip length are assumed when the request names neither. */
  quantity: number | null;
  /** Set when one published price applies; null for a range, a usage-billed price or no price. */
  usd: number | null;
  prices: readonly MediaPrice[];
  /** The same answer in full: exact, from, range (min and max), usage, unpriced or unknown. Every client shows this. */
  quote: MediaQuote<MediaPrice> | LocalQuote;
  note?: string;
  /** Present on a "local" route: there is no provider price, only time on the user's own machine. */
  local?: MediaLocalEstimate;
}

/** A "local" route has no provider price: the answer is time on the user's own machine (see local). */
export type LocalQuote = { state: "local" };

type Unit = MediaEstimate["unit"];

/** A row the caller named outright (priceVariant) is priced as it is, without matching. */
function namedQuote(prices: readonly MediaPrice[], unit: Unit, quantity: number | null, variant: string): { quote: MediaQuote<MediaPrice>; note?: string } {
  const price = prices.find((row) => row.unit === unit && row.variant === variant);
  if (!price) return { quote: { state: "unknown" }, note: prices.some((row) => row.unit === unit) ? "priceVariant not found" : `no published price for ${unit}` };
  if (quantity === null) return { quote: { state: "unknown" }, note: "quantity unknown: pass durationSec/count" };
  return { quote: { state: "exact", usd: roundUsd(price.usd * quantity), unit, quantity, price } };
}

function noteFor(quote: MediaQuote<MediaPrice>, prices: readonly MediaPrice[], unit: Unit, quantity: number | null): string | undefined {
  if (quote.state === "range") return "several published variants: set quality, resolution, audio or duration so one applies, or pass priceVariant";
  if (quote.state === "usage") return `billed per ${quote.unit}: the amount depends on the output`;
  if (quote.state === "unpriced" || (quote.state === "unknown" && !prices.some((row) => row.unit === unit))) return `no published price for ${unit}`;
  if (quote.state === "unknown") return quantity === null ? "quantity unknown: pass durationSec/count" : "no published price row matches this request";
  return undefined;
}

export function estimateMediaJob(registry: MediaRegistry, keys: MediaKeySnapshot, body: MediaJobBody & { priceVariant?: string }): MediaEstimate {
  const model = registry.getModel(body.model);
  const options = { modelId: body.model, adapterId: body.adapter, task: body.task, hasKey: (adapter: Parameters<MediaKeySnapshot["hasKey"]>[0]) => keys.hasKey(adapter) };
  let selection = selectMediaRoute(model, options);
  if (selection.ok === false && selection.code === "MEDIA_KEY_MISSING") {
    selection = selectMediaRoute(model, { ...options, hasKey: () => true });
  }
  if (selection.ok === false) {
    throw new MediaJobError(selection.code, selection.message, { status: selection.status, category: selection.status === 404 ? "not-found" : "invalid-request" });
  }
  const { adapter, spec } = selection;
  if (adapter.route === "local") {
    const local = adapter.estimateLocal?.(spec) ?? { expectedSec: null, basis: "no runs yet", mayBill: false };
    // A local run costs nothing from a provider. When the workflow can still be charged elsewhere, the amount is unknown, not zero.
    return { model: spec.id, adapter: adapter.id, route: "local", hasKey: true, unit: "request", quantity: 1,
      usd: local.mayBill ? null : 0, prices: [], quote: { state: "local" }, local,
      note: local.mayBill ? "runs locally, but this workflow may be charged by a paid node; ima2 cannot price it" : "runs locally; no provider charge" };
  }
  const unit = quoteUnit(spec.kind, spec.pricing);
  const durationSec = body.durationSec ?? (spec.kind === "image" ? undefined : defaultDuration(spec.params.durationsSec));
  const quantity = unit === "second" ? durationSec ?? null : unit === "image" ? body.count ?? 1 : 1;
  // vendorOptions.quality is the older spelling of the same setting.
  const quality = body.quality ?? (typeof body.vendorOptions?.quality === "string" ? body.vendorOptions.quality : undefined);
  const named = body.priceVariant !== undefined ? namedQuote(spec.pricing, unit, quantity, body.priceVariant) : undefined;
  const quote = named?.quote ?? quoteFor({ pricing: spec.pricing, params: spec.params }, {
    kind: spec.kind, task: body.task,
    ...(body.resolution !== undefined ? { resolution: body.resolution } : {}), ...(quality !== undefined ? { quality } : {}),
    ...(body.audio !== undefined ? { audio: body.audio } : {}), ...(body.durationSec !== undefined ? { durationSec: body.durationSec } : {}),
    ...(body.count !== undefined ? { count: body.count } : {}),
  });
  const note = named ? named.note : noteFor(quote, spec.pricing, unit, quantity);
  return { model: spec.id, adapter: adapter.id, route: adapter.route, hasKey: keys.hasKey(adapter), unit, quantity,
    usd: quote.state === "exact" || quote.state === "from" ? quote.usd : null, prices: spec.pricing, quote, ...(note ? { note } : {}) };
}
