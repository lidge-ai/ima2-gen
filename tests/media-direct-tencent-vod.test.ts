import test from "node:test";
import assert from "node:assert/strict";
import { adapter } from "../lib/providers/media/direct/tencent-vod/index.ts";
import { tc3Authorization } from "../lib/providers/media/direct/tencent-vod/tc3.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

function context(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status });
  };
  const ctx: MediaAdapterContext = { apiKey: "secret-id-123", baseUrl: "https://example.test", fetch: fetcher };
  return { ctx, calls };
}

test("VOD adapter has independent credentials and normalized error prefix", () => {
  assert.equal(adapter.id, "tencent-vod");
  assert.equal(adapter.errorPrefix, "TENCENT_VOD");
  assert.ok(adapter.normalizeError(new Error("secret-id-123")).code.startsWith(adapter.errorPrefix + "_"));
  assert.doesNotMatch(adapter.normalizeError(new Error("secret-id-123")).message, /secret-id-123/);
  assert.deepEqual(adapter.credential.envVars, ["TENCENTCLOUD_SECRET_ID"]);
  assert.equal(adapter.credential.keyVocabulary, "tencent-vod");
  assert.equal(adapter.credential.configKey, "tencentVodApiKey");
  assert.equal(adapter.credential.extraFields?.find((field) => field.name === "secretKey")?.required, true);
  assert.equal(adapter.credential.extraFields?.find((field) => field.name === "vodSubAppId")?.required, true);
  assert.equal(adapter.listModels()[0]?.id, "tencent/mingmou-1");
});

test("VOD key validation queries applications without generating media", async () => {
  const { ctx, calls } = context({ Response: { SubAppIdInfoSet: [], TotalCount: 0 } });
  ctx.extra = { secretKey: "secret-key-456" };
  assert.deepEqual(await adapter.validateKey(ctx), { ok: true });
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["x-tc-action"], "DescribeSubAppIds");
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {});
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
    (e: Error) => adapter.normalizeError(e).code === "TENCENT_VOD_CREDENTIAL_MISSING");
  assert.equal(missing.calls.length, 0);
  const created = context({ Response: { TaskId: "vod-task" } });
  created.ctx.apiKey = "id-secret-1234";
  created.ctx.extra = { secretKey: "key-secret-5678", vodSubAppId: "123456",
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
  assert.match(headers.authorization ?? "", /Credential=id-secret-1234\//);
  assert.doesNotMatch(headers.authorization ?? "", /key-secret-5678/);
  const polling = context({ Response: { TaskType: "AigcVideoTask", AigcVideoTask: { Status: "FINISH",
    ErrCode: 0, Output: { FileInfos: [{ FileUrl: "https://example.test/output.mp4",
    ExpireTime: "2027-01-01T00:00:00Z" }] } } } });
  polling.ctx.apiKey = created.ctx.apiKey;
  polling.ctx.extra = created.ctx.extra;
  assert.deepEqual(await adapter.poll(polling.ctx, job), { status: "succeeded", outputs: [{ kind: "video",
    url: "https://example.test/output.mp4", mimeType: "video/mp4", expiresAt: "2027-01-01T00:00:00Z" }] });
  assert.deepEqual(JSON.parse(String(polling.calls[0]?.init.body)), { TaskId: "vod-task", SubAppId: 123456 });
  assert.equal((polling.calls[0]?.init.headers as Record<string, string>)["x-tc-action"], "DescribeTaskDetail");
});
test("Mingmou running, failed and response envelope errors redact credentials", async () => {
  const job = { providerJobId: "job", resume: { route: "vod", subAppId: "123" } };
  const extra = { secretKey: "secret-key-456", vodSubAppId: "123" };
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
  const extra = { secretKey: "key-1234", vodSubAppId: "123" };
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
    const t = context({}); t.ctx.extra = { secretKey: "key-1234", vodSubAppId: "1" };
    await assert.rejects(adapter.submit(t.ctx, { ...req, ...patch })); assert.equal(t.calls.length, 0);
  }
  const noSub = context({}); noSub.ctx.extra = { secretKey: "key-1234" };
  await assert.rejects(adapter.submit(noSub.ctx, req)); assert.equal(noSub.calls.length, 0);
});

test("VOD key validation redacts both credentials on failure", async () => {
  const { ctx } = context({
    Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "secret-id-123 secret-key-456" } },
  });
  ctx.extra = { secretKey: "secret-key-456" };
  await assert.rejects(adapter.validateKey(ctx), (error: Error) => {
    const normalized = adapter.normalizeError(error);
    return normalized.category === "auth"
      && normalized.code.startsWith(adapter.errorPrefix + "_")
      && !/secret-id-123|secret-key-456/.test(error.message)
      && !/secret-id-123|secret-key-456/.test(normalized.message);
  });
});
