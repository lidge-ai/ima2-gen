import type { MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest, MediaVoice } from "../contract.js";
import { assertAllowed, findModel, httpJson, httpRaw, invalidRequest, MediaHttpError, normalizeMediaError, parkSyncResult, readVendorOptions, redact, takeSyncResult } from "./l3-http.js";

const prefix = "ELEVENLABS";
const docs = "https://elevenlabs.io/docs/overview/models";
const priceUrl = "https://elevenlabs.io/pricing/api";
const rows = [
  ["eleven-v4", "eleven_v4", 0.08], ["eleven-v4-turbo", "eleven_v4_turbo", 0.04],
  ["eleven-v3", "eleven_v3", 0.08], ["eleven-multilingual-v2", "eleven_multilingual_v2", 0.08],
  ["eleven-turbo-v2.5", "eleven_turbo_v2_5", 0.04],
] as const;
const models: MediaModelSpec[] = rows.map(([slug, upstreamId, price]) => ({
  id: `elevenlabs/${slug}`, upstreamId, vendor: "elevenlabs", label: slug, kind: "audio", tasks: ["text-to-audio"], params: { options: [{ name: "voice_id", type: "voice", required: true }] },
  pricing: [{ unit: "character", usd: price / 1000, variant: `$${price} per 1K characters`, source: priceUrl, checkedAt: "2026-11-26" }], docsUrl: docs,
}));
models.push({ id: "elevenlabs/elevenlabs-music-2.5", upstreamId: "music_v2_5", vendor: "elevenlabs", label: "Eleven Music 2.5", kind: "audio", tasks: ["text-to-audio"], params: {}, pricing: [{ unit: "minute", usd: 0.15, source: priceUrl, checkedAt: "2026-11-26" }], docsUrl: "https://elevenlabs.io/docs/api-reference/music/compose" });
models.push({ id: "elevenlabs/eleven-text-to-sound-v3", upstreamId: "eleven_text_to_sound_v3", vendor: "elevenlabs", label: "Eleven Sound Effects v3", kind: "audio", tasks: ["text-to-audio"], params: {}, pricing: [{ unit: "minute", usd: 0.12, source: priceUrl, checkedAt: "2026-11-26" }], docsUrl: "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert" });
const formats = ["mp3_44100_128", "mp3_44100_192", "mp3_22050_32", "wav_24000"] as const;
function headers(ctx: MediaAdapterContext): Record<string, string> { return { "xi-api-key": ctx.apiKey }; }
function base(ctx: MediaAdapterContext): string { return (ctx.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, ""); }
function check(request: MediaSubmitRequest): void {
  if (request.task !== "text-to-audio" || request.inputs.length || !request.prompt?.trim()) throw invalidRequest("Expected text-to-audio and a prompt without inputs");
  if (request.negativePrompt !== undefined || request.resolution !== undefined || request.aspectRatio !== undefined || request.seed !== undefined || request.audio !== undefined || request.count !== undefined) throw invalidRequest("Unsupported request parameter");
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest) {
  check(request);
  const model = findModel(models, request.model);
  const music = model.upstreamId === "music_v2_5";
  const sound = model.upstreamId === "eleven_text_to_sound_v3";
  const options = readVendorOptions(request, music ? ["output_format", "force_instrumental"] : sound ? ["output_format", "loop"] : ["voice_id", "output_format"]);
  const format = options.output_format ?? "mp3_44100_128";
  if (typeof format !== "string") throw invalidRequest("Invalid output_format");
  assertAllowed("output_format", format, formats);
  let path: string;
  const body: Record<string, unknown> = { model_id: model.upstreamId };
  if (music) {
    if (request.prompt!.length > 4100) throw invalidRequest("Music prompt exceeds 4100 characters");
    if (request.durationSec !== undefined && (!Number.isInteger(request.durationSec * 1000) || request.durationSec < 3 || request.durationSec > 600)) throw invalidRequest("Invalid music duration");
    if (options.force_instrumental !== undefined && typeof options.force_instrumental !== "boolean") throw invalidRequest("Invalid force_instrumental");
    Object.assign(body, { prompt: request.prompt }, request.durationSec === undefined ? {} : { music_length_ms: request.durationSec * 1000 }, options.force_instrumental === undefined ? {} : { force_instrumental: options.force_instrumental });
    path = "/v1/music";
  } else if (sound) {
    if (request.durationSec !== undefined && (request.durationSec < 0.5 || request.durationSec > 30 || !Number.isFinite(request.durationSec))) throw invalidRequest("Invalid sound duration");
    if (options.loop !== undefined && typeof options.loop !== "boolean") throw invalidRequest("Invalid loop");
    Object.assign(body, { text: request.prompt }, request.durationSec === undefined ? {} : { duration_seconds: request.durationSec }, options.loop === undefined ? {} : { loop: options.loop });
    path = "/v1/sound-generation";
  } else {
    if (request.durationSec !== undefined || typeof options.voice_id !== "string" || !options.voice_id.trim()) throw invalidRequest("TTS requires voice_id and does not accept duration");
    const limit = model.upstreamId === "eleven_v3" ? 5000 : model.upstreamId === "eleven_turbo_v2_5" ? 40000 : model.upstreamId === "eleven_v4_turbo" ? undefined : 10000;
    if (limit !== undefined && request.prompt!.length > limit) throw invalidRequest("Text exceeds model character limit");
    Object.assign(body, { text: request.prompt });
    path = `/v1/text-to-speech/${encodeURIComponent(options.voice_id)}`;
  }
  const res = await httpRaw(ctx, "ElevenLabs", `${base(ctx)}${path}?output_format=${format}`, { method: "POST", headers: headers(ctx), json: body });
  const mimeType = format.startsWith("mp3") ? "audio/mpeg" : format.startsWith("wav") ? "audio/wav" : "audio/L16";
  return parkSyncResult(prefix, { status: "succeeded", outputs: [{ kind: "audio", bytes: new Uint8Array(await res.arrayBuffer()), mimeType }] });
}
/** https://elevenlabs.io/docs/api-reference/voices/search (read 2026-11-27): GET /v2/voices, 100 per page. */
const VOICE_PAGES = 5;
type ElevenVoice = { voice_id?: unknown; name?: unknown; category?: unknown; description?: unknown; preview_url?: unknown; labels?: Record<string, unknown> | null };
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
function toVoice(raw: ElevenVoice): MediaVoice | undefined {
  const id = text(raw.voice_id);
  if (!id) return undefined;
  const gender = text(raw.labels?.gender)?.toLowerCase();
  const description = text(raw.description), language = text(raw.labels?.language), previewUrl = text(raw.preview_url);
  return {
    id, name: text(raw.name) ?? id,
    ...(description ? { description } : {}), ...(language ? { language } : {}),
    ...(gender === "female" || gender === "male" || gender === "neutral" ? { gender } : {}),
    ...(previewUrl?.startsWith("https://") ? { previewUrl } : {}),
    ...(raw.category === "cloned" || raw.category === "generated" || raw.category === "professional" ? { owned: true } : {}),
  };
}
async function listVoices(ctx: MediaAdapterContext): Promise<MediaVoice[]> {
  const voices: MediaVoice[] = [];
  let token: string | undefined;
  for (let page = 0; page < VOICE_PAGES; page += 1) {
    const url = base(ctx) + "/v2/voices?page_size=100&include_total_count=false" + (token ? "&next_page_token=" + encodeURIComponent(token) : "");
    const body = await httpJson<{ voices?: ElevenVoice[]; has_more?: boolean; next_page_token?: string | null }>(ctx, "ElevenLabs voices", url, { headers: headers(ctx) });
    for (const raw of body.voices ?? []) { const voice = toVoice(raw); if (voice) voices.push(voice); }
    token = body.has_more ? text(body.next_page_token) : undefined;
    if (!token) break;
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
  id: "elevenlabs", label: "ElevenLabs", route: "direct", errorPrefix: prefix, inputTransport: "inline",
  credential: { keyVocabulary: "elevenlabs", envVars: ["ELEVENLABS_API_KEY"], configKey: "elevenlabsApiKey", consoleUrl: "https://elevenlabs.io/app/settings/api-keys" },
  listModels: () => models,
  async validateKey(ctx) { return safe(ctx, async () => {
    try { await httpRaw(ctx, "ElevenLabs", `${base(ctx)}/v1/user`, { headers: headers(ctx) }); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "Invalid or unauthorized key" }; throw error; }
  }); },
  async listVoices(ctx) { return safe(ctx, () => listVoices(ctx)); },
  async submit(ctx, request) { return safe(ctx, () => submit(ctx, request)); }, async poll(_ctx, job) { return takeSyncResult(prefix, job); },
  // Messages are scrubbed where they are raised (safe, httpRaw); keep the vendor detail.
  normalizeError: (error) => normalizeMediaError(prefix, error),
};
