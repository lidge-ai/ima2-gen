import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../lib/providers/media/direct/byteplus-vision.js';
import type {
  MediaAdapterContext,
  MediaSubmitRequest
} from '../lib/providers/media/contract.js';

const request: MediaSubmitRequest = {
  model: 'bytedance/omnihuman-1.5',
  task: 'avatar',
  prompt: 'wave',
  resolution: '720p',
  seed: 12,
  inputs: [{
      role: 'source-image',
      url: 'https://example.com/a.jpg',
      mimeType: 'image/jpeg'
    },
    {
      role: 'source-audio',
      url: 'https://example.com/a.mp3',
      mimeType: 'audio/mpeg'
    }
  ],
};

function context(fetch: typeof globalThis.fetch): MediaAdapterContext {
  return {
    apiKey: 'test-access-id',
    extra: {
      secretAccessKey: 'test-secret-key'
    },
    fetch
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

test('signs and submits the documented request at a fixed UTC time', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-11-26T12:34:56Z')
  });
  const ctx = context(async (url, init) => {
    assert.equal(String(url),
      'https://cv.byteplusapi.com/?Action=CVSubmitTask&Version=2024-06-06');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      req_key: 'realman_avatar_picture_omni15_cv',
      image_url: 'https://example.com/a.jpg',
      audio_url: 'https://example.com/a.mp3',
      prompt: 'wave',
      output_resolution: 720,
      seed: 12
    });
    const h = new Headers(init?.headers);
    assert.equal(h.get('x-date'), '20261126T123456Z');
    assert.equal(h.get('authorization'),
      'HMAC-SHA256 Credential=test-access-id/20261126/ap-singapore-1/cv/request, '
      + 'SignedHeaders=content-type;host;x-content-sha256;x-date, '
      + 'Signature=df82180819115d3ffc359023cef1ac3c147fd7ac3dfd6f348826e67d1a86f949',
    );
    return response({
      code: 10000,
      data: {
        task_id: 'job-1'
      }
    });
  });
  assert.equal((await adapter.submit(ctx, request)).providerJobId, 'job-1');
});

test('poll maps statuses and parses the JSON string result', async () => {
  for (const [vendor, expected] of [
      ['in_queue', 'queued'],
      ['generating', 'running'],
      ['canceled', 'canceled'],
      ['not_found', 'failed'],
      ['expired', 'failed'],
      ['done', 'succeeded']
    ] as const) {
    const ctx = context(async (url, init) => {
      assert.equal(String(url),
        'https://cv.byteplusapi.com/?Action=CVGetResult&Version=2024-06-06');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        req_key: 'realman_avatar_picture_omni15_cv',
        task_id: 'job-1'
      });
      return response({
        code: 10000,
        data: {
          status: vendor,
          resp_data: '{"video_url":"https://example.com/out.mp4"}'
        }
      });
    });
    const result = await adapter.poll(ctx, {
      providerJobId: 'job-1'
    });
    assert.equal(result.status, expected);
    if (result.status === 'succeeded') assert.equal(result.outputs[0]?.url,
      'https://example.com/out.mp4');
  }
});

test('maps vendor errors and redacts both credentials, including transport failures', async () => {
  for (const [code, category, retryable] of [
      [50400, 'auth', false],
      [50429, 'rate-limit', true],
      [50430, 'rate-limit', true],
      [50215, 'invalid-request', false],
      [50500, 'upstream', true],
      [50510, 'moderation', false]
    ] as const) {
    const ctx = context(async () => response({
      code,
      message: 'test-access-id test-secret-key'
    }));
    await assert.rejects(adapter.submit(ctx, request), (error: unknown) => {
      const e = adapter.normalizeError(error);
      assert.equal(e.code, `BYTEPLUS_VISION_${code}`);
      assert.equal(e.category, category);
      assert.equal(e.retryable, retryable);
      assert.doesNotMatch(e.message, /test-access-id|test-secret-key/);
      return true;
    });
  }
  const ctx = context(async () => {
    throw new Error('test-access-id test-secret-key');
  });
  await assert.rejects(adapter.submit(ctx, request), (error: unknown) => {
    assert.doesNotMatch(adapter.normalizeError(error).message, /test-access-id|test-secret-key/);
    return true;
  });
});

test('rejects unknown options and missing URL input before network', async () => {
  const ctx = context(async () => {
    throw new Error('unexpected network');
  });
  await assert.rejects(adapter.submit(ctx, {
    ...request,
    vendorOptions: {
      unknown: true
    }
  }));
  await assert.rejects(adapter.submit(ctx, {
    ...request,
    inputs: []
  }));
  await assert.rejects(adapter.submit(ctx, {
    ...request,
    model: 'test-secret-key'
  }), (error: unknown) => {
    assert.doesNotMatch(adapter.normalizeError(error).message, /test-secret-key/);
    return true;
  });
});

test('catalog contains documented IDs and official dated pricing', () => {
  const models = adapter.listModels();
  assert.deepEqual(models.map(m => m.id), ['bytedance/omnihuman-1.5', 'bytedance/omnihuman-2']);
  assert.equal(models[1]?.upstreamId, 'realman_avatar_picture_omni20_cv');
  assert.deepEqual(models[1]?.pricing, []);
  assert.equal(models[0]?.upstreamId, 'realman_avatar_picture_omni15_cv');
  assert.equal(models[0]?.pricing[0]?.usd, 0.12);
  assert.match(models[0]?.pricing[0]?.source ?? '', /^https:\/\/docs\.byteplus\.com\//);
  assert.equal(models[0]?.pricing[0]?.checkedAt, '2026-11-26');
});

test('validates keys with signed result lookup and distinguishes auth from service failures', async () => {
  for (const [body, status, ok] of [
    [{ code: 10000, data: { status: 'not_found' } }, 200, true],
    [{ code: 50215, message: 'invalid task' }, 400, true],
    [{ code: 50400 }, 200, false],
    [{ ResponseMetadata: { Error: { Code: 'SignatureDoesNotMatch', CodeN: 100010 } } }, 200, false],
    [{ ResponseMetadata: { Error: { Code: 'InvalidAuthorization', CodeN: 100024 } } }, 400, false],
    [{ ResponseMetadata: { Error: { Code: 'InvalidCredential' } } }, 400, false],
    [{ code: 50215 }, 403, false],
    [{ code: 50500 }, 500, false],
    [{ code: 50500 }, 200, false],
    [{ code: 50429 }, 200, false],
  ] as const) {
    const ctx = context(async (url, init) => {
      assert.equal(String(url),
        'https://cv.byteplusapi.com/?Action=CVGetResult&Version=2024-06-06');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        req_key: 'realman_avatar_picture_omni15_cv',
        task_id: 'ima2-key-check'
      });
      assert.match(new Headers(init?.headers).get('authorization') ?? '', /^HMAC-SHA256 /);
      return response(body, status);
    });
    assert.equal((await adapter.validateKey(ctx)).ok, ok);
  }
});

test('official OpenAPI signing vector uses the provider signer', async () => {
  const {
    signatureFromSigningKey,
    canonicalRequest,
    deriveSigningKey
  } = await import('../lib/providers/media/direct/byteplus-vision/signature.js');
  const payload = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const canonical = canonicalRequest('GET', '/',
    'Action=ListUsers&Limit=10&Offset=0&Version=2018-01-01',
    'application/x-www-form-urlencoded; charset=utf-8', 'iam.byteplusapi.com', payload,
    '20201230T081805Z');
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(canonical).digest('hex'),
    '4809ff4a3260bb6714f750191275cfcf0c16466951fcfd99187e69644b6ae020');
  // BytePlus RTC public demo credential.
  const secret = 'TnpCak5XWXpZV1U0WkRaaE5ERmxaR0ZpTmpjeVkyUXlZek0wTWpJMU1qWQ==';
  const key = deriveSigningKey(secret, '20201230', 'ap-singapore-1', 'rtc');
  assert.equal(key.toString('hex'), 'aa6c033b312f2984f152589a7b015852909f850a150ba517ae8dea394126af08');
  const signature = signatureFromSigningKey(key, '20201230T081805Z',
    '20201230/ap-singapore-1/rtc/request',
    '347e7f5324998a2c7984370c3c50dc75bf9e6b449ea498a6bf8864d94cbd84b9');
  assert.equal(signature, '0d7e689b7d7949fa8b0132f5718b8f3b0d25cf7ea6c46eea33d91efd79f1e973');
});

test('OmniHuman 2 uses its own wire protocol and resumable req_key', async () => {
  const ctx = context(async (url, init) => {
    assert.match(String(url), /Action=CVSync2AsyncSubmitTask/);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      req_key: 'realman_avatar_picture_omni20_cv',
      image_urls: ['https://example.com/a.jpg'],
      audio_url: 'https://example.com/a.mp3',
      prompt: 'wave',
      enable_watermark: false
    });
    return response({
      code: 10000,
      data: {
        task_id: 'job-2'
      }
    });
  });
  const job = await adapter.submit(ctx, {
    ...request,
    model: 'bytedance/omnihuman-2',
    resolution: undefined,
    seed: undefined,
    vendorOptions: {
      enable_watermark: false
    }
  });
  assert.equal(job.resume?.req_key, 'realman_avatar_picture_omni20_cv');
  const result = await adapter.poll(context(async (url, init) => {
    assert.match(String(url), /Action=CVSync2AsyncGetResult/);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      req_key: 'realman_avatar_picture_omni20_cv',
      task_id: 'job-2'
    });
    return response({
      code: 10000,
      data: {
        status: 'done',
        video_url: 'https://example.com/v2.mp4'
      }
    });
  }), job);
  assert.equal(result.status, 'succeeded');
  if (result.status === 'succeeded') assert.equal(result.outputs[0]?.url, 'https://example.com/v2.mp4');
});

test('error prefix matches normalized error codes', () => {
  assert.equal(adapter.errorPrefix, 'BYTEPLUS_VISION');
  assert.ok(adapter.normalizeError(new Error('x')).code.startsWith(adapter.errorPrefix + '_'));
});
