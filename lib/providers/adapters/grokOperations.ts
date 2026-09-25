import { logEvent } from "../../logger.js";
import { detectImageMimeFromB64 } from "../../refs.js";
import type { RouteRuntimeContext } from "../../runtimeContext.js";
import { mapSizeToGrokImageParams } from "../../grokSizeMapper.js";
import { resolveGrokCredential, type GrokCredential } from "../../grokRuntime.js";
import { planGrokImage } from "../../grokImagePlanner.js";
import {
  grokError,
  imagePayload,
  imageEditPayload,
  postGrokImages,
  downloadGrokImageUrl,
  type GrokGenerateResult,
  type GrokReferenceImage,
} from "../../grokImageCore.js";

/**
 * Execution resolves the credential once per request and threads it down. Legacy direct
 * callers (lib/grokImageAdapter, lib/agentImageVideoGen) omit it, and for them the OAuth
 * `grok` lane is the correct default: the api-key lane is only ever reached by passing a
 * credential explicitly.
 */
async function requireCredential(
  ctx: RouteRuntimeContext,
  options: { credential?: GrokCredential | undefined; signal?: AbortSignal | undefined },
): Promise<GrokCredential> {
  if (options.credential) return options.credential;
  return await resolveGrokCredential(ctx, "grok", { ...(options.signal ? { signal: options.signal } : {}) });
}

export async function generateViaGrok(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: {
    model?: string | undefined;
    size?: string | undefined;
    signal?: AbortSignal | undefined;
    requestId?: string | undefined;
    plannedPrompt?: string | undefined;
    webSearchCalls?: number | undefined;
    references?: GrokReferenceImage[] | undefined;
    credential?: GrokCredential | undefined;
    plannerModel?: string | undefined;
    webSearchEnabled?: boolean | undefined;
  } = {},
): Promise<GrokGenerateResult> {
  const model = options.model || ctx.config?.grokProvider?.defaultImageModel || "grok-imagine-image-quality";
  const references = options.references || [];
  const credential = await requireCredential(ctx, options);
  const plan = options.plannedPrompt
    ? { prompt: options.plannedPrompt, model, webSearchCalls: options.webSearchCalls ?? 1 }
    : await planGrokImage(prompt, ctx, { ...options, referenceCount: references.length, credential, webSearchEnabled: options.webSearchEnabled });
  const hasReferences = references.length > 0;
  const payload = hasReferences
    ? imageEditPayload(model, plan.prompt, references, options.size)
    : imagePayload(model, plan.prompt, options.size);
  const endpoint = hasReferences ? "/v1/images/edits" : "/v1/images/generations";
  const logStage = hasReferences ? "generate:edit-start" : "generate:start";

  logEvent("grok", logStage, {
    requestId: options.requestId,
    model,
    promptChars: plan.prompt.length,
    size: options.size,
    refs: references.length,
  });
  const result = await postGrokImages(ctx, payload, options.signal, endpoint, credential);

  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    throw grokError("Grok returned no image URL", 502, "GROK_EMPTY_RESPONSE");
  }
  // Direct lane: the artifact URL is a public https origin, so no proxy hop is trusted.
  const downloaded = await downloadGrokImageUrl(imageUrl, options.signal);

  const usage = result.usage ? { grok_cost_usd_ticks: result.usage.cost_in_usd_ticks ?? 0 } : null;
  logEvent("grok", "generate:done", {
    requestId: options.requestId,
    model,
    endpoint,
    refs: references.length,
    b64Len: downloaded.b64.length,
  });

  return { b64: downloaded.b64, providerUrl: imageUrl, usage, webSearchCalls: plan.webSearchCalls, mime: downloaded.mime, revisedPrompt: plan.prompt };
}

export async function editViaGrok(
  prompt: string,
  imageB64: string,
  ctx: RouteRuntimeContext,
  options: { model?: string | undefined; size?: string | undefined; signal?: AbortSignal | undefined; requestId?: string | undefined; credential?: GrokCredential | undefined } = {},
): Promise<GrokGenerateResult> {
  const model = options.model || ctx.config?.grokProvider?.defaultImageModel || "grok-imagine-image-quality";
  const detectedInputMime = detectImageMimeFromB64(imageB64) || "image/png";
  const imageUrl = imageB64.startsWith("data:") ? imageB64 : `data:${detectedInputMime};base64,${imageB64}`;
  const payload: Record<string, unknown> = { model, prompt, n: 1, response_format: "url", image: { type: "image_url", url: imageUrl }, ...mapSizeToGrokImageParams(options.size) };
  logEvent("grok", "edit:start", { requestId: options.requestId, model, promptChars: prompt.length });
  const result = await postGrokImages(ctx, payload, options.signal, "/v1/images/edits", await requireCredential(ctx, options));
  const editResultUrl = result.data?.[0]?.url;
  if (!editResultUrl) {
    throw grokError("Grok edit returned no image URL", 502, "GROK_EMPTY_RESPONSE");
  }
  const downloaded = await downloadGrokImageUrl(editResultUrl, options.signal);
  const usage = result.usage ? { grok_cost_usd_ticks: result.usage.cost_in_usd_ticks ?? 0 } : null;
  logEvent("grok", "edit:done", { requestId: options.requestId, model, b64Len: downloaded.b64.length });
  return { b64: downloaded.b64, providerUrl: editResultUrl, usage, webSearchCalls: 0, mime: downloaded.mime, revisedPrompt: result.data[0]?.revised_prompt || prompt };
}
