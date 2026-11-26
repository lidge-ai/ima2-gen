import type { MediaModelSpec, MediaPrice } from "../contract.js";

const source = "https://ideogram.ai/api-pricing";
const price = (usd: number, variant: string): MediaPrice => ({ unit: "image", usd, variant, source, checkedAt: "2026-11-26" });
const ratios = ["auto", "1:3", "3:1", "1:2", "2:1", "9:16", "16:9", "10:16", "16:10", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "1:1"];
const docsUrl = "https://developer.ideogram.ai/openapi/ideogram-api-v2.json";
export const IDEOGRAM_MODELS: readonly MediaModelSpec[] = [
  { id: "ideogram/ideogram-v3", upstreamId: "ideogram-3", vendor: "ideogram", label: "Ideogram 3", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { aspectRatios: ratios, seed: true, negativePrompt: true, maxReferenceImages: 1 }, pricing: [price(0.03, "turbo"), price(0.06, "default"), price(0.09, "quality")], docsUrl },
  { id: "ideogram/ideogram-v4.5", upstreamId: "ideogram-4-5", vendor: "ideogram", label: "Ideogram 4.5", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { seed: true, maxReferenceImages: 5 }, pricing: [price(0.03, "text low"), price(0.06, "text medium"), price(0.10, "text high"), price(0.008, "edit very_low"), price(0.03, "edit low"), price(0.06, "edit medium"), price(0.22, "edit high")], docsUrl },
  // Detailed vectorization pricing is missing; pricing remains empty.
  { id: "ideogram/ideogram-vectorize", upstreamId: "ideogram-vector-1", vendor: "ideogram", label: "Ideogram Vectorize", kind: "image", tasks: ["image-vectorize"], params: { maxReferenceImages: 1 }, pricing: [], docsUrl },
];
