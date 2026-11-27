/**
 * comfy-local: the user's own ComfyUI server as a media route.
 *
 * A registered workflow is a model (comfy/<workflow id>). There is no key and no
 * published price: the job runs on the user's hardware, so the estimate is the
 * time this machine took before. Which server a workflow runs on was fixed at
 * registration and is checked against the allow list again for every job
 * (lib/comfy/access.ts); a request cannot name another address.
 */
import { randomUUID } from "node:crypto";
import { config } from "../../../../config.js";
import { ComfyAccess, type ComfyTarget } from "../../../comfy/access.js";
import { COMFY_ERR, CANCELED_CODE, comfyError, readJson, type HistoryEntry } from "../../../comfy/artifacts.js";
import { cancelComfyJob, comfyFetch, comfyQueuePosition, explainComfyExecution } from "../../../comfy/client.js";
import { COMFY_MODEL_PREFIX, estimateLocalRun, listLocalSpecs, localWorkflow, recordLocalRun } from "../../../comfy/localCatalog.js";
import { collectOutputFiles, downloadOutputFile } from "../../../comfy/outputs.js";
import { watchComfyProgress, type ComfyProgress, type ComfyProgressWatch } from "../../../comfy/progress.js";
import { submitComfyPrompt, uploadComfyInput } from "../../../comfy/submit.js";
import { bindGraph } from "../../../comfyGraphBind.js";
import { mediaSlots, type ComfyGraph, type ComfyMediaSlot, type ComfyWorkflowRecord } from "../../../comfyWorkflowStore.js";
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaOutput, MediaProviderAdapter, MediaProviderError, MediaSubmitRequest,
} from "../contract.js";
import { extFromMime } from "../mime.js";

const MAX_OUTPUT_FILES = 8;
const MAX_EMPTY_POLLS = 5;
const MAX_MISSING_POLLS = 3;

/** What poll() needs between calls. Lost on a restart, which costs the percentage and nothing else. */
interface LiveJob {
  startedAt: number;
  missing: number;
  empty: number;
  watch: ComfyProgressWatch | null;
  progress?: ComfyProgress;
}
const live = new Map<string, LiveJob>();

function invalid(code: string, message: string): Error {
  return comfyError(code, message, 400);
}

async function targetFor(origin: string): Promise<ComfyTarget> {
  const target = (await ComfyAccess.load(config.storage.configFile)).tryTarget(origin);
  if (!target) {
    throw invalid(COMFY_ERR.ORIGIN_NOT_ALLOWED, "ComfyUI server " + origin + " is not in the allowed servers. Add it in settings, or register the workflow again.");
  }
  return target;
}

function requireWorkflow(modelId: string): ComfyWorkflowRecord {
  const record = localWorkflow(modelId);
  if (!record) throw comfyError(COMFY_ERR.WORKFLOW_NOT_FOUND, "ComfyUI workflow '" + modelId.slice(COMFY_MODEL_PREFIX.length) + "' is not registered.", 404);
  return record;
}

/** Pairs each file with the slot of its role, in order. Every slot gets exactly one file. */
function assignInputs(record: ComfyWorkflowRecord, inputs: readonly MediaInput[]): Array<{ slot: ComfyMediaSlot; input: MediaInput }> {
  const slots = mediaSlots(record);
  const model = COMFY_MODEL_PREFIX + record.id;
  for (const role of new Set([...slots.map((slot) => slot.role), ...inputs.map((input) => input.role)])) {
    const want = slots.filter((slot) => slot.role === role).length;
    const got = inputs.filter((input) => input.role === role).length;
    if (want !== got) {
      throw invalid(COMFY_ERR.INPUT_INVALID, model + " takes " + String(want) + " " + role + " input" + (want === 1 ? "" : "s") + ", got " + String(got) + ".");
    }
  }
  const taken = new Map<string, number>();
  return slots.map((slot) => {
    const index = taken.get(slot.role) ?? 0;
    taken.set(slot.role, index + 1);
    const input = inputs.filter((entry) => entry.role === slot.role)[index]!;
    if (!input.bytes) throw invalid(COMFY_ERR.INPUT_INVALID, "ComfyUI inputs must be files ima2 holds, not links: upload the " + slot.role + " first.");
    return { slot, input };
  });
}

interface RunSettings { width?: number; height?: number; length?: number; fps?: number; params: Record<string, number | string | boolean> }

function sizeFromResolution(record: ComfyWorkflowRecord, resolution: string | undefined): { width?: number; height?: number } {
  if (resolution === undefined) return {};
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(resolution);
  if (!match || !record.bind.width || !record.bind.height) {
    throw invalid(COMFY_ERR.OPTION_INVALID, COMFY_MODEL_PREFIX + record.id + (record.bind.width && record.bind.height
      ? " takes a size as WIDTHxHEIGHT, e.g. 1024x1024." : " has no size setting bound."));
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function checkParam(record: ComfyWorkflowRecord, name: string, value: unknown): number | string | boolean {
  const model = COMFY_MODEL_PREFIX + record.id;
  const param = record.params.find((entry) => entry.name === name);
  if (!param) throw invalid(COMFY_ERR.OPTION_INVALID, "Unknown option '" + name + "' for " + model + ".");
  if (typeof value !== param.type) throw invalid(COMFY_ERR.OPTION_INVALID, model + " option '" + name + "' must be a " + param.type + ".");
  const typed = value as number | string | boolean;
  if (param.options && !param.options.some((choice) => choice === typed)) {
    throw invalid(COMFY_ERR.OPTION_INVALID, model + " option '" + name + "' must be one of the workflow's choices.");
  }
  if (typeof typed === "number" && ((param.min !== undefined && typed < param.min) || (param.max !== undefined && typed > param.max))) {
    throw invalid(COMFY_ERR.OPTION_INVALID, model + " option '" + name + "' must be between " + String(param.min ?? "-inf") + " and " + String(param.max ?? "inf") + ".");
  }
  return typed;
}

/** Reads vendorOptions. Unknown keys are refused, not dropped. */
function readSettings(record: ComfyWorkflowRecord, request: MediaSubmitRequest): RunSettings {
  const settings: RunSettings = { ...sizeFromResolution(record, request.resolution), params: {} };
  for (const [name, value] of Object.entries(request.vendorOptions ?? {})) {
    if (name === "allowPaidNodes") continue;
    if (name === "length" || name === "fps") {
      if (!record.bind[name] || typeof value !== "number" || !(value > 0)) {
        throw invalid(COMFY_ERR.OPTION_INVALID, COMFY_MODEL_PREFIX + record.id + (record.bind[name] ? " option '" + name + "' must be a positive number." : " has no " + name + " setting bound."));
      }
      settings[name] = value;
    } else {
      settings.params[name] = checkParam(record, name, value);
    }
  }
  return settings;
}

function refusePaidNodes(record: ComfyWorkflowRecord, request: MediaSubmitRequest): void {
  const paid = record.paidNodes ?? [];
  if (paid.length === 0 || request.vendorOptions?.allowPaidNodes === true) return;
  throw invalid(COMFY_ERR.PAID_NODES, COMFY_MODEL_PREFIX + record.id + " uses paid ComfyUI partner nodes (" + paid.join(", ")
    + "). ComfyUI may charge your Comfy account and ima2 cannot price it. Send vendorOptions.allowPaidNodes: true to run it anyway.");
}

async function stageInputs(ctx: MediaAdapterContext, target: ComfyTarget, record: ComfyWorkflowRecord, graph: ComfyGraph, inputs: readonly MediaInput[]): Promise<void> {
  for (const { slot, input } of assignInputs(record, inputs)) {
    const bytes = input.bytes!;
    if (bytes.byteLength > config.comfy.maxUploadBytes) {
      throw invalid(COMFY_ERR.INPUT_INVALID, "The " + slot.role + " input is larger than comfy.maxUploadBytes (" + String(config.comfy.maxUploadBytes) + " bytes).");
    }
    const name = "ima2_" + String(Date.now()) + "_" + slot.role + "." + (extFromMime(input.mimeType) ?? "bin");
    const uploaded = await uploadComfyInput(target, ctx.fetch, { bytes, mimeType: input.mimeType, name }, config.comfy.uploadTimeoutMs);
    const node = graph[slot.node];
    if (!node) throw invalid(COMFY_ERR.WORKFLOW_BIND_INVALID, "Workflow input slot points at node '" + slot.node + "', which is not in the graph. Register the workflow again.");
    node.inputs[slot.input] = uploaded;
  }
}

async function submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef> {
  const record = requireWorkflow(request.model);
  // A prompt nothing in the graph reads would be dropped in silence; say so instead.
  if (!record.bind.prompt && request.prompt) {
    throw invalid(COMFY_ERR.OPTION_INVALID, COMFY_MODEL_PREFIX + record.id + " takes no prompt: its workflow has no text input. Send the request without one.");
  }
  refusePaidNodes(record, request);
  const settings = readSettings(record, request);
  const target = await targetFor(record.origin);
  // refImage is a slot here like any other; bindGraph must not also demand it.
  const { refImage: _ref, inputs: _inputs, ...bind } = record.bind;
  const graph = bindGraph(record.graph, bind, {
    prompt: request.prompt ?? "", negativePrompt: request.negativePrompt, seed: request.seed,
    width: settings.width, height: settings.height, length: settings.length, fps: settings.fps, params: settings.params,
  }, record.params);
  const promptAt = record.bind.prompt;
  if (promptAt && request.prompt === undefined) graph[promptAt.node]!.inputs[promptAt.input] = record.graph[promptAt.node]!.inputs[promptAt.input];
  await stageInputs(ctx, target, record, graph, request.inputs);
  // ComfyUI sends a job's node and step events only to the socket whose client id submitted it.
  const clientId = "ima2-" + randomUUID();
  const promptId = await submitComfyPrompt(target, ctx.fetch, { prompt: graph, client_id: clientId, prompt_id: randomUUID() }, ctx.signal);
  const job: LiveJob = { startedAt: Date.now(), missing: 0, empty: 0, watch: null };
  // A caller that supplies its own transport owns every byte of I/O; no socket is opened behind it.
  if (ctx.fetch === globalThis.fetch && config.comfy.liveProgress !== false) {
    job.watch = watchComfyProgress(target, clientId, graph, promptId, (progress) => { job.progress = progress; });
  }
  live.set(promptId, job);
  return { providerJobId: promptId, pollAfterMs: config.comfy.pollIntervalMs, resume: { origin: target.origin, workflow: record.id, outputNode: record.bind.output.node } };
}

function finish(promptId: string): LiveJob | undefined {
  const job = live.get(promptId);
  job?.watch?.close();
  live.delete(promptId);
  return job;
}

function failed(error: unknown): MediaJobState {
  return { status: "failed", error: normalizeError(error) };
}

async function readOutputs(ctx: MediaAdapterContext, target: ComfyTarget, entry: HistoryEntry, job: MediaJobRef, state: LiveJob): Promise<MediaJobState> {
  const promptId = job.providerJobId;
  if (entry.status?.completed !== true) {
    const messages = Array.isArray(entry.status?.messages) ? entry.status.messages : [];
    finish(promptId);
    if (messages.some((message) => Array.isArray(message) && message[0] === "execution_interrupted")) return { status: "canceled" };
    return failed(comfyError(COMFY_ERR.EXECUTION_FAILED, "ComfyUI reported '" + (entry.status?.status_str ?? "unknown") + "': " + (explainComfyExecution(messages) || "no reason given")));
  }
  const files = collectOutputFiles(entry, job.resume?.outputNode ?? "").slice(0, MAX_OUTPUT_FILES);
  if (files.length === 0) {
    // ComfyUI can report a run complete a beat before its outputs are listed.
    state.empty += 1;
    if (state.empty <= MAX_EMPTY_POLLS) return { status: "running", pollAfterMs: config.comfy.pollIntervalMs, detail: "collecting outputs" };
    finish(promptId);
    return failed(comfyError(COMFY_ERR.NO_IMAGE, "The workflow finished but saved nothing. Check that its output node saves a file."));
  }
  const outputs: MediaOutput[] = [];
  for (const file of files) outputs.push(await downloadOutputFile(target, file, config.comfy.maxDownloadBytes, ctx.fetch, ctx.signal));
  finish(promptId);
  if (job.resume?.workflow) await recordLocalRun(job.resume.workflow, (Date.now() - state.startedAt) / 1000).catch(() => {});
  return { status: "succeeded", outputs };
}

function describe(progress: ComfyProgress | undefined): { progress?: number; detail?: string } {
  if (!progress) return {};
  const step = progress.step ? " " + String(progress.step.value) + "/" + String(progress.step.max) : "";
  return {
    ...(progress.fraction === undefined ? {} : { progress: progress.fraction }),
    ...(progress.nodeType ? { detail: progress.nodeType + step } : {}),
  };
}

async function poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState> {
  const promptId = job.providerJobId;
  const target = await targetFor(job.resume?.origin ?? "");
  let state = live.get(promptId);
  if (!state) { state = { startedAt: Date.now(), missing: 0, empty: 0, watch: null }; live.set(promptId, state); }
  let history: Record<string, unknown>;
  try {
    history = await readJson(await comfyFetch(target, ctx.fetch, "/history/" + encodeURIComponent(promptId), { ...(ctx.signal ? { signal: ctx.signal } : {}) }));
  } catch (error: unknown) {
    throw comfyError(COMFY_ERR.OFFLINE, "Lost contact with ComfyUI at " + target.origin + ": " + (error instanceof Error ? error.message : "unknown error"));
  }
  const entry = history[promptId] as HistoryEntry | undefined;
  if (entry) return readOutputs(ctx, target, entry, job, state);
  // /history says nothing until a job ends; the queue tells waiting from running from gone.
  const queue = await comfyQueuePosition(target, promptId, ctx.fetch);
  const pollAfterMs = config.comfy.pollIntervalMs;
  if (!queue) {
    state.missing += 1;
    if (state.missing < MAX_MISSING_POLLS) return { status: "running", pollAfterMs };
    finish(promptId);
    return failed(comfyError(COMFY_ERR.EXECUTION_FAILED, "The job disappeared from ComfyUI's queue and history without producing a result."));
  }
  state.missing = 0;
  if (!queue.running) return { status: "queued", pollAfterMs, detail: String(queue.position) + (queue.position === 1 ? " job" : " jobs") + " ahead in ComfyUI's queue" };
  return { status: "running", pollAfterMs, ...describe(state.progress) };
}

async function cancel(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void> {
  finish(job.providerJobId);
  const access = await ComfyAccess.load(config.storage.configFile);
  const target = access.tryTarget(job.resume?.origin ?? "");
  if (target) await cancelComfyJob(target, job.providerJobId, ctx.fetch);
}

const CATEGORY: Readonly<Record<string, MediaProviderError["category"]>> = {
  [COMFY_ERR.OFFLINE]: "upstream", [COMFY_ERR.DOWNLOAD_FAILED]: "upstream", [COMFY_ERR.EXECUTION_FAILED]: "upstream",
  [COMFY_ERR.NO_IMAGE]: "upstream", [COMFY_ERR.OUTPUT_INVALID]: "upstream", [COMFY_ERR.TIMEOUT]: "timeout",
  [COMFY_ERR.WORKFLOW_NOT_FOUND]: "not-found", [COMFY_ERR.SUBMIT_REJECTED]: "invalid-request", [COMFY_ERR.INPUT_INVALID]: "invalid-request",
  [COMFY_ERR.OPTION_INVALID]: "invalid-request", [COMFY_ERR.PAID_NODES]: "invalid-request", [COMFY_ERR.ORIGIN_NOT_ALLOWED]: "invalid-request",
  [COMFY_ERR.WORKFLOW_BIND_INVALID]: "invalid-request",
};

function normalizeError(error: unknown): MediaProviderError {
  const source = (error && typeof error === "object" ? error : {}) as { code?: unknown; status?: unknown; message?: unknown };
  const raw = typeof source.code === "string" ? source.code : "";
  const code = raw === CANCELED_CODE ? "COMFY_CANCELED" : raw.startsWith("COMFY_") ? raw : "COMFY_UNKNOWN";
  const message = typeof source.message === "string" && source.message ? source.message : typeof error === "string" ? error : "ComfyUI request failed";
  return {
    code, message,
    ...(typeof source.status === "number" ? { status: source.status } : {}),
    // Only losing the server is worth trying again; a refused workflow fails the same way twice.
    retryable: code === COMFY_ERR.OFFLINE,
    category: CATEGORY[code] ?? "unknown",
  };
}

export const adapter: MediaProviderAdapter = {
  id: "comfy-local",
  label: "ComfyUI (your server)",
  route: "local",
  errorPrefix: "COMFY",
  credential: { keyVocabulary: "comfy-local", envVars: [], configKey: "comfyLocal", consoleUrl: "https://docs.comfy.org", keyless: true },
  inputTransport: "inline",
  liveModels: { idPrefix: COMFY_MODEL_PREFIX },
  listModels: listLocalSpecs,
  estimateLocal: (spec) => estimateLocalRun(spec.upstreamId),
  validateKey: async () => ({ ok: true }),
  submit,
  poll,
  cancel,
  normalizeError,
};
