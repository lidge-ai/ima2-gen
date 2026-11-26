import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/pixverse.ts';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.ts';

const request: MediaSubmitRequest = { model: 'pixverse/pixverse-v6', task: 'text-to-video', prompt: 'hello', durationSec: 5, resolution: '720p', aspectRatio: '16:9', audio: true, inputs: [] };
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ctx: MediaAdapterContext = { apiKey: 'secret-key-123', baseUrl: 'https://fake.test', fetch: async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(JSON.stringify(body), { status }); } };
  return { ctx, calls };
}
test('V6 and C1 use documented text generation wire format', async () => {
  for (const model of ['v6', 'c1']) {
    const {ctx,calls} = fake({ErrCode:0,Resp:{video_id:123}});
    assert.equal((await adapter.submit(ctx,{...request,model:`pixverse/pixverse-${model}`})).providerJobId,'123');
    assert.equal(calls[0]?.url,'https://fake.test/openapi/v2/video/text/generate');
    assert.equal(calls[0]?.init.method,'POST');
    const headers = new Headers(calls[0]?.init.headers);
    assert.equal(headers.get('API-KEY'),'secret-key-123');
    assert.match(headers.get('Ai-trace-id') ?? '', /^[a-f0-9-]{36}$/);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {model,prompt:'hello',duration:5,quality:'720p',aspect_ratio:'16:9',generate_audio_switch:true});
  }
});
test('image upload and image generation use image id', async () => {
  const {ctx,calls} = fake({ErrCode:0,Resp:{img_id:42,video_id:123}});
  const uploaded = await adapter.uploadInput!(ctx,{role:'first-frame',mimeType:'image/png',bytes:new Uint8Array([1,2])});
  assert.equal(uploaded.url,'pixverse:image:42');
  assert.equal(calls[0]?.url,'https://fake.test/openapi/v2/image/upload');
  assert.ok(calls[0]?.init.body instanceof FormData);
  await adapter.submit(ctx,{...request,task:'image-to-video',aspectRatio:undefined,inputs:[{role:'first-frame',mimeType:'image/png',url:uploaded.url}]});
  assert.equal(calls[1]?.url,'https://fake.test/openapi/v2/video/img/generate');
  assert.equal(JSON.parse(String(calls[1]?.init.body)).img_id,42);
});
test('poll processes status and validates result', async () => {
  for (const [status, expected] of [[5,'running'],[1,'succeeded'],[7,'failed'],[8,'failed']] as const) {
    const {ctx,calls} = fake({ErrCode:0,Resp:{status,url:'https://cdn.test/a.mp4'}});
    const result = await adapter.poll(ctx,{providerJobId:'123'});
    assert.equal(result.status,expected);
    assert.equal(calls[0]?.url,'https://fake.test/openapi/v2/video/result/123');
    if(result.status === 'succeeded') assert.deepEqual(result.outputs,[{kind:'video',mimeType:'video/mp4',url:'https://cdn.test/a.mp4'}]);
    if(result.status === 'failed') assert.equal(result.error.category,status === 7 ? 'moderation' : 'upstream');
  }
});
test('HTTP and vendor errors are classified and redact secrets', async () => {
  for (const [status,category] of [[401,'auth'],[403,'auth'],[429,'rate-limit'],[500,'upstream']] as const) {
    const {ctx} = fake({message:'secret-key-123'},status);
    await assert.rejects(adapter.submit(ctx,request), e => { const error=adapter.normalizeError(e); assert.equal(error.category,category); assert.match(error.code,/^PIXVERSE_/); assert.ok(!error.message.includes(ctx.apiKey)); return true; });
  }
  for (const [code,category] of [[10004,'auth'],[400017,'invalid-request'],[500044,'rate-limit'],[500090,'quota']] as const) {
    const {ctx} = fake({ErrCode:code,ErrMsg:'secret-key-123'});
    await assert.rejects(adapter.submit(ctx,request), e => { const error=adapter.normalizeError(e); assert.equal(error.category,category); assert.ok(!error.message.includes(ctx.apiKey)); return true; });
  }
});
test('rejects unknown options and unsupported parameters', async () => {
  const {ctx} = fake({ErrCode:0});
  for(const bad of [{vendorOptions:{bad:true}},{task:'image-upscale' as const},{durationSec:16},{negativePrompt:'bad'},{count:2}]) await assert.rejects(adapter.submit(ctx,{...request,...bad}));
});
test('catalog and free key validation conform to contract', async () => {
  for (const model of adapter.listModels()) { assert.match(model.id,/^[a-z0-9-]+\/[a-z0-9-]+$/); for(const price of model.pricing) { assert.match(price.source,/^https:\/\//); assert.match(price.checkedAt,/^\d{4}-\d\d-\d\d$/); } }
  const {ctx,calls} = fake({ErrCode:0,Resp:{credit_package:1}});
  assert.deepEqual(await adapter.validateKey(ctx),{ok:true});
  assert.equal(calls[0]?.url,'https://fake.test/openapi/v2/account/balance');
  assert.equal(calls[0]?.init.method,'GET');
});

test('normalizing unknown errors cannot expose credentials', () => {
  for (const error of ['secret-key-123', new Error('secret-key-123')]) assert.ok(!adapter.normalizeError(error).message.includes('secret-key-123'));
});

test('validation errors redact a key supplied as a model or option name', async () => {
  const {ctx} = fake({ErrCode:0});
  for (const bad of [{model:ctx.apiKey}, {vendorOptions:{[ctx.apiKey]: true}}]) {
    await assert.rejects(adapter.submit(ctx,{...request,...bad}), error => { assert.ok(!String(error).includes(ctx.apiKey)); assert.ok(!adapter.normalizeError(error).message.includes(ctx.apiKey)); return true; });
  }
});
