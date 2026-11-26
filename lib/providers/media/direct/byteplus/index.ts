// BytePlus ModelArk direct adapter: Seedance video (async tasks) and Seedream images (sync).
// Auth: Authorization: Bearer <ARK_API_KEY>.
// https://docs.byteplus.com/en/docs/ModelArk/base-url-and-authentication (read 2026-11-26)
import type {
  MediaAdapterContext,
  MediaJobRef,
  MediaJobState,
  MediaOutput,
  MediaProviderAdapter,
} from "../../contract.js";
import { MediaAdapterError, contextSecrets, fail, normalizeUnknownError } from "../_l2/errors.js";
import { asRecord, asString, joinUrl, sendJson, type JsonRequest, type JsonResponse } from "../_l2/http.js";
import { assertTask, findModel } from "../_l2/validate.js";
import { ERROR_PREFIX as P, arkError } from "./errors.js";
import { buildImageBody, imageOutputs } from "./image.js";
import { MODELS } from "./models.js";
import { buildVideoBody, videoTaskState } from "./video.js";

/** Data-plane base URL by region ("Base URL by region" on the model-list page). */
const REGION_BASE: Readonly<Record<string, string>> = {
  "ap-southeast-1": "https://ark.ap-southeast.bytepluses.com/api/v3",
  "eu-west-1": "https://ark.eu-west.bytepluses.com/api/v3",
};
const TASKS_PATH = "contents/generations/tasks";
const FIRST_POLL_MS = 10_000;

function baseUrl(ctx: MediaAdapterContext): string {
  if (ctx.baseUrl) return ctx.baseUrl.replace(/\/+$/, "");
  const region = ctx.extra?.region || "ap-southeast-1";
  return (
    REGION_BASE[region] ??
    fail(
      P,
      "INVALID_REGION",
      "invalid-request",
      'Unknown BytePlus region "' + region + '" (ap-southeast-1 or eu-west-1)',
    )
  );
}

function httpError(ctx: MediaAdapterContext, res: JsonResponse): MediaAdapterError {
  const error = asRecord(asRecord(res.body).error);
  const message = asString(error.message) ?? "HTTP " + String(res.status);
  return new MediaAdapterError(arkError(asString(error.code), message, res.status, contextSecrets(ctx)));
}

async function call(ctx: MediaAdapterContext, req: JsonRequest): Promise<JsonResponse> {
  const res = await sendJson(ctx, P, { ...req, headers: { authorization: "Bearer " + ctx.apiKey } });
  if (!res.ok) throw httpError(ctx, res);
  return res;
}

async function submitImage(
  ctx: MediaAdapterContext,
  base: string,
  body: Record<string, unknown>,
): Promise<MediaJobRef> {
  const res = await call(ctx, { method: "POST", url: joinUrl(base, "images/generations"), body });
  const outputs = imageOutputs(res.body, contextSecrets(ctx));
  const created = asString(asRecord(res.body).created) ?? String(Date.now());
  return {
    providerJobId: "seedream-" + created,
    pollAfterMs: 0,
    resume: { kind: "image", outputs: JSON.stringify(outputs) },
  };
}

function taskUrl(ctx: MediaAdapterContext, job: MediaJobRef): string {
  return joinUrl(job.resume?.baseUrl ?? baseUrl(ctx), TASKS_PATH + "/" + encodeURIComponent(job.providerJobId));
}

export const adapter: MediaProviderAdapter = {
  id: "byteplus",
  label: "BytePlus ModelArk",
  route: "direct",
  errorPrefix: P,
  credential: {
    keyVocabulary: "byteplus",
    envVars: ["ARK_API_KEY"],
    configKey: "byteplusApiKey",
    consoleUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    extraFields: [{ name: "region", envVar: "ARK_REGION", secret: false, required: false }],
  },
  // Images and audio may be inline data URIs; video must be a public URL or an asset:// id.
  inputTransport: "inline",
  listModels: () => MODELS,
  async validateKey(ctx) {
    // A one-row task list is a read, never a generation.
    const url = joinUrl(baseUrl(ctx), TASKS_PATH + "?page_num=1&page_size=1");
    const res = await sendJson(ctx, P, { url, headers: { authorization: "Bearer " + ctx.apiKey } });
    if (res.ok) return { ok: true };
    const error = httpError(ctx, res);
    if (error.detail.category === "auth") return { ok: false, reason: error.detail.message };
    throw error;
  },
  async submit(ctx, request) {
    const model = findModel(P, MODELS, request.model);
    assertTask(P, model, request);
    const base = baseUrl(ctx);
    if (model.kind === "image") return submitImage(ctx, base, buildImageBody(model, request));
    const res = await call(ctx, {
      method: "POST",
      url: joinUrl(base, TASKS_PATH),
      body: buildVideoBody(model, request),
    });
    const id = asString(asRecord(res.body).id) ?? fail(P, "BAD_RESPONSE", "upstream", "Task creation returned no id");
    return { providerJobId: id, pollAfterMs: FIRST_POLL_MS, resume: { kind: "video", baseUrl: base } };
  },
  async poll(ctx, job): Promise<MediaJobState> {
    if (job.resume?.kind === "image") {
      return { status: "succeeded", outputs: JSON.parse(job.resume.outputs ?? "[]") as MediaOutput[] };
    }
    const res = await call(ctx, { method: "GET", url: taskUrl(ctx, job) });
    return videoTaskState(res.body, contextSecrets(ctx));
  },
  async cancel(ctx, job) {
    if (job.resume?.kind === "image") return;
    // Only queued tasks can be cancelled; a running task answers with an error the runner reports.
    await call(ctx, { method: "DELETE", url: taskUrl(ctx, job) });
  },
  normalizeError: (error) => normalizeUnknownError(P, error),
};
