import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/heygen.js';
import type { MediaAdapterContext, MediaSubmitRequest } from '../lib/providers/media/contract.js';

const key = 'sk-test-SECRET-123456';
function setup(replies: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const reply = replies.shift();
    assert.ok(reply, 'unexpected network call');
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { ctx: { apiKey: key, fetch: fake } satisfies MediaAdapterContext, calls };
}
const request = (model: string, task: MediaSubmitRequest['task']): MediaSubmitRequest => ({ model, task, inputs: [] });
const video = 'heygen/heygen-video-1';
const avatar = 'heygen/heygen-avatar-6';
const turbo = 'heygen/heygen-avatar-6-turbo';
const input = (role: 'first-frame' | 'reference-image' | 'source-audio', url: string) => ({ role, url, mimeType: role === 'source-audio' ? 'audio/wav' : 'image/jpeg' });

test('text and image video requests use documented body', async () => {
  const { ctx, calls } = setup([{ body: { data: { video_id: 'a' } } }, { body: { data: { video_id: 'b' } } }]);
  await adapter.submit(ctx, { ...request(video, 'text-to-video'), prompt: 'hello', durationSec: 5, resolution: '768p', seed: 42 });
  await adapter.submit(ctx, { ...request(video, 'image-to-video'), prompt: 'move', inputs: [input('first-frame', 'https://example.com/a.jpg')] });
  assert.equal(calls[0]?.url, 'https://api.heygen.com/v3/models/videos');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['x-api-key'], key);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: 'heygen-video-1', mode: 'text_to_video', prompt: 'hello', duration: 5, resolution: '768p', seed: 42 });
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { model: 'heygen-video-1', mode: 'image_to_video', prompt: 'move', image: { type: 'url', url: 'https://example.com/a.jpg' } });
});

test('avatar models support photo and audio or saved avatar script', async () => {
  const { ctx, calls } = setup([{ body: { data: { video_id: 'a' } } }, { body: { data: { video_id: 'b' } } }]);
  await adapter.submit(ctx, { ...request(avatar, 'avatar'), inputs: [input('reference-image', 'https://example.com/a.jpg'), input('source-audio', 'https://example.com/a.wav')] });
  await adapter.submit(ctx, { ...request(turbo, 'avatar'), prompt: 'hello', vendorOptions: { avatarId: 'look', voiceId: 'voice' } });
  assert.equal(calls[0]?.url, 'https://api.heygen.com/v3/models/avatars');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: 'heygen-avatar-6', reference_images: [{ type: 'url', url: 'https://example.com/a.jpg' }], audio: { type: 'url', url: 'https://example.com/a.wav' } });
  assert.equal(calls[1]?.url, 'https://api.heygen.com/v3/videos');
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { type: 'avatar', avatar_id: 'look', script: 'hello', voice_id: 'voice', engine: { type: 'heygen-avatar-6-turbo' } });
});

test('poll maps states and never leaks failure messages', async () => {
  const { ctx, calls } = setup(['pending', 'processing', 'completed', 'failed', 'cancelled'].map(status => ({ body: { data: { status, video_url: 'https://example.com/video.mp4', failure_code: 'generation_failed', failure_message: key } } })));
  const job = { providerJobId: 'job' };
  assert.equal((await adapter.poll(ctx, job)).status, 'queued');
  assert.equal((await adapter.poll(ctx, job)).status, 'running');
  assert.deepEqual(await adapter.poll(ctx, job), { status: 'succeeded', outputs: [{ kind: 'video', mimeType: 'video/mp4', url: 'https://example.com/video.mp4' }] });
  const failed = await adapter.poll(ctx, job);
  assert.equal(failed.status, 'failed');
  assert.ok(!JSON.stringify(failed).includes(key));
  assert.equal((await adapter.poll(ctx, job)).status, 'canceled');
  assert.equal(calls[0]?.url, 'https://api.heygen.com/v3/models/videos/job');
});

test('HTTP errors are classified and redact echoed key', async () => {
  for (const [status, category, retryable] of [[401, 'auth', false], [402, 'quota', false], [429, 'rate-limit', true], [503, 'upstream', true]] as const) {
    const { ctx } = setup([{ status, body: { error: { message: key } } }]);
    await assert.rejects(adapter.submit(ctx, { ...request(video, 'text-to-video'), prompt: 'hi' }), (error: Error) => {
      assert.ok(!error.message.includes(key));
      const result = adapter.normalizeError(error);
      assert.ok(!result.message.includes(key));
      assert.equal(result.category, category); assert.equal(result.retryable, retryable); assert.match(result.code, /^HEYGEN_/);
      return true;
    });
  }
});

test('rejects unknown options and models; key validation uses a free GET', async () => {
  const { ctx, calls } = setup([{ body: { data: {} } }, { status: 401, body: { error: { message: key } } }]);
  await assert.rejects(adapter.submit(ctx, { ...request(video, 'text-to-video'), vendorOptions: { nope: true } }));
  await assert.rejects(adapter.submit(ctx, request('unknown', 'avatar')));
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal((await adapter.validateKey(ctx)).ok, false);
  assert.equal(calls[0]?.url, 'https://api.heygen.com/v3/users/me');
  assert.equal(calls[0]?.init.method, 'GET');
});

test('reference mode and saved-avatar polling use their documented paths', async () => {
  const { ctx, calls } = setup([{ body: { data: { video_id: 'r' } } }, { body: { data: { status: 'completed', video_url: 'https://example.com/out.mp4' } } }]);
  await adapter.submit(ctx, { ...request(video, 'reference-to-video'), prompt: 'scene', inputs: [input('reference-image', 'https://example.com/ref.jpg')] });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: 'heygen-video-1', mode: 'reference_to_video', prompt: 'scene', reference_images: [{ type: 'url', url: 'https://example.com/ref.jpg' }] });
  await adapter.poll(ctx, { providerJobId: 'saved', resume: { application: '1' } });
  assert.equal(calls[1]?.url, 'https://api.heygen.com/v3/videos/saved');
});

test('documented HTTP 400 insufficient_credit is quota', async () => {
  const { ctx } = setup([{ status: 400, body: { error: { code: 'insufficient_credit', message: key } } }]);
  await assert.rejects(adapter.submit(ctx, { ...request(video, 'text-to-video'), prompt: 'x' }), (error: Error) => {
    assert.equal(adapter.normalizeError(error).category, 'quota');
    assert.ok(!error.message.includes(key));
    return true;
  });
});
