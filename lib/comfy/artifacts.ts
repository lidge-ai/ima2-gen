// lib/comfy/artifacts.ts — reading what a ComfyUI job produced.
//
// Errors, /history parsing, /view URLs and the bounded download, shared by the
// run loop in lib/comfyImageAdapter.ts. Protocol facts were verified against a
// live ComfyUI 0.27.0 on 2026-08-23 (devlog/_fin/260823_comfy_provider_lane).
import { basename } from "node:path";
import type { ComfyMediaKind } from "../comfyWorkflowStore.js";
import { detectImageMimeFromB64, detectVideoMimeFromB64 } from "../refs.js";
import type { ComfyTarget } from "./access.js";
import { comfyFetch } from "./client.js";

export const COMFY_ERR = {
  WORKFLOW_NOT_FOUND: "COMFY_WORKFLOW_NOT_FOUND",
  WORKFLOW_BIND_INVALID: "COMFY_WORKFLOW_BIND_INVALID",
  OFFLINE: "COMFY_OFFLINE",
  SUBMIT_REJECTED: "COMFY_SUBMIT_REJECTED",
  EXECUTION_FAILED: "COMFY_EXECUTION_FAILED",
  NO_IMAGE: "COMFY_NO_IMAGE",
  DOWNLOAD_FAILED: "COMFY_DOWNLOAD_FAILED",
  TIMEOUT: "COMFY_TIMEOUT",
  IMAGE_INVALID: "COMFY_IMAGE_INVALID",
  NO_VIDEO: "COMFY_NO_VIDEO",
  VIDEO_INVALID: "COMFY_VIDEO_INVALID",
  VIDEO_FORMAT_UNSUPPORTED: "COMFY_VIDEO_FORMAT_UNSUPPORTED",
  ORIGIN_NOT_ALLOWED: "COMFY_ORIGIN_NOT_ALLOWED",
  OUTPUT_INVALID: "COMFY_OUTPUT_INVALID",
  INPUT_INVALID: "COMFY_INPUT_INVALID",
  OPTION_INVALID: "COMFY_OPTION_INVALID",
  PAID_NODES: "COMFY_PAID_NODES",
} as const;

export const CANCELED_CODE = "GENERATION_CANCELED";

/**
 * Polls a completed-but-empty history entry a few more times.
 *
 * ComfyUI can report a run complete a beat before its outputs are readable, and
 * video files are the ones large enough to lose that race.
 */
export const MAX_EMPTY_OUTPUT_RETRIES = 5;

export function comfyError(code: string, message: string, status = 502): Error {
  const err = new Error(message) as Error & { code?: string; status?: number; isOperational?: boolean };
  err.code = code;
  err.status = status;
  err.isOperational = true;
  return err;
}

export function canceled(): Error {
  return comfyError(CANCELED_CODE, "Generation canceled", 499);
}

/** Folder classes /view accepts. Anything else is a path-traversal attempt. */
const VIEW_TYPES = new Set(["output", "input", "temp"]);

/** ComfyUI JSON bodies; `/history` is keyed by prompt id, so other keys stay unknown. */
export interface ComfyJson {
  system?: { comfyui_version?: unknown };
  queue_running?: unknown;
  queue_pending?: unknown;
  error?: { message?: string };
  prompt_id?: unknown;
  raw?: string;
  [key: string]: unknown;
}

export async function readJson(res: Response): Promise<ComfyJson> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw canceled();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(canceled());
    }, { once: true });
  });
}

/**
 * Builds a /view URL from values ComfyUI reported.
 *
 * filename/subfolder/type come out of a /history response, and a custom
 * SaveImage node decides what goes there — so all three are bounded before they
 * reach a URL rather than trusted because they came from "our" server.
 */
export function buildViewUrl(origin: string, image: { filename?: unknown; subfolder?: unknown; type?: unknown }): string {
  const rawType = typeof image.type === "string" ? image.type : "output";
  const type = VIEW_TYPES.has(rawType) ? rawType : "output";
  const subfolder = typeof image.subfolder === "string" ? image.subfolder : "";
  if (subfolder.includes("..") || subfolder.startsWith("/") || /^[a-z]:/i.test(subfolder)) {
    throw comfyError(COMFY_ERR.IMAGE_INVALID, "ComfyUI returned an unsafe output subfolder.");
  }
  const filename = basename(typeof image.filename === "string" ? image.filename : "");
  if (!filename) {
    throw comfyError(COMFY_ERR.NO_IMAGE, "ComfyUI output entry has no filename.");
  }
  const query = new URLSearchParams({ filename, subfolder, type });
  return `${origin}/view?${query.toString()}`;
}

export interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, {
    images?: Array<Record<string, unknown>>;
    /** VideoHelperSuite's output key. Not a ComfyUI core contract. */
    gifs?: Array<Record<string, unknown>>;
    /** Read for forward/custom-node compatibility; core does not emit it. */
    videos?: Array<Record<string, unknown>>;
    /** PreviewVideo sets this; it is what separates a clip from a still. */
    animated?: unknown;
  }>;
}

export function collectImages(entry: HistoryEntry, outputNode: string): Array<Record<string, unknown>> {
  const outputs = entry.outputs ?? {};
  const bound = outputs[outputNode]?.images;
  if (Array.isArray(bound) && bound.length > 0) return bound;
  // The user may have swapped SaveImage for another image-returning node since
  // registration; take whatever produced images rather than failing on a
  // binding that is merely out of date.
  for (const value of Object.values(outputs)) {
    if (Array.isArray(value?.images) && value.images.length > 0) return value.images;
  }
  return [];
}

/**
 * Collects video descriptors from a history entry.
 *
 * ComfyUI core does not have a "videos" output key. SaveVideo and SaveWEBM both
 * return `ui.PreviewVideo`, which serializes as
 * `{"images": [...], "animated": (True,)}` (verified 2026-08-25 against
 * comfy_api/latest/_ui.py:432-437 and comfy_extras/nodes_video.py:73,202). So a
 * saved video arrives under the SAME key an image does, and the `animated` flag
 * is what tells them apart.
 *
 * `gifs` is VideoHelperSuite's key and `videos` is read only for forward and
 * custom-node compatibility; neither is a core contract.
 *
 * The bound node is authoritative. The any-node fallback that the image path
 * uses is deliberately stricter here: it accepts an entry only when something
 * marks it as moving footage, because a graph carrying a PreviewImage alongside
 * its SaveVideo would otherwise hand back a still frame that then dies as an
 * invalid video.
 */
export function collectVideos(entry: HistoryEntry, outputNode: string): Array<Record<string, unknown>> {
  const outputs = entry.outputs ?? {};
  const bound = outputs[outputNode];
  if (bound) {
    for (const key of ["images", "gifs", "videos"] as const) {
      const list = bound[key];
      if (Array.isArray(list) && list.length > 0) return list;
    }
  }
  for (const value of Object.values(outputs)) {
    if (!value) continue;
    for (const key of ["gifs", "videos"] as const) {
      const list = value[key];
      if (Array.isArray(list) && list.length > 0) return list;
    }
    // Plain `images` from an unbound node only counts when the node itself said
    // the payload is animated.
    if (value.animated && Array.isArray(value.images) && value.images.length > 0) {
      return value.images;
    }
  }
  return [];
}

export async function downloadArtifact(
  target: ComfyTarget,
  url: string,
  maxBytes: number,
  kind: ComfyMediaKind,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ b64: string; mime: string }> {
  let res: Response;
  try {
    // The URL was built from this target's origin; only its path travels, so the token cannot follow it elsewhere.
    res = await comfyFetch(target, fetchImpl, url.slice(target.origin.length), { ...(signal ? { signal } : {}) });
  } catch (error: unknown) {
    if (signal?.aborted) throw canceled();
    throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, `Could not download the ComfyUI output: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!res.ok) {
    throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, `ComfyUI returned HTTP ${res.status} for the generated ${kind}.`);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "ComfyUI output exceeds the download limit.");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "ComfyUI output exceeds the download limit.");
  }
  const b64 = buffer.toString("base64");
  // Trust the bytes, not the Content-Type: an HTML error page saved as .png is
  // the failure this guards against.
  if (kind === "video") {
    const detected = detectVideoMimeFromB64(b64);
    if (!detected) {
      throw comfyError(COMFY_ERR.VIDEO_INVALID, "ComfyUI returned something that is not a video.");
    }
    // Naming the container we did get beats a generic refusal: every downstream
    // consumer here is anchored to .mp4 (routes/video.ts mints the filename,
    // videoContinuity rejects other extensions, frame extraction assumes it), so
    // storing WebM under an .mp4 name would misdeclare it to all of them.
    if (detected !== "video/mp4" && detected !== "video/quicktime") {
      throw comfyError(
        COMFY_ERR.VIDEO_FORMAT_UNSUPPORTED,
        `ComfyUI returned ${detected}; ima2 stores MP4 only. Set the SaveVideo format to mp4.`,
        400,
      );
    }
    return { b64, mime: detected };
  }
  const mime = detectImageMimeFromB64(b64);
  if (!mime) {
    throw comfyError(COMFY_ERR.IMAGE_INVALID, "ComfyUI returned something that is not an image.");
  }
  return { b64, mime };
}
