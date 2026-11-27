import type { MediaPrice } from "./contract.js";

/**
 * Finds the published price row a request asks for, from the parts a provider puts in a
 * variant name: "1K · low", "turbo", "TURBO", "text-to-image:low", "720p", "720p+audio".
 * Exact names (resolution · quality, resolution+audio, resolution) win first. Otherwise a row
 * matches when every part of its variant is something the request says (resolution, quality
 * or task, case-insensitive), and the most specific such row wins. When the request names a
 * quality and some rows name one, rows without it do not match. Rows naming anything the
 * request does not say never match, so nothing is guessed: no row means no match.
 */
export interface PriceRequest {
  resolution?: string | undefined;
  quality?: string | undefined;
  task?: string | undefined;
  audio?: boolean | undefined;
}

export function priceVariantParts(variant: string): string[] {
  return variant.toLowerCase().split(/\s*[·:]\s*|\s+/).filter(Boolean);
}

function exactNames(request: PriceRequest): string[] {
  const res = request.resolution;
  return [
    res && request.quality ? res + " · " + request.quality : undefined,
    res && request.audio ? res + "+audio" : undefined,
    res,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function matchPriceVariant<P extends MediaPrice>(prices: readonly P[], request: PriceRequest): P | undefined {
  for (const name of exactNames(request)) {
    const exact = prices.find((p) => p.variant === name);
    if (exact) return exact;
  }
  const quality = request.quality?.toLowerCase();
  const said = new Set([request.resolution, request.quality, request.task].filter((v): v is string => !!v).map((v) => v.toLowerCase()));
  const qualityPriced = !!quality && prices.some((p) => p.variant && priceVariantParts(p.variant).includes(quality));
  let best: P | undefined;
  let bestParts = 0;
  for (const price of prices) {
    if (!price.variant) continue;
    const parts = priceVariantParts(price.variant);
    if (!parts.every((part) => said.has(part))) continue;
    if (qualityPriced && !parts.includes(quality!)) continue;
    if (parts.length > bestParts) { best = price; bestParts = parts.length; }
  }
  return best;
}
