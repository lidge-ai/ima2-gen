import type { MediaModelSpec, MediaPrice } from "../contract.js";

const SOURCE = "https://www.recraft.ai/docs/api-reference/pricing.md";
const price = (usd: number, variant?: string): MediaPrice => ({ unit: "image", usd, source: SOURCE, checkedAt: "2026-11-26", ...(variant ? { variant } : {}) });
export const RATIOS = ["auto", "1:1", "2:1", "1:2", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "6:10", "14:10", "10:14", "16:9", "9:16"] as const;
const entries = [
  ["recraft-v4", "recraftv4", 0.04], ["recraft-v4-vector", "recraftv4_vector", 0.08],
  ["recraft-v4-pro", "recraftv4_pro", 0.25], ["recraft-v4-pro-vector", "recraftv4_pro_vector", 0.30],
  ["recraft-v4.1", "recraftv4_1", 0.035], ["recraft-v4.1-vector", "recraftv4_1_vector", 0.08],
  ["recraft-v4.1-pro", "recraftv4_1_pro", 0.21], ["recraft-v4.1-pro-vector", "recraftv4_1_pro_vector", 0.30],
  ["recraft-v4.1-flash-v2", "recraftv4_1_flash_v2", 0.007],
] as const;
const docsUrl = "https://www.recraft.ai/docs/api-reference/agents.md";

/** "recraft-v4.1-pro-vector" -> "Recraft V4.1 Pro Vector". */
export function recraftLabel(id: string): string {
  const words = id.replace(/^recraft-/, "").split("-").map((part) =>
    /^v\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1));
  return `Recraft ${words.join(" ")}`;
}

const generations: MediaModelSpec[] = entries.map(([id, upstreamId, usd]) => ({
  id: `recraft/${id}`, upstreamId, vendor: "recraft", label: recraftLabel(id), kind: "image",
  tasks: upstreamId.includes("flash") ? ["text-to-image"] : ["text-to-image", "image-to-image"],
  params: { aspectRatios: RATIOS, maxReferenceImages: 1, seed: true }, pricing: [price(usd)], docsUrl,
}));
// The guide describes vectorize version selection but OpenAPI omits it; only the default is sent.
const utilities: MediaModelSpec[] = [
  ["recraft-vectorize", "vectorize", "image-vectorize", 0.01],
  ["recraft-crisp-upscale", "crispUpscale", "image-upscale", 0.004],
  ["recraft-creative-upscale", "creativeUpscale", "image-upscale", 0.25],
].map(([id, upstreamId, task, usd]) => ({
  id: `recraft/${id}`, upstreamId: String(upstreamId), vendor: "recraft", label: recraftLabel(String(id)), kind: "image",
  tasks: [task as "image-vectorize" | "image-upscale"], params: { maxReferenceImages: 1 }, pricing: [price(Number(usd))], docsUrl,
}));
export const RECRAFT_MODELS: readonly MediaModelSpec[] = [...generations, ...utilities];
