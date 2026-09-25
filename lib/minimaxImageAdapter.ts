import { thrownFields } from "./errInfo.js";
// lib/minimaxImageAdapter.ts — MiniMax image-generation adapter.
//
// Calls the MiniMax /v1/image_generation endpoint directly with a Bearer API
// key. Supports text-to-image and image-to-image: when reference images are
// attached they are mapped to the `subject_reference` array (character subject
// type, data URL or public URL). Responses are returned as `url` or `base64`;
// both shapes are parsed into a single base64 payload for the shared pipeline.
//
// Region selects the global (.io) or China (.minimaxi.com) OpenAI-compatible
// base URL. The endpoint, models, request fields, output formats, and response
// fields follow the MiniMax image-generation API reference.

import type { RuntimeContext } from "./runtimeContext.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { logEvent } from "./logger.js";
import { deriveReferenceLimit } from "./providers/derive.js";

export const MINIMAX_TEXT_TO_IMAGE_MODEL = "image-01";
export const MINIMAX_IMAGE_TO_IMAGE_MODEL = "image-01-live";

const MINIMAX_TIMEOUT_MS = 120_000;

// Mirrors lib/grokImageCore.ts: a provider URL is untrusted input, so the
// download is capped instead of being buffered in full.
const MAX_IMAGE_DOWNLOAD_BYTES = 50 * 1024 * 1024;

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Aspect ratios accepted by the MiniMax image-generation API.
const VALID_ASPECT_RATIOS = new Set([
  "1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9",
]);

type MinimaxReference = {
  b64: string;
  declaredMime?: string | null | undefined;
  detectedMime?: string | null | undefined;
};

type MinimaxGenerateOptions = {
  model?: string | undefined;
  size?: string | undefined;
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  references?: MinimaxReference[] | undefined;
};

type MinimaxImageResult = {
  b64: string;
  revisedPrompt?: string | null | undefined;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string | undefined;
  providerUrl?: string | null | undefined;
  /** Model actually sent upstream. */
  effectiveModel: string;
};

function minimaxError(message: string, status: number, code: string): Error {
  const err = new Error(message) as Error & { status?: number; code?: string; isOperational?: boolean };
  err.status = status;
  err.code = code;
  err.isOperational = true;
  return err;
}

// MiniMax documents metadata counts as strings in its response samples, so a
// number-only check would miss a real content-safety block.
function toCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The detected magic bytes are authoritative: a Content-Type header (or the
 * absence of one) never overrides what the payload actually is. Downstream
 * storage falls back to PNG for unknown MIME types, so an HTML error body
 * would otherwise be saved as a broken .png.
 */
function validateMinimaxImageBytes(b64: string, headerMime?: string | null): string {
  if (!b64) {
    throw minimaxError("MiniMax returned an empty image payload", 502, "MINIMAX_IMAGE_INVALID");
  }
  // base64 inflates by 4/3, so this bounds the decoded size without decoding.
  if (b64.length > MAX_IMAGE_DOWNLOAD_BYTES * 1.4) {
    throw minimaxError(
      "MiniMax image payload exceeds 50MB limit",
      502,
      "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE",
    );
  }
  const detected = detectImageMimeFromB64(b64);
  if (detected && ALLOWED_IMAGE_MIMES.has(detected)) return detected;
  const header = headerMime?.split(";")[0]?.trim();
  if (header && ALLOWED_IMAGE_MIMES.has(header)) {
    throw minimaxError(
      `MiniMax returned non-image bytes for ${header}`,
      502,
      "MINIMAX_IMAGE_INVALID",
    );
  }
  throw minimaxError("MiniMax returned a non-image payload", 502, "MINIMAX_IMAGE_INVALID");
}

async function downloadMinimaxImage(
  url: string,
  signal: AbortSignal,
): Promise<{ b64: string; mime: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw minimaxError("MiniMax image URL must be HTTP(S)", 502, "MINIMAX_IMAGE_DOWNLOAD_FAILED");
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw minimaxError(`MiniMax image download failed (${res.status})`, 502, "MINIMAX_IMAGE_DOWNLOAD_FAILED");
  }
  const declared = Number(res.headers.get("content-length") || "0");
  if (declared > MAX_IMAGE_DOWNLOAD_BYTES) {
    throw minimaxError("MiniMax image download exceeds 50MB limit", 502, "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE");
  }
  if (!res.body) {
    throw minimaxError("MiniMax image download had no response body", 502, "MINIMAX_IMAGE_DOWNLOAD_FAILED");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // A declared content-length can lie, so the stream is capped as it arrives.
    if (total > MAX_IMAGE_DOWNLOAD_BYTES) {
      await reader.cancel("download size limit exceeded").catch(() => {});
      throw minimaxError("MiniMax image download exceeds 50MB limit", 502, "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks, total);
  if (buffer.length === 0) {
    throw minimaxError("MiniMax image download was empty", 502, "MINIMAX_IMAGE_DOWNLOAD_FAILED");
  }
  const b64 = buffer.toString("base64");
  return { b64, mime: validateMinimaxImageBytes(b64, res.headers.get("content-type")) };
}

/** MiniMax image generation response body. */
interface MinimaxJson {
  base_resp?: { status_code?: unknown; status_msg?: string };
  data?: { image_urls?: unknown; image_base64?: unknown };
  metadata?: { success_count?: unknown; failed_count?: unknown };
  raw?: string;
}

async function readJson(res: Response): Promise<MinimaxJson> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function resolveBaseUrl(ctx: RuntimeContext): string {
  const cfg = ctx.config.minimaxProvider;
  return cfg.region === "cn_zh" ? cfg.cnBaseUrl : cfg.globalBaseUrl;
}

// MiniMax accepts a WxH size string; map it to the closest supported
// aspect_ratio when it is not already one. "auto" / unset leaves the choice to
// the API default (1:1).
function sizeToAspectRatio(size?: string): string | null {
  if (!size || size === "auto") return null;
  if (VALID_ASPECT_RATIOS.has(size)) return size;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  const table: Array<[string, number]> = [
    ["1:1", 1], ["16:9", 16 / 9], ["4:3", 4 / 3], ["3:2", 3 / 2],
    ["2:3", 2 / 3], ["3:4", 3 / 4], ["9:16", 9 / 16], ["21:9", 21 / 9],
  ];
  let best = "1:1";
  let bestDist = Infinity;
  for (const [label, val] of table) {
    const dist = Math.abs(ratio - val);
    if (dist < bestDist) { bestDist = dist; best = label; }
  }
  return best;
}

function refToDataUrl(ref: MinimaxReference): string {
  const mime = ref.detectedMime || ref.declaredMime || detectImageMimeFromB64(ref.b64) || "image/png";
  return `data:${mime};base64,${ref.b64}`;
}

export async function generateViaMinimax(
  prompt: string,
  ctx: RuntimeContext,
  options: MinimaxGenerateOptions = {},
): Promise<MinimaxImageResult> {
  const apiKey = ctx.minimaxApiKey;
  if (!apiKey) {
    throw minimaxError("MiniMax API key not configured", 401, "MINIMAX_API_KEY_MISSING");
  }
  const references = (options.references || []).filter((ref) => ref.b64);
  if (references.length > deriveReferenceLimit("minimax", "edit")!) {
    throw minimaxError(`MiniMax image-to-image supports up to ${deriveReferenceLimit("minimax", "edit")} subject reference`, 400, "MINIMAX_REF_TOO_MANY");
  }
  // Both image-01 and image-01-live accept `subject_reference`, so an attached
  // reference never overrides the caller's model choice; swapping it silently
  // would also make the stored provenance disagree with what was sent.
  const model = options.model || MINIMAX_TEXT_TO_IMAGE_MODEL;
  // Global MiniMax lists only image-01 for text-to-image; image-01-live is a
  // reference-driven model there. Reject that combination locally with an
  // actionable message instead of surfacing a bare upstream bad-request.
  if (
    ctx.config.minimaxProvider.region !== "cn_zh"
    && model === MINIMAX_IMAGE_TO_IMAGE_MODEL
    && references.length === 0
  ) {
    throw minimaxError(
      "MiniMax image-01-live requires a reference image outside the China region. "
        + "Attach a reference or switch to image-01.",
      400,
      "MINIMAX_MODEL_REQUIRES_REFERENCE",
    );
  }
  const baseUrl = resolveBaseUrl(ctx);
  const url = `${baseUrl.replace(/\/$/, "")}/image_generation`;

  const body: Record<string, unknown> = {
    model,
    prompt,
    response_format: "url",
  };
  const aspectRatio = sizeToAspectRatio(options.size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  if (references.length > 0) {
    body.subject_reference = references.map((ref) => ({
      type: "character",
      image_file: refToDataUrl(ref),
    }));
  }

  logEvent("minimax", "generate:start", {
    requestId: options.requestId,
    model,
    aspectRatio: aspectRatio ?? null,
    refs: references.length,
  });

  const timeoutSignal = AbortSignal.timeout(ctx.config.minimaxProvider.generationTimeoutMs || MINIMAX_TIMEOUT_MS);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    const json = await readJson(res);
    const statusCode = json?.base_resp?.status_code;
    const statusMsg = json?.base_resp?.status_msg;

    if (!res.ok || (typeof statusCode === "number" && statusCode !== 0)) {
      const detail = statusMsg || JSON.stringify(json).slice(0, 200);
      if (res.status === 429 || statusCode === 1002) {
        throw minimaxError(`MiniMax rate limited: ${detail}`, 429, "MINIMAX_RATE_LIMITED");
      }
      if (res.status === 401 || statusCode === 1004 || statusCode === 2049) {
        throw minimaxError(`MiniMax authentication failed: ${detail}`, 401, "MINIMAX_AUTH_FAILED");
      }
      if (statusCode === 1008) {
        throw minimaxError(`MiniMax insufficient balance: ${detail}`, 402, "MINIMAX_INSUFFICIENT_BALANCE");
      }
      if (statusCode === 1026) {
        throw minimaxError(`MiniMax sensitive content detected: ${detail}`, 400, "MINIMAX_SAFETY_BLOCKED");
      }
      if (res.status === 400 || res.status === 403 || statusCode === 2013) {
        throw minimaxError(`MiniMax bad request: ${detail}`, res.status || 400, "MINIMAX_BAD_REQUEST");
      }
      throw minimaxError(`MiniMax image generation failed (${res.status}): ${detail}`, 502, "MINIMAX_UPSTREAM_ERROR");
    }

    const data = json?.data || {};
    const imageUrls: string[] = Array.isArray(data.image_urls) ? data.image_urls : [];
    const imageBase64: string[] = Array.isArray(data.image_base64) ? data.image_base64 : [];
    const successCount = toCount(json?.metadata?.success_count);
    const failedCount = toCount(json?.metadata?.failed_count);

    let b64: string | null = null;
    let mime = "image/png";
    let providerUrl: string | null = null;

    if (imageBase64.length > 0) {
      b64 = typeof imageBase64[0] === "string" ? imageBase64[0] : "";
      mime = validateMinimaxImageBytes(b64);
    } else if (imageUrls.length > 0) {
      const firstUrl = imageUrls[0];
      if (!firstUrl) throw minimaxError("MiniMax returned no image payload", 502, "MINIMAX_EMPTY_IMAGE");
      providerUrl = firstUrl;
      const downloaded = await downloadMinimaxImage(firstUrl, combinedSignal);
      b64 = downloaded.b64;
      mime = downloaded.mime;
    }

    if (!b64) {
      if (failedCount !== null && failedCount > 0 && (successCount === null || successCount === 0)) {
        throw minimaxError("MiniMax image generation blocked by content safety", 400, "MINIMAX_SAFETY_BLOCKED");
      }
      throw minimaxError("MiniMax image generation did not return an image", 502, "MINIMAX_NO_IMAGE");
    }

    logEvent("minimax", "generate:done", {
      requestId: options.requestId,
      model,
      b64Len: b64.length,
      mime,
      successCount: successCount ?? null,
      failedCount: failedCount ?? null,
    });

    return {
      b64,
      revisedPrompt: null,
      usage: null,
      webSearchCalls: 0,
      mime,
      providerUrl,
      effectiveModel: model,
    };
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    // AbortSignal.timeout() rejects with a TimeoutError, not an AbortError.
    if (eFields.name === "TimeoutError") {
      throw minimaxError("MiniMax image generation timed out", 504, "GENERATION_TIMEOUT");
    }
    if (eFields.name === "AbortError") {
      if (options.signal?.aborted) {
        throw minimaxError("Generation canceled", 499, "GENERATION_CANCELED");
      }
      throw minimaxError("MiniMax image generation timed out", 504, "GENERATION_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw minimaxError(`MiniMax request failed: ${eFields.message}`, 502, "MINIMAX_NETWORK_FAILED");
  }
}
