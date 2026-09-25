// Higgsfield adapter — unlocked for execution. Mappings verified against the
// authenticated 73-tool snapshot (tests/fixtures/mcp/higgsfield-tools.sanitized.json)
// and the models_explore fixture (tests/fixtures/mcp/higgsfield-models.sanitized.json).
//
// Key differences from Runway:
// - Poll tool is `job_status({ jobId })` (uuid), NOT `get_task`.
// - `job_status` supports `sync: true` (~25s server-side wait) to reduce churn.
// - `generate_video`/`generate_image` take `medias[].value` as media_id/job_id
//   via `media_upload` + `media_confirm` / `media_import_url`, never raw URLs,
//   and `medias[].role` names the provider-declared role (image|start_image|
//   end_image per models_explore — not the runway-style canonical names).
// - Status enum: pending|waiting|queued|in_progress|ip_detect|completed|failed|canceled|nsfw|ip_detected
// - Output URL lives at `generation.results.rawUrl`.
//
// Billing/purchase tools remain default-denied at this layer regardless.
import {
  collectResultText,
  extractHttpsUrls,
  type MediaJobRequest,
  type MediaProviderAdapter,
  type MediaTaskPoll,
  type ToolCallPlan,
} from "../providerAdapter.js";

/** Media-relevant generation tools confirmed in the 73-tool snapshot. */
export const HIGGSFIELD_MEDIA_TOOLS = [
  "generate_image",
  "generate_video",
  "generate_audio",
  "generate_3d",
  "reframe",
  "remove_background",
  "outpaint_image",
  "upscale_image",
  "upscale_video",
  "motion_control",
  "animation_actions",
] as const;

/** Money-mutating tools that must never be exposed through ima2 surfaces. */
export const HIGGSFIELD_BILLING_DENYLIST = [
  "confirm_billing_purchase",
  "cancel_trial_auto_renewal",
  "confirm_trial_cancel",
] as const;

/** Image models from the models_explore snapshot. */
export const HIGGSFIELD_IMAGE_MODELS = [
  "nano_banana_2",
  "nano_banana_pro",
  "soul_2",
  "soul_cinematic",
  "gpt_image_2",
  "cinematic_studio_2_5",
  "marketing_studio_image",
  "ms_image",
  "image_auto",
  "autosprite",
  "soul_cast",
  "soul_location",
] as const;

/** Video models from the models_explore snapshot. */
export const HIGGSFIELD_VIDEO_MODELS = [
  "cinematic_studio_3_0",
  "cinematic_studio_video",
  "cinematic_studio_video_v2",
  "marketing_studio_video",
  "clipify",
  "higgsfield_preset",
] as const;

const DEFAULT_MODEL = { image: "soul_2", video: "cinematic_studio_3_0" } as const;
const TASK_ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FORWARDED_PARAM_KEYS = new Set(["resolution", "quality", "count", "use_unlim"]);

function buildGenerateCall(request: MediaJobRequest): ToolCallPlan {
  const model = request.model ?? DEFAULT_MODEL[request.kind];
  // 260723: the web app sends `use_unlim: true` on every generation (captured
  // via CDP from POST fnf-api-gw.higgsfield.ai/fnf/jobs/*). Forward it by
  // default so unlimited-trial accounts take the unlimited path once the
  // provider-side MCP submit works; callers can override via parameters.
  const params: Record<string, unknown> = { model, use_unlim: true };
  if (request.prompt) params.prompt = request.prompt;
  if (request.ratio) params.aspect_ratio = request.ratio;
  // Duration only applies to video generation.
  if (request.kind === "video" && request.parameters?.duration !== undefined) {
    params.duration = request.parameters.duration;
  }
  // Provider-declared scalar knobs (models catalog): resolution (nano_banana),
  // quality (soul), count. Only whitelisted keys are forwarded.
  for (const [key, value] of Object.entries(request.parameters ?? {})) {
    if (FORWARDED_PARAM_KEYS.has(key)) params[key] = value;
  }
  // medias[].value must be a provider media_id (local uploads go through
  // media_upload + media_confirm; https inputs through media_import_url).
  // medias[].role must be a provider-declared role name — start_image /
  // end_image / image. Every media slot in models_explore is type:"image";
  // no higgsfield model declares a video-input role.
  const medias: Array<{ value: string; role: string }> = [];
  if (request.startFrameUrl) {
    medias.push({ value: request.startFrameUrl, role: "start_image" });
  }
  if (request.endFrameUrl) {
    if (!request.startFrameUrl) throw new Error(`MCP_END_FRAME_REQUIRES_START:${model}`);
    medias.push({ value: request.endFrameUrl, role: "end_image" });
  }
  for (const ref of request.referenceImages ?? []) {
    medias.push({ value: ref.url, role: "image" });
  }
  if (request.referenceVideoUrl) {
    // Undeclared roles would either be dropped silently or fail the whole job
    // provider-side; forward a video role once models_explore declares one.
    throw new Error(`MCP_INPUT_ROLE_UNSUPPORTED:${model}:video_references`);
  }
  if (medias.length > 0) params.medias = medias;

  const toolName = request.kind === "image" ? "generate_image" : "generate_video";
  return { toolName, args: { params } };
}

function parseTaskId(result: Record<string, unknown>): string | null {
  // Primary path: structuredContent.results[0].id
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  const results = structured?.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as Record<string, unknown>;
    if (typeof first?.id === "string" && first.id) return first.id;
  }
  // Fallback: generation.id (some responses wrap in generation)
  const generation = structured?.generation as Record<string, unknown> | undefined;
  if (typeof generation?.id === "string" && generation.id) return generation.id;
  // Last resort: regex scan the text content for a UUID
  const match = collectResultText(result).match(TASK_ID_PATTERN);
  return match ? match[0] : null;
}

function buildPollCall(taskId: string): ToolCallPlan {
  return { toolName: "job_status", args: { jobId: taskId, sync: true } };
}

/** Map Higgsfield status enum to the normalized MediaTaskStatus. */
function normalizeStatus(raw: string): MediaTaskPoll["status"] {
  switch (raw) {
    case "completed": return "succeeded";
    case "failed": case "nsfw": case "ip_detected": return "failed";
    case "canceled": return "canceled";
    case "in_progress": case "ip_detect": return "running";
    case "pending": case "waiting": case "queued": return "pending";
    default: return "unknown";
  }
}

function parsePoll(result: Record<string, unknown>): MediaTaskPoll {
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  const generation = structured?.generation as Record<string, unknown> | undefined;
  const rawStatus = typeof generation?.status === "string" ? generation.status : "";
  const status = normalizeStatus(rawStatus);

  // Output URL: generation.results.rawUrl
  const outputUrls: string[] = [];
  const genResults = generation?.results as Record<string, unknown> | undefined;
  if (typeof genResults?.rawUrl === "string" && genResults.rawUrl) {
    outputUrls.push(genResults.rawUrl);
  }
  // Fallback: scan text for HTTPS media URLs
  if (outputUrls.length === 0 && status === "succeeded") {
    const text = collectResultText(result);
    for (const url of extractHttpsUrls(text)) {
      if (/\.(png|jpe?g|webp|mp4|mov|webm)(\?|$)/i.test(url) || /higgsfield|fnf/i.test(url)) {
        outputUrls.push(url);
      }
    }
  }

  const detail = status === "failed"
    ? (typeof structured?.error === "string" ? structured.error.slice(0, 300) : collectResultText(result).slice(0, 300))
    : undefined;

  return { status, outputUrls, ...(detail ? { detail } : {}) };
}

export const higgsfieldAdapter: MediaProviderAdapter = {
  provider: "higgsfield",
  models: { image: [...HIGGSFIELD_IMAGE_MODELS], video: [...HIGGSFIELD_VIDEO_MODELS] },
  executable: true,
  buildGenerateCall,
  parseTaskId,
  buildPollCall,
  parsePoll,
};
