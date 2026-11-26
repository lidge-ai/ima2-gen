import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from '../contract.js';
import { assertAllowed, findModel, fromBase64, httpJson, invalidRequest, MediaHttpError, normalizeMediaError, protocolError, readVendorOptions, toBase64 } from './l3-http.js';

const base = 'https://generativelanguage.googleapis.com/v1beta';
const docs = 'https://aistudio.google.com/docs/omni';
const models: readonly MediaModelSpec[] = [{
  id: 'google/gemini-omni-flash-1.2', upstreamId: 'gemini-omni-1.2-flash', vendor: 'google', label: 'Gemini Omni 1.2 Flash', kind: 'video',
  tasks: ['text-to-video', 'image-to-video', 'reference-to-video'],
  params: { durationsSec: [3,4,5,6,7,8,9,10,11,12,13,14,15], resolutions: ['360p','720p','1080p','4k'], aspectRatios: ['16:9','9:16'], maxReferenceImages: 6, nativeAudio: true }, pricing: [{unit:'1k-tokens',usd:0.012,variant:'video output',source:'https://aistudio.google.com/docs/pricing#gemini-omni-1.2-flash',checkedAt:'2026-11-26'}], docsUrl: docs,
}, {
  id:'google/gemini-omni-flash-1.1',upstreamId:'gemini-omni-1.1-flash',vendor:'google',label:'Gemini Omni 1.1 Flash',kind:'video',tasks:['text-to-video','image-to-video'],
  params:{durationsSec:[3,4,5,6,7,8,9,10],resolutions:['360p','720p','1080p','4k'],aspectRatios:['16:9','9:16']},
  pricing:[{unit:'1k-tokens',usd:0.0175,variant:'video output',source:'https://aistudio.google.com/docs/pricing#gemini-omni-1.1-flash',checkedAt:'2026-11-26'}],docsUrl:docs,
}];
interface Interaction { id?: string; status?: string; steps?: Array<{ type?: string; content?: Array<{type?: string; data?: string; uri?: string; mime_type?: string}> }>; }
function headers(ctx: MediaAdapterContext): Record<string, string> { return { 'x-goog-api-key': ctx.apiKey, 'Api-Revision':'2026-05-20' }; }
async function call<T>(ctx: MediaAdapterContext, suffix: string, options: Parameters<typeof httpJson>[3]): Promise<T> {
  // httpJson scrubs the key from vendor error bodies, so the detail can reach the user.
  return await httpJson<T>(ctx, 'Google request', url(ctx, suffix), options);
}
function url(ctx: MediaAdapterContext, suffix: string): string { return (ctx.baseUrl ?? base).replace(/\/$/, '') + suffix; }
function body(request: MediaSubmitRequest, spec: MediaModelSpec): Record<string, unknown> {
  readVendorOptions(request, []);
  if (!spec.tasks.includes(request.task)) throw invalidRequest('Unsupported task');
  assertAllowed('durationSec', request.durationSec, spec.params.durationsSec);
  assertAllowed('resolution', request.resolution, spec.params.resolutions);
  assertAllowed('aspectRatio', request.aspectRatio, spec.params.aspectRatios);
  if (request.seed !== undefined || request.negativePrompt !== undefined || request.audio !== undefined || (request.count !== undefined && request.count !== 1)) throw invalidRequest('Unsupported parameter');
  const expected = request.task === 'text-to-video' ? [] : request.task === 'image-to-video' ? ['first-frame', 'last-frame'] : ['reference-image'];
  if (request.inputs.some((input) => !expected.includes(input.role)) || (request.task === 'text-to-video' && request.inputs.length) || (request.task !== 'text-to-video' && !request.inputs.length) || request.inputs.length > 6) throw invalidRequest('Invalid inputs');
  if (request.inputs.some(i => i.role === 'last-frame') && (request.durationSec ?? 10) > 10) throw invalidRequest('Two frames support at most 10 seconds');
  if (request.task === 'image-to-video' && (request.inputs.filter(i => i.role === 'first-frame').length !== 1 || request.inputs.filter(i => i.role === 'last-frame').length > 1)) throw invalidRequest('Invalid frames');
  const images = request.inputs.map(input => {
    if (!input.bytes || !['image/jpeg','image/png'].includes(input.mimeType)) throw invalidRequest('Inline JPEG or PNG required');
    return { type: 'image', data: toBase64(input.bytes), mime_type: input.mimeType };
  });
  const input = images.length ? [...images, {type:'text', text: request.prompt ?? ''}] : request.prompt ?? '';
  const format: Record<string, string> = {type: 'video'};
  if (request.aspectRatio) format.aspect_ratio = request.aspectRatio;
  if (request.resolution) format.resolution = request.resolution;
  if (request.durationSec) format.duration = `${request.durationSec}s`;
  return {model: spec.upstreamId, input, background: true, ...(Object.keys(format).length > 1 ? {response_format:format} : {})};
}
function state(result: Interaction, ctx: MediaAdapterContext): MediaJobState {
  if (result.status === 'in_progress') return {status:'running'};
  if (result.status === 'requires_action') throw protocolError('Interaction requires unsupported action');
  if (result.status === 'cancelled' || result.status === 'canceled') return {status:'canceled'};
  if (result.status === 'failed') return {status:'failed', error: normalizeMediaError('GOOGLE', protocolError('Google interaction failed'))};
  if (result.status !== 'completed') throw protocolError('Unexpected interaction status');
  const video = result.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).find(c => c.type === 'video');
  if (video?.data) return {status:'succeeded', outputs:[{kind:'video', bytes:fromBase64(video.data), mimeType:video.mime_type ?? 'video/mp4'}]};
  if (video?.uri && /^https:\/\/generativelanguage\.googleapis\.com\//.test(video.uri)) return {status:'succeeded', outputs:[{kind:'video',url:video.uri,mimeType:video.mime_type ?? 'video/mp4',downloadHeaders:headers(ctx)}]};
  throw protocolError('Interaction returned no usable video');
}
export const adapter: MediaProviderAdapter = {
  id:'google', label:'Google Gemini', route:'direct', errorPrefix:'GOOGLE', inputTransport:'inline',
  credential:{keyVocabulary:'gemini',configKey:'geminiApiKey',envVars:['GEMINI_API_KEY'],consoleUrl:'https://aistudio.google.com/apikey'},
  listModels: () => models,
  async validateKey(ctx) {
    try { await call(ctx, '/models?pageSize=1', {headers:headers(ctx)}); return {ok:true}; }
    catch (error) { if (error instanceof MediaHttpError && (error.status === 401 || error.status === 403)) return {ok:false,reason:'Invalid or unauthorized API key'}; throw error; }
  },
  async submit(ctx, request) {
    const payload = body(request, findModel(models, request.model));
    const response = await call<Interaction>(ctx, '/interactions', {method:'POST',headers:headers(ctx),json:payload});
    if (!response.id || !/^[A-Za-z0-9_-]+$/.test(response.id)) throw protocolError('Interaction missing id');
    return {providerJobId:response.id};
  },
  async poll(ctx, job: MediaJobRef) {
    if (!/^[A-Za-z0-9_-]+$/.test(job.providerJobId)) throw invalidRequest('Invalid interaction id');
    return state(await call<Interaction>(ctx, '/interactions/' + job.providerJobId, {headers:headers(ctx)}), ctx);
  },
  async cancel(ctx, job) {
    if (!/^[A-Za-z0-9_-]+$/.test(job.providerJobId)) throw invalidRequest('Invalid interaction id');
    await call(ctx, '/interactions/' + job.providerJobId + '/cancel', {method:'POST',headers:headers(ctx)});
  },
  normalizeError: (error) => normalizeMediaError('GOOGLE', error),
};
