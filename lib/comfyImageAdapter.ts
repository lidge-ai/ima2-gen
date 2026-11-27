// lib/comfyImageAdapter.ts — the comfy lane's runtime.
//
// Submits a bound graph to a user-run ComfyUI, waits for it, and brings the
// image back: POST /prompt -> GET /history/{id} -> GET /view. No OpenAI-style
// /v1 shim and no supervised child process; ComfyUI speaks its own protocol and
// the user already runs it.
//
// Protocol facts here were verified against a live ComfyUI 0.27.0 on
// 2026-08-23; see devlog/_plan/260823_comfy_provider_lane/001_live_probe_evidence.md.
import { randomUUID } from "node:crypto";
import { uploadBufferToComfy } from "./comfyBridge.js";
import { bindGraph } from "./comfyGraphBind.js";
import { getWorkflow, type ComfyGraph, type ComfyMediaKind, type ComfyWorkflowRecord } from "./comfyWorkflowStore.js";
import { logEvent } from "./logger.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { ComfyAccess, type ComfyTarget } from "./comfy/access.js";
import {
  COMFY_ERR, MAX_EMPTY_OUTPUT_RETRIES, buildViewUrl, canceled, collectImages, collectVideos, comfyError,
  downloadArtifact, readJson, sleep, type ComfyJson, type HistoryEntry,
} from "./comfy/artifacts.js";
import {
  COMFY_UUID_RE, cancelComfyJob, comfyFetch, comfyQueuePosition, explainComfyExecution, explainComfyRejection,
  localTarget, redactForTarget, type ComfyRejection,
} from "./comfy/client.js";
import { openComfySocket, watchComfyProgress, type ComfyProgress, type ComfyProgressWatch, type OpenComfySocket } from "./comfy/progress.js";

export { COMFY_ERR, buildViewUrl, comfyError } from "./comfy/artifacts.js";
export { cancelComfyJob } from "./comfy/client.js";

export interface ComfyImageRef {
  b64: string;
  declaredMime?: string | null | undefined;
  detectedMime?: string | null | undefined;
}

export interface ComfyQueueInfo extends ComfyProgress {
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
  /** Live progress socket. Defaults to a real one unless fetchImpl is injected. */
  openSocket?: OpenComfySocket | undefined;
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

/**
 * Probes each distinct origin in parallel with a short timeout.
 *
 * Sequential probing would make a settings surface listing workflows across two
 * instances wait for the dead one before showing the live one.
 *
 * With an allow list, an origin that is neither loopback nor on it is reported
 * without a request being sent, and a saved token rides along for the rest.
 */
export async function probeComfyOrigins(
  origins: readonly string[],
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  access?: ComfyAccess,
): Promise<Map<string, ComfyHealth>> {
  const unique = [...new Set(origins)];
  const results = await Promise.all(unique.map(async (origin): Promise<[string, ComfyHealth]> => {
    const target = access ? access.tryTarget(origin) : localTarget(origin);
    if (!target) return [origin, { ok: false, reason: "not an allowed ComfyUI server" }];
    try {
      const res = await comfyFetch(target, fetchImpl, "/system_stats", {
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
      return [origin, { ok: false, reason: redactForTarget(target, reason) }];
    }
  }));
  return new Map(results);
}

async function stageReference(
  origin: ComfyTarget,
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

async function resolveTarget(ctx: RuntimeContext, origin: string): Promise<ComfyTarget> {
  const access = await ComfyAccess.load(ctx.config.storage.configFile);
  const target = access.tryTarget(origin);
  if (!target) {
    throw comfyError(
      COMFY_ERR.ORIGIN_NOT_ALLOWED,
      "ComfyUI server " + origin + " is not in the allowed servers. Add it in settings, or register the workflow again.",
      400,
    );
  }
  return target;
}

interface ComfyRun {
  target: ComfyTarget;
  fetchImpl: typeof fetch;
  workflow: ComfyWorkflowRecord;
  mediaKind: ComfyMediaKind;
  options: ComfyVideoGenerateOptions;
  cfg: RuntimeContext["config"]["comfy"];
}

/** POST /prompt. Returns the id ComfyUI queued the job under. */
async function submitPrompt(run: ComfyRun, body: Record<string, unknown>): Promise<string> {
  const { target, fetchImpl, options } = run;
  let submitJson: ComfyJson;
  try {
    const res = await comfyFetch(target, fetchImpl, "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    submitJson = await readJson(res);
    if (!res.ok) {
      const reasons = explainComfyRejection(submitJson as ComfyRejection);
      const detail = reasons.length > 0 ? reasons.join("; ") : "HTTP " + String(res.status);
      throw comfyError(
        COMFY_ERR.SUBMIT_REJECTED,
        redactForTarget(target, "ComfyUI rejected the workflow: " + detail),
        res.status === 400 ? 400 : 502,
      );
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code) throw error;
    if (options.signal?.aborted) throw canceled();
    throw comfyError(COMFY_ERR.OFFLINE, redactForTarget(target, "Could not reach ComfyUI at " + target.origin + ": " + (error instanceof Error ? error.message : "unknown error")));
  }
  // A 200 can still carry per-node validation failures.
  const nodeErrors = submitJson?.node_errors;
  if (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
    const reasons = explainComfyRejection({ node_errors: nodeErrors } as ComfyRejection);
    throw comfyError(COMFY_ERR.SUBMIT_REJECTED, redactForTarget(target, "ComfyUI rejected nodes: " + reasons.join("; ")), 400);
  }
  const promptId = typeof submitJson?.prompt_id === "string" ? submitJson.prompt_id : null;
  if (!promptId) {
    throw comfyError(COMFY_ERR.SUBMIT_REJECTED, "ComfyUI did not return a prompt_id.");
  }
  return promptId;
}

/** Reads a finished history entry into the downloaded artifact, or null while outputs have not landed. */
async function readFinished(run: ComfyRun, entry: HistoryEntry, promptId: string): Promise<ComfyImageResult | null> {
  const { target, fetchImpl, workflow, mediaKind, options } = run;
  // An interrupted run also lands in history, with completed:false — so
  // presence alone would report a canceled generation as a success.
  if (entry.status?.completed !== true) {
    const messages = Array.isArray(entry.status?.messages) ? entry.status.messages : [];
    const detail = explainComfyExecution(messages) || JSON.stringify(messages.slice(-1)).slice(0, 300);
    throw comfyError(
      COMFY_ERR.EXECUTION_FAILED,
      redactForTarget(target, "ComfyUI reported '" + (entry.status?.status_str ?? "unknown") + "': " + detail),
    );
  }
  const outputs = mediaKind === "video"
    ? collectVideos(entry, workflow.bind.output.node)
    : collectImages(entry, workflow.bind.output.node);
  const first = outputs[0];
  if (!first) return null;
  const url = buildViewUrl(target.origin, first);
  const downloaded = await downloadArtifact(target, url, run.cfg.maxDownloadBytes, mediaKind, options.signal, fetchImpl);
  logEvent("comfy", "generate:done", { requestId: options.requestId, workflow: workflow.id, origin: target.origin, promptId });
  return {
    b64: downloaded.b64,
    revisedPrompt: null,
    usage: null,
    webSearchCalls: 0,
    mime: downloaded.mime,
    providerUrl: url,
    effectiveModel: workflow.id,
    promptId,
    origin: target.origin,
  };
}

function noOutputError(mediaKind: ComfyMediaKind): Error {
  return mediaKind === "video"
    ? comfyError(COMFY_ERR.NO_VIDEO, "The workflow finished but produced no video. Check that its output node saves a video.")
    : comfyError(COMFY_ERR.NO_IMAGE, "The workflow finished but produced no image. Check that its output node saves an image.");
}

/** Polls history and the queue until the job ends, is canceled, or times out. */
async function awaitResult(run: ComfyRun, promptId: string): Promise<ComfyImageResult> {
  const { target, fetchImpl, mediaKind, options, cfg } = run;
  const requestId = options.requestId;
  const deadline = Date.now() + cfg.generationTimeoutMs;
  let missing = 0;
  let emptyOutputRetries = 0;
  let lastQueue: string | null = null;

  for (;;) {
    if (options.signal?.aborted) {
      await cancelComfyJob(target, promptId, fetchImpl);
      throw canceled();
    }
    if (Date.now() > deadline) {
      await cancelComfyJob(target, promptId, fetchImpl);
      throw comfyError(COMFY_ERR.TIMEOUT, "ComfyUI did not finish within " + String(Math.round(cfg.generationTimeoutMs / 1000)) + "s.", 504);
    }

    let history: ComfyJson;
    try {
      const res = await comfyFetch(target, fetchImpl, "/history/" + encodeURIComponent(promptId));
      history = await readJson(res);
    } catch (error: unknown) {
      throw comfyError(COMFY_ERR.OFFLINE, redactForTarget(target, "Lost contact with ComfyUI at " + target.origin + ": " + (error instanceof Error ? error.message : "unknown error")));
    }

    const entry = history?.[promptId] as HistoryEntry | undefined;
    if (entry) {
      const result = await readFinished(run, entry, promptId);
      if (result) return result;
      // A completed run whose outputs are still empty is the documented
      // history-persistence race, not a failure. It is answered by retrying
      // the poll, NOT by loosening the missing counter: that counter also
      // detects a job vanishing from queue and history, and raising it would
      // blunt both. Scoped to video so the image path keeps failing fast.
      if (mediaKind !== "video" || emptyOutputRetries >= MAX_EMPTY_OUTPUT_RETRIES) throw noOutputError(mediaKind);
      emptyOutputRetries += 1;
      logEvent("comfy", "video:outputs-empty-retry", { requestId, promptId, attempt: emptyOutputRetries });
      await sleep(cfg.pollIntervalMs);
      continue;
    }

    // /history returns {} until a job finishes, so absence cannot tell running
    // apart from never-queued. Cross-check the queue: gone from both means the
    // job vanished (server restart, queue clear) and waiting out the full
    // timeout would be pointless.
    const queue = await comfyQueuePosition(target, promptId, fetchImpl);
    if (queue) {
      missing = 0;
      const key = String(queue.running) + ":" + String(queue.position);
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

/**
 * Opens the progress socket for a job, when the caller left I/O to this module.
 *
 * A caller that injects its own fetch owns every byte of I/O, so no socket is
 * opened behind its back unless it also injects one. comfy.liveProgress=false
 * turns the socket off for a server whose proxy does not pass WebSockets.
 */
function progressSocket(options: ComfyVideoGenerateOptions, cfg: ComfyRun["cfg"]): OpenComfySocket | null {
  return options.openSocket ?? (options.fetchImpl || cfg.liveProgress === false ? null : openComfySocket);
}

function startProgress(run: ComfyRun, graph: ComfyGraph, clientId: string, promptId: string | null): ComfyProgressWatch | null {
  const { options } = run;
  const open = progressSocket(options, run.cfg);
  if (!open) return null;
  return watchComfyProgress(run.target, clientId, graph, promptId, (progress) => {
    options.onQueue?.({ running: true, position: 0, ...progress });
  }, open);
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
    throw comfyError(COMFY_ERR.WORKFLOW_NOT_FOUND, "ComfyUI workflow '" + workflowId + "' is not registered.", 404);
  }
  const cfg = ctx.config.comfy;
  // Resolved for every run, not at registration: a server the user has since
  // removed from the allow list must stop receiving jobs.
  const target = await resolveTarget(ctx, workflow.origin);
  const run: ComfyRun = { target, fetchImpl, workflow, mediaKind, options, cfg };

  let refImageName: string | undefined;
  const reference = options.references?.find((entry) => entry.b64);
  if (reference) {
    refImageName = await stageReference(target, reference, cfg.uploadTimeoutMs, fetchImpl);
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
  const live = progressSocket(options, cfg) !== null;
  // ComfyUI sends a job's node and step events only to the socket whose client
  // id submitted it, so a watched job gets an id of its own.
  const clientId = live ? "ima2-" + randomUUID() : "ima2";
  const body: Record<string, unknown> = { prompt: graph, client_id: clientId };
  // Verified live: a canonical UUID is accepted and echoed back; anything else
  // is a 400 invalid_prompt_id. Reusing ima2's requestId when it already has
  // that shape keeps the two systems' ids aligned for free. A watched job
  // always names its id, so events that arrive before /prompt answers are
  // already attributable.
  if (requestId && COMFY_UUID_RE.test(requestId)) body.prompt_id = requestId;
  else if (live) body.prompt_id = randomUUID();

  logEvent("comfy", "generate:start", { requestId, workflow: workflowId, origin: target.origin, refs: reference ? 1 : 0 });

  const watch = startProgress(run, graph, clientId, typeof body.prompt_id === "string" ? body.prompt_id : null);
  try {
    await watch?.ready;
    const promptId = await submitPrompt(run, body);
    watch?.setPromptId(promptId);
    return await awaitResult(run, promptId);
  } finally {
    watch?.close();
  }
}
