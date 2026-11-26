import type { MediaPrice, MediaRoute } from "./mediaCatalog";
import { resolutionRank } from "./mediaModelList";
import type { MediaSelection } from "./mediaSelection";

/** The unit the server prices this job by (lib/providers/media/estimate.ts): images by the image, video by the second, else per request. */
export function estimateUnit(kind: "image" | "video", pricing: readonly MediaPrice[]): "image" | "second" | "request" {
  const unit = kind === "image" ? "image" : "second";
  return !pricing.some((price) => price.unit === unit) && pricing.some((price) => price.unit === "request") ? "request" : unit;
}

export function estimateQuantity(unit: "image" | "second" | "request", selection: Pick<MediaSelection, "durationSec">): number | null {
  if (unit === "second") return selection.durationSec ?? null;
  return 1;
}

const TASK_NAME = /(?:text|image|reference|video)-to-(?:image|video)/g;
const RESOLUTION = /\b(?:\d{3,4}p|\d(?:\.\d)?k)\b/gi;

/**
 * Whether a published price row applies to this request, and how specifically. Variant names are free
 * text written by each provider page ("text-to-video:720p", "1080p 16:9, no video input", "each input image"),
 * so this reads the parts it knows and refuses rows that name something the request is not.
 */
function variantScore(variant: string | undefined, want: { task: string; resolution?: string; audio?: boolean }): number | null {
  if (!variant) return 1;
  const text = variant.toLowerCase();
  let score = 1;
  if (/\beach input\b|\bper input\b/.test(text)) return null;
  // The classic composer never sends a video, so rows priced for a video input do not apply.
  if (/video[ _]in(?:put)?\b/.test(text) && !/\b(?:no|non|without)[ _]video[ _]in/.test(text)) return null;
  const tasks = text.match(TASK_NAME);
  if (tasks) { if (!tasks.includes(want.task)) return null; score += 4; }
  const resolutions = text.match(RESOLUTION);
  if (resolutions && want.resolution) {
    const wanted = want.resolution.toLowerCase();
    if (resolutions.includes(wanted)) score += 3;
    else {
      // "up to 1.5K" covers 1K; the tightest bound that covers the request is the row that applies.
      const covering = /\bup to\b|<=/.test(text) ? resolutions.map(resolutionRank).filter((rank) => rank >= resolutionRank(wanted)) : [];
      if (covering.length === 0) return null;
      score += 2 + 1 / (1 + (Math.min(...covering) - resolutionRank(wanted)) / 1000);
    }
  }
  if (/\b(?:no|without)[ -]audio\b|\bsilent\b/.test(text)) { if (want.audio) return null; score += 1; }
  else if (/\baudio\b|\bsound\b/.test(text)) { if (!want.audio) return null; score += 1; }
  return score;
}

export interface PricePick {
  /** The one row that applies, when the request settles it. */
  price: MediaPrice | null;
  /** The row is a published starting price ("from"), so the real charge can be higher. */
  floor: boolean;
  /** Lowest and highest applicable unit price when several rows still apply (a quality tier the UI does not set). */
  range: { min: number; max: number } | null;
}

export function pickPrice(pricing: readonly MediaPrice[], unit: string, want: { task: string; resolution?: string; audio?: boolean }): PricePick {
  const scored = pricing.filter((price) => price.unit === unit)
    .flatMap((price) => { const score = variantScore(price.variant, want); return score === null ? [] : [{ price, score }]; });
  if (scored.length === 0) return { price: null, floor: false, range: null };
  const top = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top).map((entry) => entry.price);
  const min = Math.min(...best.map((price) => price.usd));
  const max = Math.max(...best.map((price) => price.usd));
  if (min !== max) return { price: null, floor: false, range: { min, max } };
  return { price: best[0]!, floor: /\bstarting\b|\bfrom\b/i.test(best[0]!.variant ?? ""), range: null };
}

export type MediaQuote =
  | { state: "exact"; usd: number; unit: string; quantity: number; price: MediaPrice }
  | { state: "from"; usd: number; unit: string; quantity: number; price: MediaPrice }
  | { state: "range"; min: number; max: number; unit: string; quantity: number }
  | { state: "unpriced" }
  | { state: "unknown" };

/** The estimate the published prices support for this selection, before asking the server to confirm it. */
export function quoteFor(route: Pick<MediaRoute, "pricing">, selection: MediaSelection): MediaQuote {
  if (route.pricing.length === 0) return { state: "unpriced" };
  const unit = estimateUnit(selection.kind, route.pricing);
  const quantity = estimateQuantity(unit, selection);
  const want: { task: string; resolution?: string; audio?: boolean } = { task: selection.task };
  if (selection.resolution !== undefined) want.resolution = selection.resolution;
  if (selection.audio !== undefined) want.audio = selection.audio;
  const pick = pickPrice(route.pricing, unit, want);
  if (quantity === null || (!pick.price && !pick.range)) return { state: "unknown" };
  // Rounded up to a hundredth of a cent; the small allowance keeps 0.07 x 1 from becoming 0.0701 through binary fractions.
  const round = (usd: number) => Math.ceil(usd * quantity * 10000 - 1e-6) / 10000;
  if (pick.price) return { state: pick.floor ? "from" : "exact", usd: round(pick.price.usd), unit, quantity, price: pick.price };
  return { state: "range", min: round(pick.range!.min), max: round(pick.range!.max), unit, quantity };
}

/** POST /api/media/estimate body for an exact quote: the same fields the job will send, plus the price row it expects. */
export function estimateBody(selection: MediaSelection, adapter: string, price: MediaPrice): Record<string, unknown> {
  const body: Record<string, unknown> = { model: selection.model, adapter, task: selection.task };
  if (selection.durationSec !== undefined) body.durationSec = selection.durationSec;
  if (selection.resolution !== undefined) body.resolution = selection.resolution;
  if (selection.aspectRatio !== undefined) body.aspectRatio = selection.aspectRatio;
  if (selection.audio !== undefined) body.audio = selection.audio;
  if (selection.kind === "image") body.count = 1;
  if (price.variant) body.priceVariant = price.variant;
  return body;
}
