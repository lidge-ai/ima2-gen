import { errInfo, thrownFields } from "../../errInfo.js";
import {
  imageEditPayload,
  imagePayload,
  postGrokImages,
  grokError,
  downloadGrokImageUrl,
  type GrokReferenceImage,
} from "../../grokImageCore.js";
import { planGrokImage } from "../../grokImagePlanner.js";
import { resolveGrokCredential, type GrokCredential } from "../../grokRuntime.js";
import { logEvent } from "../../logger.js";
import type { RouteRuntimeContext } from "../../runtimeContext.js";

export interface GrokMultimodeResult {
  images: Array<{ b64: string; revisedPrompt?: string; mime?: string; providerUrl?: string }>;
  originalIndexes?: number[] | undefined;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  extraIgnored: number;
  error?: unknown;
}

/**
 * Representative-error policy for a multimode run.
 *
 * Items are attempted in order and a mixed-cause run has no principled winner,
 * so the last failure is chosen by construction. The result is only meaningful
 * when every item failed: with any image returned the run is a success and
 * callers must not report an error (lib/multimodePipeline.ts consults it solely
 * under `returned === 0`).
 */
export function representativeItemError(errors: readonly unknown[], returnedImages: number): unknown {
  if (returnedImages > 0) return undefined;
  return errors.length > 0 ? errors[errors.length - 1] : undefined;
}

export async function generateMultimodeViaGrok(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: {
    model?: string | undefined;
    maxImages?: number | undefined;
    size?: string | undefined;
    signal?: AbortSignal | undefined;
    requestId?: string | undefined;
    references?: GrokReferenceImage[] | undefined;
    credential?: GrokCredential | undefined;
    webSearchEnabled?: boolean | undefined;
    onFinalImage?: ((image: { b64: string; revisedPrompt?: string | undefined; mime?: string | undefined }, index: number) => void | Promise<void>) | undefined;
  } = {},
): Promise<GrokMultimodeResult> {
  const model = options.model || ctx.config?.grokProvider?.defaultImageModel || "grok-imagine-image-quality";
  const maxGeneratedImages = Math.max(
    1,
    Math.trunc(Number(ctx.config?.limits?.maxGeneratedImages) || 24),
  );
  const maxImages = Math.min(
    maxGeneratedImages,
    Math.max(1, Math.trunc(Number(options.maxImages) || 4)),
  );
  const references = options.references || [];
  // One credential for the whole batch: a per-item resolve would refresh the OAuth
  // session mid-run and give items inconsistent bearers.
  const credential = options.credential
    ?? await resolveGrokCredential(ctx, "grok", { ...(options.signal ? { signal: options.signal } : {}) });
  const images: Array<{ b64: string; revisedPrompt?: string; mime?: string; providerUrl?: string }> = [];
  const originalIndexes: number[] = [];
  let totalCost = 0;
  let totalWebSearchCalls = 0;
  const itemErrors: unknown[] = [];

  logEvent("grok", "multimode:start", { requestId: options.requestId, model, maxImages, refs: references.length });

  for (let i = 0; i < maxImages; i++) {
    if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");

    const indexedPrompt = maxImages > 1 ? `[Image ${i + 1} of ${maxImages}] ${prompt}` : prompt;
    const plan = await planGrokImage(indexedPrompt, ctx, {
      model,
      size: options.size,
      signal: options.signal,
      requestId: options.requestId,
      references,
      credential,
      webSearchEnabled: options.webSearchEnabled,
    });
    totalWebSearchCalls += plan.webSearchCalls;
    const endpoint = references.length > 0 ? "/v1/images/edits" : "/v1/images/generations";
    const payload = references.length > 0
      ? imageEditPayload(model, plan.prompt, references, options.size)
      : imagePayload(model, plan.prompt, options.size);

    try {
      logEvent("grok", "multimode:item-start", {
        requestId: options.requestId,
        index: i,
        endpoint,
        refs: references.length,
        promptChars: plan.prompt.length,
      });
      const result = await postGrokImages(ctx, payload, options.signal, endpoint, credential);
      const imgUrl = result.data?.[0]?.url;
      if (imgUrl) {
        // Direct lane: the artifact URL is a public https origin, so no proxy hop is trusted.
        const dl = await downloadGrokImageUrl(imgUrl, options.signal);
        const img = { b64: dl.b64, mime: dl.mime, revisedPrompt: plan.prompt, providerUrl: imgUrl };
        images.push(img);
        originalIndexes.push(i);
        if (result.usage?.cost_in_usd_ticks) totalCost += result.usage.cost_in_usd_ticks;
        await options.onFinalImage?.(img, i);
      }
    } catch (e: unknown) {
      const eFields = thrownFields(e);
      if (eFields.code === "GENERATION_CANCELED") throw e;
      logEvent("grok", "multimode:item-error", { requestId: options.requestId, index: i, error: errInfo(e) });
      itemErrors.push(e);
    }
  }

  logEvent("grok", "multimode:done", { requestId: options.requestId, model, returned: images.length, requested: maxImages, refs: references.length });

  const usage = totalCost > 0 ? { grok_cost_usd_ticks: totalCost } : null;
  const representative = representativeItemError(itemErrors, images.length);
  return { images, originalIndexes, usage, webSearchCalls: totalWebSearchCalls, extraIgnored: 0, ...(representative !== undefined ? { error: representative } : {}) };
}
