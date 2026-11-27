/**
 * The one place a published price row is chosen for a request, and the estimate made from it.
 * POST /api/media/estimate answers with this, and the web UI, the CLI and the MCP tools all show that answer.
 *
 * Variant names are free text written by each provider's price page ("text-to-video:720p",
 * "1080p 16:9, no video input", "1K · low", "with audio=False, model variant=pro"), so a row is read for
 * the parts it names (task, resolution, quality tier, sound, clip length, video input) and is refused
 * when it names something the request is not. Nothing is guessed: when several rows still apply at
 * different prices the answer is their range.
 *
 * No imports, so the UI's test fixtures can load this file as it is.
 */
export interface PriceRow { unit: string; usd: number; variant?: string }

export interface PriceWant {
  task: string;
  resolution?: string;
  audio?: boolean;
  durationSec?: number;
  quality?: string;
  /** Every quality the route lists, so a row naming another tier can be told apart. */
  qualities?: readonly string[];
}

/** A number that orders resolution labels ("720p", "4K", "1024x1536"); 0 when the label says nothing ("auto"). */
export function resolutionRank(label: string): number {
  const text = label.toLowerCase();
  const size = /(\d{3,5})\s*x\s*(\d{3,5})/.exec(text);
  if (size) return Math.max(Number(size[1]), Number(size[2]));
  const lines = /(\d{3,4})\s*p/.exec(text);
  if (lines) return Number(lines[1]);
  const k = /(\d+(?:\.\d+)?)\s*k/.exec(text);
  if (k) return Number(k[1]) * (Number(k[1]) >= 4 ? 540 : 1000);
  const plain = /(\d{3,5})/.exec(text);
  return plain ? Number(plain[1]) : 0;
}

const USAGE_UNITS: readonly string[] = ["megapixel", "1k-tokens", "minute", "character"];
const TASK_NAME = /(?:text|image|reference|video)-to-(?:image|video)/g;
const RESOLUTION = /\b(?:\d{3,4}p|\d(?:\.\d)?k)\b/gi;

/** The listed quality tiers a row names as whole words ("high" is not found in "xhigh" or "very_high"). */
function tiersIn(text: string, qualities: readonly string[]): string[] {
  const words = text.split(/[^a-z0-9_]+/);
  return qualities.filter((tier) => words.includes(tier.toLowerCase()));
}

/** Whether a row applies to the request, and how specifically; null when it names something the request is not. */
function variantScore(variant: string | undefined, want: PriceWant): number | null {
  if (!variant) return 1;
  const text = variant.toLowerCase();
  let score = 1;
  if (/\beach input\b|\bper input\b/.test(text)) return null;
  // Rows priced for a video input apply only to requests that send one, which an estimate does not describe.
  if (/video[ _-]in(?:put)?\b|\bvideo references\b/.test(text) && !/\b(?:no|non|without)[ _-]video[ _-]in|\bno video references\b/.test(text)) return null;
  // Rows for a request that carries source images are the edit price.
  if (/with[ _-]source[ _-]images/.test(text)) { if (want.task !== "image-to-image") return null; score += 4; }
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
  if (want.quality !== undefined && want.qualities?.length) {
    const tiers = tiersIn(text, want.qualities);
    if (tiers.length > 0) { if (!tiers.some((tier) => tier.toLowerCase() === want.quality!.toLowerCase())) return null; score += 3; }
  }
  // A row priced for one clip length ("768P 6s") applies to that length only.
  const lengths = text.match(/\b\d{1,3}s\b/g);
  if (lengths && want.durationSec !== undefined) { if (!lengths.includes(want.durationSec + "s")) return null; score += 2; }
  // Providers word sound many ways: "without audio", "audio off", "with audio=False", "sound disabled", "without_audio".
  const sound = text.replace(/[a-z]+-to-audio/g, "");
  if (/(?:no|without)[ _-]audio|audio[ =](?:off|false)|sound disabled|\bsilent\b/.test(sound)) { if (want.audio) return null; score += 1; }
  else if (/audio|sound/.test(sound)) { if (!want.audio) return null; score += 1; }
  return score;
}

export interface PricePick<T extends PriceRow = PriceRow> {
  /** The one row that applies, when the request settles it. */
  price: T | null;
  /** The row is a published starting price ("from"), so the real charge can be higher. */
  floor: boolean;
  /** Lowest and highest applicable unit price when several rows still apply at different prices. */
  range: { min: number; max: number } | null;
}

export function pickPrice<T extends PriceRow>(pricing: readonly T[], unit: string, want: PriceWant): PricePick<T> {
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

export type MediaQuote<T extends PriceRow = PriceRow> =
  | { state: "exact"; usd: number; unit: string; quantity: number; price: T }
  /** The row is a published starting price, so the charge can be higher. */
  | { state: "from"; usd: number; unit: string; quantity: number; price: T }
  | { state: "range"; min: number; max: number; unit: string; quantity: number }
  /** Priced per megapixel, token, minute or character: it depends on the output, so there is no figure. */
  | { state: "usage"; unit: string }
  | { state: "unpriced" }
  | { state: "unknown" };

export interface QuoteRequest {
  kind: string;
  task: string;
  resolution?: string;
  quality?: string;
  audio?: boolean;
  durationSec?: number;
  /** Images asked for; one when absent. */
  count?: number;
}

/** 5 s when the route offers it (the length most prices are quoted for), otherwise its shortest clip. */
export function defaultDuration(allowed: readonly number[] | undefined): number | undefined {
  if (!allowed?.length) return undefined;
  return allowed.includes(5) ? 5 : Math.min(...allowed);
}

/** Images are priced by the image, everything else by the second; a route with only per-run prices is priced per request. */
export function quoteUnit(kind: string, pricing: readonly PriceRow[]): "image" | "second" | "request" {
  const unit = kind === "image" ? "image" : "second";
  return !pricing.some((price) => price.unit === unit) && pricing.some((price) => price.unit === "request") ? "request" : unit;
}

/** Whole millionths of a dollar first (0.07 x 1 is not 0.07000000000000001), then up to a hundredth of a cent. */
export function roundUsd(usd: number): number {
  return Math.ceil(Math.round(usd * 1_000_000) / 100) / 10_000;
}

/** What the published prices say this request costs. One image and the route's default clip length are assumed when not given. */
export function quoteFor<T extends PriceRow>(route: { pricing: readonly T[]; params?: { qualities?: readonly string[]; durationsSec?: readonly number[] } }, request: QuoteRequest): MediaQuote<T> {
  if (route.pricing.length === 0) return { state: "unpriced" };
  const unit = quoteUnit(request.kind, route.pricing);
  const durationSec = request.durationSec ?? (request.kind === "image" ? undefined : defaultDuration(route.params?.durationsSec));
  const quantity = unit === "second" ? durationSec ?? null : unit === "image" ? request.count ?? 1 : 1;
  if (!route.pricing.some((price) => price.unit === unit)) {
    const usage = route.pricing.find((price) => USAGE_UNITS.includes(price.unit));
    if (usage) return { state: "usage", unit: usage.unit };
  }
  const want: PriceWant = { task: request.task };
  if (request.quality !== undefined && route.params?.qualities?.length) { want.quality = request.quality; want.qualities = route.params.qualities; }
  if (request.resolution !== undefined) want.resolution = request.resolution;
  if (request.audio !== undefined) want.audio = request.audio;
  if (durationSec !== undefined) want.durationSec = durationSec;
  const pick = pickPrice(route.pricing, unit, want);
  if (quantity === null || (!pick.price && !pick.range)) return { state: "unknown" };
  if (pick.price) return { state: pick.floor ? "from" : "exact", usd: roundUsd(pick.price.usd * quantity), unit, quantity, price: pick.price };
  return { state: "range", min: roundUsd(pick.range!.min * quantity), max: roundUsd(pick.range!.max * quantity), unit, quantity };
}
