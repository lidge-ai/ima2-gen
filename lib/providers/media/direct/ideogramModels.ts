import { withImageForms } from "./_l2/imageForm.js";
import type { MediaModelSpec, MediaPrice } from "../contract.js";

const source = "https://ideogram.ai/api-pricing";
const price = (usd: number, variant: string): MediaPrice => ({ unit: "image", usd, variant, source, checkedAt: "2026-11-26" });
const ratios = ["auto", "1:3", "3:1", "1:2", "2:1", "9:16", "16:9", "10:16", "16:10", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "1:1"];
const docsUrl = "https://developer.ideogram.ai/openapi/ideogram-api-v2.json";
// qualities: Ideogram 3 prices by rendering_speed, Ideogram 4.5 by quality; a request's quality is sent on that field.
// Ideogram 3.0 edit: "Black regions in the mask should match up with the regions of the image that you would
// like to edit" (developer.ideogram.ai/api-reference/api-reference/edit-v3, read 2026-11-28). The 4.5 precise-edit
// page was not found, so that model takes a mask in the provider's own rule only.
const MODELS: readonly MediaModelSpec[] = [
  { id: "ideogram/ideogram-v3", upstreamId: "ideogram-3", vendor: "ideogram", label: "Ideogram 3", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { aspectRatios: ratios, qualities: ["turbo", "default", "quality"], seed: true, negativePrompt: true, maxReferenceImages: 1 }, pricing: [price(0.03, "turbo"), price(0.06, "default"), price(0.09, "quality")], docsUrl },
  { id: "ideogram/ideogram-v4.5", upstreamId: "ideogram-4-5", vendor: "ideogram", label: "Ideogram 4.5", kind: "image", tasks: ["text-to-image", "image-to-image"], params: { qualities: ["very_low", "low", "medium", "high"], seed: true, maxReferenceImages: 5 }, pricing: [price(0.03, "text-to-image:low"), price(0.06, "text-to-image:medium"), price(0.10, "text-to-image:high"), price(0.008, "image-to-image:very_low"), price(0.03, "image-to-image:low"), price(0.06, "image-to-image:medium"), price(0.22, "image-to-image:high")], docsUrl },
  // Detailed vectorization pricing is missing; pricing remains empty.
  { id: "ideogram/ideogram-vectorize", upstreamId: "ideogram-vector-1", vendor: "ideogram", label: "Ideogram Vectorize", kind: "image", tasks: ["image-vectorize"], params: { maxReferenceImages: 1 }, pricing: [], docsUrl },
];

// With a mask, Ideogram 3 takes no aspect ratio or negative prompt (see ideogramBody.ts); a form drops them then.
export const IDEOGRAM_MODELS: readonly MediaModelSpec[] = withImageForms(MODELS, {
  "ideogram/ideogram-v3": { task: "image-to-image", images: 1, mask: ["vendor", "repaint-white"], accepts: ["prompt", "negativePrompt", "aspectRatio", "seed", "count", "quality"], requires: ["prompt"] },
  "ideogram/ideogram-v4.5": { task: "image-to-image", images: 5, mask: true, accepts: ["prompt", "seed", "count", "quality"], requires: ["prompt"] },
  "ideogram/ideogram-vectorize": { task: "image-vectorize", images: 1, accepts: [] },
});
