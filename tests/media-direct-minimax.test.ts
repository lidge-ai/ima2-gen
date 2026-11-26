import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/minimax.ts';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.ts';

const key = 'secret-key-12345';
function harness(
  responses: { status?: number; body: unknown }[] = [{ body: { task_id: 'job', base_resp: { status_code: 0 } } }],
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    assert.ok(next, 'unexpected fetch');
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const ctx: MediaAdapterContext = { apiKey: key, baseUrl: 'https://proxy.example/v1', fetch: fake };
  return { ctx, calls };
}
const frame = {
  role: 'first-frame' as const,
  url: 'https://example.test/image.png',
  mimeType: 'image/png',
};
const source = {
  role: 'source-video' as const,
  url: 'https://example.test/source.mp4',
  mimeType: 'video/mp4',
};
function req(
  model: string, task: MediaSubmitRequest['task'], inputs: MediaSubmitRequest['inputs'] = [],
): MediaSubmitRequest {
  return { model: `minimax/${model}`, task, prompt: 'a scene', inputs };
}

test('each model uses its documented endpoint and wire model', async () => {
  for (const [id, task, inputs, endpoint, wire] of [
    ['hailuo-2.3', 'text-to-video', [], '/v1/video_generation', 'MiniMax-Hailuo-2.3'],
    ['hailuo-2.3-fast', 'image-to-video', [frame], '/v1/video_generation', 'MiniMax-Hailuo-2.3-Fast'],
    ['minimax-h3', 'text-to-video', [], '/v2/video_generation', 'MiniMax-H3'],
    ['minimax-h3-max', 'image-to-video', [frame], '/v2/video_generation', 'MiniMax-H3-Max'],
    ['hailuo-h3-regen', 'video-upscale', [source], '/v2/video_regeneration', 'MiniMax-H3'],
  ] as const) {
    const h = harness();
    const request = req(id, task, inputs);
    if (id === 'minimax-h3') Object.assign(request, { durationSec: 5, resolution: '2K', aspectRatio: '16:9' });
    if (id === 'minimax-h3-max') Object.assign(request, { durationSec: 5, resolution: '768P' });
    await adapter.submit(h.ctx, request);
    const call = h.calls[0]!;
    assert.equal(call.url, `https://proxy.example${endpoint}`);
    assert.equal(call.init.method, 'POST');
    assert.equal((call.init.headers as Record<string, string>).authorization, `Bearer ${key}`);
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.model, wire);
    if (endpoint === '/v1/video_generation') assert.equal(body.prompt, 'a scene');
    else assert.equal(body.content[0].text, 'a scene');
    if (id === 'hailuo-h3-regen') assert.equal(body.content[1].role, 'base_video');
  }
});

test('v1 and v2 poll states and retrieve output', async () => {
  for (const [status, expected] of [['Queueing', 'queued'], ['Processing', 'running']] as const) {
    const h = harness([{ body: { status, base_resp: { status_code: 0 } } }]);
    assert.equal((await adapter.poll(h.ctx, { providerJobId: 'j', resume: { version: 'v1' } })).status, expected);
  }
  const h = harness([
    { body: { status: 'Success', file_id: 'file', base_resp: { status_code: 0 } } },
    { body: { file: { download_url: 'https://example.test/out.mp4' }, base_resp: { status_code: 0 } } },
  ]);
  const result = await adapter.poll(h.ctx, { providerJobId: 'j', resume: { version: 'v1' } });
  assert.deepEqual(result, {
    status: 'succeeded',
    outputs: [{ kind: 'video', mimeType: 'video/mp4', url: 'https://example.test/out.mp4' }],
  });
  assert.match(h.calls[1]!.url, /files\/retrieve\?file_id=file/);
  for (const status of ['queued', 'running', 'cancelled'] as const) {
    const v2 = harness([{ body: { task: { status } } }]);
    assert.equal(
      (await adapter.poll(v2.ctx, { providerJobId: 'j', resume: { version: 'v2' } })).status,
      status === 'cancelled' ? 'canceled' : status,
    );
  }
  const v2 = harness([{ body: { task: { status: 'succeeded', content: { url: 'https://example.test/out.mp4' } } } }]);
  assert.equal((await adapter.poll(v2.ctx, { providerJobId: 'j', resume: { version: 'v2' } })).status, 'succeeded');
  const bad = harness([{ body: { task: { status: 'failed', error: { code: '1026', message: `blocked ${key}` } } } }]);
  const failure = await adapter.poll(bad.ctx, { providerJobId: 'j', resume: { version: 'v2' } });
  assert.equal(failure.status, 'failed');
  if (failure.status === 'failed') {
    assert.equal(failure.error.category, 'moderation');
    assert.ok(!failure.error.message.includes(key));
  }
});

test('HTTP and vendor errors are classified and redact secrets', async () => {
  for (const [status, category, retryable] of [
    [401, 'auth', false], [403, 'auth', false], [429, 'rate-limit', true], [503, 'upstream', true],
  ] as const) {
    const h = harness([{ status, body: { message: `bad ${key}` } }]);
    await assert.rejects(adapter.submit(h.ctx, req('hailuo-2.3', 'text-to-video')), (e: unknown) => {
      const detail = adapter.normalizeError(e);
      assert.equal(detail.category, category);
      assert.equal(detail.retryable, retryable);
      assert.match(detail.code, /^MINIMAX_/);
      assert.ok(!detail.message.includes(key));
      return true;
    });
  }
  for (const [code, category] of [
    [1002, 'rate-limit'], [1004, 'auth'], [1008, 'quota'], [1026, 'moderation'], [2013, 'invalid-request'],
  ] as const) {
    const h = harness([{ body: { base_resp: { status_code: code, status_msg: `bad ${key}` } } }]);
    await assert.rejects(adapter.submit(h.ctx, req('hailuo-2.3', 'text-to-video')), (e: unknown) => {
      const detail = adapter.normalizeError(e);
      assert.equal(detail.category, category);
      assert.ok(!detail.message.includes(key));
      return true;
    });
  }
});

test('invalid inputs and unknown options are refused without network', async () => {
  const h = harness([]);
  for (const request of [
    { ...req('hailuo-2.3-fast', 'text-to-video'), vendorOptions: {} },
    { ...req('hailuo-2.3', 'text-to-video'), vendorOptions: { nonsense: true } },
    { ...req('hailuo-2.3', 'text-to-video'), durationSec: 10, resolution: '1080P' },
    { ...req('hailuo-2.3', 'text-to-video'), seed: 1 },
    { ...req('minimax-h3', 'text-to-video'), durationSec: 5, resolution: '2K' },
  ]) await assert.rejects(adapter.submit(h.ctx, request));
  assert.equal(h.calls.length, 0);
});

test('catalog, prices, region and free key validation', async () => {
  assert.equal(adapter.errorPrefix, 'MINIMAX');
  assert.ok(adapter.normalizeError(new Error('x')).code.startsWith(adapter.errorPrefix + '_'));
  assert.equal(adapter.listModels().length, 5);
  for (const model of adapter.listModels()) {
    assert.match(model.id, /^minimax\/[a-z0-9.-]+$/);
    for (const price of model.pricing) {
      assert.match(price.source, /^https:\/\//);
      assert.equal(price.checkedAt, '2026-11-26');
    }
  }
  const h = harness([{ body: { files: [], base_resp: { status_code: 0 } } }]);
  assert.deepEqual(await adapter.validateKey(h.ctx), { ok: true });
  assert.equal(h.calls[0]!.url, 'https://proxy.example/v1/files/list');
  assert.equal(h.calls[0]!.init.method, 'GET');
  const cn = harness();
  delete cn.ctx.baseUrl;
  cn.ctx.extra = { region: 'cn_zh' };
  await adapter.submit(cn.ctx, req('hailuo-2.3', 'text-to-video'));
  assert.match(cn.calls[0]!.url, /^https:\/\/api\.minimaxi\.com\/v1\//);
});


test('unknown errors, validation errors and network errors never expose key', async () => {
  assert.ok(!adapter.normalizeError(new Error(`oops ${key}`)).message.includes(key));
  const h = harness([]);
  await assert.rejects(adapter.submit(h.ctx, req(key, 'text-to-video')), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(key));
    assert.ok(!adapter.normalizeError(error).message.includes(key));
    return true;
  });
  h.ctx.fetch = async () => {
    throw new Error(`connection ${key}`);
  };
  await assert.rejects(adapter.submit(h.ctx, req('hailuo-2.3', 'text-to-video')), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(key));
    return true;
  });
});
