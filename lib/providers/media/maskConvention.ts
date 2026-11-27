/**
 * What a mask means. Providers disagree: OpenAI repaints where the mask is transparent, Ideogram where it
 * is black. A request can say which rule its mask follows:
 *
 *  - "vendor" (default): the mask is already in the provider's own rule and is passed through untouched.
 *  - "repaint-white": a PNG the same size as the image, white = repaint, black = keep. The adapter converts
 *    it to the provider's rule. Only routes that declare this convention take it; anywhere else it is
 *    refused before a provider call, never passed through.
 */
import sharp from "sharp";
import type { MediaInput, MediaModelSpec, MediaSubmitRequest } from "./contract.js";
import { MediaJobError } from "./errors.js";

export type MaskConvention = "vendor" | "repaint-white";
export const MASK_CONVENTIONS: readonly MaskConvention[] = ["vendor", "repaint-white"];

/** A brush has soft edges: a pixel at least half white is repainted. Providers take a hard mask. */
export const REPAINT_THRESHOLD = 128;

/** How a provider reads its mask. */
export type VendorMaskRule = "transparent-repaints" | "black-repaints";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function refuse(message: string, reason = "INVALID_MASK"): never {
  throw new MediaJobError("MEDIA_" + reason, message);
}

/** Refuses a repaint-white mask on a route that does not declare it for the task. */
export function assertMaskConvention(spec: MediaModelSpec, request: Pick<MediaSubmitRequest, "task" | "maskConvention">): void {
  if (request.maskConvention !== "repaint-white") return;
  const declared = (spec.params.inputs ?? []).some((need) =>
    need.role === "mask" && (!need.tasks || need.tasks.includes(request.task)) && need.conventions?.includes("repaint-white"));
  if (!declared) refuse(spec.id + " does not take a repaint-white mask on this route. Send the mask in the provider's own rule with maskConvention \"vendor\".", "MASK_CONVENTION_UNSUPPORTED");
}

async function size(bytes: Uint8Array, what: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata().catch(() => refuse("The " + what + " could not be read as an image."));
  if (!meta.width || !meta.height) refuse("The " + what + " could not be read as an image.");
  return { width: meta.width, height: meta.height };
}

/**
 * The request with its mask in the provider's rule. Unchanged unless the request says "repaint-white".
 * A transparent pixel of the incoming mask counts as black (kept).
 */
export async function vendorMask(request: MediaSubmitRequest, rule: VendorMaskRule): Promise<MediaSubmitRequest> {
  if (request.maskConvention !== "repaint-white") return request;
  const mask = request.inputs.find((input) => input.role === "mask");
  if (!mask) return request;
  const image = request.inputs.find((input) => input.role === "source-image") ?? request.inputs.find((input) => input.role === "reference-image");
  if (!image?.bytes?.length) refuse("A repaint-white mask needs the image it belongs to, sent as a file.");
  if (!mask.bytes?.length) refuse("A repaint-white mask must be sent as a file.");
  if (mask.bytes.length < 8 || PNG_SIGNATURE.some((byte, i) => mask.bytes![i] !== byte)) refuse("The mask must be a PNG file.");
  const [m, s] = await Promise.all([size(mask.bytes, "mask"), size(image.bytes, "image")]);
  if (m.width !== s.width || m.height !== s.height) {
    refuse("The mask is " + m.width + "x" + m.height + " but the image is " + s.width + "x" + s.height + ". They must be the same size.");
  }
  const luma = await sharp(mask.bytes).flatten({ background: "#000000" }).greyscale().raw().toBuffer();
  const pixels = m.width * m.height;
  const out = Buffer.alloc(pixels * (rule === "transparent-repaints" ? 4 : 1));
  for (let i = 0; i < pixels; i += 1) {
    const repaint = luma[i]! >= REPAINT_THRESHOLD;
    if (rule === "transparent-repaints") out[i * 4 + 3] = repaint ? 0 : 255;
    else out[i] = repaint ? 0 : 255;
  }
  const png = await sharp(out, { raw: { width: m.width, height: m.height, channels: rule === "transparent-repaints" ? 4 : 1 } }).png().toBuffer();
  const converted: MediaInput = { role: "mask", bytes: new Uint8Array(png), mimeType: "image/png" };
  return { ...request, inputs: request.inputs.map((input) => (input === mask ? converted : input)) };
}
