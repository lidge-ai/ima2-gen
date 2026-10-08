import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeContext } from "../runtimeContext.js";
import { api88Origin } from "./origin.js";
import { api88VideoSpec } from "./videoSpecs.js";
import { buildApi88VideoBody, type Api88VideoInput, type Api88VideoBody } from "./videoBody.js";
import { downloadApi88Video } from "./videoDownload.js";

export interface Api88VideoEvent {
  phase: "submitted" | "progress";
  providerTaskId: string;
  model: string;
  origin: string;
  progress?: number | null;
  status?: string;
}
export interface Api88VideoOptions {
  origin?: string | undefined;
  signal?: AbortSignal | undefined;
  sleep?: ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  onEvent?: ((event: Api88VideoEvent) => void | Promise<void>) | undefined;
}
export interface Api88VideoResult {
  videoBuffer: Buffer;
  providerUrl: string;
  providerTaskId: string;
  model: string;
  origin: string;
}
type VideoContext = Pick<RuntimeContext, "api88VideoKey" | "config">;
type Json = Record<string, unknown>;
interface Run {
  origin: string; headers: { Authorization: string }; deadline: number;
  signal: AbortSignal; options: Api88VideoOptions; now: () => number;
  config: RuntimeContext["config"]["api88Provider"];
}
function fail(code: string, message: string, status = 502, providerTaskId?: string): never {
  throw Object.assign(new Error(message), { code, status, ...(providerTaskId ? { providerTaskId } : {}) });
}
function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function runFor(ctx: VideoContext, options: Api88VideoOptions): Run {
  const key = ctx.api88VideoKey?.trim();
  if (!key) return fail("API88_VIDEO_KEY_MISSING", "88API video key required", 401);
  const now = options.now ?? Date.now;
  const timeout = ctx.config.api88Provider.videoTimeoutMs;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeout)]);
  return { origin: api88Origin(options.origin ?? ctx.config.api88Provider.baseUrl), headers: { Authorization: `Bearer ${key}` },
    deadline: now() + timeout, signal, options, now, config: ctx.config.api88Provider };
}
function check(run: Run, taskId?: string): void {
  if (run.options.signal?.aborted) run.options.signal.throwIfAborted();
  if (run.signal.aborted || run.now() >= run.deadline) {
    fail("API88_VIDEO_TIMEOUT", "88API waiting budget exhausted; resume the existing task", 504, taskId);
  }
}
async function wait(run: Run, ms: number, taskId: string): Promise<void> {
  check(run, taskId);
  const remaining = run.deadline - run.now();
  const sleep = run.options.sleep ?? ((duration, signal) => delay(duration, undefined, { signal }));
  await sleep(Math.min(ms, remaining), run.signal);
  check(run, taskId);
}

async function submit(run: Run, body: Api88VideoBody): Promise<string> {
  check(run);
  let response: Response;
  let data: Json;
  try {
    response = await fetch(`${run.origin}/v1/videos`, {
      method: "POST", redirect: "error", headers: { ...run.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.any([run.signal,
        AbortSignal.timeout(Math.min(run.config.videoSubmitTimeoutMs, Math.max(1, run.deadline - run.now())))]),
    });
    if (!response.ok) return fail("API88_VIDEO_REQUEST_FAILED", `88API submit HTTP ${response.status}`, response.status);
    data = object(await response.json());
  } catch (error) {
    if ((error as { code?: string }).code === "API88_VIDEO_REQUEST_FAILED") throw error;
    return fail("API88_VIDEO_SUBMIT_UNCERTAIN", "Submit outcome uncertain; never automatically submit again", 502);
  }
  if (typeof data.id !== "string" || !data.id.length) {
    return fail("API88_VIDEO_SUBMIT_UNCERTAIN", "Submit response has no id; do not resubmit", 502);
  }
  return data.id;
}

function retryDelay(response: Response, attempt: number, now: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1000, date - now);
  }
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}
async function pollOnce(run: Run, taskId: string): Promise<Json> {
  for (let attempt = 0; ; attempt += 1) {
    check(run, taskId);
    const response = await fetch(`${run.origin}/v1/videos/${encodeURIComponent(taskId)}`, {
      method: "GET", redirect: "error", headers: run.headers, signal: AbortSignal.any([run.signal,
        AbortSignal.timeout(Math.min(run.config.videoPollTimeoutMs, Math.max(1, run.deadline - run.now())))]),
    });
    if (response.status === 429 || response.status >= 500) {
      const backoff = retryDelay(response, attempt, run.now());
      await response.body?.cancel();
      await wait(run, backoff, taskId);
      continue;
    }
    if (!response.ok) return fail("API88_VIDEO_REQUEST_FAILED", `88API poll HTTP ${response.status}`, response.status, taskId);
    return object(await response.json());
  }
}
export function api88VideoResultUrl(value: unknown): string | null {
  const root = object(value);
  const data = object(root.data);
  const containers = [root, object(root.output), data, object(data.output)];
  for (const key of ["url", "video_url", "result_url"]) {
    for (const container of containers) {
      const url = container[key];
      if (typeof url === "string" && url.length > 0) return url;
    }
  }
  return null;
}
async function poll(run: Run, taskId: string, model: string): Promise<Api88VideoResult> {
  let unknown = 0;
  await run.options.onEvent?.({ phase: "submitted", providerTaskId: taskId, model, origin: run.origin });
  await wait(run, run.config.videoFirstPollMs, taskId);
  while (true) {
    check(run, taskId);
    const data = await pollOnce(run, taskId);
    check(run, taskId);
    const status = typeof data.status === "string" ? data.status : "unknown";
    if (status === "failed") return fail("API88_VIDEO_FAILED", "88API task failed", 502, taskId);
    if (status === "completed") {
      const url = api88VideoResultUrl(data);
      if (!url) return fail("API88_VIDEO_EMPTY_RESULT", "Completed task has no result URL", 502, taskId);
      const downloadSignal = AbortSignal.any([run.signal, AbortSignal.timeout(run.config.videoDownloadTimeoutMs)]);
      const videoBuffer = await downloadApi88Video(url, downloadSignal, run.config.maxVideoBytes);
      check(run, taskId);
      return { videoBuffer, providerUrl: url, providerTaskId: taskId, model, origin: run.origin };
    }
    unknown = status === "queued" || status === "in_progress" ? 0 : unknown + 1;
    if (unknown >= run.config.videoUnknownStatusLimit) return fail("API88_VIDEO_STATUS_UNKNOWN", "Three consecutive unknown task states", 502, taskId);
    const progress = typeof data.progress === "number" && Number.isFinite(data.progress)
      ? Math.min(1, Math.max(0, data.progress / 100)) : null;
    await run.options.onEvent?.({ phase: "progress", providerTaskId: taskId, model, origin: run.origin, progress, status });
    await wait(run, run.config.videoPollIntervalMs, taskId);
  }
}
async function complete(run: Run, taskId: string, model: string): Promise<Api88VideoResult> {
  try { return await poll(run, taskId, model); }
  catch (error) {
    if (run.options.signal?.aborted) run.options.signal.throwIfAborted();
    check(run, taskId);
    if (error instanceof Error && error.name === "TimeoutError") return fail("API88_VIDEO_TIMEOUT", "88API request timed out", 504, taskId);
    const code = (error as { code?: unknown } | null)?.code;
    if (error instanceof Error && (typeof code === "string" && code.startsWith("API88_") || code === "GENERATION_CANCELED")) {
      throw Object.assign(error, { providerTaskId: taskId });
    }
    return fail("API88_VIDEO_REQUEST_FAILED", "88API poll/download response failed", 502, taskId);
  }
}
export async function generateApi88Video(
  ctx: VideoContext, input: Api88VideoInput, options: Api88VideoOptions = {},
): Promise<Api88VideoResult> {
  const body = buildApi88VideoBody(input);
  const run = runFor(ctx, options);
  const taskId = await submit(run, body);
  return complete(run, taskId, input.model);
}
export async function resumeApi88Video(
  ctx: VideoContext, taskId: string, model: string, options: Api88VideoOptions = {},
): Promise<Api88VideoResult> {
  api88VideoSpec(model);
  if (!taskId || taskId.length > 512) return fail("API88_VIDEO_INVALID_REQUEST", "Task id required (max 512 characters)", 400);
  return complete(runFor(ctx, options), taskId, model);
}
