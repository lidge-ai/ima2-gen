import { randomUUID } from "node:crypto";
import type { WireHistoryRow, WireJob, WireEstimateResponse } from "../wire.ts";
import type { MediaKind } from "../types.ts";
import { EventRing } from "./events.ts";
import { History } from "./history.ts";
import { fixture, type FileData } from "./media.ts";

export interface JobStart {
  requestId: string;
  jobKind: "media" | "workflow";
  model: string;
  adapter: string;
  task: string;
  prompt: string;
  kind: MediaKind;
  sessionId?: string;
  workflow?: string;
  aspectRatio?: string;
  /** The settings the server keeps on the result (sidecar "media"), so it can be made again as it was. */
  media?: Record<string, unknown>;
  plan?: WireEstimateResponse;
}
export class Jobs {
  readonly jobs = new Map<string, WireJob>();
  readonly history = new History();
  readonly files = new Map<string, FileData>();
  private timers = new Map<NodeJS.Timeout, string>();
  readonly events: EventRing;
  readonly scale: number;
  readonly seed: string;
  constructor(events: EventRing, scale: number, seed: string) {
    this.events = events;
    this.scale = scale;
    this.seed = seed;
  }
  emit(name: string, job: JobStart, data: Record<string, unknown>): void {
    this.events.emit(name, { requestId: job.requestId, jobKind: job.jobKind, ...data });
  }
  schedule(id: string, delay: number, fn: () => void): void {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        fn();
      },
      Math.max(1, delay * this.scale),
    );
    this.timers.set(timer, id);
  }
  start(job: JobStart): void {
    const now = Date.now();
    this.jobs.set(job.requestId, {
      requestId: job.requestId,
      kind: job.jobKind,
      prompt: job.prompt,
      meta: {
        model: job.model,
        adapter: job.adapter,
        task: job.task,
        ...(job.workflow ? { workflow: job.workflow } : {}),
        ...(job.sessionId ? { sessionId: job.sessionId } : {}),
      },
      startedAt: now,
      phase: "queued",
      phaseAt: now,
    });
    if (job.plan) this.emit("planned", job, job.plan as unknown as Record<string, unknown>);
    else this.emit("submitted", job, { model: job.model, adapter: job.adapter });
    const steps = job.plan?.steps ?? [];
    for (let i = 0; i < Math.max(3, steps.length); i++)
      this.schedule(job.requestId, 250 * (i + 1), () => this.tick(job, i, steps));
    this.schedule(job.requestId, 250 * (Math.max(3, steps.length) + 1), () => this.finish(job));
  }
  tick(job: JobStart, index: number, steps: WireEstimateResponse["steps"]): void {
    const record = this.jobs.get(job.requestId);
    if (!record || record.status) return;
    record.phase = "running";
    record.phaseAt = Date.now();
    const step = steps[index];
    if (step) {
      this.emit("step", job, { stepId: step.id, status: "started" });
      this.emit("progress", job, { stepId: step.id, status: "running", progress: 0.5 });
      this.emit("step", job, { stepId: step.id, status: "done" });
    } else this.emit("progress", job, { status: "running", progress: (index + 1) / 4 });
  }
  finish(job: JobStart): void {
    const record = this.jobs.get(job.requestId);
    if (!record || record.status) return;
    const failure = /\[fail:(auth|quota|rate-limit|invalid-request|moderation|upstream|timeout|comfy-offline)\]/.exec(
      job.prompt,
    )?.[1];
    if (failure) {
      this.fail(job, record, failure);
      return;
    }
    const file = fixture(job.kind, this.seed + job.prompt, job.aspectRatio),
      ext = job.kind === "video" ? "mp4" : job.kind === "audio" ? "wav" : "png",
      filename = randomUUID() + "." + ext,
      url = "/generated/" + filename;
    this.files.set(filename, file);
    const now = Date.now();
    record.status = "completed";
    record.finishedAt = now;
    this.history.items.unshift({
      filename,
      url,
      thumb: null,
      mediaType: job.kind,
      createdAt: now,
      prompt: job.prompt,
      model: job.model,
      provider: "media:" + job.adapter,
      requestId: job.requestId,
      kind: job.jobKind,
      adapter: job.adapter,
      ...(job.media ? { media: job.media as NonNullable<WireHistoryRow["media"]> } : {}),
      ...(job.workflow ? { workflow: job.workflow } : {}),
    });
    this.emit("done", job, {
      outputs: [{ filename, url, mediaType: job.kind, mimeType: file.mime, bytes: file.data.length }],
      filename,
      url,
      mediaType: job.kind,
      elapsed: now - record.startedAt,
    });
  }
  fail(job: JobStart, record: WireJob, failure: string): void {
    // A local ComfyUI that stopped answering fails the way the server reports it (lib/providers/media/local/comfy.ts).
    const comfy = failure === "comfy-offline";
    const code = comfy ? "COMFY_OFFLINE" : "FAKE_" + failure.toUpperCase().replaceAll("-", "_");
    const category = comfy ? "upstream" : failure;
    record.status = "error";
    record.errorCode = code;
    // Stored the way the server is asked to store it (L7 request: category in the job meta),
    // so a reloaded job list still knows why the job failed.
    record.meta = { ...record.meta, category, retryable: comfy };
    record.finishedAt = Date.now();
    this.emit("error", job, {
      code,
      error: comfy ? "Lost contact with ComfyUI at http://127.0.0.1:8188: connect ECONNREFUSED" : "Simulated provider failure",
      status: 500,
      category,
      retryable: comfy,
    });
  }
  cancel(id: string): void {
    const record = this.jobs.get(id);
    if (!record || record.status) return;
    for (const [timer, owner] of this.timers)
      if (owner === id) {
        clearTimeout(timer);
        this.timers.delete(timer);
      }
    record.status = "canceled";
    record.finishedAt = Date.now();
    record.errorCode = "GENERATION_CANCELED";
    this.events.emit("error", {
      requestId: id,
      jobKind: record.kind,
      code: "GENERATION_CANCELED",
      error: "Generation canceled",
      status: 499,
      category: "unknown",
      retryable: false,
    });
  }
  close(): void {
    for (const timer of this.timers.keys()) clearTimeout(timer);
    this.timers.clear();
  }
}
