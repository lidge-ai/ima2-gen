/**
 * Folds the server's flat job events (GET /api/events, jobKind media|workflow)
 * into full Job snapshots, so screens always render one object per job.
 */
import { stepLabels } from "./adaptWorkflow.ts";
import type { Job, JobEventName, JobOutput, MediaKind, MediaSubmitBody, WorkflowStepState } from "./types.ts";
import type { WireOutput, WireStepEstimate, WireStepSummary } from "./wire.ts";

export type WireEventData = Readonly<Record<string, unknown>>;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function seed(data: WireEventData, now: string): Job {
  const kind = data.jobKind === "workflow" ? "workflow" : "media";
  return {
    jobId: str(data.requestId) ?? "",
    kind,
    target: str(data.model) ?? str(data.workflow) ?? "",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: {} as MediaSubmitBody,
    outputs: [],
  };
}

function plannedSteps(data: WireEventData): WorkflowStepState[] {
  const steps = (data.steps as readonly WireStepSummary[] | undefined) ?? [];
  const estimates = (data.estimate as { steps?: readonly WireStepEstimate[] } | undefined)?.steps ?? [];
  return steps.map((s) => {
    const e = estimates.find((x) => x.stepId === s.id);
    const step: WorkflowStepState = { id: s.id, label: s.label, status: "queued" };
    const labels = stepLabels(s);
    if (labels) step.labels = labels;
    if (s.model) step.model = s.model;
    if (s.route) step.provider = s.route;
    if (e) step.estimate = { usd: e.usd, basis: e.note ?? (e.units ? e.units.quantity + " " + e.units.unit : "") };
    return step;
  });
}

const STEP_STATUS: Record<string, WorkflowStepState["status"]> = {
  started: "running",
  done: "succeeded",
  failed: "failed",
};

function withStep(job: Job, stepId: string, status: WorkflowStepState["status"] | undefined): Job {
  if (!status) return job;
  const steps = job.steps ?? [];
  const known = steps.some((s) => s.id === stepId);
  const next = known
    ? steps.map((s) => (s.id === stepId ? { ...s, status } : s))
    : [...steps, { id: stepId, label: stepId, status }];
  const done = next.filter((s) => s.status === "succeeded").length;
  return { ...job, steps: next, status: "running", ...(next.length ? { progress: done / next.length } : {}) };
}

function outputs(data: WireEventData): JobOutput[] {
  const list = (data.outputs as readonly WireOutput[] | undefined) ?? [];
  return list.map((o) => ({ kind: o.mediaType as MediaKind, mimeType: o.mimeType, url: o.url, historyId: o.filename }));
}

function failed(job: Job, data: WireEventData): Job {
  const code = str(data.code) ?? "UNKNOWN";
  if (code === "GENERATION_CANCELED") return { ...job, status: "canceled" };
  const category = (str(data.category) ?? "unknown") as NonNullable<Job["error"]>["category"];
  const error: NonNullable<Job["error"]> = {
    code,
    message: str(data.error) ?? code,
    category,
    retryable: data.retryable === true,
  };
  const status = num(data.status);
  if (status !== undefined) error.status = status;
  return { ...job, status: "failed", error };
}

function apply(job: Job, name: string, data: WireEventData): Job | null {
  switch (name) {
    case "submitted": {
      const provider = str(data.adapter) ?? job.provider;
      return { ...job, status: "running", target: str(data.model) ?? job.target, ...(provider ? { provider } : {}) };
    }
    case "planned":
      return { ...job, status: "running", steps: plannedSteps(data) };
    case "progress":
      if (job.kind === "workflow" && str(data.stepId)) return withStep(job, str(data.stepId)!, "running");
      {
        const progress = num(data.progress) ?? job.progress;
        return {
          ...job,
          status: data.status === "queued" ? "queued" : "running",
          ...(progress !== undefined ? { progress } : {}),
        };
      }
    case "step":
      return withStep(job, str(data.stepId) ?? "step", STEP_STATUS[str(data.status) ?? ""]);
    case "done": {
      const steps = job.steps?.map((s) => ({ ...s, status: "succeeded" as const }));
      const billed = num((data.billed as { usd?: unknown } | undefined)?.usd);
      return {
        ...job,
        status: "succeeded",
        progress: 1,
        outputs: outputs(data),
        ...(steps ? { steps } : {}),
        ...(billed !== undefined ? { billed: { usd: billed } } : {}),
      };
    }
    case "error":
      return failed(job, data);
    default:
      return null;
  }
}

const KIT_EVENT: Record<string, JobEventName> = {
  submitted: "progress",
  planned: "step",
  progress: "progress",
  step: "step",
  done: "done",
};

/** Next snapshot and the kit event name, or null for events this reducer does not model. */
export function reduceJobEvent(
  prev: Job | undefined,
  name: string,
  data: WireEventData,
  now = new Date().toISOString(),
): { job: Job; event: JobEventName } | null {
  if (data.jobKind !== "media" && data.jobKind !== "workflow") return null;
  const next = apply(prev ?? seed(data, now), name, data);
  if (!next) return null;
  const event: JobEventName =
    name === "error" ? (next.status === "canceled" ? "canceled" : "error") : (KIT_EVENT[name] ?? "progress");
  return { job: { ...next, updatedAt: now }, event };
}
