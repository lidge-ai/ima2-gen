import type { MediaPrice } from "./contract.js";
import type { MediaKeySnapshot } from "./credentials.js";
import { MediaJobError } from "./errors.js";
import { selectMediaRoute, type MediaRegistry } from "./registry.js";
import type { MediaJobBody } from "./validate.js";

export interface MediaEstimate {
  model: string;
  adapter: string;
  route: "direct" | "aggregator";
  hasKey: boolean;
  unit: "image" | "second" | "request";
  quantity: number | null;
  usd: number | null;
  prices: readonly MediaPrice[];
  note?: string;
}

function priceEstimate(prices: readonly MediaPrice[], unit: MediaEstimate["unit"], quantity: number | null, variant?: string): { usd: number | null; note?: string } {
  const rows = prices.filter((price) => price.unit === unit);
  if (rows.length === 0) return { usd: null, note: `no published price for ${unit}` };
  const price = variant !== undefined ? rows.find((row) => row.variant === variant) : rows.length === 1 && !rows[0]!.variant ? rows[0] : undefined;
  if (!price) return { usd: null, note: variant !== undefined ? "priceVariant not found" : "several published variants: pass priceVariant" };
  if (quantity === null) return { usd: null, note: "quantity unknown: pass durationSec/count" };
  return { usd: Math.ceil(price.usd * quantity * 10000) / 10000 };
}

export function estimateMediaJob(registry: MediaRegistry, keys: MediaKeySnapshot, body: MediaJobBody & { priceVariant?: string }): MediaEstimate {
  const model = registry.getModel(body.model);
  const options = { modelId: body.model, adapterId: body.adapter, task: body.task, hasKey: (adapter: Parameters<MediaKeySnapshot["hasKey"]>[0]) => keys.hasKey(adapter) };
  let selection = selectMediaRoute(model, options);
  if (!selection.ok && selection.code === "MEDIA_KEY_MISSING") {
    selection = selectMediaRoute(model, { ...options, hasKey: () => true });
  }
  if (!selection.ok) {
    throw new MediaJobError(selection.code, selection.message, { status: selection.status, category: selection.status === 404 ? "not-found" : "invalid-request" });
  }
  const { adapter, spec } = selection;
  let unit: MediaEstimate["unit"] = spec.kind === "image" ? "image" : "second";
  let quantity = spec.kind === "image" ? body.count ?? null : body.durationSec ?? null;
  if (!spec.pricing.some((price) => price.unit === unit) && spec.pricing.some((price) => price.unit === "request")) {
    unit = "request";
    quantity = 1;
  }
  return { model: spec.id, adapter: adapter.id, route: adapter.route, hasKey: keys.hasKey(adapter), unit, quantity,
    prices: spec.pricing, ...priceEstimate(spec.pricing, unit, quantity, body.priceVariant) };
}
