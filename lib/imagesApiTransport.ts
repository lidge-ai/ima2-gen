// Direct OpenAI Image API transport (POST /v1/images/generations and /v1/images/edits)
// for the API-key lane. Images 2.6 documents complexity, markup, GIF and SVG output on
// this API; the Responses image_generation tool path stays in responsesTransport.ts.
// Timeout, cancellation and upstream error classification are shared with that path.
import { logEvent } from "./logger.js";
import { errInfo } from "./errInfo.js";
import { setJobPhase } from "./inflight.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { apiSafetyFields } from "./safetyIdentifier.js";
import {
  apiAuthorizationHeader, isKnownResponsesError, makeError, normalizedCode, parseOpenAIErrorBody,
  safeUpstreamClientMessage, transportAbortError, transportLifetime, type UpstreamError,
} from "./responsesTransport.js";

export const IMAGES_API_BASE_URL = "https://api.openai.com/v1/images";

export interface PostApiImagesArgs {
  ctx: RouteRuntimeContext;
  scope: string;
  kind: "generations" | "edits";
  json: Record<string, unknown>;
  requestId?: string | null | undefined;
  signal?: AbortSignal | null | undefined;
}

export interface ApiImagesResult {
  images: Array<{ b64: string; revisedPrompt: string | null }>;
  usage: Record<string, number> | null;
  /** SVG output only: tokens billed to the SVG authoring model, separate from image usage. */
  svgUsage: Record<string, unknown> | null;
  outputFormat: string | null;
  background: string | null;
  size: string | null;
  quality: string | null;
}

/**
 * Request fields that OpenAI gates per organization or project (GIF preview, SVG
 * model selection, markup) or per model. A rejection that names one of them means
 * "not enabled for you", which the caller should show as such instead of a generic
 * parameter error.
 */
const GATED_PARAMS: Record<string, string> = {
  output_format: "this output format",
  frame_count: "GIF output",
  frame_duration_ms: "GIF output",
  svg: "SVG output",
  "svg.model": "SVG model selection",
  markup: "markup-guided edits",
  complexity: "the complexity setting",
  model: "this image model",
};
const GATE_WORDING = /not enabled|not available|\baccess\b|preview|not supported for this (?:organization|project)/i;

export function gatedFeature(status: number, upstream: UpstreamError | null): string | null {
  if (!upstream?.param || !(upstream.param in GATED_PARAMS)) return null;
  if (status !== 403 && !(status === 400 && GATE_WORDING.test(upstream.message))) return null;
  if (upstream.param === "output_format") {
    if (/\bgif\b/i.test(upstream.message)) return "GIF output";
    if (/\bsvg\b/i.test(upstream.message)) return "SVG output";
  }
  return GATED_PARAMS[upstream.param] ?? null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function readApiImages(res: Response, args: PostApiImagesArgs, wait: <T>(run: () => Promise<T>) => Promise<T>): Promise<ApiImagesResult> {
  const { scope, kind, requestId } = args;
  logEvent(scope, "images_response", { requestId, kind, status: res.status });
  const text = await wait(() => res.text());
  if (!res.ok) {
    const upstream = parseOpenAIErrorBody(text);
    const feature = gatedFeature(res.status, upstream);
    const detail = {
      status: res.status, upstreamBodyChars: text.length, upstreamCode: upstream?.code ?? null,
      upstreamType: upstream?.type ?? null, upstreamParam: upstream?.param ?? null, upstreamMessageRedacted: true,
    };
    if (feature) {
      throw makeError(`OpenAI has not enabled ${feature} for this API key's organization or project.`, {
        ...detail, code: "IMAGE_FEATURE_NOT_ENABLED", feature: upstream?.param,
      });
    }
    if (res.status >= 400 && res.status < 500 && upstream?.message) {
      throw makeError(safeUpstreamClientMessage(upstream, res.status), { ...detail, code: normalizedCode(upstream) });
    }
    throw makeError(`OpenAI Images API returned ${res.status}`, detail);
  }
  let parsed: Record<string, unknown> & { data?: Array<{ b64_json?: unknown; revised_prompt?: unknown }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw makeError("OpenAI Images API returned a non-JSON response", { status: 502, upstreamBodyChars: text.length });
  }
  const images = (Array.isArray(parsed.data) ? parsed.data : [])
    .map((item) => (typeof item?.b64_json === "string" && item.b64_json
      ? { b64: item.b64_json, revisedPrompt: stringOrNull(item.revised_prompt) } : null))
    .filter((item): item is { b64: string; revisedPrompt: string | null } => item !== null);
  logEvent(scope, "images_end", { requestId, kind, imageCount: images.length });
  const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
  return {
    images,
    usage: record(parsed.usage) as Record<string, number> | null,
    svgUsage: record(parsed.svg_usage) as Record<string, unknown> | null,
    outputFormat: stringOrNull(parsed.output_format),
    background: stringOrNull(parsed.background),
    size: stringOrNull(parsed.size),
    quality: stringOrNull(parsed.quality),
  };
}

export async function postApiImages(args: PostApiImagesArgs): Promise<ApiImagesResult> {
  const { ctx, kind, json, requestId, signal = null } = args;
  const lifetime = transportLifetime(ctx, "api", signal);
  try {
    const headers = { "Content-Type": "application/json", Authorization: apiAuthorizationHeader(ctx.apiKey) };
    const body = JSON.stringify({ ...json, ...apiSafetyFields("api", ctx.config) });
    if (requestId) setJobPhase(requestId, "streaming");
    const res = await lifetime.wait(() => fetch(`${IMAGES_API_BASE_URL}/${kind}`, {
      method: "POST", headers, body, signal: lifetime.signal,
    }));
    return await readApiImages(res, args, lifetime.wait);
  } catch (e) {
    const err = errInfo(e);
    if (err.name === "AbortError") throw transportAbortError(err.raw, lifetime.signal, "api", signal);
    if (isKnownResponsesError(err.raw)) throw err.raw;
    throw makeError("Images API request failed before receiving a response", {
      status: 502, code: "NETWORK_FAILED", errorName: err.name, upstreamMessageRedacted: true,
    });
  } finally {
    lifetime.dispose();
  }
}
