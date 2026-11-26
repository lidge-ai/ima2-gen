import type { MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from '../contract.js';
import { assertAllowed, findModel, httpJson, inputsByRole, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, redact, requireInput, requireUrl } from './l3-http.js';

const docs = 'https://developers.heygen.com/docs/models/heygen-video';
const avatarDocs = 'https://developers.heygen.com/docs/models/avatar-6';
const models: readonly MediaModelSpec[] = [
  { id: 'heygen/heygen-video-1', upstreamId: 'heygen-video-1', vendor: 'heygen', label: 'HeyGen Video 1', kind: 'video', tasks: ['text-to-video', 'image-to-video', 'reference-to-video'], params: { durationsSec: Array.from({ length: 26 }, (_, i) => i + 5), resolutions: ['480p', '768p', '1080p', '2k'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], maxReferenceImages: 9, maxReferenceVideos: 3, seed: true, nativeAudio: true }, pricing: [], docsUrl: docs },
  ...['heygen-avatar-6', 'heygen-avatar-6-turbo'].map((id): MediaModelSpec => ({ id: 'heygen/' + id, upstreamId: id, vendor: 'heygen', label: id === 'heygen-avatar-6' ? 'HeyGen Avatar 6' : 'HeyGen Avatar 6 Turbo', kind: 'video', tasks: ['avatar'], params: { resolutions: ['1080p', '2k'], aspectRatios: ['16:9', '9:16', '1:1', '4:5', '5:4', 'auto'], maxReferenceImages: 1, maxReferenceVideos: 1 }, pricing: [], docsUrl: avatarDocs })),
];
type ResponseData = { data?: { video_id?: string; status?: string; video_url?: string; failure_code?: string; failure_message?: string } };
const base = (ctx: MediaAdapterContext) => (ctx.baseUrl ?? 'https://api.heygen.com').replace(/\/$/, '');
const headers = (ctx: MediaAdapterContext) => ({ 'x-api-key': ctx.apiKey });
const asset = (item: MediaInput) => ({ type: 'url', url: requireUrl(item) });

function validate(request: MediaSubmitRequest, spec: MediaModelSpec): void {
  if (!spec.tasks.includes(request.task)) throw invalidRequest('Unsupported task');
  assertAllowed('durationSec', request.durationSec, spec.params.durationsSec);
  assertAllowed('resolution', request.resolution, spec.params.resolutions);
  assertAllowed('aspectRatio', request.aspectRatio, spec.params.aspectRatios);
  if (request.negativePrompt !== undefined || request.count !== undefined || request.audio !== undefined) throw invalidRequest('Unsupported parameter');
  if (request.seed !== undefined && (!spec.params.seed || !Number.isInteger(request.seed) || request.seed < 0 || request.seed > 4294967295)) throw invalidRequest('Invalid seed');
  if (request.durationSec !== undefined && !spec.params.durationsSec) throw invalidRequest('Unsupported duration');
}

function videoBody(request: MediaSubmitRequest, spec: MediaModelSpec, options: Record<string, unknown>): Record<string, unknown> {
  if (!request.prompt || request.prompt.length > 32000) throw invalidRequest('A prompt of at most 32000 characters is required');
  const enhancement = options.promptEnhancement;
  if (enhancement !== undefined && (typeof enhancement !== 'string' || !['turbo', 'quality', 'ultraquality', 'disabled'].includes(enhancement))) throw invalidRequest('Invalid promptEnhancement');
  if ((enhancement === 'ultraquality' || enhancement === 'disabled') && (request.durationSec ?? 5) > 15) throw invalidRequest('Duration exceeds enhancement limit');
  if (request.task === 'image-to-video' && request.aspectRatio !== undefined) throw invalidRequest('Image video follows image aspect ratio');
  if (['1080p', '2k'].includes(request.resolution ?? '') && request.task !== 'image-to-video' && !['16:9', '9:16'].includes(request.aspectRatio ?? '')) throw invalidRequest('High resolution requires 16:9 or 9:16');
  const body: Record<string, unknown> = { model: spec.upstreamId, mode: request.task.replaceAll('-', '_'), prompt: request.prompt };
  if (request.durationSec !== undefined) body.duration = request.durationSec;
  if (request.resolution !== undefined) body.resolution = request.resolution;
  if (request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (request.seed !== undefined) body.seed = request.seed;
  if (enhancement !== undefined) body.prompt_enhancement = enhancement;
  if (request.task === 'image-to-video') body.image = asset(requireInput(request, 'first-frame'));
  if (request.task === 'reference-to-video') addReferences(body, request);
  const expected = request.task === 'text-to-video' ? 0 : request.task === 'image-to-video' ? 1 : request.inputs.length;
  if (request.inputs.length !== expected) throw invalidRequest('Unexpected inputs');
  return body;
}

function addReferences(body: Record<string, unknown>, request: MediaSubmitRequest): void {
  const images = inputsByRole(request, 'reference-image');
  const videos = inputsByRole(request, 'reference-video');
  const audio = inputsByRole(request, 'reference-audio');
  if (!images.length && !videos.length) throw invalidRequest('A reference image or video is required');
  if (images.length > 9 || videos.length > 3 || audio.length > 3 || images.length + videos.length + audio.length > 15 || images.length + videos.length + audio.length !== request.inputs.length) throw invalidRequest('Invalid reference inputs');
  if (images.length) body.reference_images = images.map(asset);
  if (videos.length) body.reference_videos = videos.map(asset);
  if (audio.length) body.reference_audio = audio.map(asset);
}

function avatarBody(request: MediaSubmitRequest, spec: MediaModelSpec, options: Record<string, unknown>): { path: string; body: Record<string, unknown> } {
  const { avatarId, voiceId, motionPrompt, motionExpressiveness } = options;
  if (motionPrompt !== undefined && (typeof motionPrompt !== 'string' || motionPrompt.length > 1200)) throw invalidRequest('Invalid motionPrompt');
  if (motionExpressiveness !== undefined && !['default', 'less'].includes(String(motionExpressiveness))) throw invalidRequest('Invalid motionExpressiveness');
  if (avatarId !== undefined) return savedAvatarBody(request, spec, options);
  if (voiceId !== undefined || request.prompt !== undefined || request.aspectRatio !== undefined) throw invalidRequest('Photo avatar requires audio and follows the reference shape');
  const images = inputsByRole(request, 'reference-image');
  const videos = inputsByRole(request, 'reference-video');
  const audio = requireInput(request, 'source-audio');
  if (images.length > 1 || videos.length > 1 || images.length + videos.length < 1 || request.inputs.length !== images.length + videos.length + 1) throw invalidRequest('Invalid avatar reference inputs');
  const body: Record<string, unknown> = { model: spec.upstreamId, audio: asset(audio) };
  if (images.length) body.reference_images = images.map(asset);
  if (videos.length) body.reference_videos = videos.map(asset);
  if (request.resolution) body.resolution = request.resolution;
  if (motionPrompt !== undefined) body.motion_prompt = motionPrompt;
  if (motionExpressiveness !== undefined) body.motion_expressiveness = motionExpressiveness;
  return { path: '/v3/models/avatars', body };
}

function savedAvatarBody(request: MediaSubmitRequest, spec: MediaModelSpec, options: Record<string, unknown>): { path: string; body: Record<string, unknown> } {
  if (typeof options.avatarId !== 'string' || !options.avatarId) throw invalidRequest('avatarId is required');
  const sounds = inputsByRole(request, 'source-audio');
  if (sounds.length > 1 || request.inputs.length !== sounds.length) throw invalidRequest('Unexpected avatar inputs');
  if (sounds.length ? request.prompt !== undefined || options.voiceId !== undefined : !request.prompt || typeof options.voiceId !== 'string' || !options.voiceId) throw invalidRequest('Provide audio or script and voiceId');
  if (request.prompt && request.prompt.length > 5000) throw invalidRequest('Script exceeds 5000 characters');
  const engine: Record<string, unknown> = { type: spec.upstreamId };
  if (options.motionExpressiveness !== undefined) engine.motion_expressiveness = options.motionExpressiveness;
  const body: Record<string, unknown> = { type: 'avatar', avatar_id: options.avatarId };
  if (sounds.length) body.audio_url = requireUrl(sounds[0]!);
  else { body.script = request.prompt; body.voice_id = options.voiceId; }
  body.engine = engine;
  if (request.resolution) body.resolution = request.resolution;
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (options.motionPrompt !== undefined) body.motion_prompt = options.motionPrompt;
  return { path: '/v3/videos', body };
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const spec = findModel(models, request.model);
  validate(request, spec);
  const isAvatar = request.task === 'avatar';
  const options = readVendorOptions(request, isAvatar ? ['avatarId', 'voiceId', 'motionPrompt', 'motionExpressiveness'] : ['promptEnhancement']);
  const payload = isAvatar ? avatarBody(request, spec, options) : { path: '/v3/models/videos', body: videoBody(request, spec, options) };
  const result = await httpJson<ResponseData>(ctx, 'HeyGen submit', base(ctx) + payload.path, {
    method: 'POST', headers: headers(ctx), json: payload.body,
    classify: (status, body) => status === 400 && /"code"\s*:\s*"insufficient_credit"/.test(body)
      ? { reason: 'INSUFFICIENT_CREDIT', category: 'quota', retryable: false } : undefined,
  });
  if (!result.data?.video_id) throw protocolError('HeyGen did not return a video id');
  return { providerJobId: result.data.video_id, ...(payload.path === '/v3/videos' ? { resume: { application: '1' } } : {}) };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const path = job.resume?.application === '1' ? '/v3/videos/' : '/v3/models/videos/';
  const result = await httpJson<ResponseData>(ctx, 'HeyGen poll', base(ctx) + path + encodeURIComponent(job.providerJobId), { headers: headers(ctx) });
  const data = result.data;
  if (data?.status === 'pending') return { status: 'queued' };
  if (data?.status === 'processing') return { status: 'running' };
  if (data?.status === 'cancelled') return { status: 'canceled' };
  if (data?.status === 'completed' && data.video_url) return { status: 'succeeded', outputs: [{ kind: 'video', mimeType: 'video/mp4', url: data.video_url }] };
  if (data?.status === 'failed') {
    const reason = data.failure_code === 'moderation_rejected' ? 'MODERATION' : data.failure_code === 'usage_limit_reached' ? 'INSUFFICIENT_CREDIT' : 'GENERATION_FAILED';
    const category = reason === 'MODERATION' ? 'moderation' : reason === 'INSUFFICIENT_CREDIT' ? 'quota' : 'upstream';
    const error = new MediaHttpError({ reason, category, retryable: false, message: redact(data.failure_message ?? 'HeyGen generation failed', [ctx.apiKey]) });
    return { status: 'failed', error: normalizeMediaError('HEYGEN', error) };
  }
  throw protocolError('HeyGen returned an unknown or incomplete job state');
}

export const adapter: MediaProviderAdapter = {
  id: 'heygen', label: 'HeyGen', route: 'direct', errorPrefix: 'HEYGEN',
  credential: { keyVocabulary: 'heygen', envVars: ['HEYGEN_API_KEY'], configKey: 'heygenApiKey', consoleUrl: 'https://platform.heygen.com/settings/api' },
  inputTransport: 'url', listModels: () => models, submit, poll,
  async validateKey(ctx) {
    try { await httpJson(ctx, 'HeyGen key validation', base(ctx) + '/v3/users/me', { headers: headers(ctx) }); return { ok: true }; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: 'Invalid or unauthorized API key' }; throw error; }
  },
  // Vendor messages are scrubbed where they are raised; keep network and timeout classes too.
  normalizeError: (error) => normalizeMediaError('HEYGEN', error),
};
