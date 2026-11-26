import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/google.js';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.js';

const key = 'sk-test-SECRET-123456';
const request: MediaSubmitRequest = { model: 'google/gemini-omni-flash-1.2', task: 'text-to-video', prompt: 'a cat', inputs: [] };
function fake(bodies: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  const ctx: MediaAdapterContext = { apiKey: key, fetch: (async (url, init) => {
    calls.push({ url: String(url), init });
    const next = bodies.shift(); assert.ok(next);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch };
  return { ctx, calls };
}

test('submits interaction, polls running and returns video bytes', async () => {
  const {ctx, calls} = fake([{body:{id:'abc'}}, {body:{status:'in_progress'}}, {body:{status:'completed',steps:[{type:'model_output',content:[{type:'video',mime_type:'video/mp4',data:'YQ=='}]}]}}]);
  const job = await adapter.submit(ctx, request);
  assert.equal(calls[0]?.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal((calls[0]?.init?.headers as Record<string,string>)['x-goog-api-key'], key);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {model:'gemini-omni-1.2-flash',input:'a cat',background:true});
  assert.equal((await adapter.poll(ctx, job)).status, 'running');
  const state = await adapter.poll(ctx, job); assert.equal(state.status, 'succeeded');
  if (state.status === 'succeeded') assert.deepEqual(state.outputs[0]?.bytes, new Uint8Array([97]));
});

test('errors, validation and secret redaction', async () => {
  for (const [status, category, retryable] of [[401,'auth',false],[402,'quota',false],[429,'rate-limit',true],[500,'upstream',true]] as const) {
    const {ctx} = fake([{status,body:{error:{message:key}}}]);
    await assert.rejects(adapter.submit(ctx, request), (error: Error) => {
      assert.ok(!error.message.includes(key)); const e = adapter.normalizeError(error);
      assert.equal(e.category, category); assert.equal(e.retryable, retryable); assert.match(e.code, /^GOOGLE_/); assert.ok(!e.message.includes(key)); return true;
    });
  }
  const {ctx} = fake([]);
  await assert.rejects(adapter.submit(ctx, {...request, model:'bad'}));
  await assert.rejects(adapter.submit(ctx, {...request, vendorOptions:{bad:true}}));
});

test('key validation and failed interaction', async () => {
  assert.equal((await adapter.validateKey(fake([{body:{models:[]}}]).ctx)).ok, true);
  assert.equal((await adapter.validateKey(fake([{status:401,body:{}}]).ctx)).ok, false);
  const {ctx} = fake([{body:{status:'failed',error:{message:key}}}]);
  const state = await adapter.poll(ctx, {providerJobId:'abc'});
  assert.equal(state.status, 'failed'); if (state.status === 'failed') assert.ok(!state.error.message.includes(key));
});

test('Omni 1.1 uses documented model id and 10 second maximum', async () => {
 const {ctx,calls}=fake([{body:{id:'one'}}]);
 await adapter.submit(ctx,{...request,model:'google/gemini-omni-flash-1.1',durationSec:10});
 assert.equal(JSON.parse(String(calls[0]?.init?.body)).model,'gemini-omni-1.1-flash');
 await assert.rejects(adapter.submit(ctx,{...request,model:'google/gemini-omni-flash-1.1',durationSec:11}));
});

test('image and reference inputs are sent inline', async () => {
 const {ctx,calls}=fake([{body:{id:'image'}},{body:{id:'ref'}}]);
 await adapter.submit(ctx,{...request,task:'image-to-video',inputs:[{role:'first-frame',bytes:new Uint8Array([97]),mimeType:'image/png'}]});
 assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)).input,[{type:'image',data:'YQ==',mime_type:'image/png'},{type:'text',text:'a cat'}]);
 await adapter.submit(ctx,{...request,task:'reference-to-video',inputs:[{role:'reference-image',bytes:new Uint8Array([98]),mimeType:'image/jpeg'}]});
 assert.equal(JSON.parse(String(calls[1]?.init?.body)).input[0].data,'Yg==');
});

test('cancels a background interaction', async () => {
 const {ctx,calls}=fake([{body:{}}]); assert.ok(adapter.cancel); await adapter.cancel(ctx,{providerJobId:'abc'});
 assert.equal(calls[0]?.url,'https://generativelanguage.googleapis.com/v1beta/interactions/abc/cancel');
 assert.equal(calls[0]?.init?.method,'POST');
});
