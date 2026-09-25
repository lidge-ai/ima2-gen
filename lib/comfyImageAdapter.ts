// lib/comfyImageAdapter.ts — the comfy lane's runtime.
//
// Submits a bound graph to a user-run ComfyUI, waits for it, and brings the
// image back: POST /prompt -> GET /history/{id} -> GET /view. No OpenAI-style
// /v1 shim and no supervised child process; ComfyUI speaks its own protocol and
// the user already runs it.
//
// Protocol facts here were verified against a live ComfyUI 0.27.0 on
// 2026-08-23; see devlog/_plan/260823_comfy_provider_lane/001_live_probe_evidence.md.
import { basename } from "node:path";
import { uploadBufferToComfy } from "./comfyBridge.js";
import { bindGraph } from "./comfyGraphBind.js";
import { getWorkflow, type ComfyGraph, type ComfyMediaKind, type ComfyWorkflowRecord } from "./comfyWorkflowStore.js";
import { detectImageMimeFromB64, detectVideoMimeFromB64 } from "./refs.js";
import { logEvent } from "./logger.js";
import type { RuntimeContext } from "./runtimeContext.js";

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
} as const;

const CANCELED_CODE = "GENERATION_CANCELED";

/**
 * Polls a completed-but-empty history entry a few more times.
 *
 * ComfyUI can report a run complete a beat before its outputs are readable, and
 * video files are the ones large enough to lose that race.
 */
const MAX_EMPTY_OUTPUT_RETRIES = 5;

export function comfyError(code: string, message: string, status = 502): Error {
  const err = new Error(message) as Error & { code?: string; status?: number; isOperational?: boolean };
  err.code = code;
  err.status = status;
  err.isOperational = true;
  return err;
}

function canceled(): Error {
  return comfyError(CANCELED_CODE, "Generation canceled", 499);
}

/** ComfyUI accepts a client-chosen prompt_id only when it is a canonical UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Folder classes /view accepts. Anything else is a path-traversal attempt. */
const VIEW_TYPES = new Set(["output", "input", "temp"]);

export interface ComfyImageRef {
  b64: string;
  declaredMime?: string | null | undefined;
  detectedMime?: string | null | undefined;
}

export interface ComfyQueueInfo {
  running: boolean;
  /** 0 when running or first in line; otherwise how many jobs are ahead. */
  position: number;
}

export interface ComfyGenerateOptions {
  /** Workflow id. This is what "model" means in the comfy lane. */
  model?: string | undefined;
  size?: string | undefined;
  seed?: number | undefined;
  negativePrompt?: string | undefined;
  params?: Record<string, number | string | boolean> | undefined;
  references?: readonly ComfyImageRef[] | undefined;
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  onQueue?: ((info: ComfyQueueInfo) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ComfyVideoGenerateOptions extends ComfyGenerateOptions {
  /** Frame count. H3 wants the 17n+5 grid at 24fps. */
  length?: number | undefined;
  fps?: number | undefined;
}

export interface ComfyImageResult {
  b64: string;
  revisedPrompt?: string | null | undefined;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string | undefined;
  providerUrl?: string | null | undefined;
  /** Workflow id actually executed. */
  effectiveModel: string;
  /** Instance-local: meaningless outside the origin that issued it. */
  promptId: string;
  origin: string;
}

export interface ComfyHealth {
  ok: boolean;
  version?: string | undefined;
  queueRemaining?: number | undefined;
  reason?: string | undefined;
}

function parseSize(size: string | undefined): { width?: number; height?: number } {
  const match = typeof size === "string" ? size.match(/^(\d+)x(\d+)$/) : null;
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** ComfyUI JSON bodies; `/history` is keyed by prompt id, so other keys stay unknown. */
interface ComfyJson {
  system?: { comfyui_version?: unknown };
  queue_running?: unknown;
  queue_pending?: unknown;
  error?: { message?: string };
  prompt_id?: unknown;
  raw?: string;
  [key: string]: unknown;
}

async function readJson(res: Response): Promise<ComfyJson> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

/**
 * Cancels a job without trusting either endpoint's status code.
 *
 * Verified live: POST /queue {delete} returns 200 for a RUNNING job and does
 * nothing — it only touches the pending heap — while /interrupt stops it. Both
 * are idempotent and harmless on a miss, so both are fired in order rather than
 * reading /queue first: a read-then-act sequence races the job into running
 * between the two calls.
 */
export async function cancelComfyJob(
  origin: string,
  promptId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const post = async (path: string, body: unknown) => {
    try {
      await fetchImpl(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // A cancel that cannot reach the instance is not worth surfacing: the
      // caller is already tearing the job down.
    }
  };
  await post("/queue", { delete: [promptId] });
  await post("/interrupt", { prompt_id: promptId });
}

/**
 * Probes each distinct origin in parallel with a short timeout.
 *
 * Sequential probing would make a settings surface listing workflows across two
 * instances wait for the dead one before showing the live one.
 */
export async function probeComfyOrigins(
  origins: readonly string[],
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, ComfyHealth>> {
  const unique = [...new Set(origins)];
  const results = await Promise.all(unique.map(async (origin): Promise<[string, ComfyHealth]> => {
    try {
      const res = await fetchImpl(`${origin}/system_stats`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [origin, { ok: false, reason: `HTTP ${res.status}` }];
      const json = await readJson(res);
      const health: ComfyHealth = { ok: true };
      const version = json?.system?.comfyui_version;
      if (typeof version === "string") health.version = version;
      return [origin, health];
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unreachable";
      return [origin, { ok: false, reason }];
    }
  }));
  return new Map(results);
}

interface HistoryEntry {
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

/** Locates a prompt in the queue so a caller can report real waiting. */
async function queuePosition(
  origin: string,
  promptId: string,
  fetchImpl: typeof fetch,
): Promise<ComfyQueueInfo | null> {
  let json: ComfyJson;
  try {
    const res = await fetchImpl(`${origin}/queue`);
    json = await readJson(res);
  } catch {
    return null;
  }
  const idOf = (entry: unknown): string | null => Array.isArray(entry) && typeof entry[1] === "string" ? entry[1] : null;
  const running: unknown[] = Array.isArray(json?.queue_running) ? json.queue_running : [];
  if (running.some((entry) => idOf(entry) === promptId)) return { running: true, position: 0 };
  const pending: unknown[] = Array.isArray(json?.queue_pending) ? json.queue_pending : [];
  const index = pending.findIndex((entry) => idOf(entry) === promptId);
  if (index >= 0) return { running: false, position: index + 1 };
  return null;
}

function collectImages(entry: HistoryEntry, outputNode: string): Array<Record<string, unknown>> {
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
function collectVideos(entry: HistoryEntry, outputNode: string): Array<Record<string, unknown>> {
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

async function downloadArtifact(
  url: string,
  maxBytes: number,
  kind: ComfyMediaKind,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ b64: string; mime: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...(signal ? { signal } : {}) });
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

async function stageReference(
  origin: string,
  reference: ComfyImageRef,
  uploadTimeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const buffer = Buffer.from(reference.b64, "base64");
  return uploadBufferToComfy(origin, buffer, "ima2_ref", uploadTimeoutMs, fetchImpl);
}

/**
 * Runs one generation on the workflow named by `options.model`.
 *
 * Reads the workflow from the store rather than from ctx.comfyWorkflows: the
 * context projection exists for the synchronous adapter contract and may lag a
 * write by one tick, and a generation must never run a stale graph.
 */
export async function generateViaComfy(
  prompt: string,
  ctx: RuntimeContext,
  options: ComfyGenerateOptions = {},
): Promise<ComfyImageResult> {
  return runComfyWorkflow(prompt, ctx, options, "image");
}

/**
 * Runs one video generation on the workflow named by `options.model`.
 *
 * Shares every step with the image path — submit, queue reporting, polling,
 * cancellation, download limits — and differs only in which history key it
 * reads and which magic bytes it accepts. Splitting the whole runtime would
 * have duplicated the cancel discipline, which is the part most expensive to
 * get wrong.
 */
export async function generateVideoViaComfy(
  prompt: string,
  ctx: RuntimeContext,
  options: ComfyVideoGenerateOptions = {},
): Promise<ComfyImageResult> {
  return runComfyWorkflow(prompt, ctx, options, "video");
}

async function runComfyWorkflow(
  prompt: string,
  ctx: RuntimeContext,
  options: ComfyVideoGenerateOptions,
  mediaKind: ComfyMediaKind,
): Promise<ComfyImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workflowId = options.model;
  if (!workflowId) {
    throw comfyError(COMFY_ERR.WORKFLOW_NOT_FOUND, "provider 'comfy' requires a workflow id as the model.", 400);
  }
  const workflow: ComfyWorkflowRecord | null = await getWorkflow(workflowId);
  if (!workflow) {
    throw comfyError(COMFY_ERR.WORKFLOW_NOT_FOUND, `ComfyUI workflow '${workflowId}' is not registered.`, 404);
  }
  const { origin } = workflow;
  const cfg = ctx.config.comfy;

  let refImageName: string | undefined;
  const reference = options.references?.find((entry) => entry.b64);
  if (reference) {
    refImageName = await stageReference(origin, reference, cfg.uploadTimeoutMs, fetchImpl);
  }

  const { width, height } = parseSize(options.size);
  const graph: ComfyGraph = bindGraph(workflow.graph, workflow.bind, {
    prompt,
    negativePrompt: options.negativePrompt,
    width,
    height,
    seed: options.seed,
    length: options.length,
    fps: options.fps,
    refImageName,
    params: options.params,
  }, workflow.params);

  const requestId = options.requestId;
  const body: Record<string, unknown> = { prompt: graph, client_id: "ima2" };
  // Verified live: a canonical UUID is accepted and echoed back; anything else
  // is a 400 invalid_prompt_id. Reusing ima2's requestId when it already has
  // that shape keeps the two systems' ids aligned for free, and taking the
  // server's id otherwise avoids reshaping requestId across inflight, SSE and
  // idempotency for cosmetic gain.
  if (requestId && UUID_RE.test(requestId)) body.prompt_id = requestId;

  logEvent("comfy", "generate:start", { requestId, workflow: workflowId, origin, refs: reference ? 1 : 0 });

  let submitJson: ComfyJson;
  try {
    const res = await fetchImpl(`${origin}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    submitJson = await readJson(res);
    if (!res.ok) {
      const detail = submitJson?.error?.message ?? `HTTP ${res.status}`;
      throw comfyError(COMFY_ERR.SUBMIT_REJECTED, `ComfyUI rejected the workflow: ${detail}`, res.status === 400 ? 400 : 502);
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code) throw error;
    if (options.signal?.aborted) throw canceled();
    throw comfyError(COMFY_ERR.OFFLINE, `Could not reach ComfyUI at ${origin}: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  // A 200 can still carry per-node validation failures.
  const nodeErrors = submitJson?.node_errors;
  if (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
    throw comfyError(COMFY_ERR.SUBMIT_REJECTED, `ComfyUI rejected nodes: ${Object.keys(nodeErrors).join(", ")}`, 400);
  }
  const promptId = typeof submitJson?.prompt_id === "string" ? submitJson.prompt_id : null;
  if (!promptId) {
    throw comfyError(COMFY_ERR.SUBMIT_REJECTED, "ComfyUI did not return a prompt_id.");
  }

  const deadline = Date.now() + cfg.generationTimeoutMs;
  let missing = 0;
  let emptyOutputRetries = 0;
  let lastQueue: string | null = null;

  for (;;) {
    if (options.signal?.aborted) {
      await cancelComfyJob(origin, promptId, fetchImpl);
      throw canceled();
    }
    if (Date.now() > deadline) {
      await cancelComfyJob(origin, promptId, fetchImpl);
      throw comfyError(COMFY_ERR.TIMEOUT, `ComfyUI did not finish within ${Math.round(cfg.generationTimeoutMs / 1000)}s.`, 504);
    }

    let history: ComfyJson;
    try {
      const res = await fetchImpl(`${origin}/history/${encodeURIComponent(promptId)}`);
      history = await readJson(res);
    } catch (error: unknown) {
      throw comfyError(COMFY_ERR.OFFLINE, `Lost contact with ComfyUI at ${origin}: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const entry = history?.[promptId] as HistoryEntry | undefined;
    if (entry) {
      // An interrupted run also lands in history, with completed:false — so
      // presence alone would report a canceled generation as a success.
      if (entry.status?.completed !== true) {
        const messages = Array.isArray(entry.status?.messages) ? entry.status!.messages : [];
        const tail = JSON.stringify(messages.slice(-1)).slice(0, 300);
        throw comfyError(COMFY_ERR.EXECUTION_FAILED, `ComfyUI reported '${entry.status?.status_str ?? "unknown"}': ${tail}`);
      }
      const outputs = mediaKind === "video"
        ? collectVideos(entry, workflow.bind.output.node)
        : collectImages(entry, workflow.bind.output.node);
      const first = outputs[0];
      if (!first) {
        if (mediaKind === "video") {
          // A completed run whose outputs are still empty is the documented
          // history-persistence race, not a failure. It is answered by retrying
          // the poll, NOT by loosening `missing`: that counter also detects a
          // job vanishing from queue and history, and raising it would blunt
          // both. Scoped to video so the image path keeps failing fast.
          if (emptyOutputRetries < MAX_EMPTY_OUTPUT_RETRIES) {
            emptyOutputRetries += 1;
            logEvent("comfy", "video:outputs-empty-retry", { requestId, promptId, attempt: emptyOutputRetries });
            await sleep(cfg.pollIntervalMs);
            continue;
          }
          throw comfyError(COMFY_ERR.NO_VIDEO, "The workflow finished but produced no video. Check that its output node saves a video.");
        }
        throw comfyError(COMFY_ERR.NO_IMAGE, "The workflow finished but produced no image. Check that its output node saves an image.");
      }
      const url = buildViewUrl(origin, first);
      const downloaded = await downloadArtifact(url, cfg.maxDownloadBytes, mediaKind, options.signal, fetchImpl);
      logEvent("comfy", "generate:done", { requestId, workflow: workflowId, origin, promptId });
      return {
        b64: downloaded.b64,
        revisedPrompt: null,
        usage: null,
        webSearchCalls: 0,
        mime: downloaded.mime,
        providerUrl: url,
        effectiveModel: workflowId,
        promptId,
        origin,
      };
    }

    // /history returns {} until a job finishes, so absence cannot tell running
    // apart from never-queued. Cross-check the queue: gone from both means the
    // job vanished (server restart, queue clear) and waiting out the full
    // timeout would be pointless.
    const queue = await queuePosition(origin, promptId, fetchImpl);
    if (queue) {
      missing = 0;
      const key = `${queue.running}:${queue.position}`;
      if (key !== lastQueue) {
        lastQueue = key;
        options.onQueue?.(queue);
      }
    } else {
      missing += 1;
      if (missing >= 3) {
        throw comfyError(COMFY_ERR.EXECUTION_FAILED, "The job disappeared from ComfyUI's queue and history without producing a result.");
      }
    }

    // Not sleep(ms, signal): an abort raised from inside the sleep would exit
    // the loop without telling ComfyUI to stop, leaving the GPU working on a
    // job nobody is waiting for. Sleep plainly, then let the check at the top
    // of the loop cancel upstream first.
    await sleep(cfg.pollIntervalMs);
  }
}
