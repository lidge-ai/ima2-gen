/**
 * Maps ima2's background preset onto the Responses `image_generation` tool
 * parameters (`background` + `output_format`).
 *
 * Why this is not a straight pass-through of `background: "transparent"`:
 *
 * The ChatGPT OAuth (Codex) session pins the image tool to the
 * `gpt-image-2-codex` variant, which REJECTS a forced transparent background
 * with HTTP 400 "Transparent background is not supported for this model." on
 * every OAuth model (gpt-6-astra, gpt-5.6-luna/sol/terra, gpt-5.5, gpt-5.4, gpt-5.4-mini).
 * A bogus-parameter control returns a different error ("Unknown parameter"),
 * so that 400 is a genuine upstream semantic rejection, not a schema strip.
 *
 * `background: "auto"` IS accepted, and with an explicit cutout intent in the
 * prompt the model returns a real RGBA PNG. Measured on the live OAuth path:
 * 5/5 generations came back with 4 channels, all four corners at alpha 0, and
 * 42-56% fully transparent pixels — including genuine PARTIAL alpha for glass
 * and leaf veins. A scene-style prompt on the same settings returns 3 channels
 * with no alpha, so the prompt is the lever and `auto` is the switch that lets
 * the model pull it.
 *
 * Evidence: devlog/_plan/260821_gpt_image2_transparent_background/{000,001}.
 *
 * Direct API surfaces (Atlas Cloud gpt-image-2) accept the forced value per
 * OpenAI's 2026-08-21 preview announcement, and so does GPT OAuth since it
 * renders through the Codex Images API (lib/oauthImages.ts, verified
 * 2026-09-25), so `supportsForcedTransparent` lets those callers opt into the
 * strict parameter. The hosted-tool path (API key lane) still uses `auto`.
 */
import type { BackgroundPreset } from "./backgroundPresets.js";

export const VALID_BACKGROUND_VALUES = ["auto", "opaque", "transparent"] as const;
export type BackgroundValue = (typeof VALID_BACKGROUND_VALUES)[number];

/** Formats that can carry an alpha channel. JPEG cannot. */
export const ALPHA_CAPABLE_FORMATS = ["png", "webp"] as const;
export type AlphaCapableFormat = (typeof ALPHA_CAPABLE_FORMATS)[number];

export interface ImageBackgroundParams {
  background: BackgroundValue;
  outputFormat: AlphaCapableFormat | undefined;
}

export interface ResolveBackgroundInput {
  preset: BackgroundPreset | null | undefined;
  /**
   * True only for surfaces proven to accept a forced transparent background.
   * The OAuth proxy is NOT one of them; see the module docblock.
   */
  supportsForcedTransparent?: boolean | undefined;
  /** Caller-requested output format, if any. */
  requestedFormat?: string | null | undefined;
}

export function isAlphaCapableFormat(value: unknown): value is AlphaCapableFormat {
  return typeof value === "string" && (ALPHA_CAPABLE_FORMATS as readonly string[]).includes(value);
}

/**
 * Image lanes that can actually return an alpha channel.
 *
 * Only the GPT image tool (OAuth/API) and the gpt-image-2 API surface expose a
 * background parameter. Grok, Gemini, Agy, and MiniMax have no equivalent and
 * their pipeline branches force JPEG, so a transparent request there would bill
 * the user for an opaque image labeled as a cutout.
 */
export const ALPHA_CAPABLE_PROVIDERS = ["oauth", "api", "atlascloud"] as const;

export function providerSupportsTransparent(provider: string | undefined | null): boolean {
  return typeof provider === "string" && (ALPHA_CAPABLE_PROVIDERS as readonly string[]).includes(provider);
}

export interface ProviderConflict {
  error: string;
  code: "TRANSPARENT_PROVIDER_UNSUPPORTED";
}

/** Refuse a transparent request on a lane that cannot deliver alpha. */
export function validateTransparentProvider(
  preset: string | null | undefined,
  provider: string | undefined | null,
): ProviderConflict | null {
  if (preset !== "transparent") return null;
  if (providerSupportsTransparent(provider)) return null;
  return {
    error: `transparent backgrounds are not supported on the "${String(provider)}" lane (no alpha channel); use ${ALPHA_CAPABLE_PROVIDERS.join(", ")}, or pick a solid background and key it`,
    code: "TRANSPARENT_PROVIDER_UNSUPPORTED",
  };
}

/**
 * Verify a result that was supposed to carry alpha actually does.
 *
 * Requesting transparency does not guarantee it: a provider can honor the
 * request semantically and still return opaque bytes, and JPEG cannot hold an
 * alpha channel at all. Persisting such a result would re-encode it through
 * sharp.toFormat() and record it with a "transparent" preset, so the file,
 * the metadata, and the UI would all disagree with reality.
 *
 * This DECODES the image and inspects real pixels. A header-only check proves
 * only that the container CAN hold alpha, which is not the same claim: an RGBA
 * PNG whose every alpha byte is 255 is completely opaque yet advertises an
 * alpha channel, and `VP8X` merely marks an extended WebP container. Measured
 * against sharp, the header-only version passed a fully-opaque RGBA PNG — the
 * exact false positive this guard exists to stop (adversarial review 260821
 * round 4).
 *
 * Cost is bounded: this runs once per generated image, only when transparency
 * was requested, on an image we are about to re-encode and write anyway.
 */
export type AlphaVerdict =
  | { hasAlpha: true }
  | { hasAlpha: false; reason: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable" };

/** Fast pre-check: JPEG can never carry alpha, so skip the decode entirely. */
export function isJpegBuffer(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

type RawDecoder = (buffer: Buffer) => Promise<{ data: Buffer; channels: number; hasAlpha: boolean }>;

/**
 * @param decode injected so tests can drive failure paths without stubbing sharp
 */
export async function verifyBufferAlpha(buffer: Buffer, decode: RawDecoder): Promise<AlphaVerdict> {
  if (isJpegBuffer(buffer)) return { hasAlpha: false, reason: "jpeg" };
  let decoded: { data: Buffer; channels: number; hasAlpha: boolean };
  try {
    decoded = await decode(buffer);
  } catch {
    // Unreadable bytes are not evidence of transparency.
    return { hasAlpha: false, reason: "undetectable" };
  }
  if (!decoded.hasAlpha) return { hasAlpha: false, reason: "no-alpha-channel" };
  const { data, channels } = decoded;
  if (channels < 4 || data.length < channels) return { hasAlpha: false, reason: "no-alpha-channel" };
  // One non-opaque pixel is enough: partial alpha (glass, hair, anti-aliased
  // edges) counts as transparency just as much as a fully cut-out background.
  for (let i = channels - 1; i < data.length; i += channels) {
    if (data[i]! < 255) return { hasAlpha: true };
  }
  return { hasAlpha: false, reason: "fully-opaque" };
}
export interface TransparentResultError extends Error {
  status: number;
  code: "TRANSPARENT_RESULT_OPAQUE";
  isOperational: true;
}

/** Operational error for a transparency request that came back opaque. */
export function makeTransparentResultError(
  provider: string | undefined | null,
  reason: "jpeg" | "no-alpha-channel" | "fully-opaque" | "undetectable",
): TransparentResultError {
  const detail = reason === "jpeg"
    ? "the provider returned JPEG, which cannot carry an alpha channel"
    : reason === "no-alpha-channel"
      ? "the returned image has no alpha channel"
      : reason === "fully-opaque"
        ? "the returned image has an alpha channel but every pixel is fully opaque"
        : "the returned image could not be decoded to verify transparency";
  const err = new Error(
    `transparent background requested but ${detail} (lane: ${String(provider)}). Nothing was saved; retry, or use a solid background and key it.`,
  ) as TransparentResultError;
  err.status = 502;
  err.code = "TRANSPARENT_RESULT_OPAQUE";
  err.isOperational = true;
  return err;
}

/**
 * Resolve the tool parameters for a preset. Returns `null` when the preset
 * implies no explicit background handling, so existing callers keep their
 * current payload byte-for-byte.
 */
export function resolveImageBackgroundParams(
  input: ResolveBackgroundInput,
): ImageBackgroundParams | null {
  if (input.preset !== "transparent") return null;

  const requested = input.requestedFormat;
  // JPEG cannot hold alpha: silently honoring it would ship an opaque image
  // while the UI claims transparency. Fall back to PNG instead.
  const outputFormat: AlphaCapableFormat = isAlphaCapableFormat(requested) ? requested : "png";

  return {
    background: input.supportsForcedTransparent ? "transparent" : "auto",
    outputFormat,
  };
}

export interface FormatConflict {
  error: string;
  code: "TRANSPARENT_FORMAT_CONFLICT";
}

/**
 * Reject an explicit alpha-incapable format paired with a transparent
 * background instead of quietly producing an opaque image.
 */
export function validateTransparentFormat(
  preset: BackgroundPreset | null | undefined,
  requestedFormat: unknown,
): FormatConflict | null {
  if (preset !== "transparent") return null;
  if (requestedFormat === undefined || requestedFormat === null || requestedFormat === "") return null;
  if (isAlphaCapableFormat(requestedFormat)) return null;
  return {
    error: `a transparent background requires an alpha-capable output format (${ALPHA_CAPABLE_FORMATS.join(", ")}); received "${String(requestedFormat)}"`,
    code: "TRANSPARENT_FORMAT_CONFLICT",
  };
}
