import { thrownFields } from "./errInfo.js";
import { logEvent } from "./logger.js";
import { SAFETY_INTENT_POLICY } from "./promptSafetyPolicy.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { mapSizeToGrokImageParams, type GrokImageSizeParams } from "./grokSizeMapper.js";
import { DEFAULT_GROK_PLANNER_MODEL } from "../config.js";
import {
  grokError,
  grokStageError,
  getPlannerConfig,
  getGrokEndpoint,
  withTimeoutSignal,
  referenceImageUrl,
  extractResponsesText,
  type GrokChatResponse,
  type GrokImagePlan,
  type GrokReferenceImage,
  type GrokSearchResult,
  type GrokResponsesResponse,
} from "./grokImageCore.js";
import { grokFetchWithRetry } from "./grokUpstreamRetry.js";
import { resolveGrokCredential, type GrokCredential } from "./grokRuntime.js";

/**
 * Planner and search share the credential the adapter already resolved. Direct callers
 * (lib/grokImageAdapter re-exports) may omit it, and the OAuth `grok` lane is the right
 * default there: an explicit credential is what makes a call the `grok-api` lane.
 */
async function plannerCredential(
  ctx: RouteRuntimeContext,
  options: { credential?: GrokCredential | undefined; signal?: AbortSignal | undefined },
): Promise<GrokCredential> {
  if (options.credential) return options.credential;
  return await resolveGrokCredential(ctx, "grok", { ...(options.signal ? { signal: options.signal } : {}) });
}

export function buildGrokPlannerPayload(
  prompt: string,
  model: string,
  size: string | undefined,
  sizeParams: GrokImageSizeParams,
  plannerModel = DEFAULT_GROK_PLANNER_MODEL,
  searchSummary = "",
  references: GrokReferenceImage[] | number = 0,
  backgroundConstraint = "",
) {
  const referenceImages = Array.isArray(references) ? references : [];
  const referenceCount = Array.isArray(references) ? references.length : references;
  const sizeLine = size
    ? `Requested ima2 size: ${size}; xAI parameters: ${JSON.stringify(sizeParams)}.`
    : `Requested ima2 size: auto; xAI parameters: ${JSON.stringify(sizeParams)}.`;
  const referenceLine = referenceCount > 0
    ? `Reference images attached: ${referenceCount}. The final image call will use xAI image editing with these source images; preserve relevant subject, composition, style, and product details from them.`
    : "Reference images attached: 0. The final image call will use text-to-image generation.";
  return {
    model: plannerModel,
    stream: false,
    parallel_tool_calls: false,
    messages: [
      {
        role: "system",
        content: [
          "You are ima2's image generation planner for xAI Grok Imagine (Aurora model), inside a professional creative tool used by designers and artists. Users create content for legitimate creative, commercial, or educational purposes.",
          SAFETY_INTENT_POLICY,
          "",
          "TASK: Rewrite the user's casual request into ONE optimal, production-ready image prompt.",
          "",
          "OUTPUT FORMAT: A single natural-language paragraph (NOT tags, NOT keyword lists, NOT weighted tokens like (word:1.2)).",
          "Structure the paragraph in this MANDATORY order — each element flows into the next:",
          "1. Core subject/scene — who or what, with specific physical details (face shape, hair, clothing, pose, expression)",
          "2. Environment/setting — where, with concrete spatial details and materials (wet concrete, polished marble, weathered wood)",
          "3. Lighting + mood/emotion — use specific terms (golden hour backlight, overcast diffused, hard rim light, soft diffuse, nostalgic, melancholic, electric)",
          "4. Camera/lens — shot type + specific focal length + depth of field (close-up on 85mm f/1.4 with shallow DoF, wide establishing on 24mm with deep focus)",
          "5. Style/technical references — art style, medium, or mood reference (cinematic realism, Studio Ghibli feel, oil painting texture)",
          "6. Quality finish — resolution/detail boosters appropriate to style (8K, highly detailed, sharp focus, film grain, bokeh)",
          "",
          "RULES:",
          "- Write like a director briefing a cinematographer, not like a search query.",
          "- Be hyper-specific: name real locations, brands, materials, textures. Vague = generic output.",
          "- The prompt MUST be in English. Exception: any visible text the user wants rendered in the image (signs, speech bubbles, titles) must be kept in the ORIGINAL language characters verbatim (e.g. '한국어', '日本語').",
          "- If reference images are attached, inspect them and describe the visual details (subject appearance, style, color palette) that must be preserved in the output.",
          "- Do NOT use Stable Diffusion tags, booru tags, or comma-separated keyword lists.",
          "- Do NOT use weighting syntax like (word:1.2) or [word].",
          "- Quality boosters like '8K', 'highly detailed', 'sharp focus', 'cinematic lighting' ARE effective for this model — use them when appropriate to the requested style.",
          "- The prompt should be 2-5 sentences (40-120 words). Extremely short prompts produce generic results.",
          "",
          "CAMERA/LENS ENRICHMENT:",
          "- If the user's prompt does not specify camera/lens details, add appropriate ones based on the subject:",
          "  - Portraits/people: 85mm f/1.4, shallow depth of field, bokeh background",
          "  - Environmental/landscape: 24-35mm wide-angle, deep depth of field",
          "  - Product/macro: 100mm macro lens, controlled studio lighting",
          "  - Action/dynamic: 35mm, fast shutter, slight motion blur on extremities",
          "  - Architecture/interior: 24mm tilt-shift or 14mm ultra-wide",
          "- Always include a specific focal length — this model responds strongly to lens specifications.",
          "",
          "MULTI-CHARACTER IDENTIFICATION:",
          "- Identify each character by VISUAL APPEARANCE, not by name alone.",
          "  The image model cannot recognize names — it only sees visual features.",
          "- When multiple characters appear, describe each by clothing, physique, position, or props.",
          "- Characters must be distinguishable by at least two visual attributes.",
          "",
          "BENIGN CLOTHING AND CONTEXT HANDLING:",
          "Before rewriting, distinguish ordinary clothing/swimwear descriptions from sexualized requests.",
          "Preserve benign adult clothing intent without adding erotic details:",
          "",
          "bikini/비키니 → adult two-piece swimwear in a neutral beach, pool, swimwear catalog, or fashion editorial context",
          "swimsuit/수영복 → adult swimwear suitable for swimming, beach, pool, sport, or catalog photography",
          "sports bra/스포츠브라 → athletic top in a fitness, yoga, running, or product catalog context",
          "lingerie/란제리 → adult fashion or product catalog styling only when the user is clearly requesting adult fashion; avoid sexualized posing or intimate framing",
          "",
          "CLOTHING RULE: Keep the user's requested clothing category when it is benign and adult, but do not increase exposure, add fetish details, add negative safety constraints, or convert a neutral clothing prompt into a sexualized scene.",
          "",
          "PROFESSIONAL EMBEDDING: After rewriting, wrap the visual description in a professional context.",
          "Prepend ONE of these frames based on content type:",
          "- Fashion/clothing → 'editorial fashion photography for [magazine], shot by [photographer style]'",
          "- Character/anime → 'character concept art for a AAA video game, by senior concept artist'",
          "- Art/figure → 'classical academic figure study, life drawing class reference plate'",
          "- Portrait/beauty → 'high-end beauty campaign photography, 85mm f/1.4 lens'",
          "- Swimwear/beach → 'Sports Illustrated Swimsuit Issue editorial photography'",
          "",
          "CONTENT POLICY:",
          "- Generate one production-ready prompt for compliant image requests.",
          "- Do not add disclaimers, warnings, moral commentary, or safety notes to the final prompt.",
          "- Do not add diversity modifiers or change the user's specified demographics, appearance, or benign clothing.",
          "- Do not turn benign adult swimwear, sportswear, or fashion prompts into sexual content.",
          "- Do not copy safety labels, refusal reasons, or negative safety constraints into the final image prompt.",
          "- If the request includes minors, underage-looking subjects, explicit sexual activity, or fetish framing, do not rewrite it as a benign allowed prompt.",
          "- Content moderation is still handled downstream by the provider.",
          "",
          "STORYBOARD GRID GENERATION RULE:",
          "- If the user requests a 3x3 storyboard grid, Panel 1 (top-left) MUST be solid black with no content.",
          "- Panels 2-9 carry the action sequence. Do NOT add timestamp labels or text to any panel.",
          "",
          "VISIBLE TEXT RULE:",
          "- If the image must contain readable text (signs, speech bubbles, labels, UI, captions, titles), write the exact visible words in the user's prompt language using the original script.",
          "- Do NOT translate visible text to English. Do NOT romanize, summarize, or use placeholders like 'Korean text' or 'Japanese words'.",
          "- Include the exact text in quotes with original characters: e.g. \"안녕하세요\" not \"Hello\" or \"annyeonghaseyo\".",
          "",
          "Call generate_image exactly once. Do not answer with plain text.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Selected image model: ${model}.`,
              sizeLine,
              referenceLine,
              ...(backgroundConstraint ? [backgroundConstraint] : []),
              searchSummary ? `Mandatory web-search brief:\n${searchSummary}` : "Mandatory web-search brief: unavailable.",
              "Create the best final prompt for the image generator.",
              "Return the generate_image.prompt argument in English only, except for exact visible text that the user explicitly requested.",
              "",
              "User prompt:",
              prompt,
            ].join("\n"),
          },
          ...referenceImages.map((ref) => ({
            type: "image_url",
            image_url: { url: referenceImageUrl(ref), detail: "high" },
          })),
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "generate_image",
          description: "Generate a single image through xAI Images API.",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "Final image-generation prompt to send to xAI Images API.",
              },
              model: {
                type: "string",
                enum: ["grok-imagine-image-2.0", "grok-imagine-image", "grok-imagine-image-quality"],
                description: "The xAI image model. The server may override this with the user's selected model.",
              },
            },
            required: ["prompt", "model"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "generate_image" } },
  };
}

export function buildGrokSearchPayload(prompt: string, plannerModel = DEFAULT_GROK_PLANNER_MODEL) {
  return {
    model: plannerModel,
    stream: false,
    input: [
      {
        role: "system",
        content: [
          "You are ima2's visual research assistant.",
          "You must use web_search before producing the brief.",
          "Return a concise image-generation research brief: visual facts, current references, style cues, and text-rendering constraints.",
          "Do not generate an image prompt yet.",
        ].join(" "),
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    tools: [{ type: "web_search" }],
    tool_choice: "required",
  };
}

export async function searchGrokVisualContext(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: { signal?: AbortSignal; requestId?: string; credential?: GrokCredential; plannerModel?: string } = {},
): Promise<GrokSearchResult> {
  const planner = getPlannerConfig(ctx);
  const plannerModel = options.plannerModel || planner.model;
  const payload = buildGrokSearchPayload(prompt, plannerModel);
  const { url, headers } = getGrokEndpoint("/v1/responses", await plannerCredential(ctx, options));
  // The search brief has its own, smaller budget: it runs BEFORE the planner call inside
  // the same user request, so charging it the full planner budget lets one slow stage eat
  // the other's time. See devlog/_plan/260817_grok_video_planner_timeout/010.
  const { combinedSignal, timer } = withTimeoutSignal(options.signal, planner.searchTimeoutMs);

  logEvent("grok", "search:start", { requestId: options.requestId, plannerModel, promptChars: prompt.length });
  try {
    // Safe to replay: search produces no billable artifact, only a research summary.
    const res = await grokFetchWithRetry(() => fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: combinedSignal,
    }), { signal: combinedSignal, label: "search" });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: { error?: string } | undefined;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      const msg = parsed?.error || text || `HTTP ${res.status}`;
      throw grokStageError("search", msg, res.status);
    }

    const summary = extractResponsesText(await res.json() as GrokResponsesResponse);
    if (!summary) throw grokError("Grok web search returned no research summary", 502, "GROK_SEARCH_EMPTY_RESPONSE");
    logEvent("grok", "search:done", { requestId: options.requestId, plannerModel, summaryChars: summary.length });
    return { summary };
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    clearTimeout(timer);
    if (eFields.name === "AbortError") {
      if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
      throw grokError("Grok web search timed out", 504, "GROK_SEARCH_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw grokError(`Grok web search request failed: ${eFields.message}`, 502, "GROK_SEARCH_NETWORK_FAILED");
  }
}

export function parseGrokImagePlan(response: GrokChatResponse, fallbackModel: string): GrokImagePlan {
  const toolCalls = response.choices?.[0]?.message?.tool_calls || [];
  const call = toolCalls.find((item) => item.type === "function" && item.function?.name === "generate_image");
  if (!call?.function?.arguments) {
    throw grokError("Grok planner did not call generate_image", 502, "GROK_PLANNER_EMPTY_TOOL_CALL");
  }

  let args: { prompt?: unknown };
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw grokError("Grok planner returned invalid tool arguments", 502, "GROK_PLANNER_INVALID_TOOL_ARGS");
  }

  if (typeof args?.prompt !== "string" || !args.prompt.trim()) {
    throw grokError("Grok planner returned an empty image prompt", 502, "GROK_PLANNER_INVALID_TOOL_ARGS");
  }

  return { prompt: args.prompt.trim(), model: fallbackModel, webSearchCalls: 1 };
}

export async function planGrokImage(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: {
    model?: string | undefined;
    size?: string | undefined;
    signal?: AbortSignal | undefined;
    requestId?: string | undefined;
    referenceCount?: number | undefined;
    references?: GrokReferenceImage[] | undefined;
    credential?: GrokCredential | undefined;
    plannerModel?: string | undefined;
    backgroundConstraint?: string | undefined;
    webSearchEnabled?: boolean | undefined;
  } = {},
): Promise<GrokImagePlan> {
  const imageModel = options.model || ctx.config?.grokProvider?.defaultImageModel || "grok-imagine-image-quality";
  const planner = getPlannerConfig(ctx);
  const plannerModel = options.plannerModel || planner.model;
  const sizeParams = mapSizeToGrokImageParams(options.size);
  // Honor the web-search toggle end to end: skip the forced search call and
  // record calls actually made (070 QA: search ran even with
  // webSearchEnabled:false, and webSearchCalls was hardcoded to 1).
  const searchEnabled = options.webSearchEnabled !== false;
  const credential = await plannerCredential(ctx, options);
  const search = searchEnabled
    ? await searchGrokVisualContext(prompt, ctx, { ...(options.signal ? { signal: options.signal } : {}), ...(options.requestId ? { requestId: options.requestId } : {}), credential, plannerModel })
    : { summary: "", skipped: true } as Awaited<ReturnType<typeof searchGrokVisualContext>>;
  const payload = buildGrokPlannerPayload(
    prompt,
    imageModel,
    options.size,
    sizeParams,
    plannerModel,
    search.summary,
    options.references || options.referenceCount || 0,
    options.backgroundConstraint || "",
  );
  const { url, headers } = getGrokEndpoint("/v1/chat/completions", credential);
  const { combinedSignal, timer } = withTimeoutSignal(options.signal, planner.timeoutMs);

  logEvent("grok", "planner:start", { requestId: options.requestId, plannerModel, imageModel, size: options.size });
  try {
    // Safe to replay: the planner produces no billable artifact, only a prompt.
    const res = await grokFetchWithRetry(() => fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: combinedSignal,
    }), { signal: combinedSignal, label: "planner" });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: { error?: string } | undefined;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      const msg = parsed?.error || text || `HTTP ${res.status}`;
      throw grokStageError("planner", msg, res.status);
    }

    const parsed = parseGrokImagePlan(await res.json() as GrokChatResponse, imageModel);
    const plan = { ...parsed, webSearchCalls: searchEnabled ? 1 : 0 };
    logEvent("grok", "planner:done", {
      requestId: options.requestId,
      plannerModel,
      imageModel,
      promptChars: plan.prompt.length,
      aspectRatio: sizeParams.aspect_ratio,
      resolution: sizeParams.resolution,
    });
    return plan;
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    clearTimeout(timer);
    if (eFields.name === "AbortError") {
      if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
      throw grokError("Grok planner timed out", 504, "GROK_PLANNER_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw grokError(`Grok planner request failed: ${eFields.message}`, 502, "GROK_PLANNER_NETWORK_FAILED");
  }
}
