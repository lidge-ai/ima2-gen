import type { MediaInputRole, MediaKind } from "./contract.js";
import { MediaJobError } from "./errors.js";
import { resolveMediaInputRef } from "./inputs.js";
import { launchMediaJob, prepareMediaJob } from "./runner.js";
import { saveOutput } from "./runnerOutputs.js";
import { DEFAULT_MAX_INPUT_BYTES, type MediaJobResult, type MediaRunnerDeps, type SavedMediaOutput } from "./runnerTypes.js";
import type { MediaSource, MediaWorkflow, MediaWorkflowRunContext, MediaWorkflowStepRequest } from "./workflow.js";
import { abortJob, finishJob, isJobCanceled, isStartJobFailure, registerJobAbortController, startJob } from "../../inflight.js";
import { makeGenerationCanceledError } from "../../generationCancel.js";
import { publish } from "../../eventBus.js";
import { publishJobEvent } from "../../ssePublish.js";
import { logEvent } from "../../logger.js";

export interface WorkflowLaunchOptions {
  requestId: string;
  input: Readonly<Record<string, unknown>>;
  sessionId?: string | null;
}

function emitFor(requestId: string) {
  return (event: string, data: Record<string, unknown>) => {
    const payload = { requestId, ...data };
    if (event === "done" || event === "error") publishJobEvent(requestId, event, payload);
    else publish(requestId, event, payload);
  };
}

const MEDIA_FIELD_TYPES = new Set(["image", "video", "audio"]);

/** Required fields present, selects in range, media fields shaped as a MediaSource. */
export function validateWorkflowInput(workflow: MediaWorkflow, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MediaJobError("WORKFLOW_INVALID_INPUT", "input must be an object");
  const values = input as Record<string, unknown>;
  for (const field of workflow.inputs) {
    const v = values[field.name];
    if (v === undefined || v === null || v === "") {
      if (field.required) throw new MediaJobError("WORKFLOW_INVALID_INPUT", `${field.label} is required`);
      continue;
    }
    if (field.type === "select" && field.options && !field.options.includes(String(v))) {
      throw new MediaJobError("WORKFLOW_INVALID_INPUT", `${field.label} must be one of ${field.options.join(", ")}`);
    }
    if (MEDIA_FIELD_TYPES.has(field.type) && (typeof v !== "object" || Array.isArray(v))) {
      throw new MediaJobError("WORKFLOW_INVALID_INPUT", `${field.label} must be a media source object`);
    }
  }
  return values;
}

function stepRunner(deps: MediaRunnerDeps, workflow: MediaWorkflow, opts: WorkflowLaunchOptions, signal: AbortSignal) {
  const emit = emitFor(opts.requestId);
  const seen = new Map<string, number>();
  return async (stepId: string, request: MediaWorkflowStepRequest, options?: { adapter?: string }): Promise<MediaJobResult> => {
    if (signal.aborted) throw makeGenerationCanceledError();
    const n = (seen.get(stepId) ?? 0) + 1;
    seen.set(stepId, n);
    const childRequestId = `${opts.requestId}.${stepId}${n > 1 ? `-${n}` : ""}`;
    emit("step", { stepId, status: "started", childRequestId });
    try {
      const prepared = await prepareMediaJob(deps, { ...request, ...(options?.adapter ? { adapter: options.adapter } : {}) });
      const { done } = launchMediaJob(deps, prepared, {
        requestId: childRequestId, sessionId: opts.sessionId ?? null, parentSignal: signal,
        meta: { workflow: workflow.id, workflowRequestId: opts.requestId, workflowStep: stepId },
      });
      const result = await done;
      emit("step", { stepId, status: "done", childRequestId, outputs: result.outputs });
      return result;
    } catch (error) {
      const code = error instanceof MediaJobError ? error.code : (error as { code?: string })?.code ?? "WORKFLOW_STEP_FAILED";
      emit("step", { stepId, status: "failed", childRequestId, code });
      throw error;
    }
  };
}

function runContext(deps: MediaRunnerDeps, workflow: MediaWorkflow, opts: WorkflowLaunchOptions, signal: AbortSignal): MediaWorkflowRunContext {
  const dirs = { generatedDir: deps.generatedDir, inputsDir: deps.inputsDir, maxBytes: deps.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES };
  const emit = emitFor(opts.requestId);
  return {
    requestId: opts.requestId,
    signal,
    input: opts.input,
    catalog: deps.registry,
    runStep: stepRunner(deps, workflow, opts, signal),
    asInput: (source: MediaSource, role: MediaInputRole) => ({ ...source, role }),
    loadSource: async (source: MediaSource) => {
      const input = await resolveMediaInputRef({ ...source, role: "source-image" }, dirs);
      if (!input.bytes) throw new MediaJobError("WORKFLOW_SOURCE_REMOTE", "Remote URLs cannot be read locally; pass a ref or filename");
      return { bytes: input.bytes, mimeType: input.mimeType };
    },
    saveOutput: (data: { bytes: Uint8Array; mimeType: string; kind: MediaKind }, meta?: Record<string, unknown>) =>
      saveOutput(deps, data.kind, { buffer: Buffer.from(data.bytes), mimeType: data.mimeType }, {
        kind: data.kind, mediaType: data.kind, generator: "workflow", provider: `workflow:${workflow.id}`, model: workflow.id,
        requestId: opts.requestId, sessionId: opts.sessionId ?? null, createdAt: Date.now(), workflow: workflow.id, ...(meta ?? {}),
      }),
    progress: (stepId: string, data: { progress?: number; message?: string }) => emit("progress", { stepId, ...data }),
  };
}

async function executeWorkflow(deps: MediaRunnerDeps, workflow: MediaWorkflow, opts: WorkflowLaunchOptions, controller: AbortController) {
  const emit = emitFor(opts.requestId);
  const startedAt = Date.now();
  let finish: Parameters<typeof finishJob>[1] = {};
  try {
    const { outputs } = await workflow.run(runContext(deps, workflow, opts, controller.signal));
    const first: SavedMediaOutput | undefined = outputs[0];
    const elapsed = +((Date.now() - startedAt) / 1000).toFixed(1);
    finish = { status: "completed", meta: { filename: first?.filename ?? null } };
    emit("done", { workflow: workflow.id, outputs, filename: first?.filename ?? null, url: first?.url ?? null, mediaType: first?.mediaType ?? null, elapsed });
    return { outputs };
  } catch (error) {
    if (controller.signal.aborted || isJobCanceled(opts.requestId)) {
      finish = { canceled: true, httpStatus: 499, errorCode: "GENERATION_CANCELED" };
      throw makeGenerationCanceledError();
    }
    const err = error instanceof MediaJobError ? error : new MediaJobError((error as { code?: string })?.code ?? "WORKFLOW_FAILED", "Workflow failed", { status: 500, category: "unknown" });
    finish = { status: "error", httpStatus: err.status, errorCode: err.code };
    emit("error", { workflow: workflow.id, code: err.code, error: err.message, status: err.status, category: err.category, retryable: err.retryable });
    logEvent("workflow", "failed", { requestId: opts.requestId, workflow: workflow.id, code: err.code });
    throw err;
  } finally {
    finishJob(opts.requestId, finish);
  }
}

/** Admits a workflow job; steps run as child media jobs that the parent's cancel also stops. */
export function launchWorkflow(deps: MediaRunnerDeps, workflow: MediaWorkflow, opts: WorkflowLaunchOptions): { requestId: string; done: Promise<{ outputs: readonly SavedMediaOutput[] }> } {
  const started = startJob({ requestId: opts.requestId, kind: "workflow", prompt: typeof opts.input.prompt === "string" ? opts.input.prompt : null, meta: { kind: "workflow", workflow: workflow.id, sessionId: opts.sessionId ?? null } });
  if (started && isStartJobFailure(started)) {
    throw new MediaJobError(started.code, started.code === "TOO_MANY_JOBS" ? "Too many concurrent generation jobs" : "Request ID already in use", { status: started.code === "TOO_MANY_JOBS" ? 429 : 409 });
  }
  const controller = new AbortController();
  registerJobAbortController(opts.requestId, controller);
  const done = executeWorkflow(deps, workflow, opts, controller);
  return { requestId: opts.requestId, done };
}

export { abortJob as cancelMediaOrWorkflowJob };
