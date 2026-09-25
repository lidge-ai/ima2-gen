import type { GenerateOptions } from "../providers/adapters/openaiTypes.js";
import type { UpstreamErr } from "../generationErrors.js";
import { setJobPhase } from "../inflight.js";
import { logEvent } from "../logger.js";
import { safeReferenceDiagnostics } from "../refs.js";
import type { RouteRuntimeContext } from "../runtimeContext.js";
import { throwOAuthHttpError, throwOAuthTimeoutError } from "./errors.js";
import {
  GENERATE_DEVELOPER_PROMPT,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  buildUserTextPrompt,
} from "./prompts.js";
import { normalizeReferenceForOAuth } from "./references.js";
import type { OAuthReferenceRef } from "./references.js";
import {
  buildImageTools,
  createOAuthGenerationTimeout,
  fetchOAuth,
  getOAuthUrl,
  resolveReasoningEffort,
  resolveWebSearchEnabled,
  summarizeEventTypes,
  waitForOAuthReady,
} from "./runtime.js";
import { readImageStream, type OAuthResponsesJson } from "./streams.js";

export async function generateViaOAuth(
  prompt: string,
  quality: string,
  size: string,
  moderation: string = "low",
  references: OAuthReferenceRef[] = [],
  requestId: string | null = null,
  mode: string = "auto",
  ctx: RouteRuntimeContext = {},
  options: GenerateOptions = {},
) {
  await waitForOAuthReady(ctx);
  const oauthUrl = getOAuthUrl(ctx);
  const model = options.model || ctx.config?.imageModels?.default || "gpt-5.6-luna";
  const webSearchEnabled = resolveWebSearchEnabled(options);
  const tools = buildImageTools(webSearchEnabled, {
    quality,
    size,
    moderation,
    ...(options.partialImages ? { partial_images: options.partialImages } : {}),
  });

  const textPrompt = buildUserTextPrompt(prompt, mode, { webSearchEnabled, size });
  const referenceInputs = references.map(normalizeReferenceForOAuth);
  const referenceDiagnostics = safeReferenceDiagnostics(referenceInputs);
  const referenceMismatchCount = referenceDiagnostics.filter((ref) => ref.warnings.includes("mime_mismatch")).length;
  const userContent = referenceInputs.length
    ? [
        ...referenceInputs.map(({ b64, requestMime }) => ({
          type: "input_image",
          image_url: `data:${requestMime};base64,${b64}`,
        })),
        { type: "input_text", text: textPrompt },
      ]
    : textPrompt;

  if (referenceInputs.length > 0) {
    logEvent("oauth", "reference_diagnostics", {
      requestId,
      refsCount: referenceInputs.length,
      referenceMismatchCount,
      refDetectedMimes: [...new Set(referenceDiagnostics.map((ref) => ref.detectedMime).filter(Boolean))].join(","),
      refDeclaredMimes: [...new Set(referenceDiagnostics.map((ref) => ref.declaredMime).filter(Boolean))].join(","),
    });
  }

  const reasoningEffort = resolveReasoningEffort(ctx, options);
  const developerPrompt = webSearchEnabled ? GENERATE_DEVELOPER_PROMPT : GENERATE_NO_SEARCH_DEVELOPER_PROMPT;
  const timeout = createOAuthGenerationTimeout(ctx, requestId, "oauth");
  try {
    const res = await fetchOAuth(`${oauthUrl}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      ...(timeout.signal ? { signal: timeout.signal } : {}),
      body: JSON.stringify({
        model,
        input: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: userContent },
        ],
        tools,
        tool_choice: "required",
        reasoning: { effort: reasoningEffort },
        stream: true,
      }),
    }, { requestId, scope: "oauth" });

    logEvent("oauth", "response", {
      requestId,
      model,
      status: res.status,
      contentType: res.headers.get("content-type"),
    });

    if (!res.ok) {
      const text = await res.text();
      logEvent("oauth", "error_response", { requestId, status: res.status, errorChars: text.length });
      throwOAuthHttpError(res, text, {
        requestId,
        scope: "oauth",
        fallbackMessage: `OAuth proxy returned ${res.status}`,
      });
    }

    if (requestId) setJobPhase(requestId, "streaming");

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      logEvent("oauth", "json_response", { requestId });
      const json = await res.json() as OAuthResponsesJson;
      for (const item of json.output || []) {
        if (item.type === "image_generation_call" && item.result) {
          logEvent("oauth", "image", { requestId, imageChars: item.result.length });
          const revisedPrompt = typeof item.revised_prompt === "string" ? item.revised_prompt : null;
          return { b64: item.result, usage: json.usage, webSearchCalls: 0, revisedPrompt };
        }
      }
      logEvent("oauth", "json_no_image", { requestId, outputCount: (json.output || []).length });
      throw new Error("No image data in response (non-stream mode)");
    }

    const { imageB64, usage, webSearchCalls, revisedPrompt, eventCount, eventTypes } = await readImageStream(res, {
      requestId,
      scope: "oauth",
      onPartialImage: options.onPartialImage,
    });
    logEvent("oauth", "stream_end", {
      requestId,
      events: eventCount,
      hasImage: !!imageB64,
      ...summarizeEventTypes(eventTypes),
    });

    if (!imageB64) {
      // Keep reference images on the retry: a transient empty stream is not
      // evidence the references caused it, and dropping them silently degrades
      // a reference-guided generation (e.g. card news template) into prompt-only.
      const hadReferences = referenceInputs.length > 0;
      const retryKind = hadReferences ? "references_json_image_tool" : "prompt_only";
      logEvent("oauth", "retry_json", {
        requestId,
        retryKind,
        hadReferences,
        referencesDroppedOnRetry: false,
        developerPromptDroppedOnRetry: true,
      });
      const retryRes = await fetchOAuth(`${oauthUrl}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(timeout.signal ? { signal: timeout.signal } : {}),
        body: JSON.stringify({
          model,
          input: [{ role: "user", content: userContent }],
          tools: [{ type: "image_generation", quality, size, moderation }],
          tool_choice: "required",
          reasoning: { effort: reasoningEffort },
          stream: false,
        }),
      }, { requestId, scope: "oauth" });

      if (retryRes.ok) {
        const json = await retryRes.json() as OAuthResponsesJson;
        for (const item of json.output || []) {
          if (item.type === "image_generation_call" && item.result) {
            logEvent("oauth", "retry_image", {
              requestId,
              imageChars: item.result.length,
              retryKind,
              hadReferences,
              referencesDroppedOnRetry: false,
            });
            const retryRevised = typeof item.revised_prompt === "string" ? item.revised_prompt : null;
            return {
              b64: item.result,
              usage: json.usage,
              webSearchCalls,
              revisedPrompt: retryRevised,
              retryKind,
              hadReferences,
              referencesDroppedOnRetry: false,
              developerPromptDroppedOnRetry: true,
              initialEventCount: eventCount,
            };
          }
        }
      } else {
        const text = await retryRes.text();
        logEvent("oauth", "retry_error_response", { requestId, status: retryRes.status, errorChars: text.length });
        throwOAuthHttpError(retryRes, text, {
          requestId,
          scope: "oauth",
          fallbackMessage: `OAuth proxy returned ${retryRes.status}`,
        });
      }

      const emptyErr: Error & UpstreamErr = new Error("No image data received from OAuth proxy (parsed " + eventCount + " events)");
      emptyErr.eventCount = eventCount;
      emptyErr.eventTypes = eventTypes;
      emptyErr.size = size;
      emptyErr.quality = quality;
      emptyErr.model = model;
      emptyErr.refsCount = referenceInputs.length;
      emptyErr.inputImageCount = referenceInputs.length;
      emptyErr.referenceDiagnostics = referenceDiagnostics;
      emptyErr.referenceMismatchCount = referenceMismatchCount;
      emptyErr.retryKind = retryKind;
      emptyErr.hadReferences = hadReferences;
      emptyErr.referencesDroppedOnRetry = false;
      emptyErr.developerPromptDroppedOnRetry = true;
      throw emptyErr;
    }

    return { b64: imageB64, usage, webSearchCalls, revisedPrompt };
  } catch (err) {
    if (timeout.isTimeoutError(err)) {
      throwOAuthTimeoutError(err, { timeoutMs: timeout.timeoutMs, requestId, scope: "oauth" });
    }
    throw err;
  } finally {
    timeout.clear();
  }
}

export { generateMultimodeViaOAuth, editViaOAuth } from "./multimodeGenerators.js";
