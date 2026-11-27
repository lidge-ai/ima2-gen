import type {
  MediaAdapterContext, MediaJobRef, MediaModelSpec, MediaProviderAdapter, MediaProviderError, MediaSubmitRequest,
} from '../contract.js';
import {
  MediaAdapterError, categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets,
} from './_l2/errors.js';
import { asRecord, asString, joinUrl, sendJson } from './_l2/http.js';
import { urlOrDataUri, urlOutput } from './_l2/inputs.js';
import { assertKnownOptions, assertParams, assertTask, findModel } from './_l2/validate.js';

// Error codes read MINIMAX_<REASON>; the media event names the adapter, so the image lane's codes stay distinct.
const PREFIX = 'MINIMAX';
const PRICING = 'https://platform.minimax.io/docs/pricing/overview';
const V1DOC = 'https://platform.minimax.io/docs/api-reference/video-generation-i2v';
const V2DOC = 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create';
const REGEN = 'https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration';
const ratios = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const price = (usd: number, unit: 'request' | 'second', variant: string) => ({
  usd, unit, variant, source: PRICING, checkedAt: '2026-11-26',
});
const models: MediaModelSpec[] = [
  {
    id: 'minimax/hailuo-2.3',
    upstreamId: 'MiniMax-Hailuo-2.3',
    vendor: 'minimax',
    label: 'Hailuo 2.3',
    kind: 'video',
    tasks: ['text-to-video', 'image-to-video'],
    params: { durationsSec: [6, 10], resolutions: ['768P', '1080P'] },
    pricing: [
      price(.28, 'request', '768P 6s'),
      price(.56, 'request', '768P 10s'),
      price(.49, 'request', '1080P 6s'),
    ],
    docsUrl: V1DOC,
  },
  {
    id: 'minimax/hailuo-2.3-fast',
    upstreamId: 'MiniMax-Hailuo-2.3-Fast',
    vendor: 'minimax',
    label: 'Hailuo 2.3 Fast',
    kind: 'video',
    tasks: ['image-to-video'],
    params: { durationsSec: [6, 10], resolutions: ['768P', '1080P'] },
    pricing: [
      price(.19, 'request', '768P 6s'),
      price(.32, 'request', '768P 10s'),
      price(.33, 'request', '1080P 6s'),
    ],
    docsUrl: V1DOC,
  },
  {
    id: 'minimax/minimax-h3',
    upstreamId: 'MiniMax-H3',
    vendor: 'minimax',
    label: 'MiniMax H3',
    kind: 'video',
    tasks: ['text-to-video', 'image-to-video', 'reference-to-video'],
    params: {
      durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['480P', '768P', '2K'],
      aspectRatios: ratios,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      nativeAudio: true,
    },
    pricing: [
      price(.13, 'second', '2K output'),
      price(.08, 'second', '768P output'),
      price(.038, 'second', '480P output; RunningHub'),
    ],
    docsUrl: V2DOC,
  },
  {
    id: 'minimax/minimax-h3-max',
    upstreamId: 'MiniMax-H3-Max',
    vendor: 'minimax',
    label: 'MiniMax H3 Max',
    kind: 'video',
    tasks: ['text-to-video', 'image-to-video', 'reference-to-video'],
    params: {
      durationsSec: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['480P', '768P'],
      aspectRatios: ratios,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      nativeAudio: true,
    },
    pricing: [
      price(.08, 'second', '768P output; fal'),
      price(.05, 'second', '480P output; fal'),
    ],
    docsUrl: V2DOC,
  },
  {
    id: 'minimax/hailuo-h3-regen',
    upstreamId: 'MiniMax-H3',
    vendor: 'minimax',
    label: 'H3 Regeneration',
    kind: 'video',
    tasks: ['video-upscale'],
    params: { resolutions: ['2K'], nativeAudio: true,
      inputs: [{ role: 'source-video', min: 1, max: 1, tasks: ['video-upscale'], billedLength: true }],
      taskFields: { 'video-upscale': { accepts: ['prompt', 'resolution', 'audio'] } } },
    pricing: [price(.05, 'second', '768P to 2K output; input billed separately')],
    docsUrl: REGEN,
  },
];

// The base follows config.ts and lib/minimaxImageAdapter.ts; ctx.baseUrl also accepts a /v1 proxy base.
function base(ctx: MediaAdapterContext): string {
  return (ctx.baseUrl ?? (ctx.extra?.region === 'cn_zh'
    ? 'https://api.minimaxi.com/v1' : 'https://api.minimax.io/v1'))
    .replace(/\/+$/, '').replace(/\/v1$/, '');
}
function classify(code: string): MediaProviderError['category'] {
  if (['1004','2049'].includes(code)) return 'auth';
  if (['1008','2053','2067'].includes(code)) return 'quota';
  if (['1002','1039','1041','1045','2045','2046','2047','2062'].includes(code)) return 'rate-limit';
  if (['1026','1027','1040','1046'].includes(code)) return 'moderation';
  if (['1001','2066'].includes(code)) return 'timeout';
  if (['1000','1013','1024','1033','2064'].includes(code)) return 'upstream';
  return 'invalid-request';
}
function providerError(ctx: MediaAdapterContext, code: string, message: string): MediaProviderError {
  const safeCode = /^\d+$/.test(code) ? code : 'UNKNOWN';
  return mediaError(
    PREFIX, `VENDOR_${safeCode}`, safeCode === 'UNKNOWN' ? 'upstream' : classify(code),
    redactSecrets(message, contextSecrets(ctx)),
  );
}
async function call(ctx: MediaAdapterContext, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await sendJson(ctx, PREFIX, {
      url: joinUrl(base(ctx), path),
      headers: { authorization: `Bearer ${ctx.apiKey}` },
      ...(body === undefined ? {} : { body }),
    });
  } catch (e) {
    if (e instanceof MediaAdapterError) throw e;
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw e;
    const message = e instanceof Error ? e.message : String(e);
    fail(PREFIX, 'NETWORK', 'upstream', redactSecrets(message, contextSecrets(ctx)));
  }
  const data = asRecord(response.body);
  if (!response.ok) {
    const message = asString(asRecord(data.error).message) ?? asString(data.message) ?? `HTTP ${response.status}`;
    fail(
      PREFIX, `HTTP_${response.status}`, categoryForStatus(response.status),
      redactSecrets(message, contextSecrets(ctx)), { status: response.status },
    );
  }
  const vendor = asRecord(data.base_resp);
  const code = asString(vendor.status_code);
  if (code && code !== '0') {
    const detail = providerError(ctx, code, asString(vendor.status_msg) ?? 'Provider error');
    fail(PREFIX, detail.code.slice(PREFIX.length + 1), detail.category, detail.message);
  }
  const error = asRecord(data.error);
  if (Object.keys(error).length) {
    const detail = providerError(ctx, asString(error.code) ?? '', asString(error.message) ?? 'Provider error');
    fail(PREFIX, detail.code.slice(PREFIX.length + 1), detail.category, detail.message);
  }
  return data;
}
function invalid(message: string): never { return fail(PREFIX, 'INVALID_PARAM', 'invalid-request', message); }
function validate(request: MediaSubmitRequest, model: MediaModelSpec, version: string): void {
  assertTask(PREFIX, model, request);
  assertParams(PREFIX, model, request);
  assertKnownOptions(PREFIX, request.vendorOptions, []);
  if (request.count !== undefined && request.count !== 1) invalid('count must be 1');
  if (request.audio !== undefined && !model.params.nativeAudio) invalid('audio is unsupported');
  if (version === 'v1' && request.aspectRatio !== undefined) invalid('aspect ratio is unsupported');
  if (request.durationSec === 10 && request.resolution === '1080P' && version === 'v1')
    invalid('1080P supports only 6 seconds');
  if (version === 'v2' && model.docsUrl !== REGEN &&
      (!request.durationSec || !request.resolution || !request.prompt))
    invalid('H3 requires prompt, duration and resolution');
  if (version === 'v2' && request.task === 'text-to-video' &&
      (!request.aspectRatio || request.aspectRatio === 'adaptive'))
    invalid('H3 text-to-video requires an explicit ratio');
  if (version === 'v2' && request.task === 'image-to-video' &&
      request.aspectRatio && request.aspectRatio !== 'adaptive')
    invalid('image-to-video ratio must be adaptive');
  if (model.docsUrl === REGEN && (request.durationSec !== undefined || request.aspectRatio !== undefined))
    invalid('regeneration does not accept duration or ratio');
}
function checkInputs(request: MediaSubmitRequest, version: string): void {
  const roles = request.inputs.map(i => i.role);
  const count = (role: string) => roles.filter(r => r === role).length;
  const allowed = request.task === 'image-to-video'
    ? (version === 'v1' ? ['first-frame'] : ['first-frame', 'last-frame'])
    : request.task === 'reference-to-video'
      ? ['reference-image', 'reference-video', 'reference-audio']
      : request.task === 'video-upscale'
        ? ['source-video', 'reference-image', 'reference-video', 'reference-audio', 'first-frame', 'last-frame']
        : [];
  if (roles.some(role => !allowed.includes(role))) invalid('unsupported input role');
  if (request.task === 'image-to-video' &&
      (count('first-frame') > 1 || count('last-frame') > 1 || roles.length === 0 ||
       (version === 'v1' && count('first-frame') !== 1))) invalid('invalid frame inputs');
  if (request.task === 'reference-to-video' && !roles.length) invalid('reference input required');
  if (request.task === 'video-upscale' && count('source-video') !== 1) invalid('one source video is required');
  if (count('reference-image') > 9 || count('reference-video') > 3 || count('reference-audio') > 3)
    invalid('too many reference inputs');
}
function content(request: MediaSubmitRequest): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  if (request.prompt) items.push({ type: 'text', text: request.prompt });
  for (const input of request.inputs) {
    const type = input.role.includes('video') ? 'video_url' : input.role.includes('audio') ? 'audio_url' : 'image_url';
    const role = input.role === 'source-video' ? 'base_video' : input.role.replace(/-/g, '_');
    items.push({ type, [type]: { url: urlOrDataUri(PREFIX, input) }, role });
  }
  return items;
}
async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const model = findModel(PREFIX, models, request.model);
  const version = model.id.includes('hailuo-2.3') ? 'v1' : 'v2';
  validate(request, model, version);
  checkInputs(request, version);
  let body: Record<string, unknown>;
  if (version === 'v1') {
    body = {
      model: model.upstreamId,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.durationSec === undefined ? {} : { duration: request.durationSec }),
      ...(request.resolution ? { resolution: request.resolution } : {}),
    };
    if (request.inputs[0]) body.first_frame_image = urlOrDataUri(PREFIX, request.inputs[0]);
    if (request.task === 'text-to-video' && !request.prompt) invalid('prompt required');
  } else {
    body = {
      model: model.upstreamId,
      content: content(request),
      resolution: model.docsUrl === REGEN ? '2K' : request.resolution,
      ...(request.durationSec === undefined ? {} : { duration: request.durationSec }),
      ...(request.aspectRatio ? { ratio: request.aspectRatio } : {}),
      ...(request.audio === undefined ? {} : { generate_audio: request.audio }),
    };
  }
  const path = model.docsUrl === REGEN ? '/v2/video_regeneration' : `/${version}/video_generation`;
  const result = await call(ctx, path, body);
  const id = asString(result.task_id) ?? asString(asRecord(result.task).id);
  if (!id) return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'Provider omitted task id');
  return { providerJobId: id, resume: { version } };
}
async function poll(ctx: MediaAdapterContext, job: MediaJobRef) {
  const version = job.resume?.version;
  if (version !== 'v1' && version !== 'v2')
    return fail(PREFIX, 'INVALID_JOB', 'invalid-request', 'Missing job version');
  const id = encodeURIComponent(job.providerJobId);
  const data = await call(ctx, version === 'v1'
    ? `/v1/query/video_generation?task_id=${id}` : `/v2/query/video_generation/${id}`);
  const task = version === 'v1' ? data : asRecord(data.task);
  const state = asString(task.status)?.toLowerCase();
  if (state === 'preparing' || state === 'queueing' || state === 'queued') return { status: 'queued' as const };
  if (state === 'processing' || state === 'running') return { status: 'running' as const };
  if (state === 'cancelled' || state === 'canceled') return { status: 'canceled' as const };
  if (state === 'fail' || state === 'failed') {
    const error = asRecord(task.error);
    return {
      status: 'failed' as const,
      error: providerError(ctx, asString(error.code) ?? '', asString(error.message) ?? 'Video generation failed'),
    };
  }
  if (state !== 'success' && state !== 'succeeded')
    return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'Unknown provider job state');
  let url = asString(asRecord(task.content).url);
  if (version === 'v1') {
    const fileId = asString(task.file_id);
    if (!fileId) return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'Provider omitted file id');
    const file = await call(ctx, `/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
    url = asString(asRecord(file.file).download_url);
  }
  if (!url) return fail(PREFIX, 'BAD_RESPONSE', 'upstream', 'Provider omitted output URL');
  return { status: 'succeeded' as const, outputs: [urlOutput(url, 'video')] };
}
export const adapter: MediaProviderAdapter = {
  id: 'minimax',
  label: 'MiniMax Video',
  route: 'direct',
  errorPrefix: PREFIX,
  inputTransport: 'inline',
  credential: {
    keyVocabulary: 'minimax',
    envVars: ['MINIMAX_API_KEY'],
    configKey: 'minimaxApiKey',
    consoleUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    extraFields: [{ name: 'region', envVar: 'IMA2_MINIMAX_REGION', secret: false, required: false }],
  },
  listModels: () => models,
  async validateKey(ctx) {
    try {
      await call(ctx, '/v1/files/list');
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: normalizeUnknownError(PREFIX, error).message };
    }
  },
  async submit(ctx, request) {
    try {
      return await submit(ctx, request);
    } catch (error) {
      if (error instanceof MediaAdapterError) throw new MediaAdapterError({
        ...error.detail, message: redactSecrets(error.detail.message, contextSecrets(ctx)),
      });
      throw error;
    }
  },
  poll,
  normalizeError(error) {
    const detail = normalizeUnknownError(PREFIX, error);
    return error instanceof MediaAdapterError ? detail : { ...detail, message: 'Provider request failed' };
  },
};
