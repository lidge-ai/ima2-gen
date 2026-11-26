/**
 * Black Forest Labs catalog for the bfl adapter. Fields and prices come from
 * https://api.bfl.ai/openapi.json and https://bfl.ai/pricing, read 2026-11-26
 * (see devlog lanes/L4.md). Each upstream id belongs to one request family.
 */
import type { MediaModelSpec, MediaPrice } from "../contract.js";

export type BflFamily = "kontext" | "flux2" | "flux2-flex" | "flux3" | "flux3-klein";

const CHECKED_AT = "2026-11-26";
const KONTEXT_PRICING = "https://bfl.ai/pricing";
const FLUX2_PRICING = "https://bfl.ai/pricing?category=flux.2";
const FLUX3_PRICING = "https://bfl.ai/pricing?category=flux+3+image";
const DOCS = "https://docs.bfl.ai";

/** Kontext takes any ratio between 21:9 and 9:21; FLUX.2 ratios map to ~1 MP sizes (bflBody.ts). */
const COMMON_RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "9:21"] as const;
const FLUX3_RATIOS = ["auto", "21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"] as const;
const FLUX3_RESOLUTIONS = ["768sq", "1k", "1.5k", "2k", "4k"] as const;

const price = (usd: number, unit: MediaPrice["unit"], source: string, variant?: string): MediaPrice =>
  variant ? { unit, usd, variant, source, checkedAt: CHECKED_AT } : { unit, usd, source, checkedAt: CHECKED_AT };

interface Entry { upstreamId: string; label: string; family: BflFamily; pricing: MediaPrice[] }

function tierPrices(usd: readonly number[]): MediaPrice[] {
  return FLUX3_RESOLUTIONS.map((tier, index) => price(usd[index] ?? 0, "image", FLUX3_PRICING, tier));
}

const ENTRIES: readonly Entry[] = [
  { upstreamId: "flux-kontext-max", label: "FLUX.1 Kontext [max]", family: "kontext", pricing: [price(0.08, "image", KONTEXT_PRICING)] },
  { upstreamId: "flux-kontext-pro", label: "FLUX.1 Kontext [pro]", family: "kontext", pricing: [price(0.04, "image", KONTEXT_PRICING)] },
  {
    upstreamId: "flux-2-max", label: "FLUX.2 [max]", family: "flux2",
    pricing: [price(0.07, "megapixel", FLUX2_PRICING, "first output MP"), price(0.03, "megapixel", FLUX2_PRICING, "additional output MP"), price(0.03, "megapixel", FLUX2_PRICING, "input reference MP")],
  },
  {
    upstreamId: "flux-2-pro", label: "FLUX.2 [pro]", family: "flux2",
    pricing: [price(0.03, "megapixel", FLUX2_PRICING, "first output MP"), price(0.015, "megapixel", FLUX2_PRICING, "additional output MP"), price(0.015, "megapixel", FLUX2_PRICING, "input reference MP")],
  },
  {
    upstreamId: "flux-2-flex", label: "FLUX.2 [flex]", family: "flux2-flex",
    pricing: [price(0.05, "megapixel", FLUX2_PRICING, "output MP"), price(0.05, "megapixel", FLUX2_PRICING, "input reference MP")],
  },
  { upstreamId: "flux-3-image", label: "FLUX 3 Image", family: "flux3", pricing: tierPrices([0.041, 0.048, 0.07, 0.10, 0.607]) },
  { upstreamId: "flux-3-image-klein", label: "FLUX 3 Image Klein", family: "flux3-klein", pricing: tierPrices([0.008, 0.009, 0.011, 0.014, 0.036]) },
];

function params(family: BflFamily): MediaModelSpec["params"] {
  switch (family) {
    case "kontext": return { aspectRatios: COMMON_RATIOS, maxReferenceImages: 1, seed: true };
    case "flux2":
    case "flux2-flex": return { aspectRatios: COMMON_RATIOS, maxReferenceImages: 8, seed: true };
    case "flux3": return { aspectRatios: FLUX3_RATIOS, resolutions: FLUX3_RESOLUTIONS, maxReferenceImages: 10 };
    case "flux3-klein": return { aspectRatios: FLUX3_RATIOS, resolutions: FLUX3_RESOLUTIONS, maxReferenceImages: 10, seed: true };
  }
}

export const BFL_FAMILY: ReadonlyMap<string, BflFamily> = new Map(ENTRIES.map((entry) => [entry.upstreamId, entry.family]));

export const BFL_MODELS: readonly MediaModelSpec[] = ENTRIES.map((entry) => ({
  id: `black-forest-labs/${entry.upstreamId}`,
  upstreamId: entry.upstreamId,
  vendor: "black-forest-labs",
  label: entry.label,
  kind: "image",
  tasks: ["text-to-image", "image-to-image"],
  params: params(entry.family),
  pricing: entry.pricing,
  docsUrl: `${DOCS}/api-reference`,
}));
