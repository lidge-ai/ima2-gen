// Seedance video tasks on ModelArk: request body and task-state parsing.
// https://docs.byteplus.com/en/docs/ModelArk/create-video-generation-task-api (read 2026-11-26)
// https://docs.byteplus.com/en/docs/ModelArk/get-video-generation-task-api (read 2026-11-26)
import type { MediaInput, MediaJobState, MediaModelSpec, MediaOutput, MediaSubmitRequest } from "../../../contract.js";
import { fail, mediaError } from "../_l2/errors.js";
import { asRecord, asString } from "../_l2/http.js";
import { urlOrDataUri } from "../_l2/inputs.js";
import { assertKnownOptions, assertParams } from "../_l2/validate.js";
import { ERROR_PREFIX as P, arkError } from "./errors.js";
import { SEEDANCE_LIMITS, type SeedanceLimits } from "./models.js";

const OPTIONS = ["watermark", "output_format", "return_last_frame", "draft", "draft_task_id", "priority", "safety_identifier", "execution_expires_after"];
const URL_DAY_SECONDS = 86_400;

type Kind = "image" | "video" | "audio";
const ROLE: Readonly<Record<MediaInput["role"], { kind: Kind; wire: string } | undefined>> = {
  "first-frame": { kind: "image", wire: "first_frame" }, "last-frame": { kind: "image", wire: "last_frame" },
  "reference-image": { kind: "image", wire: "reference_image" }, "source-image": { kind: "image", wire: "reference_image" },
  "reference-video": { kind: "video", wire: "reference_video" }, "source-video": { kind: "video", wire: "reference_video" },
  "reference-audio": { kind: "audio", wire: "reference_audio" }, "source-audio": { kind: "audio", wire: "reference_audio" },
  mask: undefined,
};

/** Public URL, asset://<id> (digital character or authorized real person), or inline data for images and audio. */
export function wireUrl(input: MediaInput, allowInline: boolean): string {
  if (input.url) {
    if (/^(https?:\/\/|asset:\/\/)/.test(input.url) || (allowInline && input.url.startsWith("data:"))) return input.url;
    return fail(P, "INPUT_INVALID", "invalid-request", 'Input "' + input.role + '" must be an http(s) URL, an asset:// id' + (allowInline ? " or a data URI" : ""));
  }
  if (!allowInline) {
    return fail(P, "INPUT_URL_REQUIRED", "invalid-request", 'Input "' + input.role + '" must be a public URL or an asset:// id; ModelArk takes no inline video');
  }
  return urlOrDataUri(P, input);
}

function contentItem(input: MediaInput): Record<string, unknown> {
  const role = ROLE[input.role] ?? fail(P, "INPUT_INVALID", "invalid-request", 'Seedance takes no "' + input.role + '" input');
  const field = role.kind + "_url";
  return { type: field, [field]: { url: wireUrl(input, role.kind !== "video") }, role: role.wire };
}

function countRoles(inputs: readonly MediaInput[]): Record<"first" | "last" | Kind, number> {
  const n = { first: 0, last: 0, image: 0, video: 0, audio: 0 };
  for (const input of inputs) {
    if (input.role === "first-frame") n.first += 1;
    else if (input.role === "last-frame") n.last += 1;
    else { const role = ROLE[input.role]; if (role) n[role.kind] += 1; }
  }
  return n;
}

function checkInputs(model: MediaModelSpec, limits: SeedanceLimits, request: MediaSubmitRequest): void {
  const n = countRoles(request.inputs);
  const refs = n.image + n.video + n.audio;
  const frames = n.first + n.last;
  const bad = (msg: string): never => fail(P, "INPUT_INVALID", "invalid-request", msg);
  const missing = (msg: string): never => fail(P, "INPUT_MISSING", "invalid-request", msg);
  if (request.task === "text-to-video" && request.inputs.length > 0) bad("text-to-video takes no inputs");
  if (request.task === "image-to-video") {
    if (n.first === 0) missing("image-to-video needs a first-frame image");
    if (n.first > 1 || n.last > 1 || refs > 0) bad("image-to-video takes one first frame and at most one last frame");
  }
  if (request.task === "reference-to-video") {
    if (frames > 0) bad("first/last frames cannot be mixed with references; use image-to-video");
    if (refs === 0) missing("reference-to-video needs at least one reference");
    if (limits.family === "2.0" && n.image + n.video === 0) bad(model.label + " needs a reference image or video; audio alone is not accepted");
  }
  if ((request.task === "video-to-video" || request.task === "video-extend") && (n.video === 0 || frames > 0)) {
    missing(request.task + " needs a reference video and no first/last frames");
  }
  if (n.image > (model.params.maxReferenceImages ?? 0)) bad(model.label + " takes at most " + String(model.params.maxReferenceImages) + " reference images");
  if (n.video > (model.params.maxReferenceVideos ?? 0)) bad(model.label + " takes at most " + String(model.params.maxReferenceVideos) + " reference videos");
  if (n.audio > limits.maxReferenceAudios) bad(model.label + " takes at most " + String(limits.maxReferenceAudios) + " reference audio clips");
}

const TASK_TYPE: Partial<Record<MediaSubmitRequest["task"], string>> = {
  "reference-to-video": "reference", "video-to-video": "edit", "video-extend": "extend",
};

function invalid(message: string): never {
  return fail(P, "INVALID_PARAM", "invalid-request", message);
}

/** Seedance 2.5 keeps the source aspect ratio for edit, extend and frame-driven tasks, and edit keeps its duration. */
function timing(limits: SeedanceLimits, request: MediaSubmitRequest): { ratio?: string; duration?: number } {
  const fixedRatio = limits.family === "2.5" && ["image-to-video", "video-to-video", "video-extend"].includes(request.task);
  if (fixedRatio && request.aspectRatio !== undefined && request.aspectRatio !== "adaptive") {
    invalid("Seedance 2.5 keeps the source aspect ratio for " + request.task + "; aspectRatio must be adaptive");
  }
  const out: { ratio?: string; duration?: number } = {};
  if (fixedRatio) out.ratio = "adaptive";
  else if (request.aspectRatio !== undefined) out.ratio = request.aspectRatio;
  if (limits.family === "2.5" && request.task === "video-to-video") {
    if (request.durationSec !== undefined) invalid("Seedance 2.5 video editing keeps the source duration; omit durationSec");
    out.duration = -1;
  } else if (request.durationSec !== undefined) out.duration = request.durationSec;
  return out;
}

function checkOptions(model: MediaModelSpec, limits: SeedanceLimits, options: Record<string, unknown>): void {
  for (const key of ["watermark", "return_last_frame", "draft"]) {
    if (key in options && typeof options[key] !== "boolean") invalid(key + " must be a boolean");
  }
  const onlyFull25 = model.upstreamId === "dreamina-seedance-2-5-260628";
  if (("draft" in options || "draft_task_id" in options) && !onlyFull25) invalid("Draft mode is only offered on Seedance 2.5");
  if ("output_format" in options && (limits.family !== "2.5" || !["mp4", "mov"].includes(String(options.output_format)))) {
    invalid("output_format is mp4 or mov, on Seedance 2.5 models only");
  }
  const priority = options.priority;
  if (priority !== undefined && !(Number.isInteger(priority) && Number(priority) >= 0 && Number(priority) <= 9)) invalid("priority must be an integer 0-9");
  const expires = options.execution_expires_after;
  if (expires !== undefined && !(Number.isInteger(expires) && Number(expires) >= 3600 && Number(expires) <= 259_200)) {
    invalid("execution_expires_after must be an integer 3600-259200");
  }
  if ("draft_task_id" in options && typeof options.draft_task_id !== "string") invalid("draft_task_id must be a string");
}

export function buildVideoBody(model: MediaModelSpec, request: MediaSubmitRequest): Record<string, unknown> {
  const limits = SEEDANCE_LIMITS[model.upstreamId] ?? invalid("No Seedance limits for " + model.upstreamId);
  assertParams(P, model, request);
  if (request.count !== undefined && request.count !== 1) invalid("Seedance returns one video per task");
  checkInputs(model, limits, request);
  const options = assertKnownOptions(P, request.vendorOptions, OPTIONS);
  checkOptions(model, limits, options);
  const { draft_task_id: draftTaskId, ...wireOptions } = options;
  const content: Record<string, unknown>[] = [];
  if (request.prompt) content.push({ type: "text", text: request.prompt });
  content.push(...request.inputs.map(contentItem));
  if (typeof draftTaskId === "string") content.push({ type: "draft_task", draft_task: { id: draftTaskId } });
  const body: Record<string, unknown> = { model: model.upstreamId, content };
  if (request.resolution !== undefined) body.resolution = request.resolution;
  Object.assign(body, timing(limits, request));
  if (request.audio !== undefined) body.generate_audio = request.audio;
  body.watermark = false;
  Object.assign(body, wireOptions);
  const taskType = TASK_TYPE[request.task];
  if (limits.family === "2.5" && taskType) body.omni_reference_task_type = taskType;
  return body;
}

function expiry(task: Record<string, unknown>): string | undefined {
  const updated = Number(task.updated_at);
  return Number.isFinite(updated) && updated > 0 ? new Date((updated + URL_DAY_SECONDS) * 1000).toISOString() : undefined;
}

function succeeded(task: Record<string, unknown>): MediaJobState {
  const content = asRecord(task.content);
  const videoUrl = asString(content.video_url) ?? fail(P, "BAD_RESPONSE", "upstream", "Succeeded task has no video_url");
  const expiresAt = expiry(task);
  const video: MediaOutput = { kind: "video", url: videoUrl, mimeType: task.output_format === "mov" ? "video/quicktime" : "video/mp4" };
  if (expiresAt) video.expiresAt = expiresAt;
  const outputs: MediaOutput[] = [video];
  const lastFrame = asString(content.last_frame_url);
  if (lastFrame) {
    const frame: MediaOutput = { kind: "image", url: lastFrame, mimeType: "image/jpeg" };
    if (expiresAt) frame.expiresAt = expiresAt;
    outputs.push(frame);
  }
  const tokens = Number(asRecord(task.usage).completion_tokens);
  return Number.isFinite(tokens) && tokens > 0
    ? { status: "succeeded", outputs, billed: { units: tokens / 1000, unit: "1k-tokens" } }
    : { status: "succeeded", outputs };
}

export function videoTaskState(body: unknown): MediaJobState {
  const task = asRecord(body);
  const status = asString(task.status);
  if (status === "queued" || status === "running") return { status };
  if (status === "succeeded") return succeeded(task);
  if (status === "cancelled") return { status: "canceled" };
  if (status === "expired") {
    return { status: "failed", error: mediaError(P, "EXPIRED", "timeout", "Task expired before it finished (execution_expires_after)", { retryable: false, providerState: "expired" }) };
  }
  if (status === "failed") {
    const error = asRecord(task.error);
    return { status: "failed", error: arkError(asString(error.code), asString(error.message) ?? "Task failed") };
  }
  return fail(P, "BAD_RESPONSE", "upstream", "Unknown task status " + String(status));
}
