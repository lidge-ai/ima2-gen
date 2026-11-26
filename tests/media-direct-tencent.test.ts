import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/tencent.ts";
import { tc3Authorization } from "../lib/providers/media/direct/tencent/tc3.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const request: MediaSubmitRequest = { model: "tencent/wand-vega-1.0-lite", task: "text-to-video",
  prompt: "a cat", durationSec: 6, resolution: "768P", aspectRatio: "16:9", inputs: [] };
function context(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status });
  };
  const ctx: MediaAdapterContext = { apiKey: "sensitive-key-1234", baseUrl: "https://example.test", fetch: fetcher };
  return { ctx, calls };
}
test("error prefix satisfies the adapter contract", () => {
  assert.equal(adapter.errorPrefix, "TENCENT");
  assert.ok(adapter.normalizeError(new Error("x")).code.startsWith(adapter.errorPrefix + "_"));
});
test("catalog and exact submit wire request", async () => {
  const models = adapter.listModels();
  assert.equal(models.length, 2);
  assert.equal(models[0]?.upstreamId, "wand-vega-video-1.0-lite");
  for (const m of models) {
    assert.match(m.id, /^[^/]+\/[^/]+$/);
    for (const p of m.pricing) { assert.match(p.source, /^https:\/\//); assert.match(p.checkedAt,
      /^\d{4}-\d{2}-\d{2}$/); }
  }
  const { ctx, calls } = context({ id: "job-1", status: "queued" });
  assert.equal((await adapter.submit(ctx, request)).providerJobId, "job-1");
  assert.equal(calls[0]?.url, "https://example.test/v1/wand/vega-videos/tasks");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${ctx.apiKey}`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { model: "wand-vega-video-1.0-lite", content: [{
    type: "text", text: "a cat" }], duration: 6, resolution: "768P", ratio: "16:9" });
});
test("frames and reference content follow documented wire shape", async () => {
  const { ctx, calls } = context({ id: "x" });
  await adapter.submit(ctx, { ...request, task: "image-to-video", inputs: [{ role: "first-frame",
    url: "https://example.test/a.png", mimeType: "image/png" }, { role: "last-frame",
    url: "https://example.test/b.png", mimeType: "image/png" }] });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).content.slice(1), [{ type: "image_url",
    image_url: { url: "https://example.test/a.png" }, role: "first_frame" }, { type: "image_url", image_url: {
    url: "https://example.test/b.png" }, role: "last_frame" }]);
});
test("poll transitions and task errors", async () => {
  for (const status of ["queued", "running"]) assert.equal((await adapter.poll(context({ status }).ctx, {
    providerJobId: "x" })).status, status);
  const done = await adapter.poll(context({ status: "succeeded", content: {
    video_url: "https://example.test/a.mp4" } }).ctx, { providerJobId: "x" });
  assert.deepEqual(done, { status: "succeeded", outputs: [{ kind: "video", url: "https://example.test/a.mp4",
    mimeType: "video/mp4" }] });
  const failed = await adapter.poll(context({ status: "failed", error: { code: "TaskTimeout",
    message: "sensitive-key-1234" } }).ctx, { providerJobId: "x" });
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") { assert.equal(failed.error.category, "timeout");
    assert.equal(failed.error.code, "TENCENT_TASK_TIMEOUT"); assert.ok(failed.error.retryable);
    assert.doesNotMatch(failed.error.message, /sensitive-key/); }
});
test("HTTP errors are classified and redacted", async () => {
  for (const [status, category, retryable] of [[401, "auth", false], [403, "auth", false], [429, "rate-limit",
    true], [500, "upstream", true]] as const) {
    const { ctx } = context({ error: { message: "sensitive-key-1234" } }, status);
    try { await adapter.submit(ctx, request); assert.fail("expected failure"); } catch (e) {
      const error = adapter.normalizeError(e); assert.equal(error.category, category);
        assert.equal(error.retryable, retryable); assert.equal(error.code, `TENCENT_HTTP_${status}`);
        assert.doesNotMatch(error.message, /sensitive-key/);
    }
  }
});
test("invalid parameters and unknown options are rejected before network", async () => {
  for (const patch of [{ vendorOptions: { surprise: true } }, { task: "video-upscale" as const }, {
    durationSec: 16 }, { seed: 1 }, { audio: true }, { count: 2 }]) {
    const { ctx, calls } = context({ id: "x" });
    await assert.rejects(adapter.submit(ctx, { ...request, ...patch })); assert.equal(calls.length, 0);
  }
});
test("key validation reads authenticated model list without generation", async () => {
  const { ctx, calls } = context({ object: "list", data: [] });
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.url, "https://example.test/v1/models"); assert.equal(calls[0]?.init.method, "GET");
});
test("arbitrary errors and transport errors never expose the key", async () => {
  assert.doesNotMatch(adapter.normalizeError(new Error("sensitive-key-1234")).message, /sensitive-key/);
  const ctx: MediaAdapterContext = { apiKey: "sensitive-key-1234", fetch: async () => {
    throw new TypeError("sensitive-key-1234"); } };
  await assert.rejects(adapter.submit(ctx, request), (e: Error) => !e.message.includes(ctx.apiKey) &&
    !adapter.normalizeError(e).message.includes(ctx.apiKey));
});
test("documented vendor errors and reference requests", async () => {
  const { ctx, calls } = context({ id: "ref" });
  await adapter.submit(ctx, { ...request, task: "reference-to-video", inputs: [{ role: "reference-image",
    url: "https://example.test/ref.png", mimeType: "image/png" }] });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).content[1], { type: "image_url", image_url: {
    url: "https://example.test/ref.png" }, role: "reference_image" });
  const state = await adapter.poll(context({ status: "failed", error: { code: "InternalError",
    message: "failure" } }).ctx, { providerJobId: "ref" });
  assert.equal(state.status, "failed");
  if (state.status === "failed") { assert.equal(state.error.code, "TENCENT_INTERNAL_ERROR");
    assert.equal(state.error.category, "upstream"); assert.equal(state.error.retryable, true); }
  const bad = context({ error: { code: "invalid_request_error", message: "bad request" } }, 400);
  await assert.rejects(adapter.submit(bad.ctx, request),
    (e: Error) => adapter.normalizeError(e).category === "invalid-request");
});

test("TC3 signature matches Tencent's published sample", () => {
  const payload = '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}';
  assert.equal(tc3Authorization({ secretId: "DOC-EXAMPLE-SECRET-ID",
    secretKey: "Gu5t9xGARNpq86cd98joQYCN3EXAMPLE", host: "cvm.tencentcloudapi.com", service: "cvm",
    timestamp: 1551113065, payload }),
    "TC3-HMAC-SHA256 Credential=DOC-EXAMPLE-SECRET-ID/2019-02-25/cvm/tc3_request, " +
    "SignedHeaders=content-type;host, Signature=" +
    "72e494ea809ad7a8c8f7a4507b9bddcbaa8e581f516e8da2f66e2c5a96525168");
});
test("Mingmou requires TC3 credentials and uses VOD signed create and poll", async () => {
  const req: MediaSubmitRequest = { model: "tencent/mingmou-1", task: "text-to-video", prompt: "a cat", inputs: [] };
  const missing = context({});
  await assert.rejects(adapter.submit(missing.ctx, req),
    (e: Error) => adapter.normalizeError(e).code === "TENCENT_CREDENTIAL_MISSING");
  assert.equal(missing.calls.length, 0);
  const created = context({ Response: { TaskId: "vod-task" } });
  created.ctx.extra = { secretId: "id-secret-1234", secretKey: "key-secret-5678", vodSubAppId: "123456",
    region: "ap-singapore" };
  const job = await adapter.submit(created.ctx, req);
  assert.deepEqual(job.resume, { route: "vod", subAppId: "123456", region: "ap-singapore" });
  assert.deepEqual(JSON.parse(String(created.calls[0]?.init.body)), { SubAppId: 123456, ModelName: "Mingmou",
    ModelVersion: "1.0", Prompt: "a cat" });
  const headers = created.calls[0]?.init.headers as Record<string, string>;
  assert.equal(created.calls[0]?.url, "https://example.test/");
  assert.equal(headers["x-tc-action"], "CreateAigcVideoTask");
  assert.equal(headers["x-tc-version"], "2018-07-17");
  assert.match(headers.authorization ?? "", /^TC3-HMAC-SHA256 Credential=/);
  const polling = context({ Response: { TaskType: "AigcVideoTask", AigcVideoTask: { Status: "FINISH",
    ErrCode: 0, Output: { FileInfos: [{ FileUrl: "https://example.test/output.mp4",
    ExpireTime: "2027-01-01T00:00:00Z" }] } } } });
  polling.ctx.extra = created.ctx.extra;
  assert.deepEqual(await adapter.poll(polling.ctx, job), { status: "succeeded", outputs: [{ kind: "video",
    url: "https://example.test/output.mp4", mimeType: "video/mp4", expiresAt: "2027-01-01T00:00:00Z" }] });
  assert.deepEqual(JSON.parse(String(polling.calls[0]?.init.body)), { TaskId: "vod-task", SubAppId: 123456 });
  assert.equal((polling.calls[0]?.init.headers as Record<string, string>)["x-tc-action"], "DescribeTaskDetail");
});
test("Mingmou running, failed and response envelope errors redact credentials", async () => {
  const job = { providerJobId: "job", resume: { route: "vod", subAppId: "123" } };
  const extra = { secretId: "secret-id-123", secretKey: "secret-key-456", vodSubAppId: "123" };
  const running = context({ Response: { AigcVideoTask: { Status: "PROCESSING" } } }); running.ctx.extra = extra;
  assert.equal((await adapter.poll(running.ctx, job)).status, "running");
  const failed = context({ Response: { AigcVideoTask: { Status: "FINISH", ErrCode: 7,
    Message: "secret-key-456" } } }); failed.ctx.extra = extra;
  const state = await adapter.poll(failed.ctx, job);
  assert.equal(state.status, "failed");
  if (state.status === "failed") assert.doesNotMatch(state.error.message, /secret-key-456/);
  const bad = context({ Response: { Error: { Code: "AuthFailure.SignatureFailure",
    Message: "secret-id-123 secret-key-456" } } }); bad.ctx.extra = extra;
  await assert.rejects(adapter.poll(bad.ctx, job), (e: Error) => {
    const normalized = adapter.normalizeError(e); return normalized.category === "auth" &&
    !/secret-id-123|secret-key-456/.test(normalized.message); });
});
test("Mingmou extended failure codes are honored even if ErrCode is zero", async () => {
  const extra = { secretId: "id-1234", secretKey: "key-1234", vodSubAppId: "123" };
  const job = { providerJobId: "job", resume: { route: "vod", subAppId: "123" } };
  for (const [code, expected] of [["RequestLimitExceeded", "rate-limit"], ["ContentModerationFailed",
    "moderation"], ["TaskTimeout", "timeout"], ["ResourceInsufficient", "quota"]] as const) {
    const t = context({ Response: { AigcVideoTask: { Status: "FINISH", ErrCode: 0, ErrCodeExt: code,
      Message: "failed" } } }); t.ctx.extra = extra;
    const state = await adapter.poll(t.ctx, job); assert.equal(state.status, "failed");
    if (state.status === "failed") assert.equal(state.error.category, expected);
  }
  const canceled = context({ Response: { AigcVideoTask: { Status: "FINISH", ErrCode: 1,
    ErrCodeExt: "OperationCanceled" } } }); canceled.ctx.extra = extra;
  assert.equal((await adapter.poll(canceled.ctx, job)).status, "canceled");
});
test("Mingmou rejects unsupported options and invalid credentials without transport", async () => {
  const req: MediaSubmitRequest = { model: "tencent/mingmou-1", task: "text-to-video", prompt: "test", inputs: [] };
  for (const patch of [{ durationSec: 5 }, { audio: true }, { vendorOptions: { arbitrary: true } }, {
    task: "image-to-video" as const }]) {
    const t = context({}); t.ctx.extra = { secretId: "id-1234", secretKey: "key-1234", vodSubAppId: "1" };
    await assert.rejects(adapter.submit(t.ctx, { ...req, ...patch })); assert.equal(t.calls.length, 0);
  }
  const noSub = context({}); noSub.ctx.extra = { secretId: "id-1234", secretKey: "key-1234" };
  await assert.rejects(adapter.submit(noSub.ctx, req)); assert.equal(noSub.calls.length, 0);
});
