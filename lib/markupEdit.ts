/**
 * Markup-guided edits (OpenAI Image API `markup`, GPT Image 2.5 and 2.6).
 *
 * The markup is a transparent PNG annotation layer (circles, arrows, sketches) at the
 * edit image's exact size. It marks where to change things; the prompt says what to
 * change. OpenAI applies it to the first input image only and refuses it together with
 * `mask`. The checks below mirror the documented limits so a bad layer fails here,
 * before an upstream round trip: https://developers.openai.com/api/docs/guides/image-generation
 */
import sharp, { type Metadata } from "sharp";
import { isApiImageToolModel } from "./oauthNormalize.js";

export const MAX_MARKUP_BYTES = 50 * 1024 * 1024;
export const MAX_MARKUP_PIXELS = 16_777_216;

export interface MarkupCheck {
  markup: string | null;
  markupBytes: number;
  error?: string;
  code?: string;
}

interface MarkupInput {
  image: unknown;
  markup: unknown;
  mask: unknown;
  provider: string | undefined;
  imageToolModel: string | undefined;
}

const fail = (code: string, error: string): MarkupCheck => ({ markup: null, markupBytes: 0, code, error });

function decodeBase64(value: string): Buffer | null {
  const b64 = value.replace(/^data:[^;,]+;base64,/i, "").replace(/\s+/g, "");
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buffer = Buffer.from(b64, "base64");
  return buffer.length > 0 ? buffer : null;
}

/** Width/height as the model sees them: EXIF orientations 5-8 swap the axes. */
function orientedSize(meta: Metadata) {
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5;
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

export async function validateEditMarkup(input: MarkupInput): Promise<MarkupCheck> {
  if (input.markup === undefined || input.markup === null || input.markup === "") return { markup: null, markupBytes: 0 };
  if (typeof input.markup !== "string") return fail("INVALID_EDIT_MARKUP", "markup must be a PNG data URL or base64 string");
  if (input.mask !== undefined && input.mask !== null && input.mask !== "") {
    return fail("EDIT_MARKUP_WITH_MASK", "markup and mask cannot be combined; send one or the other");
  }
  if (input.provider !== "api" || !isApiImageToolModel(input.imageToolModel)) {
    return fail("EDIT_MARKUP_UNSUPPORTED",
      "Markup-guided edits need the OpenAI API key lane with a GPT Image 2.5 or 2.6 image model");
  }
  const markup = decodeBase64(input.markup);
  if (!markup) return fail("INVALID_EDIT_MARKUP", "markup must be valid base64");
  if (markup.length > MAX_MARKUP_BYTES) return fail("EDIT_MARKUP_TOO_LARGE", "markup is larger than 50 MB");
  const image = typeof input.image === "string" ? decodeBase64(input.image) : null;
  if (!image) return fail("INVALID_EDIT_IMAGE", "image must be valid base64");
  let markupMeta: Metadata;
  let imageMeta: Metadata;
  try {
    [markupMeta, imageMeta] = await Promise.all([sharp(markup).metadata(), sharp(image).metadata()]);
  } catch {
    return fail("INVALID_EDIT_MARKUP_PNG", "markup must be a PNG image");
  }
  if (markupMeta.format !== "png") return fail("INVALID_EDIT_MARKUP_PNG", "markup must be a PNG image");
  const markupSize = orientedSize(markupMeta);
  const imageSize = orientedSize(imageMeta);
  if ((markupSize.width ?? 0) * (markupSize.height ?? 0) > MAX_MARKUP_PIXELS
    || (imageSize.width ?? 0) * (imageSize.height ?? 0) > MAX_MARKUP_PIXELS) {
    return fail("EDIT_MARKUP_TOO_LARGE", "markup and image must each be at most 16,777,216 pixels");
  }
  if (markupSize.width !== imageSize.width || markupSize.height !== imageSize.height) {
    return fail("EDIT_MARKUP_DIMENSION_MISMATCH", "markup must have the same width and height as the image");
  }
  if (!markupMeta.hasAlpha) return fail("EDIT_MARKUP_NO_ALPHA", "markup PNG must include an alpha channel");
  // stats() reports every channel of the input; RGBA puts alpha at index 3.
  const alpha = await sharp(markup).ensureAlpha().stats();
  if ((alpha.channels[3]?.min ?? 255) >= 255) {
    return fail("EDIT_MARKUP_NO_TRANSPARENCY",
      "markup must keep transparent pixels; draw the marks on an empty layer instead of on the photo");
  }
  return { markup: markup.toString("base64"), markupBytes: markup.length };
}
