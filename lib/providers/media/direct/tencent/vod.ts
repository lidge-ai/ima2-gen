import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaModelSpec, MediaSubmitRequest, MediaProviderError } from "../../contract.js";
import { categoryForStatus, contextSecrets, fail, mediaError, normalizeUnknownError, redactSecrets } from "../_l2/errors.js";
import { asArray, asRecord, asString, sendJson } from "../_l2/http.js";
import { urlOutput } from "../_l2/inputs.js";
import { assertKnownOptions, assertTask } from "../_l2/validate.js";
import { tc3Authorization } from "./tc3.js";

const PREFIX = "TENCENT_";
const BASE = "https://vod.intl.tencentcloudapi.com";
export const mingmou: MediaModelSpec = {
  id: "tencent/mingmou-1", upstreamId: "Mingmou", vendor: "tencent", label: "Mingmou 1.0",
  kind: "video", tasks: ["text-to-video"], params: {}, pricing: [
    { unit: "second", usd: 0.0462, variant: "720P", source: "https://www.tencentcloud.com/document/product/266/14666", checkedAt: "2026-11-26" },
    { unit: "second", usd: 0.0769, variant: "1080P", source: "https://www.tencentcloud.com/document/product/266/14666", checkedAt: "2026-11-26" },
    { unit: "second", usd: 0.1154, variant: "2K", source: "https://www.tencentcloud.com/document/product/266/14666", checkedAt: "2026-11-26" },
    { unit: "second", usd: 0.1723, variant: "4K", source: "https://www.tencentcloud.com/document/product/266/14666", checkedAt: "2026-11-26" },
  ],
  docsUrl: "https://www.tencentcloud.com/document/api/266/76684",
};
function secrets(ctx: MediaAdapterContext): string[] {
  return [...contextSecrets(ctx, ["secretId", "secretKey"]), ctx.apiKey, ctx.extra?.secretId ?? "", ctx.extra?.secretKey ?? ""].filter(Boolean);
}
function safe(ctx: MediaAdapterContext, message: string): string { return redactSecrets(message, secrets(ctx)); }
function credential(ctx: MediaAdapterContext) {
  const secretId = ctx.extra?.secretId;
  const secretKey = ctx.extra?.secretKey;
  if (!secretId || !secretKey) fail(PREFIX, "CREDENTIAL_MISSING", "auth", "Tencent VOD SecretId and SecretKey are required");
  return { secretId, secretKey };
}
function subApp(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(PREFIX, "INVALID_PARAM", "invalid-request", "A numeric VOD SubAppId is required");
  return Number(value);
}
function vendorError(ctx: MediaAdapterContext, code: string, message: string, status?: number): MediaProviderError {
  const category = /ContentModerationFailed|VoilationContent/i.test(code) ? "moderation" : /TaskTimeout/i.test(code) ? "timeout" : /ResourceInsufficient/i.test(code) ? "quota" : /^(AuthFailure|UnauthorizedOperation)/i.test(code) ? "auth" : /RequestLimitExceeded/i.test(code) ? "rate-limit" : /^(InvalidParameter|MissingParameter)/i.test(code) ? "invalid-request" : /^(ResourceNotFound)/i.test(code) ? "not-found" : /^(InternalError|FailedOperation)/i.test(code) ? "upstream" : status ? categoryForStatus(status) : "unknown";
  const reason = safe(ctx, code).replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase() || (status ? `HTTP_${status}` : "VOD_ERROR");
  return mediaError(PREFIX, reason, category, safe(ctx, message), { status });
}
function throwDetail(error: MediaProviderError): never {
  return fail(PREFIX, error.code.slice(PREFIX.length), error.category, error.message, { status: error.status, retryable: error.retryable });
}
async function vodCall(ctx: MediaAdapterContext, action: string, body: Record<string, unknown>, region?: string): Promise<Record<string, unknown>> {
  const creds = credential(ctx);
  const url = new URL(ctx.baseUrl ?? BASE);
  if (url.pathname !== "/" || url.search || url.hash) fail(PREFIX, "INVALID_PARAM", "invalid-request", "VOD base URL must be an origin");
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = tc3Authorization({ ...creds, host: url.host, service: "vod", timestamp, payload: JSON.stringify(body), contentType: "application/json" });
  try {
    const response = await sendJson(ctx, PREFIX, { url: url.origin + "/", method: "POST", headers: { authorization, "x-tc-action": action, "x-tc-version": "2018-07-17", "x-tc-timestamp": String(timestamp), ...(region ? { "x-tc-region": region } : {}) }, body });
    const envelope = asRecord(asRecord(response.body).Response);
    const error = asRecord(envelope.Error);
    if (!response.ok || Object.keys(error).length) throwDetail(vendorError(ctx, asString(error.Code) ?? "", asString(error.Message) ?? `HTTP ${response.status}`, response.ok ? undefined : response.status));
    if (!Object.keys(envelope).length) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing VOD response envelope");
    return envelope;
  } catch (error) {
    const detail = normalizeUnknownError(PREFIX, error);
    throwDetail({ ...detail, message: safe(ctx, detail.message) });
  }
}
function validateRequest(request: MediaSubmitRequest): void {
  assertTask(PREFIX, mingmou, request); assertKnownOptions(PREFIX, request.vendorOptions, []);
  if (!request.prompt?.trim() || request.inputs.length || request.durationSec !== undefined || request.resolution !== undefined || request.aspectRatio !== undefined || request.seed !== undefined || request.negativePrompt !== undefined || request.audio !== undefined || (request.count !== undefined && request.count !== 1)) fail(PREFIX, "INVALID_PARAM", "invalid-request", "Mingmou requires a text prompt; other parameters are not confirmed");
}
export async function submitVod(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  credential(ctx);
  validateRequest(request);
  const subAppId = subApp(ctx.extra?.vodSubAppId);
  const region = ctx.extra?.region;
  const data = await vodCall(ctx, "CreateAigcVideoTask", { SubAppId: subAppId, ModelName: "Mingmou", ModelVersion: "1.0", Prompt: request.prompt }, region);
  const id = asString(data.TaskId);
  if (!id) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing VOD task id");
  return { providerJobId: id, resume: { route: "vod", subAppId: String(subAppId), ...(region ? { region } : {}) } };
}
export async function pollVod(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const data = await vodCall(ctx, "DescribeTaskDetail", { TaskId: job.providerJobId, SubAppId: subApp(job.resume?.subAppId) }, job.resume?.region);
  const task = asRecord(data.AigcVideoTask);
  if (task.Status === "PROCESSING") return { status: "running" };
  if (task.Status !== "FINISH") fail(PREFIX, "BAD_RESPONSE", "upstream", "Unknown VOD task status");
  if (typeof task.ErrCode !== "number") fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing VOD task error code");
  const extended = asString(task.ErrCodeExt);
  if (extended === "OperationCanceled") return { status: "canceled" };
  if (task.ErrCode !== 0 || extended) return { status: "failed", error: vendorError(ctx, extended ?? "TASK_FAILED", asString(task.Message) ?? "VOD task failed") };
  const files = asArray(asRecord(task.Output).FileInfos).map(asRecord);
  const outputs = files.filter(file => asString(file.FileUrl)).map(file => urlOutput(asString(file.FileUrl)!, "video", asString(file.ExpireTime)));
  if (!outputs.length) fail(PREFIX, "BAD_RESPONSE", "upstream", "Missing VOD video URL");
  return { status: "succeeded", outputs };
}
