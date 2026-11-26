import type { MediaModelSpec, MediaPrice, MediaTask } from "../contract.js";

const SOURCE = "https://docs.stability.ai/pricing.md";
const RATIOS = ["21:9", "16:9", "3:2", "5:4", "1:1", "4:5", "2:3", "9:16", "9:21"];
const price = (usd: number): MediaPrice[] => [{ unit: "image", usd, source: SOURCE, checkedAt: "2026-11-26" }];
interface Entry { id: string; upstreamId: string; label: string; tasks: MediaTask[]; params: MediaModelSpec["params"]; pricing: MediaPrice[] }
const generation = { aspectRatios: RATIOS, negativePrompt: true, seed: true };
// Audio: the pricing page and both text-to-audio endpoint references say 8 credits ($0.08) per generation;
// only platform.stability.ai/llms.txt says 20/26. The two primary pages agree, so 8 credits is used.
const audioPrice: MediaPrice[] = [{ unit: "request", usd: 0.08, source: SOURCE, checkedAt: "2026-11-26" }];
const entries: Entry[] = [
  { id: "stable-image-ultra", upstreamId: "ultra", label: "Stable Image Ultra", tasks: ["text-to-image", "image-to-image"], params: { ...generation, maxReferenceImages: 1 }, pricing: price(0.08) },
  { id: "stable-image-core", upstreamId: "core", label: "Stable Image Core", tasks: ["text-to-image"], params: generation, pricing: price(0.03) },
  { id: "sd3.5-large", upstreamId: "sd3.5-large", label: "Stable Diffusion 3.5 Large", tasks: ["text-to-image", "image-to-image"], params: { ...generation, maxReferenceImages: 1 }, pricing: price(0.065) },
  { id: "upscale-fast", upstreamId: "fast", label: "Fast Upscale", tasks: ["image-upscale"], params: { maxReferenceImages: 1 }, pricing: price(0.02) },
  { id: "upscale-creative", upstreamId: "creative", label: "Creative Upscale", tasks: ["image-upscale"], params: { maxReferenceImages: 1, negativePrompt: true, seed: true }, pricing: price(0.60) },
  { id: "stable-audio-2.5", upstreamId: "stable-audio-2.5", label: "Stable Audio 2.5", tasks: ["text-to-audio"], params: { seed: true, durationsSec: Array.from({ length: 190 }, (_, i) => i + 1) }, pricing: audioPrice },
  { id: "stable-audio-3", upstreamId: "stable-audio-3", label: "Stable Audio 3", tasks: ["text-to-audio"], params: { seed: true, durationsSec: Array.from({ length: 380 }, (_, i) => i + 1) }, pricing: audioPrice },
];
export const STABILITY_MODELS: MediaModelSpec[] = entries.map((entry) => ({
  ...entry, id: `stability/${entry.id}`, vendor: "stability", kind: entry.tasks[0] === "text-to-audio" ? "audio" : "image",
  docsUrl: "https://docs.stability.ai/api-reference/index.md",
}));
