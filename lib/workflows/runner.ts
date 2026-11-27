import { mkdir } from "node:fs/promises";
import { estimatePlan } from "./cost.js";
import { inputError, toErrorInfo, WorkflowError } from "./errors.js";
import { DEFAULT_POLL_POLICY, isAbort, runMediaStep, type PollPolicy } from "./mediaStep.js";
import { ArtifactStore, createStepRuntime } from "./runtime.js";
import type {
  PlanEnv, PlanNote, ResolvedSlot, StepSummary, WorkflowArtifact, WorkflowDefinition, WorkflowEstimate, WorkflowEvent,
  WorkflowGateway, WorkflowLocalOps, WorkflowPlan, WorkflowSelection, WorkflowStep, WorkflowValues, WorkflowResult,
} from "./types.js";
import { probeMediaValues, resolveSlotPlan, validateValues } from "./validate.js";

export interface WorkflowDeps {
  gateway: WorkflowGateway;
  local: WorkflowLocalOps;
  /** Folders a media path may come from (upload dir, generated dir). */
  allowedRoots: readonly string[];
}

export interface PreparedWorkflow {
  definition: WorkflowDefinition;
  values: WorkflowValues;
  slots: Readonly<Record<string, ResolvedSlot>>;
  plan: WorkflowPlan;
  estimate: WorkflowEstimate;
  /** Slot fallbacks, skipped optional steps and missing keys, for the UI before a run. */
  notes: readonly PlanNote[];
}

function readSelection(raw: unknown): WorkflowSelection | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw inputError("selection", "must be an object");
  const { combo, models, routes, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw inputError("selection", "only combo, models and routes are accepted");
  if (combo !== undefined && typeof combo !== "string") throw inputError("selection.combo", "must be a string");
  const map = (name: string, value: unknown): Readonly<Record<string, string>> | undefined => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Object.values(value).some((v) => typeof v !== "string")) {
      throw inputError("selection." + name, "must map step names to ids");
    }
    return value as Record<string, string>;
  };
  const selection: WorkflowSelection = {};
  if (typeof combo === "string") selection.combo = combo;
  const m = map("models", models);
  const r = map("routes", routes);
  if (m) selection.models = m;
  if (r) selection.routes = r;
  return selection;
}

/** Checks ids are unique, dependencies point backwards, and something is final. */
export function checkPlan(plan: WorkflowPlan): void {
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.id)) throw new WorkflowError("WORKFLOW_PLAN_INVALID", "duplicate step " + step.id, { status: 500 });
    const missing = step.dependsOn.find((dep) => !seen.has(dep));
    if (missing) throw new WorkflowError("WORKFLOW_PLAN_INVALID", step.id + " depends on " + missing + " before it runs", { status: 500 });
    seen.add(step.id);
  }
  if (!plan.steps.some((s) => s.final)) throw new WorkflowError("WORKFLOW_PLAN_INVALID", "plan has no final step", { status: 500 });
}

/** Validation, probing, planning and pricing. Spends nothing; the estimate endpoint stops here. */
export async function prepareWorkflow(definition: WorkflowDefinition, request: unknown, deps: WorkflowDeps, signal: AbortSignal): Promise<PreparedWorkflow> {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw inputError("request", "must be an object");
  const { values: rawValues, selection: rawSelection, ...rest } = request as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw inputError(Object.keys(rest)[0] ?? "request", "is not accepted");
  const checked = await validateValues(definition, rawValues ?? {}, { allowedRoots: deps.allowedRoots });
  const values = await probeMediaValues(definition, checked, deps.local, signal);
  const env: PlanEnv = {
    catalog: (id: string) => deps.gateway.catalog(id),
    canPlanText: typeof deps.gateway.planText === "function",
    ...(deps.gateway.canRun ? { canRun: (id: string, route: string | undefined) => deps.gateway.canRun!(id, route) } : {}),
    ...(deps.gateway.subscription ? { subscription: (route: string) => deps.gateway.subscription!(route) } : {}),
  };
  const { slots, notes: slotNotes } = resolveSlotPlan(definition, readSelection(rawSelection), values, env);
  const plan = definition.plan(values, slots, env);
  checkPlan(plan);
  return { definition, values, slots, plan, estimate: estimatePlan(plan, env), notes: [...slotNotes, ...(plan.notes ?? [])] };
}

export function summarizeSteps(plan: WorkflowPlan): StepSummary[] {
  return plan.steps.map((step) => {
    const summary: StepSummary = { id: step.id, label: step.label, kind: step.kind, dependsOn: step.dependsOn, final: step.final === true };
    if (step.kind === "media") {
      summary.slot = step.slot;
      summary.model = step.model;
      if (step.route) summary.route = step.route;
    }
    return summary;
  });
}

export interface RunOptions {
  runId: string;
  prepared: PreparedWorkflow;
  deps: WorkflowDeps;
  /** An empty directory owned by this run. */
  workDir: string;
  emit(event: WorkflowEvent): void;
  signal?: AbortSignal;
  poll?: Partial<PollPolicy>;
  /** Steps running at once. Default 2. */
  concurrency?: number;
}

type Settled = { id: string; error?: unknown; failed: boolean };

/** Runs a prepared plan. Independent steps run in parallel; the first failure stops the rest. */
export async function runWorkflow(options: RunOptions): Promise<WorkflowResult> {
  const { runId, prepared, deps, emit } = options;
  const internal = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => internal.abort(outer?.reason);
  if (outer?.aborted) internal.abort(outer.reason);
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  await mkdir(options.workDir, { recursive: true });
  const store = new ArtifactStore(options.workDir);
  const secrets: string[] = [];
  const poll: PollPolicy = { ...DEFAULT_POLL_POLICY, ...options.poll };
  emit({ type: "workflow.planned", runId, workflowId: prepared.plan.workflowId, estimate: prepared.estimate, steps: summarizeSteps(prepared.plan), notes: prepared.notes });
  const runStep = async (step: WorkflowStep): Promise<void> => {
    emit({ type: "step.started", runId, stepId: step.id });
    const rt = createStepRuntime(step, { values: prepared.values, workDir: options.workDir, signal: internal.signal, local: deps.local, gateway: deps.gateway, store });
    let billedUsd: number | undefined;
    let drafts;
    if (step.kind === "media") {
      const result = await runMediaStep(step, rt, { runId, gateway: deps.gateway, poll, emit, secrets });
      drafts = result.drafts;
      billedUsd = result.billedUsd;
    } else {
      drafts = await step.run(rt);
    }
    const artifacts = await store.save(step, drafts);
    for (const artifact of artifacts) emit({ type: "step.artifact", runId, stepId: step.id, artifact });
    emit({ type: "step.succeeded", runId, stepId: step.id, ...(billedUsd === undefined ? {} : { billedUsd }) });
  };
  try {
    const failure = await schedule(prepared.plan, runStep, options.concurrency ?? 2, internal, (id, error) => {
      emit({ type: "step.failed", runId, stepId: id, error: { ...toErrorInfo(error, secrets), stepId: id } });
    });
    return finish(runId, store.finals(), store.all(), failure, outer, secrets, emit);
  } finally {
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

function finish(runId: string, finals: WorkflowArtifact[], all: WorkflowArtifact[], failure: Settled | null, outer: AbortSignal | undefined, secrets: string[], emit: (e: WorkflowEvent) => void): WorkflowResult {
  if (outer?.aborted) {
    emit({ type: "workflow.canceled", runId });
    return { runId, status: "canceled", artifacts: all };
  }
  if (failure) {
    const error = { ...toErrorInfo(failure.error, secrets), stepId: failure.id };
    emit({ type: "workflow.failed", runId, error });
    return { runId, status: "failed", artifacts: all, error };
  }
  emit({ type: "workflow.succeeded", runId, artifacts: finals });
  return { runId, status: "succeeded", artifacts: finals };
}

async function schedule(plan: WorkflowPlan, runStep: (s: WorkflowStep) => Promise<void>, concurrency: number, internal: AbortController, onStepFailed: (id: string, error: unknown) => void): Promise<Settled | null> {
  const done = new Set<string>();
  const started = new Set<string>();
  const running = new Map<string, Promise<Settled>>();
  let failure: Settled | null = null;
  for (;;) {
    if (!failure && !internal.signal.aborted) {
      for (const step of plan.steps) {
        if (running.size >= concurrency) break;
        if (started.has(step.id) || !step.dependsOn.every((d) => done.has(d))) continue;
        started.add(step.id);
        running.set(step.id, runStep(step).then(() => ({ id: step.id, failed: false }), (error: unknown) => ({ id: step.id, error, failed: true })));
      }
    }
    if (running.size === 0) return failure;
    const settled = await Promise.race(running.values());
    running.delete(settled.id);
    if (!settled.failed) {
      done.add(settled.id);
      continue;
    }
    const causedByUs = failure !== null && isAbort(settled.error);
    if (!causedByUs && !internal.signal.aborted) onStepFailed(settled.id, settled.error);
    if (!failure) {
      failure = settled;
      internal.abort(new WorkflowError("WORKFLOW_ABORTED", "another step failed"));
    }
  }
}


