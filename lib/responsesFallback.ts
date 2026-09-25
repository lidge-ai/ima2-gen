import { logEvent } from "./logger.js";
import type { ParsedResponsesResult } from "./responsesParse.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { imageToolChoice, tools } from "./responsesTools.js";
import { emptyResponseError } from "./responsesErrors.js";
import { thrownFields } from "./errInfo.js";
import {
  GENERATE_DEVELOPER_PROMPT,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  buildUserTextPrompt,
} from "./oauthProxy.js";

type PostResponses = (args: {
  ctx: RouteRuntimeContext;
  provider: string | undefined;
  scope: string;
  payload: unknown;
  requestId?: string | null | undefined;
  maxImages?: number | undefined;
  signal?: AbortSignal | null | undefined;
}) => Promise<ParsedResponsesResult>;

const MAX_RETRIES = 2;

type ReferenceInput = { type: string; image_url: string };

export async function retryPromptOnlyJsonImage({
  postResponses,
  ctx,
  provider,
  prompt,
  mode,
  model,
  quality,
  size,
  moderation,
  requestId,
  signal,
  initial,
  referenceInputs = [],
  webSearchDroppedOnRetry,
  reasoningEffort,
  background,
  outputFormat,
}: {
  postResponses: PostResponses;
  ctx: RouteRuntimeContext;
  provider: string | undefined;
  prompt: string | undefined;
  mode: string;
  model: string;
  quality?: string | undefined;
  size?: string | undefined;
  moderation?: string | undefined;
  requestId: string | null;
  signal?: AbortSignal | null;
  initial: ParsedResponsesResult;
  referenceInputs?: ReferenceInput[];
  webSearchDroppedOnRetry: boolean;
  reasoningEffort?: string;
  /** Carried through so a retry cannot silently drop the alpha request. */
  background?: string | undefined;
  outputFormat?: string | undefined;
}) {
  if (provider === "api") return null;
  const developerPrompt = webSearchDroppedOnRetry
    ? GENERATE_NO_SEARCH_DEVELOPER_PROMPT
    : GENERATE_DEVELOPER_PROMPT;
  const hadReferences = referenceInputs.length > 0;

  // Retry chain: the first MAX_RETRIES attempts stay faithful to the original
  // request — developer prompt kept AND reference images kept (a transient empty
  // stream is not evidence the references caused it; dropping them silently
  // degrades a reference-guided generation into a prompt-only one). Only the
  // final attempt goes truly prompt-only (developer prompt and references both
  // dropped) so a clean, instruction-free generation gets the last word as a
  // clearly-labeled degraded last resort.
  const attemptPlans = [
    ...Array.from({ length: MAX_RETRIES }, () => ({
      retryKind: hadReferences ? "references_with_developer" : "prompt_only_with_developer",
      developerPromptDroppedOnRetry: false,
      referencesDroppedOnRetry: false,
    })),
    {
      retryKind: "prompt_only_json_image_tool",
      developerPromptDroppedOnRetry: true,
      referencesDroppedOnRetry: hadReferences,
    },
  ];

  const baseMeta = {
    initialEventCount: initial.eventCount,
    initialEventTypes: initial.eventTypes,
    hadReferences,
    webSearchDroppedOnRetry,
  };
  let retryMeta = { ...baseMeta, ...attemptPlans[attemptPlans.length - 1] };

  let lastRetry: ParsedResponsesResult | null = null;

  for (let attempt = 1; attempt <= attemptPlans.length; attempt++) {
    const plan = attemptPlans[attempt - 1];
    if (!plan) break;
    retryMeta = { ...baseMeta, ...plan };
    logEvent("oauth", "retry_attempt", { requestId, attempt, maxRetries: attemptPlans.length, ...retryMeta });
    const userText = buildUserTextPrompt(prompt, mode, { webSearchEnabled: false, size });
    const keepReferences = hadReferences && !plan.referencesDroppedOnRetry;
    const userContent = keepReferences
      ? [...referenceInputs, { type: "input_text", text: userText }]
      : userText;
    try {
      lastRetry = await postResponses({
        ctx,
        provider,
        scope: "oauth-fallback",
        requestId,
        maxImages: 1,
        signal,
        payload: {
          model,
          input: [
            ...(plan.developerPromptDroppedOnRetry ? [] : [{ role: "developer", content: developerPrompt }]),
            { role: "user", content: userContent },
          ],
          tools: tools(false, {
            quality,
            size,
            moderation,
            ...(background ? { background } : {}),
            ...(outputFormat ? { output_format: outputFormat } : {}),
          }),
          tool_choice: imageToolChoice(true),
          reasoning: { effort: reasoningEffort || "low" },
          // OAuth/Codex proxy returns empty output[] for non-stream image requests; SSE required.
          stream: true,
        },
      });
    } catch (e) {
      if (attempt === attemptPlans.length) {
        if (e && typeof e === "object") Object.assign(e, retryMeta);
        throw e;
      }
      logEvent("oauth", "retry_error", { requestId, attempt, error: (e as Error).message, status: thrownFields(e).status, code: thrownFields(e).code });
      continue;
    }
    const image = lastRetry.images[0];
    if (image?.b64) {
      logEvent("oauth", "retry_image", { requestId, retryKind: plan.retryKind, attempt, imageChars: image.b64.length });
      return { b64: image.b64, usage: lastRetry.usage, webSearchCalls: initial.webSearchCalls, revisedPrompt: image.revisedPrompt, text: lastRetry.text, ...retryMeta };
    }
    logEvent("oauth", "retry_no_image", { requestId, retryKind: plan.retryKind, attempt, fallbackEventCount: lastRetry.eventCount });
  }

  const diagSource = lastRetry ?? initial;
  throw emptyResponseError("No image data received after retries", diagSource, {
    provider,
    model,
    quality,
    size,
    moderation,
    webSearchEnabled: false,
    refsCount: 0,
    inputImageCount: 0,
    promptChars: typeof prompt === "string" ? prompt.length : 0,
    toolTypes: ["image_generation"],
    toolChoiceKind: "image_generation",
    ...retryMeta,
    fallbackEventCount: diagSource.eventCount,
    fallbackEventTypes: diagSource.eventTypes,
    fallbackImageCallSeen: diagSource.diagnostics.imageCallSeen,
    fallbackImageResultCount: diagSource.diagnostics.imageResultCount,
  });
}
