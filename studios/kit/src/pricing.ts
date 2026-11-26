import type { CostEstimate, MediaPrice } from "./types.ts";

export interface PricedRequest {
  durationSec?: number;
  resolution?: string;
  audio?: boolean;
  count?: number;
  /** Output megapixels, for megapixel-priced image models. */
  megapixels?: number;
}

function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "$" + usd.toFixed(4).replace(/0+$/, "");
  return "$" + usd.toFixed(usd < 1 ? 3 : 2).replace(/(\.\d\d)0$/, "$1");
}

/** Variant names are free text ("720p", "1080p+audio"); match on the tokens we know. */
function variantScore(price: MediaPrice, request: PricedRequest): number {
  if (!price.variant) return 1;
  const tokens = price.variant.toLowerCase().split(/[+,\s/]+/).filter(Boolean);
  let score = 2;
  for (const token of tokens) {
    if (token === "audio") score += request.audio ? 1 : -10;
    else if (token === "silent" || token === "no-audio") score += request.audio ? -10 : 1;
    else if (request.resolution && token === request.resolution.toLowerCase()) score += 2;
    else if (/^\d{3,4}p$|^[124]k$/.test(token)) score -= 10;
  }
  return score;
}

export function pickPrice(pricing: readonly MediaPrice[], request: PricedRequest): MediaPrice | null {
  let best: MediaPrice | null = null;
  let bestScore = 0;
  for (const price of pricing) {
    const score = variantScore(price, request);
    if (score > bestScore) { best = price; bestScore = score; }
  }
  return best;
}

function unitsFor(price: MediaPrice, request: PricedRequest): { units: number; label: string } | null {
  const count = Math.max(1, request.count ?? 1);
  switch (price.unit) {
    case "second":
      return request.durationSec ? { units: request.durationSec * count, label: request.durationSec + " s" } : null;
    case "minute":
      return request.durationSec ? { units: (request.durationSec / 60) * count, label: request.durationSec + " s" } : null;
    case "image":
      return { units: count, label: count + " image" + (count > 1 ? "s" : "") };
    case "request":
      return { units: count, label: count + " request" + (count > 1 ? "s" : "") };
    case "megapixel":
      return request.megapixels ? { units: request.megapixels * count, label: request.megapixels + " MP" } : null;
    default:
      return null;
  }
}

/** Estimate from published prices only. usd is null when the model has no price or the unit cannot be derived. */
export function estimateCost(pricing: readonly MediaPrice[], request: PricedRequest): CostEstimate {
  const price = pickPrice(pricing, request);
  if (!price) return { usd: null, basis: "No published price" };
  const units = unitsFor(price, request);
  const per = money(price.usd) + "/" + price.unit + (price.variant ? " (" + price.variant + ")" : "");
  if (!units) return { usd: null, basis: per };
  const count = Math.max(1, request.count ?? 1);
  const times = count > 1 && price.unit !== "image" && price.unit !== "request" ? " x " + count : "";
  return { usd: units.units * price.usd, basis: units.label + times + " at " + per };
}

export function formatUsd(estimate: CostEstimate): string {
  return estimate.usd === null ? "Price not published" : money(estimate.usd);
}

export function sumEstimates(parts: readonly CostEstimate[]): CostEstimate {
  if (parts.some((part) => part.usd === null)) {
    return { usd: null, basis: "At least one step has no published price" };
  }
  const usd = parts.reduce((total, part) => total + (part.usd ?? 0), 0);
  return { usd, basis: parts.length + " steps" };
}
