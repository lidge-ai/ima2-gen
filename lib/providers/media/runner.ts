import type { MediaAdapterContext, MediaInput, MediaJobRef, MediaProviderAdapter, MediaSubmitRequest } from "./contract.js";
import { MediaKeySnapshot, credentialReady } from "./credentials.js";
import { MediaJobError, mediaJobErrorFromProvider } from "./errors.js";
import { resolveMediaInputRef } from "./inputs.js";
import { redactDeep, redactSecrets } from "./redact.js";
import { selectMediaRoute } from "./registry.js";
import { adapterJobError, pollUntilTerminal } from "./runnerPoll.js";
import { materializeOutput, saveOutput } from "./runnerOutputs.js";
import { DEFAULT_MAX_INPUT_BYTES, type MediaJobResult, type MediaLaunchOptions, type MediaRunnerDeps, type PreparedMediaJob, type SavedMediaOutput } from "./runnerTypes.js";
import { validateAgainstSpec, type MediaJobBody } from "./validate.js";
import { abortJob, finishJob, isJobCanceled, isStartJobFailure, registerJobAbortController, setJobPhase, startJob } from "../../inflight.js";
import { makeGenerationCanceledError } from "../../generationCancel.js";
import { publish } from "../../eventBus.js";
import { publishJobEvent } from "../../ssePublish.js";
import { logEvent } from "../../logger.js";

export type { MediaJobResult, MediaLaunchOptions, MediaRunnerDeps, PreparedMediaJob, SavedMediaOutput } from "./runnerTypes.js";

function checkTransport(adapter: MediaProviderAdapter, inputs: readonly MediaInput[]): void {
  if (adapter.inputTransport !== "url") return;
  if (inputs.some((i) => !i.url)) {
    throw new MediaJobError("MEDIA_INPUT_URL_REQUIRED", `${adapter.label} only accepts public https input URLs`);
  }
}

/** Synchronous-to-the-caller checks: model, route, key, parameters, inputs. Nothing is sent upstream. */
export async function prepareMediaJob(deps: MediaRunnerDeps, body: MediaJobBody): Promise<PreparedMediaJob> {
  const keys = await MediaKeySnapshot.load(deps.configFile, deps.env ?? process.env);
  const selection = selectMediaRoute(deps.registry.getModel(body.model), {
    modelId: body.model,
    adapterId: body.adapter,
    task: body.task,
    hasKey: (a) => keys.hasKey(a),
  });
  if (selection.ok === false) {
    const { code, message, status } = selection as Extract<typeof selection, { ok: false }>;
    throw new MediaJobError(code, message, { status, category: code === "MEDIA_KEY_MISSING" ? "auth" : "invalid-request" });
  }
  validateAgainstSpec(selection.spec, body);
  const dirs = { generatedDir: deps.generatedDir, inputsDir: deps.inputsDir, maxBytes: deps.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES };
  const inputs = await Promise.all(body.inputs.map((ref) => resolveMediaInputRef(ref, dirs)));
  checkTransport(selection.adapter, inputs);
  const { adapter: _adapter, inputs: _refs, ...rest } = body;
  const request: MediaSubmitRequest = { ...rest, model: selection.spec.id, inputs };
  const credential = keys.resolve(selection.adapter);
  if (!credentialReady(credential)) throw new MediaJobError("MEDIA_KEY_MISSING", `Key incomplete for ${selection.adapter.label}`, { category: "auth" });
  return { adapter: selection.adapter, spec: selection.spec, request, credential };
}

function emitter(requestId: string, secrets: readonly string[]) {
  return (event: string, data: Record<string, unknown>) => {
    const safe = redactDeep({ requestId, jobKind: "media", ...data }, secrets);
    if (event === "done" || event === "error") publishJobEvent(requestId, event, safe);
    else publish(requestId, event, safe);
  };
}

async function uploadInputs(adapter: MediaProviderAdapter, actx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaSubmitRequest> {
  if (adapter.inputTransport !== "upload" || !request.inputs.some((i) => i.bytes)) return request;
  if (!adapter.uploadInput) throw new MediaJobError("MEDIA_ADAPTER_INVALID", `${adapter.id} declares upload transport without uploadInput`, { status: 500, category: "unknown" });
  const inputs = await Promise.all(request.inputs.map(async (input) => {
    if (!input.bytes) return input;
    const { url } = await adapter.uploadInput!(actx, input);
    return { role: input.role, url, mimeType: input.mimeType };
  }));
  return { ...request, inputs };
}

function sidecar(prepared: PreparedMediaJob, opts: MediaLaunchOptions, job: MediaJobRef, elapsed: number): Record<string, unknown> {
  const { adapter, spec, request } = prepared;
  const inputRoles = request.inputs.map((i) => i.role);
  return {
    kind: spec.kind, mediaType: spec.kind, generator: "media", provider: `media:${adapter.id}`,
    model: spec.id, upstreamModel: spec.upstreamId, vendor: spec.vendor, adapter: adapter.id, route: adapter.route,
    requestId: opts.requestId, sessionId: opts.sessionId ?? null, clientNodeId: opts.clientNodeId ?? null,
    prompt: request.prompt ?? null, userPrompt: request.prompt ?? null, revisedPrompt: null,
    createdAt: Date.now(), elapsed, providerJobId: job.providerJobId,
    media: { task: request.task, durationSec: request.durationSec ?? null, resolution: request.resolution ?? null,
      aspectRatio: request.aspectRatio ?? null, seed: request.seed ?? null, audio: request.audio ?? null, inputRoles },
    ...(spec.kind === "video" ? { video: { mode: request.task, duration: request.durationSec ?? null, resolution: request.resolution ?? null, aspectRatio: request.aspectRatio ?? null } } : {}),
    ...(opts.meta ?? {}),
  };
}

async function cancelUpstream(adapter: MediaProviderAdapter, actx: MediaAdapterContext, job: MediaJobRef | null): Promise<void> {
  if (!job || !adapter.cancel) return;
  await adapter.cancel({ ...actx, signal: AbortSignal.timeout(10_000) }, job).catch(() => {});
}

interface ExecState { job: MediaJobRef | null; finish: { status?: string; httpStatus?: number; errorCode?: string; canceled?: boolean; meta?: Record<string, unknown> } }

async function runToCompletion(deps: MediaRunnerDeps, prepared: PreparedMediaJob, opts: MediaLaunchOptions, actx: MediaAdapterContext, state: ExecState): Promise<MediaJobResult> {
  const { adapter, spec, credential } = prepared;
  const emit = emitter(opts.requestId, credential.secrets);
  const startedAt = Date.now();
  setJobPhase(opts.requestId, "streaming");
  const request = await uploadInputs(adapter, actx, prepared.request);
  const job = await adapter.submit(actx, request);
  state.job = job;
  emit("submitted", { model: spec.id, adapter: adapter.id, providerJobId: job.providerJobId });
  const terminal = await pollUntilTerminal({
    deps, adapter, actx, job, signal: actx.signal!, secrets: credential.secrets,
    onProgress: (p) => emit("progress", { status: p.status, progress: typeof p.progress === "number" ? p.progress : null }),
  });
  // A failed state already carries a normalized error; only strip secrets from its message.
  if (terminal.status === "failed") throw mediaJobErrorFromProvider({ ...terminal.error, message: redactSecrets(String(terminal.error.message ?? ""), credential.secrets) });
  if (terminal.status === "canceled") throw new MediaJobError("MEDIA_UPSTREAM_CANCELED", "The provider canceled the job", { status: 502, category: "upstream" });
  // Download headers can carry the key (Gemini file URIs); never let them reach events or logs.
  for (const out of terminal.outputs) credential.secrets.push(...Object.values(out.downloadHeaders ?? {}));
  setJobPhase(opts.requestId, "decoding");
  const elapsed = +((Date.now() - startedAt) / 1000).toFixed(1);
  const outputs: SavedMediaOutput[] = [];
  for (const out of terminal.outputs) {
    const data = await materializeOutput(deps, out, actx.signal!);
    outputs.push(await saveOutput(deps, out.kind ?? spec.kind, data, sidecar(prepared, opts, job, elapsed)));
  }
  if (outputs.length === 0) throw new MediaJobError("MEDIA_NO_OUTPUT", "The provider finished without an output", { status: 502, category: "upstream" });
  const result: MediaJobResult = { requestId: opts.requestId, adapter: adapter.id, model: spec.id, providerJobId: job.providerJobId, outputs, ...(terminal.billed ? { billed: terminal.billed } : {}), elapsed };
  state.finish = { status: "completed", meta: { filename: outputs[0]!.filename, adapter: adapter.id } };
  const first = outputs[0]!;
  emit("done", { model: spec.id, adapter: adapter.id, outputs, filename: first.filename, url: first.url, mediaType: first.mediaType, elapsed, ...(terminal.billed ? { billed: terminal.billed } : {}) });
  logEvent("media", "saved", { requestId: opts.requestId, adapter: adapter.id, model: spec.id, outputs: outputs.length, elapsed });
  return result;
}

async function executeMediaJob(deps: MediaRunnerDeps, prepared: PreparedMediaJob, opts: MediaLaunchOptions, controller: AbortController): Promise<MediaJobResult> {
  const { adapter, credential } = prepared;
  const actx: MediaAdapterContext = { apiKey: credential.apiKey ?? "", extra: credential.extra, fetch: deps.fetch ?? globalThis.fetch, signal: controller.signal };
  const state: ExecState = { job: null, finish: {} };
  try {
    return await runToCompletion(deps, prepared, opts, actx, state);
  } catch (error) {
    if (controller.signal.aborted || isJobCanceled(opts.requestId)) {
      state.finish = { canceled: true, httpStatus: 499, errorCode: "GENERATION_CANCELED" };
      await cancelUpstream(adapter, actx, state.job);
      throw makeGenerationCanceledError();
    }
    const err = adapterJobError(adapter, error, credential.secrets);
    state.finish = { status: "error", httpStatus: err.status, errorCode: err.code };
    emitter(opts.requestId, credential.secrets)("error", { code: err.code, error: err.message, status: err.status, category: err.category, retryable: err.retryable, adapter: adapter.id });
    logEvent("media", "failed", { requestId: opts.requestId, adapter: adapter.id, code: err.code, category: err.category });
    throw err;
  } finally {
    finishJob(opts.requestId, state.finish);
  }
}

/**
 * Admits the job (inflight slot, abort controller) and runs it in the background.
 * Throws MediaJobError when admission fails; job failures reject `done` and are
 * also published as an "error" event on the job's requestId.
 */
export function launchMediaJob(deps: MediaRunnerDeps, prepared: PreparedMediaJob, opts: MediaLaunchOptions): { requestId: string; done: Promise<MediaJobResult> } {
  const { spec, adapter, request } = prepared;
  const started = startJob({
    requestId: opts.requestId, kind: spec.kind, prompt: request.prompt ?? null,
    meta: { kind: spec.kind, sessionId: opts.sessionId ?? null, clientNodeId: opts.clientNodeId ?? null, model: spec.id, adapter: adapter.id, task: request.task },
  });
  if (started && isStartJobFailure(started)) {
    throw new MediaJobError(started.code, started.code === "TOO_MANY_JOBS" ? "Too many concurrent generation jobs" : "Request ID already in use", {
      status: started.code === "TOO_MANY_JOBS" ? 429 : 409, category: started.code === "TOO_MANY_JOBS" ? "rate-limit" : "invalid-request", retryable: started.code === "TOO_MANY_JOBS",
    });
  }
  const controller = new AbortController();
  registerJobAbortController(opts.requestId, controller);
  const parent = opts.parentSignal;
  const onParentAbort = () => { abortJob(opts.requestId); };
  if (parent?.aborted) queueMicrotask(onParentAbort);
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const done = executeMediaJob(deps, prepared, opts, controller).finally(() => parent?.removeEventListener("abort", onParentAbort));
  return { requestId: opts.requestId, done };
}
