import { canonicalRequest, deriveSigningKey, hash, signatureFromSigningKey, SIGNED_HEADERS } from './byteplus-vision/signature.js';
import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from '../contract.js';
import { MediaAdapterError, categoryForStatus, fail, mediaError, normalizeUnknownError, redactSecrets } from './_l2/errors.js';
import type { ErrorCategory } from './_l2/errors.js';
import { asRecord, asString, sendJson } from './_l2/http.js';
import { inputsWithRole, urlOutput } from './_l2/inputs.js';
import { assertKnownOptions, assertParams, assertTask, findModel } from './_l2/validate.js';

const PREFIX = 'BYTEPLUS_VISION_';
const KEY = 'realman_avatar_picture_omni15_cv';
const KEY2 = 'realman_avatar_picture_omni20_cv';
const REGION = 'ap-singapore-1';
const DOCS = 'https://docs.byteplus.com/en/docs/byteplus-vision/omnihuman-video_generation';
const MODELS: readonly MediaModelSpec[] = [{
  id: 'bytedance/omnihuman-1.5', upstreamId: KEY, vendor: 'bytedance', label: 'OmniHuman 1.5',
  kind: 'video', tasks: ['avatar'], params: { resolutions: ['720p', '1080p'], seed: true },
  pricing: [{ unit: 'second', usd: 0.12, source: 'https://docs.byteplus.com/api/docs/byteplus-vision/omnihuman1_5overview', checkedAt: '2026-11-26' }], docsUrl: DOCS,
}, {
  id: 'bytedance/omnihuman-2', upstreamId: KEY2, vendor: 'bytedance', label: 'OmniHuman 2.0',
  kind: 'video', tasks: ['avatar'], params: {}, pricing: [],
  docsUrl: 'https://docs.byteplus.com/en/docs/byteplus-vision/omnihuman-2-0-video-generation',
}];
function sign(ctx: MediaAdapterContext, url: URL, body: string): Record<string, string> {
  const secret = ctx.extra?.secretAccessKey;
  if (!ctx.apiKey || !secret) fail(PREFIX, 'MISSING_CREDENTIAL', 'auth', 'Access key ID and secret access key are required');
  const region = ctx.extra?.region || REGION;
  if (region !== REGION) fail(PREFIX, 'INVALID_REGION', 'invalid-request', 'BytePlus Vision requires ap-singapore-1');
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8), payload = hash(body);
  const query = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = canonicalRequest('POST', url.pathname, query, 'application/json', url.host, payload, date);
  const scope = `${day}/${region}/cv/request`;
  const signature = signatureFromSigningKey(deriveSigningKey(secret, day, region, 'cv'), date, scope, hash(canonical));
  const names = SIGNED_HEADERS;
  return { 'x-date': date, 'x-content-sha256': payload, authorization: `HMAC-SHA256 Credential=${ctx.apiKey}/${scope}, SignedHeaders=${names}, Signature=${signature}` };
}

function vendorCategory(code: number, status: number): ErrorCategory {
  if (code === 50400) return 'auth';
  if (code === 50402) return 'not-found';
  if (code === 50429 || code === 50430) return 'rate-limit';
  if (code === 50510) return 'moderation';
  if (code >= 50500 && code < 50600) return 'upstream';
  if (code >= 50200 && code < 50300) return 'invalid-request';
  return categoryForStatus(status);
}

async function call(ctx: MediaAdapterContext, action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = new URL(ctx.baseUrl || 'https://cv.byteplusapi.com/');
  url.search = `Action=${action}&Version=2024-06-06`;
  const headers = sign(ctx, url, JSON.stringify(body));
  try {
    const res = await sendJson(ctx, PREFIX, { url: url.toString(), headers, body });
    const envelope = asRecord(res.body), metadata = asRecord(envelope.ResponseMetadata);
    if (metadata.Error) fail(PREFIX, 'GATEWAY', categoryForStatus(res.status), 'BytePlus Vision gateway rejected the request', { status: res.status });
    const code = typeof envelope.code === 'number' ? envelope.code : NaN;
    if (!res.ok || code !== 10000) {
      const reason = Number.isFinite(code) ? String(code) : 'BAD_RESPONSE';
      fail(PREFIX, reason, Number.isFinite(code) ? vendorCategory(code, res.status) : categoryForStatus(res.status), `BytePlus Vision request failed (${reason})`, { status: res.status });
    }
    return asRecord(envelope.data);
  } catch (error) {
    if (error instanceof MediaAdapterError) throw error;
    const category = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'upstream';
    fail(PREFIX, 'NETWORK', category, 'BytePlus Vision request failed');
  }
}

function buildBody(request: MediaSubmitRequest): Record<string, unknown> {
  const model = findModel(PREFIX, MODELS, request.model);
  assertTask(PREFIX, model, request); assertParams(PREFIX, model, request);
  const isV2 = model.upstreamId === KEY2;
  const options = assertKnownOptions(PREFIX, request.vendorOptions, isV2 ? ['enable_watermark'] : ['mask_url', 'pe_fast_mode']);
  if (options.enable_watermark !== undefined && typeof options.enable_watermark !== 'boolean') fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'enable_watermark must be a boolean');
  if (isV2 && (request.resolution !== undefined || request.seed !== undefined)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'OmniHuman 2 does not support resolution or seed');
  if (options.mask_url !== undefined && typeof options.mask_url !== 'string') fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'mask_url must be a string');
  if (options.pe_fast_mode !== undefined && typeof options.pe_fast_mode !== 'boolean') fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'pe_fast_mode must be a boolean');
  const image = inputsWithRole(request.inputs, 'source-image'), audio = inputsWithRole(request.inputs, 'source-audio');
  if (image.length !== 1 || audio.length !== 1 || request.inputs.length !== 2 || !image[0]?.url || !audio[0]?.url) fail(PREFIX, 'INPUT_MISSING', 'invalid-request', 'One source-image URL and one source-audio URL are required');
  if (request.durationSec !== undefined || request.aspectRatio !== undefined || request.audio !== undefined || (request.count !== undefined && request.count !== 1)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'Unsupported generation parameter');
  if (request.seed !== undefined && !Number.isSafeInteger(request.seed)) fail(PREFIX, 'INVALID_PARAM', 'invalid-request', 'seed must be an integer');
  return { req_key: model.upstreamId, ...(isV2 ? { image_urls: [image[0].url] } : { image_url: image[0].url }), audio_url: audio[0].url,
    ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
    ...(request.resolution !== undefined ? { output_resolution: parseInt(request.resolution, 10) } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}), ...options };
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const body = buildBody(request);
  const result = await call(ctx, body.req_key === KEY2 ? 'CVSync2AsyncSubmitTask' : 'CVSubmitTask', body);
  const id = asString(result.task_id);
  if (!id) fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'BytePlus Vision omitted the task ID');
  return { providerJobId: id, resume: { req_key: String(body.req_key) } };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const key = job.resume?.req_key ?? KEY;
  if (key !== KEY && key !== KEY2) fail(PREFIX, 'INVALID_JOB', 'invalid-request', 'Unknown task model');
  const result = await call(ctx, key === KEY2 ? 'CVSync2AsyncGetResult' : 'CVGetResult', { req_key: key, task_id: job.providerJobId });
  const status = asString(result.status);
  if (status === 'in_queue') return { status: 'queued' };
  if (status === 'generating') return { status: 'running' };
  if (status === 'canceled') return { status: 'canceled' };
  if (status === 'not_found' || status === 'expired') return { status: 'failed', error: mediaError(PREFIX, status.toUpperCase(), 'not-found', 'BytePlus Vision task not found or expired', { providerState: status }) };
  if (status !== 'done') fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'BytePlus Vision returned an unknown task status');
  let data: unknown = key === KEY2 ? result : result.resp_data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'BytePlus Vision returned invalid result data'); }
  }
  const url = asString(asRecord(data).video_url);
  if (!url) fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'BytePlus Vision omitted the video URL');
  return { status: 'succeeded', outputs: [urlOutput(url, 'video')] };
}

const AUTH_CODES = new Set(['100003', '100004', '100005', '100006', '100009', '100010', '100012', '100013', '100024', '100025', '100026', '50400', 'MissingAuthenticationToken', 'MissingRequestInfo', 'MissingSignature', 'InvalidTimestamp', 'InvalidAccessKey', 'SignatureDoesNotMatch', 'LackPolicy', 'AccessDenied', 'InvalidAuthorization', 'InvalidCredential', 'InvalidSecretToken']);
async function validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }> {
  try {
    const body = { req_key: KEY, task_id: 'ima2-key-check' };
    const url = new URL(ctx.baseUrl || 'https://cv.byteplusapi.com/');
    url.search = 'Action=CVGetResult&Version=2024-06-06';
    const res = await sendJson(ctx, PREFIX, { url: url.toString(), headers: sign(ctx, url, JSON.stringify(body)), body });
    const envelope = asRecord(res.body), gateway = asRecord(asRecord(envelope.ResponseMetadata).Error);
    const codes = [envelope.code, gateway.Code, gateway.CodeN].map(String);
    if (res.status === 401 || res.status === 403 || codes.some(code => AUTH_CODES.has(code))) return { ok: false, reason: 'BytePlus Vision authentication or permission failed' };
    const serviceCode = typeof envelope.code === 'number' ? envelope.code : 0;
    if (res.status >= 500 || res.status === 429 || serviceCode >= 50500 || serviceCode === 50429 || serviceCode === 50430 || (!('code' in envelope) && !gateway.Code && !gateway.CodeN)) return { ok: false, reason: 'BytePlus Vision key verification was inconclusive' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'BytePlus Vision key verification was inconclusive' };
  }
}

async function safeCall<T>(ctx: MediaAdapterContext, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    const detail = normalizeUnknownError(PREFIX, error);
    const secrets = [ctx.apiKey, ctx.extra?.secretAccessKey].filter((s): s is string => Boolean(s));
    throw new MediaAdapterError({ ...detail, message: redactSecrets(detail.message, secrets) });
  }
}

export const adapter: MediaProviderAdapter = {
  id: 'byteplus-vision', label: 'BytePlus Vision', route: 'direct', errorPrefix: PREFIX,
  credential: { keyVocabulary: 'byteplus-vision', envVars: ['BYTEPLUS_ACCESS_KEY_ID'], configKey: 'byteplusVisionApiKey', consoleUrl: 'https://console.byteplus.com/ai', extraFields: [
    { name: 'secretAccessKey', envVar: 'BYTEPLUS_SECRET_ACCESS_KEY', secret: true, required: true },
    { name: 'region', envVar: 'BYTEPLUS_VISION_REGION', secret: false, required: false },
  ] },
  inputTransport: 'url', listModels: () => MODELS,
  validateKey,
  submit: (ctx, request) => safeCall(ctx, () => submit(ctx, request)),
  poll: (ctx, job) => safeCall(ctx, () => poll(ctx, job)), normalizeError: (error) => normalizeUnknownError(PREFIX, error),
};
