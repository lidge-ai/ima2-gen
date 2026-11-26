import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/byteplus-vision.js';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.js';

const request: MediaSubmitRequest = {
  model: 'bytedance/omnihuman-1.5', task: 'avatar', prompt: 'wave', resolution: '720p', seed: 12,
  inputs: [{ role: 'source-image', url: 'https://example.com/a.jpg', mimeType: 'image/jpeg' },
    { role: 'source-audio', url: 'https://example.com/a.mp3', mimeType: 'audio/mpeg' }],
};
function context(fetch: typeof globalThis.fetch): MediaAdapterContext {
  return { apiKey: 'test-access-id', extra: { secretAccessKey: 'test-secret-key' }, fetch };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('signs and submits the documented request at a fixed UTC time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:34:56Z') });
  const ctx = context(async (url, init) => {
    assert.equal(String(url), 'https://cv.byteplusapi.com/?Action=CVSubmitTask&Version=2024-06-06');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { req_key: 'realman_avatar_picture_omni15_cv', image_url: 'https://example.com/a.jpg', audio_url: 'https://example.com/a.mp3', prompt: 'wave', output_resolution: 720, seed: 12 });
    const h = new Headers(init?.headers);
    assert.equal(h.get('x-date'), '20261126T123456Z');
    assert.equal(h.get('authorization'), 'HMAC-SHA256 Credential=test-access-id/20261126/ap-singapore-1/cv/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=df82180819115d3ffc359023cef1ac3c147fd7ac3dfd6f348826e67d1a86f949');
    return response({ code: 10000, data: { task_id: 'job-1' } });
  });
  assert.equal((await adapter.submit(ctx, request)).providerJobId, 'job-1');
});

test('poll maps statuses and parses the JSON string result', async () => {
  for (const [vendor, expected] of [['in_queue', 'queued'], ['generating', 'running'], ['canceled', 'canceled'], ['not_found', 'failed'], ['expired', 'failed'], ['done', 'succeeded']] as const) {
    const ctx = context(async (url, init) => {
      assert.equal(String(url), 'https://cv.byteplusapi.com/?Action=CVGetResult&Version=2024-06-06');
      assert.deepEqual(JSON.parse(String(init?.body)), { req_key: 'realman_avatar_picture_omni15_cv', task_id: 'job-1' });
      return response({ code: 10000, data: { status: vendor, resp_data: '{"video_url":"https://example.com/out.mp4"}' } });
    });
    const result = await adapter.poll(ctx, { providerJobId: 'job-1' });
    assert.equal(result.status, expected);
    if (result.status === 'succeeded') assert.equal(result.outputs[0]?.url, 'https://example.com/out.mp4');
  }
});

test('maps vendor errors and redacts both credentials, including transport failures', async () => {
  for (const [code, category, retryable] of [[50400, 'auth', false], [50429, 'rate-limit', true], [50430, 'rate-limit', true], [50215, 'invalid-request', false], [50500, 'upstream', true], [50510, 'moderation', false]] as const) {
    const ctx = context(async () => response({ code, message: 'test-access-id test-secret-key' }));
    await assert.rejects(adapter.submit(ctx, request), (error: unknown) => {
      const e = adapter.normalizeError(error);
      assert.equal(e.code, `BYTEPLUS_VISION_${code}`); assert.equal(e.category, category); assert.equal(e.retryable, retryable);
      assert.doesNotMatch(e.message, /test-access-id|test-secret-key/); return true;
    });
  }
  const ctx = context(async () => { throw new Error('test-access-id test-secret-key'); });
  await assert.rejects(adapter.submit(ctx, request), (error: unknown) => {
    assert.doesNotMatch(adapter.normalizeError(error).message, /test-access-id|test-secret-key/); return true;
  });
});

test('rejects unknown options and missing URL input before network', async () => {
  const ctx = context(async () => { throw new Error('unexpected network'); });
  await assert.rejects(adapter.submit(ctx, { ...request, vendorOptions: { unknown: true } }));
  await assert.rejects(adapter.submit(ctx, { ...request, inputs: [] }));
});

test('catalog contains documented IDs and official dated pricing', () => {
  const models = adapter.listModels();
  assert.deepEqual(models.map(m => m.id), ['bytedance/omnihuman-1.5']);
  assert.equal(models[0]?.upstreamId, 'realman_avatar_picture_omni15_cv');
  assert.equal(models[0]?.pricing[0]?.usd, 0.12);
  assert.match(models[0]?.pricing[0]?.source ?? '', /^https:\/\/docs\.byteplus\.com\//);
  assert.equal(models[0]?.pricing[0]?.checkedAt, '2026-11-26');
});

test('key validation does not call a potentially billable endpoint', async () => {
  const result = await adapter.validateKey(context(async () => { throw new Error('unexpected network'); }));
  assert.equal(result.ok, false);
});
