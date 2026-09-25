/**
 * GPT OAuth image lane on openai-oauth 2 (the Codex image_gen shape).
 *
 * GPT-6 models on the ChatGPT backend cannot call the hosted image_generation tool, so the
 * lane runs in two steps, the way Codex's image_gen.imagegen and OpenCodex's media bridge do:
 *   1. plan  — the selected GPT-6 model gets ima2's existing developer/user prompts plus a
 *              client function tool \`image_gen\` and writes the final prompt(s);
 *   2. render — each prompt goes to the proxy's Images API (gpt-image-2): /generations without
 *              input images, /edits with the edit source and references.
 * Direct mode skips the planner and renders the user's prompt verbatim.
 * The result keeps ParsedResponsesResult's shape so routes, SSE, history and error
 * diagnostics stay unchanged.
 */
import { logEvent } from "./logger.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import type {
  FinalImageHandler,
  ParsedFunctionCall,
  ParsedImage,
  ParsedResponsesResult,
  ResponseDiagnostics,
} from "./responsesParse.js";
import { postOAuthImages, postResponses } from "./responsesTransport.js";

export const OAUTH_IMAGE_TOOL = "image_gen";
export const OAUTH_RENDER_MODEL = "gpt-image-2";
/** The ChatGPT images edit endpoint accepts at most five input images. */
export const OAUTH_MAX_EDIT_IMAGES = 5;
const RENDER_CONCURRENCY = 3;
const IMAGES_QUALITY = new Set(["low", "medium", "high"]);

const PLANNER_NOTE = [
  "",
  "",
  "Rendering: ima2 renders images through the image_gen function tool. Put the final image prompt in its arguments; the renderer sees only that prompt and the attached images, so include every visual detail it needs.",
  "Call image_gen exactly once. Never answer with text instead of calling it.",
].join("\n");

const SEQUENCE_NOTE = (n: number) =>
  `\nFor this request call image_gen once with \`prompts\`: an ordered array of 1 to ${n} stage prompts. Each entry becomes one separate output image.`;

export interface OAuthPlanImage {
  b64: string;
  mime: string;
}

export interface OAuthImageJob {
  ctx: RouteRuntimeContext;
  scope: string;
  requestId?: string | null | undefined;
  signal?: AbortSignal | null | undefined;
  model: string;
  mode: string;
  reasoningEffort: string;
  webSearchEnabled: boolean;
  developerPrompt: string;
  userText: string;
  /** Prompt rendered as-is in Direct mode. */
  directPrompt: string;
  /** Images the planner sees and the renderer edits from, in order (edit source first). */
  images: OAuthPlanImage[];
  maxImages: number;
  quality?: string | undefined;
  size?: string | undefined;
  background?: string | undefined;
  onFinalImage?: FinalImageHandler | null | undefined;
}

export interface OAuthImageJobResult extends ParsedResponsesResult {
  originalIndexes?: number[];
  error?: unknown;
}

/** Point every hosted-tool mention in ima2's prompts at the client function tool. */
export function toFunctionToolWording(text: string): string {
  return text.replace(/image_generation_call/g, "image_gen call").replace(/image_generation/g, "image_gen");
}

export function imageGenTool(maxImages: number) {
  const sequence = maxImages > 1;
  return {
    type: "function",
    name: OAUTH_IMAGE_TOOL,
    description: sequence
      ? "Render the requested image sequence. Call once with one prompt per output image."
      : "Render the final image. Call once with the complete image prompt.",
    parameters: sequence
      ? {
          type: "object",
          properties: {
            prompts: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: maxImages,
              description: "Ordered stage prompts, one per output image.",
            },
          },
          required: ["prompts"],
          additionalProperties: false,
        }
      : {
          type: "object",
          properties: { prompt: { type: "string", description: "Complete image prompt to render." } },
          required: ["prompt"],
          additionalProperties: false,
        },
    strict: false,
  };
}

export function buildPlannerPayload(job: OAuthImageJob, retry = false) {
  const note = PLANNER_NOTE + (job.maxImages > 1 ? SEQUENCE_NOTE(job.maxImages) : "")
    + (retry ? "\nThe previous attempt did not call image_gen. Call it now." : "");
  const text = toFunctionToolWording(job.userText);
  const content = job.images.length
    ? [
        ...job.images.map((image) => ({ type: "input_image", image_url: `data:${image.mime};base64,${image.b64}` })),
        { type: "input_text", text },
      ]
    : text;
  return {
    model: job.model,
    input: [
      { role: "developer", content: toFunctionToolWording(job.developerPrompt) + note },
      { role: "user", content },
    ],
    tools: [...(job.webSearchEnabled ? [{ type: "web_search" }] : []), imageGenTool(job.maxImages)],
    reasoning: { effort: job.reasoningEffort },
    stream: true,
  };
}

/** Read the planner's image_gen calls into an ordered prompt list, capped at maxImages. */
export function promptsFromCalls(calls: ParsedFunctionCall[] | undefined, maxImages: number): string[] {
  const prompts: string[] = [];
  for (const call of calls ?? []) {
    if (call.name !== OAUTH_IMAGE_TOOL) continue;
    let args: unknown;
    try { args = JSON.parse(call.arguments || "{}"); } catch { continue; }
    if (!args || typeof args !== "object") continue;
    const record = args as { prompt?: unknown; prompts?: unknown };
    if (Array.isArray(record.prompts)) {
      for (const entry of record.prompts) if (typeof entry === "string" && entry.trim()) prompts.push(entry.trim());
    } else if (typeof record.prompt === "string" && record.prompt.trim()) {
      prompts.push(record.prompt.trim());
    }
  }
  return prompts.slice(0, Math.max(1, maxImages));
}

/** Map ima2's request fields onto what the OAuth Images API accepts. */
export function renderFields(job: Pick<OAuthImageJob, "quality" | "size" | "background">) {
  const fields: Record<string, string> = {};
  const quality = job.quality === "xhigh" || job.quality === "max" ? "high" : job.quality;
  if (quality && IMAGES_QUALITY.has(quality)) fields.quality = quality;
  if (job.size && job.size !== "auto" && /^\d+x\d+$/.test(job.size)) fields.size = job.size;
  if (job.background && ["transparent", "opaque", "auto"].includes(job.background)) fields.background = job.background;
  return fields;
}

function extensionFor(mime: string) {
  return mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
}

async function renderOne(job: OAuthImageJob, prompt: string) {
  const fields = renderFields(job);
  if (!job.images.length) {
    return postOAuthImages({
      ctx: job.ctx,
      scope: job.scope,
      kind: "generations",
      json: { model: OAUTH_RENDER_MODEL, prompt, n: 1, ...fields },
      requestId: job.requestId,
      signal: job.signal,
    });
  }
  const form = new FormData();
  form.set("model", OAUTH_RENDER_MODEL);
  form.set("prompt", prompt);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  job.images.slice(0, OAUTH_MAX_EDIT_IMAGES).forEach((image, index) => {
    const blob = new Blob([Buffer.from(image.b64, "base64")], { type: image.mime });
    form.append("image", blob, `input-${index + 1}.${extensionFor(image.mime)}`);
  });
  return postOAuthImages({ ctx: job.ctx, scope: job.scope, kind: "edits", form, requestId: job.requestId, signal: job.signal });
}

function addUsage(target: Record<string, number>, usage: Record<string, unknown> | null | undefined) {
  for (const [key, value] of Object.entries(usage ?? {})) {
    if (typeof value === "number") target[key] = (target[key] ?? 0) + value;
  }
}

function emptyDiagnostics(): ResponseDiagnostics {
  return {
    eventTypes: {},
    streamStats: {
      chunkCount: 0, bytesRead: 0, maxChunkBytes: 0, lfBoundaryCount: 0, crlfBoundaryCount: 0,
      parseSkipCount: 0, finalBufferChars: 0, sawDoneSentinel: false, sawResponseCompleted: false,
    },
    outputItemSummary: [],
    imageCallSeen: false,
    imageCallCompleted: false,
    imageCallFailed: false,
    imageResultCount: 0,
    webSearchCallSeen: false,
    messageOutputSeen: false,
    outputTextChars: 0,
  };
}

async function plan(job: OAuthImageJob) {
  let result = await postResponses({
    ctx: job.ctx, provider: "oauth", scope: `${job.scope}-plan`, requestId: job.requestId,
    signal: job.signal, maxImages: 0, payload: buildPlannerPayload(job),
  });
  let prompts = promptsFromCalls(result.functionCalls, job.maxImages);
  if (!prompts.length) {
    logEvent(job.scope, "plan_retry", { requestId: job.requestId, events: result.eventCount });
    result = await postResponses({
      ctx: job.ctx, provider: "oauth", scope: `${job.scope}-plan`, requestId: job.requestId,
      signal: job.signal, maxImages: 0, payload: buildPlannerPayload(job, true),
    });
    prompts = promptsFromCalls(result.functionCalls, job.maxImages);
  }
  return { result, prompts };
}

export async function runOAuthImageJob(job: OAuthImageJob): Promise<OAuthImageJobResult> {
  const direct = job.mode === "direct";
  const planned = direct
    ? { result: null, prompts: Array.from({ length: Math.max(1, job.maxImages) }, () => job.directPrompt) }
    : await plan(job);
  const base = planned.result;
  const usage: Record<string, number> = {};
  addUsage(usage, base?.usage);
  const eventTypes: Record<string, number> = { ...(base?.eventTypes ?? {}) };
  const diagnostics = base?.diagnostics ? { ...base.diagnostics } : emptyDiagnostics();
  const kind = job.images.length ? "images.edits" : "images.generations";
  logEvent(job.scope, "plan_done", { requestId: job.requestId, direct, prompts: planned.prompts.length });

  type Settled = { ok: true; value: Awaited<ReturnType<typeof renderOne>> } | { ok: false; error: unknown };
  const slots = planned.prompts.map(() => {
    let resolve!: (value: Settled) => void;
    const promise = new Promise<Settled>((r) => { resolve = r; });
    return { promise, resolve };
  });
  let cursor = 0;
  const worker = async () => {
    while (cursor < planned.prompts.length) {
      const index = cursor++;
      try {
        slots[index]?.resolve({ ok: true, value: await renderOne(job, planned.prompts[index] as string) });
      } catch (error) {
        slots[index]?.resolve({ ok: false, error });
      }
    }
  };
  const workers = Array.from({ length: Math.min(RENDER_CONCURRENCY, planned.prompts.length) }, () => worker());

  const images: ParsedImage[] = [];
  const originalIndexes: number[] = [];
  let firstError: unknown;
  // Deliver in stage order so sequences persist and stream in the order the planner wrote them.
  for (const [index, slot] of slots.entries()) {
    const settled = await slot.promise;
    eventTypes[kind] = (eventTypes[kind] ?? 0) + 1;
    if (!settled.ok) {
      firstError ??= settled.error;
      logEvent(job.scope, "render_failed", { requestId: job.requestId, index });
      continue;
    }
    addUsage(usage, settled.value.usage);
    const b64 = settled.value.images[0]?.b64;
    if (!b64) continue;
    const image = { b64, revisedPrompt: direct ? null : (planned.prompts[index] as string) };
    images.push(image);
    originalIndexes.push(index);
    await job.onFinalImage?.(image, index);
  }
  await Promise.all(workers);
  // A single render has no partial result to return: surface its own error.
  if (planned.prompts.length === 1 && firstError !== undefined) throw firstError;
  diagnostics.eventTypes = eventTypes;
  diagnostics.imageCallSeen = planned.prompts.length > 0;
  diagnostics.imageCallCompleted = images.length > 0;
  diagnostics.imageCallFailed = firstError !== undefined;
  diagnostics.imageResultCount = images.length;
  return {
    images,
    usage: Object.keys(usage).length ? usage : null,
    webSearchCalls: base?.webSearchCalls ?? 0,
    eventCount: (base?.eventCount ?? 0) + planned.prompts.length,
    eventTypes,
    extraIgnored: 0,
    text: base?.text ?? null,
    diagnostics,
    ...(base?.functionCalls ? { functionCalls: base.functionCalls } : {}),
    ...(originalIndexes.length !== planned.prompts.length || firstError !== undefined ? { originalIndexes } : {}),
    ...(firstError !== undefined ? { error: firstError } : {}),
  };
}
