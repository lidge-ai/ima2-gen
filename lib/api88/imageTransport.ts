import type { RuntimeContext } from "../runtimeContext.js";
import type { ExecutionReference, SingleImageExecutionResult } from "../providers/execution/types.js";
import { getProvider } from "../providers/registry.js";
import { detectImageMimeFromB64 } from "../refs.js";
import { api88Origin } from "./origin.js";
import { api88Key } from "./catalog.js";
import { api88Error, api88Json, api88Record } from "./errors.js";
import { downloadApi88Bytes, parseApi88ImageBytes, readApi88Image } from "./download.js";
import { parseApi88GeminiImage } from "./geminiParse.js";

export interface Api88ImageOptions {
  model?: string | undefined;
  size?: string | undefined;
  requestId?: string | undefined;
  signal?: AbortSignal | undefined;
  references?: ExecutionReference[] | undefined;
  sourceImage?: string | null | undefined;
  providerUrl?: string | null | undefined;
  mask?: string | null | undefined;
}

export function assertApi88ImageModel(model: string): void {
  const row = getProvider("88api").models.find((entry) => entry.kind === "image" && entry.id === model);
  if (!row) throw api88Error("API88_MODEL_UNSUPPORTED", `Unknown 88API image model: ${model}`, 400);
  if ("status" in row && row.status === "unverified") throw api88Error("API88_MODEL_UNVERIFIED", `88API image endpoint is unverified for ${model}`, 400);
}

function normalizedReference(value: string): ExecutionReference {
  const b64 = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  const detectedMime = detectImageMimeFromB64(b64);
  if (!detectedMime) throw api88Error("API88_REFERENCE_INVALID", "88API reference is not a supported image", 400);
  return { b64, declaredMime: detectedMime, detectedMime };
}

async function references(ctx: RuntimeContext, options: Api88ImageOptions, signal: AbortSignal) {
  const refs = (options.references ?? []).map((ref) => normalizedReference(ref.b64));
  if (options.sourceImage) refs.unshift(normalizedReference(options.sourceImage));
  else if (options.providerUrl) {
    const image = parseApi88ImageBytes(await downloadApi88Bytes(options.providerUrl, signal, ctx.config.api88Provider.maxImageBytes), ctx.config.api88Provider.maxImageBytes);
    refs.unshift(normalizedReference(image.b64));
  }
  if (refs.length > ctx.config.limits.maxRefCount) throw api88Error("API88_REF_TOO_MANY", `88API input exceeds the application reference limit ${ctx.config.limits.maxRefCount}`, 400);
  return refs;
}

function gptBody(model: string, prompt: string, size: string, refs: ExecutionReference[]): RequestInit {
  const supportedSize = ["1024x1024", "1536x1024", "1024x1536"].includes(size) ? size : "1024x1024";
  if (refs.length === 0) return {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size: supportedSize, n: 1 }),
  };
  const form = new FormData();
  form.set("model", model); form.set("prompt", prompt); form.set("n", "1"); form.set("size", supportedSize);
  for (const [index, ref] of refs.entries()) {
    const bytes = new Uint8Array(Buffer.from(ref.b64, "base64"));
    form.append("image[]", new Blob([bytes], { type: ref.detectedMime ?? "image/png" }), `reference-${index}`);
  }
  return { method: "POST", body: form };
}

function geminiBody(model: string, prompt: string, refs: ExecutionReference[]): RequestInit {
  const content = refs.length ? [
    { type: "text", text: prompt },
    ...refs.map((ref) => ({ type: "image_url", image_url: { url: `data:${ref.detectedMime};base64,${ref.b64}` } })),
  ] : prompt;
  return { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }) };
}

function imageValue(body: unknown): { value: string; revisedPrompt?: string } {
  const data = api88Record(body).data;
  const first = api88Record(Array.isArray(data) ? data[0] : undefined);
  const value = typeof first.b64_json === "string" && first.b64_json
    ? `data:image/png;base64,${first.b64_json}` : typeof first.url === "string" ? first.url : "";
  if (!value) throw api88Error("API88_EMPTY_RESULT", "88API image response contained no data[0] image", 502);
  return { value, ...(typeof first.revised_prompt === "string" ? { revisedPrompt: first.revised_prompt } : {}) };
}

function deadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

export async function generateViaApi88Image(prompt: string, ctx: RuntimeContext, options: Api88ImageOptions = {}): Promise<SingleImageExecutionResult> {
  const model = options.model ?? ctx.config.api88Provider.defaultImageModel;
  assertApi88ImageModel(model);
  if (options.mask) throw api88Error("API88_MASK_UNSUPPORTED", "88API image masks are unsupported", 400);
  const key = api88Key(ctx, "image");
  if (!key) throw api88Error("API88_IMAGE_KEY_MISSING", "88API image key missing", 401);
  const cfg = ctx.config.api88Provider;
  const signal = deadline(options.signal, cfg.imageTimeoutMs);
  try {
    signal.throwIfAborted();
    const refs = await references(ctx, options, signal);
    const gpt = model.startsWith("gpt-image-");
    const path = gpt ? refs.length ? "/v1/images/edits" : "/v1/images/generations" : "/v1/chat/completions";
    const init = gpt ? gptBody(model, prompt, options.size ?? "1024x1024", refs) : geminiBody(model, prompt, refs);
    const body = await api88Json(`${api88Origin(cfg.baseUrl)}${path}`, key, { ...init, signal });
    const result = gpt ? imageValue(body) : { value: parseApi88GeminiImage(body) };
    const image = await readApi88Image(result.value, deadline(signal, cfg.imageDownloadTimeoutMs), cfg.maxImageBytes);
    return { ...image, ...("revisedPrompt" in result ? { revisedPrompt: result.revisedPrompt } : {}), usage: null, webSearchCalls: 0 };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) throw api88Error("API88_IMAGE_TIMEOUT", "88API image request timed out", 504);
    throw error;
  }
}
