import * as mediaApi from "./mediaApi.js";
import { MediaApiError } from "./mediaErrors.js";
import type { SseEvent } from "./sse.js";

type Dict = Record<string, unknown>;
export type HandlerOptions = { signal: AbortSignal; onEvent?: (event: SseEvent) => void };
const outputFields = ["filename", "url", "mediaType", "mimeType", "createdAt", "provider", "model", "requestId", "prompt", "sessionId"];
const jobFields = ["requestId", "kind", "status", "startedAt", "finishedAt", "errorCode", "model", "adapter", "workflow", "progress", "phase", "phaseAt"];
const metaFields = ["adapter", "model", "workflow", "sessionId", "kind", "filename"];
const doneFields = ["requestId", "jobId", "model", "adapter", "workflow", "estimate", "steps", "filename", "url", "mediaType", "elapsed"];

function record(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
}
function pick(value: unknown, fields: string[]): Dict {
  const source = record(value);
  return Object.fromEntries(fields.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}
function projectJob(value: unknown): Dict {
  const job = record(value);
  return { ...pick(job, jobFields), ...(job.meta && typeof job.meta === "object" ? { meta: pick(job.meta, metaFields) } : {}) };
}
function projectJobStatus(value: Dict): Dict {
  return { job: projectJob(value.job ?? value), pollAfterSeconds: value.pollAfterSeconds,
    ...(value.timedOut !== undefined ? { timedOut: value.timedOut } : {}) };
}
function projectJobs(value: Dict): Dict {
  return { ...(Array.isArray(value.jobs) ? { jobs: value.jobs.map(projectJob) } : {}),
    ...(Array.isArray(value.terminalJobs) ? { terminalJobs: value.terminalJobs.map(projectJob) } : {}) };
}
function catalogFilters(args: Dict) {
  return {
    ...(typeof args.kind === "string" ? { kind: args.kind } : {}),
    ...(typeof args.vendor === "string" ? { vendor: args.vendor } : {}),
    ...(typeof args.task === "string" ? { task: args.task } : {}),
    ...(typeof args.model === "string" ? { model: args.model } : {}),
    ...(typeof args.adapter === "string" ? { adapter: args.adapter } : {}),
    ...(typeof args.keyed === "boolean" ? { keyed: args.keyed } : {}),
    ...(typeof args.maxUsd === "number" ? { maxUsd: args.maxUsd } : {}),
  };
}
export function projectCompletion(value: Dict): Dict {
  return { ...pick(value, doneFields), ...(Array.isArray(value.outputs) ? { outputs: value.outputs.map((item) => pick(item, outputFields)) } : {}) };
}
export function waitOptions(args: Dict, options: HandlerOptions, defaultSeconds: number) {
  return { timeoutMs: (typeof args.timeoutSec === "number" ? args.timeoutSec : defaultSeconds) * 1000,
    signal: options.signal, ...(options.onEvent ? { onEvent: options.onEvent } : {}) };
}
export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new MediaApiError("MEDIA_WAIT_ABORTED", "Waiting was aborted; the job may still be running.");
}
async function mediaResult(base: string, args: Dict): Promise<Dict> {
  const data = await mediaApi.result(base, String(args.requestId));
  const outputs = data.outputs.map((item) => pick(item, outputFields));
  return { requestId: data.requestId, outputs,
    ...(typeof args.saveDir === "string" ? { paths: await mediaApi.saveOutputs(base, outputs, args.saveDir) } : {}) };
}
async function mediaHistory(base: string, args: Dict): Promise<Dict> {
  const cursor = args.cursor as { before: string | number; beforeFilename: string } | undefined;
  const data = await mediaApi.history(base, { ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    ...(typeof args.kind === "string" ? { kind: args.kind } : {}), ...(cursor ? { cursor } : {}) });
  return { ...data, items: data.items.map((item) => pick(item, outputFields)) };
}
async function mediaSubmit(base: string, args: Dict, options: HandlerOptions): Promise<Dict> {
  const { requestId, wait, timeoutSec: _timeoutSec, ...body } = args;
  assertNotAborted(options.signal);
  const data = await mediaApi.submitMedia(base, mediaApi.normalizeMediaBody(body), {
    requestId: String(requestId), wait: wait === true, ...waitOptions(args, options, 600),
  });
  return projectCompletion(data);
}
export async function handleMedia(base: string, name: string, args: Dict, options: HandlerOptions): Promise<Dict> {
  switch (name) {
    case "media_catalog": return mediaApi.publicCatalog(await mediaApi.catalog(base, catalogFilters(args)));
    case "media_keys_status": return mediaApi.keyStatus(base, { redact: true });
    case "media_estimate": return mediaApi.estimate(base, mediaApi.normalizeMediaBody(args));
    case "media_submit": return mediaSubmit(base, args, options);
    case "media_job_status": return projectJobStatus(await mediaApi.jobStatus(base, String(args.requestId)));
    case "media_wait": return projectJobStatus(await mediaApi.waitJob(base, String(args.requestId), waitOptions(args, options, 60)));
    case "media_jobs": return projectJobs(await mediaApi.jobs(base, args.all === true));
    case "media_cancel": return mediaApi.cancel(base, String(args.requestId));
    case "media_result": return mediaResult(base, args);
    case "media_history": return mediaHistory(base, args);
    default: throw new MediaApiError("MCP_TOOL_UNKNOWN", `Unknown media tool: ${name}`);
  }
}
