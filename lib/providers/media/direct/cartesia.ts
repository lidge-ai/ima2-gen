import type { MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest, MediaVoice } from "../contract.js";
import { assertAllowed, findModel, httpJson, httpRaw, invalidRequest, MediaHttpError, normalizeMediaError, parkSyncResult, readVendorOptions, redact, takeSyncResult } from "./l3-http.js";

const prefix = "CARTESIA";
const docs = "https://docs.cartesia.ai/api-reference/tts/bytes";
const models: MediaModelSpec[] = ["sonic-3.6", "sonic-3.5", "sonic-3"].map((id) => ({
  id: `cartesia/${id}`, upstreamId: id, label: id, vendor: "cartesia", kind: "audio", tasks: ["text-to-audio"], params: { options: [{ name: "voice_id", type: "voice", required: true }] }, pricing: [], docsUrl: docs,
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
/** https://docs.cartesia.ai/api-reference/voices/list (read 2026-11-27): GET /voices, 100 per page, cursor in next_page. */
const VOICE_PAGES = 5;
const GENDERS: Readonly<Record<string, MediaVoice["gender"]>> = { feminine: "female", masculine: "male", gender_neutral: "neutral" };
type CartesiaVoice = { id?: unknown; name?: unknown; tagline?: unknown; description?: unknown; language?: unknown; gender?: unknown; is_owner?: unknown };
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
function toVoice(raw: CartesiaVoice): MediaVoice | undefined {
  const id = text(raw.id);
  if (!id) return undefined;
  const description = text(raw.tagline) ?? text(raw.description), language = text(raw.language);
  const gender = GENDERS[text(raw.gender) ?? ""];
  // preview_file_url needs the API key, so it is not passed on: a browser could not play it.
  return { id, name: text(raw.name) ?? id, ...(description ? { description } : {}), ...(language ? { language } : {}), ...(gender ? { gender } : {}), ...(raw.is_owner === true ? { owned: true } : {}) };
}
async function listVoices(ctx: MediaAdapterContext): Promise<MediaVoice[]> {
  const voices: MediaVoice[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < VOICE_PAGES; page += 1) {
    const url = base(ctx) + "/voices?limit=100" + (cursor ? "&starting_after=" + encodeURIComponent(cursor) : "");
    const body = await httpJson<{ data?: CartesiaVoice[]; has_more?: boolean; next_page?: string | null }>(ctx, "Cartesia voices", url, { headers: headers(ctx) });
    for (const raw of body.data ?? []) { const voice = toVoice(raw); if (voice) voices.push(voice); }
    cursor = body.has_more ? text(body.next_page) : undefined;
    if (!cursor) break;
  }
  return voices;
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
  async listVoices(ctx) { return safe(ctx, () => listVoices(ctx)); },
  async submit(ctx, request) { return safe(ctx, () => submit(ctx, request)); }, async poll(_ctx, job) { return takeSyncResult(prefix, job); },
  // Messages are scrubbed where they are raised (safe, httpRaw); keep the vendor detail.
  normalizeError: (error) => normalizeMediaError(prefix, error),
};
