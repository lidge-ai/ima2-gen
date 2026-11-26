import { createHmac } from "node:crypto";
import type { MediaAdapterContext, MediaJobRef, MediaJobState } from "../../contract.js";
import {
  categoryForStatus,
  contextSecrets,
  fail,
  mediaError,
  redactSecrets,
  MediaAdapterError,
} from "../_l2/errors.js";
import { asArray, asRecord, asString, joinUrl, sendJson } from "../_l2/http.js";
import { urlOutput } from "../_l2/inputs.js";
const BASE = "https://api-singapore.klingai.com";
const IMAGE_PATH = "/v1/images/generations";
const VIDEO_PATH = "/v1/videos/text2video";
const IMAGE_TO_VIDEO = "/v1/videos/image2video";
const OMNI_VIDEO = "/v1/videos/omni-video";
const OMNI_IMAGE = "/v1/images/omni-image";
const LIP_SYNC = "/v1/videos/advanced-lip-sync";
function token(ctx: MediaAdapterContext, PREFIX: string, now = Date.now()): string {
  const secret = ctx.extra?.secretKey;
  if (!ctx.apiKey || !secret)
    fail(PREFIX, "CREDENTIAL_MISSING", "auth", "KLING_ACCESS_KEY and KLING_SECRET_KEY are required");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(now / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const claims = encode({ iss: ctx.apiKey, exp: seconds + 1800, nbf: seconds - 5 });
  const payload = `${header}.${claims}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function vendorCategory(code: string, status: number) {
  if (["1000", "1001", "1002", "1003", "1004", "1103"].includes(code)) return "auth" as const;
  if (["1101", "1102"].includes(code)) return "quota" as const;
  if (["1200", "1201"].includes(code)) return "invalid-request" as const;
  if (["1202", "1203"].includes(code)) return "not-found" as const;
  if (["1300", "1301"].includes(code)) return "moderation" as const;
  if (["1302", "1303"].includes(code)) return "rate-limit" as const;
  if (code === "1304") return "auth" as const;
  if (["5000", "5001"].includes(code)) return "upstream" as const;
  if (code === "5002") return "timeout" as const;
  return categoryForStatus(status);
}
export async function request(
  ctx: MediaAdapterContext,
  path: string,
  body: unknown,
  modern: boolean,
  PREFIX: string,
): Promise<Record<string, unknown>> {
  const authorization = modern ? ctx.apiKey : token(ctx, PREFIX);
  if (!authorization) fail(PREFIX, "CREDENTIAL_MISSING", "auth", "KLING_API_KEY is required");
  let response;
  try {
    response = await sendJson(ctx, PREFIX, {
      url: joinUrl(ctx.baseUrl ?? BASE, path),
      headers: { authorization: `Bearer ${authorization}` },
      ...(body === undefined ? {} : { body }),
    });
  } catch (error) {
    if (error instanceof MediaAdapterError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
    fail(PREFIX, "NETWORK", "upstream", "Provider request failed");
  }
  const envelope = asRecord(response.body);
  const code = asString(envelope.code);
  if (!response.ok || (code !== undefined && code !== "0")) {
    const status = response.status;
    const category = vendorCategory(code ?? "", status);
    const message = redactSecrets(
      asString(envelope.message) ?? `Provider returned HTTP ${status}`,
      contextSecrets(ctx, ["secretKey", "apiKey"]),
    );
    fail(
      PREFIX,
      code && code !== "0" ? `VENDOR_${code.replace(/[^a-zA-Z0-9]/g, "_")}` : `HTTP_${status}`,
      category,
      message,
      { status },
    );
  }
  return envelope;
}
function failedState(
  ctx: MediaAdapterContext,
  data: Record<string, unknown>,
  modern: boolean,
  PREFIX: string,
): MediaJobState {
  return {
    status: "failed",
    error: mediaError(
      PREFIX,
      "TASK_FAILED",
      "upstream",
      redactSecrets(
        asString(modern ? data.message : data.task_status_msg) ?? "Task failed",
        contextSecrets(ctx, ["secretKey", "apiKey"]),
      ),
      { retryable: false },
    ),
  };
}
export async function poll(
  ctx: MediaAdapterContext,
  job: MediaJobRef,
  PREFIX: string,
  modernAdapter: boolean,
): Promise<MediaJobState> {
  const path = job.resume?.path;
  const kind = job.resume?.kind;
  const modern = path === "/tasks" && job.resume?.auth === "apiKey";
  if (modern !== modernAdapter) fail(PREFIX, "INVALID_JOB", "invalid-request", "Invalid job authentication");
  if (!(
    (kind === "image" && (path === IMAGE_PATH || path === OMNI_IMAGE)) ||
    (kind === "video" &&
      (path === VIDEO_PATH || path === IMAGE_TO_VIDEO || path === OMNI_VIDEO || path === LIP_SYNC || modern))
  ))
    fail(PREFIX, "INVALID_JOB", "invalid-request", "Invalid job path");
  const envelope = await request(
    ctx,
    modern
      ? `/tasks?task_ids=${encodeURIComponent(job.providerJobId)}`
      : `${path}/${encodeURIComponent(job.providerJobId)}`,
    undefined,
    modern,
    PREFIX,
  );
  const data = modern
    ? asRecord(asArray(envelope.data).find((v) => asString(asRecord(v).id) === job.providerJobId))
    : asRecord(envelope.data);
  const state = asString(modern ? data.status : data.task_status);
  if (state === "submitted") return { status: "queued" };
  if (state === "processing") return { status: "running" };
  if (state === "failed") return failedState(ctx, data, modern, PREFIX);
  if (state !== (modern ? "succeeded" : "succeed"))
    fail(PREFIX, "BAD_RESPONSE", "upstream", "Unknown task status");
  const result = asRecord(data.task_result);
  const values = asArray(modern ? data.outputs : kind === "image" ? result.images : result.videos);
  const outputs = values
    .map(asRecord)
    .map((v) => asString(v.url))
    .filter((url): url is string => Boolean(url))
    .map((url) => urlOutput(url, kind));
  if (!outputs.length) fail(PREFIX, "BAD_RESPONSE", "upstream", "Task returned no output");
  return { status: "succeeded", outputs };
}
