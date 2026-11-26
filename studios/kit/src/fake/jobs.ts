import { randomUUID } from "node:crypto";
import type {
  Accepted,
  HistoryItem,
  Job,
  JobEventName,
  MediaKind,
  MediaProviderError,
  MediaSubmitBody,
  WorkflowDef,
  WorkflowEstimate,
  WorkflowRunBody,
} from "../types.ts";
import { EventRing } from "./events.ts";
import { fixture, type FileData } from "./media.ts";

export class Jobs {
  readonly jobs = new Map<string, Job>();
  readonly history: HistoryItem[] = [];
  readonly files = new Map<string, FileData>();
  readonly tokens = new Map<string, Accepted>();
  private timers = new Map<NodeJS.Timeout, string>();
  readonly events: EventRing;
  readonly scale: number;
  readonly seed: string;
  constructor(events: EventRing, scale: number, seed: string) {
    this.events = events;
    this.scale = scale;
    this.seed = seed;
  }
  emit(name: JobEventName, job: Job): void {
    job.updatedAt = new Date().toISOString();
    this.events.emit(name, job);
  }
  schedule(jobId: string, fn: () => void, delay: number): void {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        fn();
      },
      Math.max(1, delay * this.scale),
    );
    this.timers.set(timer, jobId);
  }
  start(
    target: string,
    provider: string,
    request: MediaSubmitBody | WorkflowRunBody,
    kind: MediaKind,
    def?: WorkflowDef,
    estimate?: WorkflowEstimate,
  ): Accepted {
    const now = new Date().toISOString(),
      jobId = randomUUID();
    const job: Job = {
      jobId,
      kind: def ? "workflow" : "media",
      target,
      provider,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      request,
      outputs: [],
      ...(def
        ? {
            steps: def.steps.map((s) => ({
              id: s.id,
              label: s.label,
              status: "queued" as const,
              ...(s.model ? { model: s.model } : {}),
              ...(estimate?.steps.find((e) => e.id === s.id)?.estimate
                ? { estimate: estimate.steps.find((e) => e.id === s.id)!.estimate }
                : {}),
            })),
          }
        : {}),
    };
    this.jobs.set(jobId, job);
    const accepted = { jobId, provider };
    if (request.clientRequestId) this.tokens.set(request.clientRequestId, accepted);
    this.emit("queued", job);
    this.advance(job, kind, def);
    return accepted;
  }
  advance(job: Job, kind: MediaKind, def?: WorkflowDef): void {
    const ticks = def ? def.steps.length + 1 : 4;
    for (let i = 1; i <= ticks; i++)
      this.schedule(
        job.jobId,
        () => {
          if (job.status === "canceled" || job.status === "failed") return;
          job.status = "running";
          job.progress = (i / ticks) * 0.9;
          if (def && job.steps && i <= def.steps.length) {
            job.steps = job.steps.map((s, n) => ({
              ...s,
              status: n < i - 1 ? "succeeded" : n === i - 1 ? "running" : "queued",
            }));
            this.emit("step", job);
          } else this.emit("progress", job);
          if (i === ticks) this.finish(job, kind);
        },
        i * 250,
      );
  }
  finish(job: Job, kind: MediaKind): void {
    const request = job.request as MediaSubmitBody;
    const prompt =
      typeof request.prompt === "string"
        ? request.prompt
        : String((job.request as WorkflowRunBody).inputs?.prompt ?? "");
    const failure = /\[fail:(auth|quota|rate-limit|invalid-request|moderation|upstream|timeout)\]/.exec(prompt)?.[1] as
      MediaProviderError["category"] | undefined;
    if (failure) {
      job.status = "failed";
      job.error = {
        code: "FAKE_" + failure.toUpperCase().replaceAll("-", "_"),
        message: "Simulated provider failure",
        category: failure,
        retryable: ["quota", "rate-limit", "upstream", "timeout"].includes(failure),
      };
      this.emit("error", job);
      return;
    }
    const file = fixture(kind, this.seed + prompt, request.aspectRatio),
      historyId = randomUUID(),
      url = "/files/" + historyId;
    this.files.set(historyId, file);
    job.outputs = [{ kind, mimeType: file.mime, url, historyId }];
    const item: HistoryItem = {
      historyId,
      jobId: job.jobId,
      kind,
      mimeType: file.mime,
      url,
      model: job.target,
      createdAt: new Date().toISOString(),
      favorite: false,
      ...(job.provider ? { provider: job.provider } : {}),
      ...(job.kind === "workflow" ? { workflow: job.target } : {}),
      ...(prompt ? { prompt } : {}),
    };
    this.history.unshift(item);
    job.status = "succeeded";
    job.progress = 1;
    if (job.steps) job.steps = job.steps.map((s) => ({ ...s, status: "succeeded" }));
    this.emit("done", job);
  }
  cancel(job: Job): void {
    if (job.status === "queued" || job.status === "running") {
      for (const [timer, id] of this.timers)
        if (id === job.jobId) {
          clearTimeout(timer);
          this.timers.delete(timer);
        }
      job.status = "canceled";
      this.emit("canceled", job);
    }
  }
  close(): void {
    for (const timer of this.timers.keys()) clearTimeout(timer);
    this.timers.clear();
  }
}
