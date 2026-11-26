import { randomUUID } from 'node:crypto';
import type { MediaAdapterContext, MediaInput, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from '../contract.js';
import { MediaAdapterError, categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets } from './_l2/errors.js';
import { asRecord, asString, joinUrl, sendJson } from './_l2/http.js';
import { urlOutput } from './_l2/inputs.js';
import { assertKnownOptions, assertParams, assertTask, findModel } from './_l2/validate.js';

const PREFIX = 'PIXVERSE_';
const BASE = 'https://app-api.pixverse.ai';
const DOCS = 'https://docs.platform.pixverse.ai/text-to-video-13016634e0';
const PRICE = 'https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0';
const resolutions = ['360p', '540p', '720p', '1080p'];
const ratios = ['16:9', '9:16', '4:3', '3:4', '1:1', '2:3', '3:2', '21:9'];
const durations = Array.from({ length: 15 }, (_, i) => i + 1);
function model(id: 'v6' | 'c1', rates: readonly number[]): MediaModelSpec {
  return { id: `pixverse/pixverse-${id}`, upstreamId: id, vendor: 'pixverse', label: `PixVerse ${id.toUpperCase()}`,
    kind: 'video', tasks: ['text-to-video', 'image-to-video'],
    params: { durationsSec: durations, resolutions, aspectRatios: ratios, nativeAudio: true, seed: true },
    pricing: rates.map((credits, i) => ({ unit: 'second', usd: credits / 225, variant: `${resolutions[i % 4]} audio ${i < 4 ? 'off' : 'on'}; ${credits} credits/s, 225 credits/USD`, source: PRICE, checkedAt: '2026-11-26' })), docsUrl: DOCS };
}
const models = [model('v6', [5, 7, 9, 18, 7, 9, 12, 23]), model('c1', [6, 8, 10, 19, 8, 10, 13, 24])];
function headers(ctx: MediaAdapterContext): Record<string, string> { return { 'API-KEY': ctx.apiKey, 'Ai-trace-id': randomUUID() }; }
function category(code: string, status: number) {
  if (['10001', '10002', '10003', '10004', '10005', '400009', '500020'].includes(code)) return 'auth' as const;
  if (code === '500090') return 'quota' as const;
  if (code === '500044' || code === '712008') return 'rate-limit' as const;
  if (code === '500008') return 'not-found' as const;
  if (['500010', '500069', '500100'].includes(code)) return 'upstream' as const;
  if (['500052', '500054', '500063'].includes(code)) return 'moderation' as const;
  if (code.startsWith('400')) return 'invalid-request' as const;
  return categoryForStatus(status);
}
function readResponse(ctx: MediaAdapterContext, status: number, ok: boolean, value: unknown): Record<string, unknown> {
  const body = asRecord(value); const code = asString(body.ErrCode);
  if (!ok || (code !== undefined && code !== '0')) {
    const reason = code && code !== '0' ? `VENDOR_${code.replace(/\W/g, '_')}` : `HTTP_${status}`;
    const message = asString(body.ErrMsg) ?? asString(body.message) ?? `PixVerse request failed (HTTP ${status})`;
    fail(PREFIX, reason, category(code ?? '', status), redactSecrets(message, contextSecrets(ctx)), { status });
  }
  if (code !== '0') fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse response is missing ErrCode');
  return asRecord(body.Resp);
}
async function json(ctx: MediaAdapterContext, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response;
  try { response = await sendJson(ctx, PREFIX, { url: joinUrl(ctx.baseUrl ?? BASE, path), headers: headers(ctx), ...(body === undefined ? {} : { body }) }); }
  catch { return fail(PREFIX, 'NETWORK', 'upstream', 'PixVerse request failed'); }
  return readResponse(ctx, response.status, response.ok, response.body);
}
async function upload(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }> {
  const image = input.mimeType.startsWith('image/');
  if (!image) fail(PREFIX, 'INPUT_TYPE', 'invalid-request', 'Only images are supported by this adapter');
  if (Boolean(input.url) === Boolean(input.bytes)) fail(PREFIX, 'INPUT_MISSING', 'invalid-request', 'Provide one image URL or file');
  const form = new FormData();
  if (input.bytes) form.set('image', new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }), 'image');
  else form.set('image_url', input.url!);
  let res: Response;
  try { res = await ctx.fetch(joinUrl(ctx.baseUrl ?? BASE, '/openapi/v2/image/upload'), { method: 'POST', headers: headers(ctx), body: form, ...(ctx.signal ? { signal: ctx.signal } : {}) }); }
  catch { return fail(PREFIX, 'NETWORK', 'upstream', 'PixVerse upload failed'); }
  let value: unknown;
  try { value = await res.json(); } catch { return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse upload returned invalid JSON', { status: res.status }); }
  const id = asString(readResponse(ctx, res.status, res.ok, value).img_id);
  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse upload returned an invalid image ID');
  // Runner passes uploaded IDs in MediaInput.url; this is an opaque adapter-local reference, not a downloadable URL.
  return { url: `pixverse:image:${id}` };
}
function validate(request: MediaSubmitRequest, spec: MediaModelSpec): void {
  assertTask(PREFIX, spec, request); assertKnownOptions(PREFIX, request.vendorOptions, []); assertParams(PREFIX, spec, request);
  if (!request.prompt || request.prompt.length > 2048 || request.durationSec === undefined || !request.resolution) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Prompt, duration and resolution are required');
  if (request.count !== undefined && request.count !== 1) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Only one output is supported');
  if (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 2147483647)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Invalid seed');
  if (request.task === 'text-to-video' && (!request.aspectRatio || request.inputs.length)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Text generation requires aspect ratio and no inputs');
  if (request.task === 'image-to-video' && (request.aspectRatio || request.inputs.length !== 1 || !['first-frame', 'source-image'].includes(request.inputs[0]!.role))) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Image generation requires one image and no aspect ratio');
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest) {
  const spec = findModel(PREFIX, models, request.model); validate(request, spec);
  const body: Record<string, unknown> = { model: spec.upstreamId, prompt: request.prompt, duration: request.durationSec, quality: request.resolution };
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.audio !== undefined) body.generate_audio_switch = request.audio;
  if (request.task === 'text-to-video') body.aspect_ratio = request.aspectRatio;
  else {
    const input = request.inputs[0]!;
    const ref = input.url?.startsWith('pixverse:image:') ? input.url : (await upload(ctx, input)).url;
    const id = ref.slice('pixverse:image:'.length);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Invalid image ID');
    body.img_id = Number(id);
  }
  const result = await json(ctx, `/openapi/v2/video/${request.task === 'text-to-video' ? 'text' : 'img'}/generate`, body);
  const id = asString(result.video_id);
  if (!id || !/^[1-9]\d*$/.test(id)) fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse response has no valid video ID');
  return { providerJobId: id, pollAfterMs: 3000 };
}
async function poll(ctx: MediaAdapterContext, job: { providerJobId: string }) {
  if (!/^[1-9]\d*$/.test(job.providerJobId)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Invalid video ID');
  const result = await json(ctx, `/openapi/v2/video/result/${job.providerJobId}`);
  if (result.status === 5) return { status: 'running' as const, pollAfterMs: 3000 };
  if (result.status === 1) {
    const url = asString(result.url);
    if (!url || !/^https?:\/\//i.test(url)) fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse result has no valid URL');
    return { status: 'succeeded' as const, outputs: [urlOutput(url, 'video')] };
  }
  if (result.status === 7 || result.status === 8) return { status: 'failed' as const, error: mediaError(PREFIX, `STATUS_${result.status}`, result.status === 7 ? 'moderation' : 'upstream', 'PixVerse generation failed', { providerState: String(result.status), retryable: false }) };
  return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'PixVerse returned an unknown task status');
}
async function protect<T>(ctx: MediaAdapterContext, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof MediaAdapterError) throw new MediaAdapterError({ ...error.detail, message: redactSecrets(error.detail.message, contextSecrets(ctx)) });
    throw error;
  }
}
export const adapter: MediaProviderAdapter = {
  id: 'pixverse', label: 'PixVerse', route: 'direct', errorPrefix: PREFIX,
  credential: { keyVocabulary: 'pixverse', envVars: ['PIXVERSE_API_KEY'], configKey: 'pixverseApiKey', consoleUrl: 'https://platform.pixverse.ai/' },
  inputTransport: 'upload', listModels: () => models,
  uploadInput: (ctx, input) => protect(ctx, () => upload(ctx, input)),
  submit: (ctx, request) => protect(ctx, () => submit(ctx, request)),
  poll: (ctx, job) => protect(ctx, () => poll(ctx, job)),
  async validateKey(ctx) { try { await json(ctx, '/openapi/v2/account/balance'); return { ok: true }; } catch (error) { return { ok: false, reason: normalizeUnknownError(PREFIX, error).message }; } },
  normalizeError(error) { return normalizeUnknownError(PREFIX, error instanceof MediaAdapterError ? error : new Error('PixVerse request failed')); },
};
