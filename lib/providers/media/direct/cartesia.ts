import type { MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../contract.js";
import { assertAllowed, findModel, httpRaw, invalidRequest, MediaHttpError, normalizeMediaError, parkSyncResult, readVendorOptions, redact, takeSyncResult } from "./l3-http.js";

const prefix = "CARTESIA";
const docs = "https://docs.cartesia.ai/api-reference/tts/bytes";
const models: MediaModelSpec[] = ["sonic-3.6", "sonic-3.5", "sonic-3"].map((id) => ({
  id: `cartesia/${id}`, upstreamId: id, label: id, vendor: "cartesia", kind: "audio", tasks: ["text-to-audio"], params: {}, pricing: [], docsUrl: docs,
}));
function base(ctx: MediaAdapterContext): string { return (ctx.baseUrl ?? "https://api.cartesia.ai").replace(/\/$/, ""); }
function headers(ctx: MediaAdapterContext): Record<string, string> { return { Authorization: `Bearer ${ctx.apiKey}`, "Cartesia-Version": "2026-08-14" }; }
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest) {
  if (request.task !== "text-to-audio" || !request.prompt?.trim() || request.inputs.length) throw invalidRequest("Expected text-to-audio and a prompt without inputs");
  if (request.durationSec !== undefined || request.negativePrompt !== undefined || request.resolution !== undefined || request.aspectRatio !== undefined || request.seed !== undefined || request.audio !== undefined || request.count !== undefined) throw invalidRequest("Unsupported request parameter");
  const model = findModel(models, request.model);
  const options = readVendorOptions(request, ["voice_id"]);
  if (typeof options.voice_id !== "string" || !options.voice_id.trim()) throw invalidRequest("voice_id is required");
  assertAllowed("task", request.task, model.tasks);
  const response = await httpRaw(ctx, "Cartesia", `${base(ctx)}/tts/bytes`, { method: "POST", headers: headers(ctx), json: {
    model_id: model.upstreamId, transcript: request.prompt, voice: options.voice_id,
    output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
  } });
  return parkSyncResult(prefix, { status: "succeeded", outputs: [{ kind: "audio", bytes: new Uint8Array(await response.arrayBuffer()), mimeType: "audio/wav" }] });
}
async function safe<T>(ctx: MediaAdapterContext, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof MediaHttpError) {
      throw new MediaHttpError({ message: redact(error.message, [ctx.apiKey]), reason: error.reason, category: error.category, retryable: error.retryable, ...(error.status === undefined ? {} : { status: error.status }) });
    }
    // eslint-disable-next-line preserve-caught-error -- the original error can carry the key; it is rebuilt scrubbed.
    if (error instanceof TypeError) throw new TypeError("Network request failed");
    const sanitized = new Error("Provider request failed");
    if (error instanceof Error) sanitized.name = error.name;
    throw sanitized;
  }
}
export const adapter: MediaProviderAdapter = {
  id: "cartesia", label: "Cartesia", route: "direct", errorPrefix: prefix, inputTransport: "inline",
  credential: { keyVocabulary: "cartesia", envVars: ["CARTESIA_API_KEY"], configKey: "cartesiaApiKey", consoleUrl: "https://play.cartesia.ai/keys", keyPrefix: "sk_car_" },
  listModels: () => models,
  async validateKey(ctx) { return safe(ctx, async () => {
    try { await httpRaw(ctx, "Cartesia", `${base(ctx)}/voices`, { headers: headers(ctx) }); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized key" }; throw error; }
  }); },
  async submit(ctx, request) { return safe(ctx, () => submit(ctx, request)); }, async poll(_ctx, job) { return takeSyncResult(prefix, job); },
  // Messages are scrubbed where they are raised (safe, httpRaw); keep the vendor detail.
  normalizeError: (error) => normalizeMediaError(prefix, error),
};
