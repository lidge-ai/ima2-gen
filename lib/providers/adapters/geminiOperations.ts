import { thrownFields, type CodedError } from "../../errInfo.js";
import { logEvent } from "../../logger.js";
import type { RuntimeContext } from "../../runtimeContext.js";
import { detectImageMimeFromB64 } from "../../refs.js";
import { getVertexAccessToken, getVertexProjectId, isVertexInitialized } from "../../vertexAuth.js";
import { deriveReferenceLimit } from "../../providers/derive.js";

export interface GeminiApiGenerateResult {
  b64: string;
  revisedPrompt?: string;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string;
}

interface GeminiApiRefDetail {
  b64: string;
  declaredMime?: string | null;
  detectedMime?: string | null;
}

const MODEL_ID_MAP: Record<string, string> = {
  "nano-banana-2": "gemini-3.1-flash-image",
  "nano-banana-pro": "gemini-3-pro-image",
};

const GEMINI_TIMEOUT_MS = 120_000;

// Public v1beta ImageResponseFormat uses enums (ASPECT_RATIO_*/IMAGE_SIZE_*),
// while Vertex imageConfig takes plain strings ("1:1"/"1K") — mixing them got
// every public-API request rejected with invalid aspect_ratio (070 QA).
const V1BETA_ASPECT_ENUM: Record<string, string> = {
  "1:1": "ASPECT_RATIO_ONE_BY_ONE", "2:3": "ASPECT_RATIO_TWO_BY_THREE",
  "3:2": "ASPECT_RATIO_THREE_BY_TWO", "3:4": "ASPECT_RATIO_THREE_BY_FOUR",
  "4:3": "ASPECT_RATIO_FOUR_BY_THREE", "4:5": "ASPECT_RATIO_FOUR_BY_FIVE",
  "5:4": "ASPECT_RATIO_FIVE_BY_FOUR", "9:16": "ASPECT_RATIO_NINE_BY_SIXTEEN",
  "16:9": "ASPECT_RATIO_SIXTEEN_BY_NINE", "21:9": "ASPECT_RATIO_TWENTY_ONE_BY_NINE",
  "1:8": "ASPECT_RATIO_ONE_BY_EIGHT", "8:1": "ASPECT_RATIO_EIGHT_BY_ONE",
  "1:4": "ASPECT_RATIO_ONE_BY_FOUR", "4:1": "ASPECT_RATIO_FOUR_BY_ONE",
};

const V1BETA_SIZE_ENUM: Record<string, string> = {
  "512": "IMAGE_SIZE_FIVE_TWELVE",
  "1K": "IMAGE_SIZE_ONE_K",
  "2K": "IMAGE_SIZE_TWO_K",
  "4K": "IMAGE_SIZE_FOUR_K",
};

function toV1BetaImageFormat(params: { aspectRatio: string; imageSize: string }): { aspect_ratio: string; image_size: string } {
  const aspect = V1BETA_ASPECT_ENUM[params.aspectRatio];
  const size = V1BETA_SIZE_ENUM[params.imageSize];
  if (!aspect) throw new Error(`gemini-api: no v1beta aspect enum for ${params.aspectRatio}`);
  if (!size) throw new Error(`gemini-api: no v1beta image-size enum for ${params.imageSize}`);
  return { aspect_ratio: aspect, image_size: size };
}

function parseGeminiImageParams(size?: string): { aspectRatio: string; imageSize: string } {
  if (!size || size === "auto" || size === "1024x1024") return { aspectRatio: "1:1", imageSize: "1K" };
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return { aspectRatio: "1:1", imageSize: "1K" };
  const w = Number(match[1]);
  const h = Number(match[2]);
  const ratio = w / h;
  const ratioMap: Array<[string, number]> = [
    ["1:1", 1], ["2:3", 2/3], ["3:2", 3/2], ["3:4", 3/4], ["4:3", 4/3],
    ["4:5", 4/5], ["5:4", 5/4], ["9:16", 9/16], ["16:9", 16/9], ["21:9", 21/9],
    ["1:8", 1/8], ["8:1", 8], ["1:4", 1/4], ["4:1", 4],
  ];
  let bestLabel = "1:1";
  let bestDist = Infinity;
  for (const [label, val] of ratioMap) {
    const dist = Math.abs(ratio - val);
    if (dist < bestDist) { bestDist = dist; bestLabel = label; }
  }
  const maxDim = Math.max(w, h);
  const imageSize = maxDim <= 512 ? "512" : maxDim <= 1024 ? "1K" : maxDim <= 2048 ? "2K" : "4K";
  return { aspectRatio: bestLabel, imageSize };
}

function geminiApiError(message: string, status: number, code: string): Error {
  const err: CodedError = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function resolveGeminiModelId(model: string): string {
  return MODEL_ID_MAP[model] || model;
}

function buildContents(
  prompt: string,
  references: GeminiApiRefDetail[],
): Array<{ role: string; parts: unknown[] }> {
  const parts: unknown[] = [];

  // Add reference images first (if any)
  for (const ref of references.slice(0, deriveReferenceLimit("gemini-api", "edit"))) {
    const mime = ref.declaredMime || ref.detectedMime || detectImageMimeFromB64(ref.b64) || "image/png";
    parts.push({
      inlineData: {
        mimeType: mime,
        data: ref.b64,
      },
    });
  }

  // Add text prompt
  parts.push({ text: prompt });

  return [{ role: "user", parts }];
}

export async function generateViaGeminiApi(
  prompt: string,
  ctx: RuntimeContext,
  options: {
    model?: string;
    size?: string;
    signal?: AbortSignal;
    requestId?: string;
    references?: GeminiApiRefDetail[];
  } = {},
): Promise<GeminiApiGenerateResult> {
  const apiKey = ctx.geminiApiKey;
  const vertexReady = ctx.hasVertexKey && isVertexInitialized();
  const authMode = ctx.geminiAuthMode;
  const useVertex = authMode === "vertex" ? vertexReady : (!apiKey && vertexReady);
  if (!apiKey && !useVertex) {
    throw geminiApiError("Gemini API key or Vertex AI credentials not configured", 401, "GEMINI_API_KEY_MISSING");
  }

  const model = options.model || "nano-banana-2";
  const apiModelId = resolveGeminiModelId(model);
  const references = (options.references || []).slice(0, deriveReferenceLimit("gemini-api", "edit"));

  let url: string;
  let authHeaders: Record<string, string>;

  if (useVertex) {
    const token = await getVertexAccessToken();
    const projectId = getVertexProjectId();
    url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${apiModelId}:generateContent`;
    authHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:generateContent`;
    authHeaders = { "Content-Type": "application/json", "x-goog-api-key": apiKey! };
  }

  // size "auto" → omit image config entirely so the model decides ratio/size
  const isAutoSize = !options.size || options.size === "auto";
  const imageParams = isAutoSize ? null : parseGeminiImageParams(options.size);
  // Vertex AI rejects responseFormat; it expects imageConfig directly under
  // generationConfig (camelCase). Public API uses response_format.image (snake_case).
  const generationConfig: Record<string, unknown> = useVertex
    ? {
        responseModalities: ["TEXT", "IMAGE"],
        ...(imageParams
          ? { imageConfig: { aspectRatio: imageParams.aspectRatio, imageSize: imageParams.imageSize } }
          : {}),
      }
    : {
        response_modalities: ["TEXT", "IMAGE"],
        ...(imageParams
          ? { response_format: { image: toV1BetaImageFormat(imageParams) } }
          : {}),
      };
  const configKey = useVertex ? "generationConfig" : "generation_config";
  const body = { contents: buildContents(prompt, references), [configKey]: generationConfig };

  logEvent("gemini-api", "generate:start", {
    requestId: options.requestId,
    model,
    apiModelId,
    promptChars: prompt.length,
    refs: references.length,
  });

  const timeoutSignal = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        throw geminiApiError(`Gemini API rate limited: ${text.slice(0, 200)}`, 429, "GEMINI_API_RATE_LIMITED");
      }
      if (res.status === 400 || res.status === 403) {
        throw geminiApiError(`Gemini API error: ${text.slice(0, 200)}`, res.status, "GEMINI_API_BAD_REQUEST");
      }
      throw geminiApiError(`Gemini API error (${res.status}): ${text.slice(0, 200)}`, 502, "GEMINI_API_UPSTREAM_ERROR");
    }

    const json = await res.json() as GeminiGenerateJson;

    // Extract image from candidates[0].content.parts[]
    const parts = json?.candidates?.[0]?.content?.parts || [];
    let b64: string | null = null;
    let textResponse = "";
    let mime = "image/png";

    for (const part of parts) {
      if (part.inlineData?.data) {
        b64 = part.inlineData.data;
        mime = part.inlineData.mimeType || "image/png";
      }
      if (part.text) {
        textResponse += part.text;
      }
    }

    if (!b64) {
      // Check for safety block
      const finishReason = json?.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY") {
        throw geminiApiError("Gemini API: generation blocked by safety filter", 400, "GEMINI_API_SAFETY_BLOCKED");
      }
      throw geminiApiError(
        `Gemini API: no image in response (finishReason: ${finishReason || "unknown"})`,
        502,
        "GEMINI_API_NO_IMAGE",
      );
    }

    const usageMetadata = json?.usageMetadata || {};

    logEvent("gemini-api", "generate:done", {
      requestId: options.requestId,
      model,
      b64Len: b64.length,
      mime,
      textResponseLen: textResponse.length,
    });

    return {
      b64,
      revisedPrompt: textResponse || prompt,
      usage: {
        promptTokens: usageMetadata.promptTokenCount || 0,
        candidatesTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      },
      webSearchCalls: 0,
      mime,
    };
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    if (eFields.name === "AbortError") {
      if (options.signal?.aborted) {
        throw geminiApiError("Generation canceled", 499, "GENERATION_CANCELED");
      }
      throw geminiApiError("Gemini API generation timed out", 504, "GENERATION_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw geminiApiError(`Gemini API request failed: ${eFields.message}`, 502, "GEMINI_API_NETWORK_FAILED");
  }
}

/** generateContent response fields read by the image adapter. */
interface GeminiGenerateJson {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}
