import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { saveOutput } from "./runnerOutputs.js";
import type { MediaRunnerDeps, SavedMediaOutput } from "./runnerTypes.js";
import { MediaJobError } from "./errors.js";
import { abortJob, finishJob, isJobCanceled, isStartJobFailure, registerJobAbortController, startJob } from "../../inflight.js";
import { publish } from "../../eventBus.js";
import { publishJobEvent } from "../../ssePublish.js";
import { logEvent } from "../../logger.js";
import { runWorkflow, type PreparedWorkflow, type WorkflowDeps } from "../../workflows/index.js";
import type { WorkflowArtifact, WorkflowEvent } from "../../workflows/types.js";

export interface WorkflowJobOptions {
  requestId: string;
  sessionId?: string | null;
  /** Parent folder for per-run scratch directories. */
  runsDir: string;
  /** Extra sidecar fields for the saved outputs, e.g. the signed-in web user. */
  meta?: Record<string, unknown>;
}

function emitter(requestId: string) {
  return (event: string, data: Record<string, unknown>) => {
    const payload = { requestId, jobKind: "workflow", ...data };
    if (event === "done" || event === "error") publishJobEvent(requestId, event, payload);
    else publish(requestId, event, payload);
  };
}

function publicArtifact(a: WorkflowArtifact) {
  return { id: a.id, stepId: a.stepId, kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes, final: a.final };
}

/** Bus events for L6 engine events. File paths stay on the server. */
function forward(emit: ReturnType<typeof emitter>, workflowId: string, e: WorkflowEvent): void {
  if (e.type === "workflow.planned") emit("planned", { workflow: workflowId, estimate: e.estimate, steps: e.steps, notes: e.notes });
  else if (e.type === "step.started") emit("step", { stepId: e.stepId, status: "started" });
  else if (e.type === "step.progress") emit("progress", { stepId: e.stepId, status: e.state, progress: e.progress ?? null });
  else if (e.type === "step.artifact") emit("step", { stepId: e.stepId, status: "artifact", artifact: publicArtifact(e.artifact) });
  else if (e.type === "step.succeeded") emit("step", { stepId: e.stepId, status: "done", ...(e.billedUsd === undefined ? {} : { billedUsd: e.billedUsd }) });
  else if (e.type === "step.failed") emit("step", { stepId: e.stepId, status: "failed", code: e.error.code, error: e.error.message });
}

async function saveFinals(deps: MediaRunnerDeps, prepared: PreparedWorkflow, opts: WorkflowJobOptions, finals: readonly WorkflowArtifact[]): Promise<SavedMediaOutput[]> {
  const saved: SavedMediaOutput[] = [];
  for (const a of finals) {
    if (a.kind === "json") continue;
    saved.push(await saveOutput(deps, a.kind, { buffer: await readFile(a.path), mimeType: a.mimeType }, {
      kind: a.kind, mediaType: a.kind, generator: "workflow", provider: `workflow:${prepared.definition.id}`,
      model: prepared.definition.id, workflow: prepared.definition.id, workflowStep: a.stepId,
      requestId: opts.requestId, sessionId: opts.sessionId ?? null, createdAt: Date.now(),
      prompt: typeof prepared.values.prompt === "string" ? prepared.values.prompt : null,
      estimateUsd: prepared.estimate.usd, estimateComplete: prepared.estimate.complete,
      ...(opts.meta ?? {}),
    }));
  }
  return saved;
}

async function execute(deps: MediaRunnerDeps, wfDeps: WorkflowDeps, prepared: PreparedWorkflow, opts: WorkflowJobOptions, controller: AbortController) {
  const emit = emitter(opts.requestId);
  const workflowId = prepared.definition.id;
  // Never derived from the request: a requestId such as ".." would otherwise point the
  // scratch folder (removed recursively when the run ends) outside runsDir.
  const workDir = join(opts.runsDir, `${Date.now()}-${randomBytes(8).toString("hex")}`);
  const startedAt = Date.now();
  let finish: Parameters<typeof finishJob>[1] = {};
  try {
    const result = await runWorkflow({ runId: opts.requestId, prepared, deps: wfDeps, workDir, signal: controller.signal, emit: (e) => forward(emit, workflowId, e) });
    if (result.status === "canceled" || isJobCanceled(opts.requestId)) {
      finish = { canceled: true, httpStatus: 499, errorCode: "GENERATION_CANCELED" };
      return;
    }
    if (result.status === "failed") {
      const err = result.error!;
      finish = { status: "error", httpStatus: 502, errorCode: err.code };
      emit("error", { workflow: workflowId, code: err.code, error: err.message, category: err.category ?? "unknown", retryable: err.retryable, stepId: err.stepId ?? null });
      return;
    }
    const outputs = await saveFinals(deps, prepared, opts, result.artifacts);
    const first = outputs[0];
    finish = { status: "completed", meta: { filename: first?.filename ?? null, workflow: workflowId } };
    emit("done", { workflow: workflowId, outputs, filename: first?.filename ?? null, url: first?.url ?? null, mediaType: first?.mediaType ?? null, elapsed: +((Date.now() - startedAt) / 1000).toFixed(1) });
    logEvent("workflow", "saved", { requestId: opts.requestId, workflow: workflowId, outputs: outputs.length });
  } catch {
    finish = { status: "error", httpStatus: 500, errorCode: "WORKFLOW_INTERNAL" };
    logEvent("workflow", "internal-error", { requestId: opts.requestId, workflow: workflowId, code: "WORKFLOW_INTERNAL" });
    emit("error", { workflow: workflowId, code: "WORKFLOW_INTERNAL", error: "Workflow failed (internal error); see the server log", category: "unknown", retryable: false });
  } finally {
    finishJob(opts.requestId, finish);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Admits a prepared workflow as one inflight job; cancel with abortJob(requestId). */
export function launchWorkflowJob(deps: MediaRunnerDeps, wfDeps: WorkflowDeps, prepared: PreparedWorkflow, opts: WorkflowJobOptions): Promise<void> {
  const id = prepared.definition.id;
  const started = startJob({ requestId: opts.requestId, kind: "workflow", prompt: typeof prepared.values.prompt === "string" ? prepared.values.prompt : null, meta: { kind: "workflow", workflow: id, sessionId: opts.sessionId ?? null } });
  if (started && isStartJobFailure(started)) {
    const busy = started.code === "TOO_MANY_JOBS";
    throw new MediaJobError(started.code, busy ? "Too many concurrent generation jobs" : "Request ID already in use", { status: busy ? 429 : 409, retryable: busy });
  }
  const controller = new AbortController();
  registerJobAbortController(opts.requestId, controller);
  return execute(deps, wfDeps, prepared, opts, controller);
}

export { abortJob as cancelWorkflowJob };
