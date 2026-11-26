import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaOutput, MediaProviderAdapter,
} from "../providers/media/contract.js";
import { fromProviderError, WorkflowError } from "./errors.js";
import type { ArtifactDraft, MediaStep, StepRuntime, WorkflowEvent, WorkflowGateway } from "./types.js";

export interface PollPolicy {
  minDelayMs: number;
  maxDelayMs: number;
  defaultDelayMs: number;
  timeoutMs: number;
  /** Consecutive retryable poll errors tolerated before the step fails. */
  maxPollErrors: number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
}

export const DEFAULT_POLL_POLICY: PollPolicy = {
  minDelayMs: 1_000,
  maxDelayMs: 15_000,
  defaultDelayMs: 4_000,
  timeoutMs: 30 * 60_000,
  maxPollErrors: 3,
  sleep: abortableSleep,
  now: () => Date.now(),
};

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface MediaRunDeps {
  runId: string;
  gateway: WorkflowGateway;
  poll: PollPolicy;
  emit(event: WorkflowEvent): void;
  /** Secrets seen so far in this run, for redaction. */
  secrets: string[];
}

function secretsOf(adapter: MediaProviderAdapter, ctx: Omit<MediaAdapterContext, "signal">): string[] {
  const extras = (adapter.credential.extraFields ?? []).filter((f) => f.secret).map((f) => ctx.extra?.[f.name] ?? "");
  return [ctx.apiKey, ...extras].filter((s) => s.length > 0);
}

async function prepareInput(adapter: MediaProviderAdapter, ctx: MediaAdapterContext, gateway: WorkflowGateway, input: MediaInput): Promise<MediaInput> {
  if (adapter.inputTransport === "inline") {
    if (input.bytes || !input.url) return input;
    const res = await gateway.fetch(input.url, ctx.signal ? { signal: ctx.signal } : {});
    if (!res.ok) throw new WorkflowError("WORKFLOW_INPUT_FETCH_FAILED", "could not read input " + input.role + " (HTTP " + res.status + ")", { status: 502 });
    return { role: input.role, mimeType: input.mimeType, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  if (input.url) return input;
  if (adapter.inputTransport === "upload") {
    if (!adapter.uploadInput) throw new WorkflowError("WORKFLOW_ADAPTER_INVALID", adapter.id + " declares upload transport without uploadInput", { status: 500 });
    const { url } = await adapter.uploadInput(ctx, input);
    return { role: input.role, mimeType: input.mimeType, url };
  }
  if (!gateway.publishInput) {
    throw new WorkflowError("WORKFLOW_INPUT_NEEDS_PUBLIC_URL", adapter.id + " only reads inputs by URL and no publisher is configured", { status: 400 });
  }
  const { url } = await gateway.publishInput(input, ctx.signal ?? new AbortController().signal);
  return { role: input.role, mimeType: input.mimeType, url };
}

async function download(output: MediaOutput, gateway: WorkflowGateway, signal: AbortSignal, stepId: string): Promise<ArtifactDraft> {
  const meta = output.expiresAt ? { expiresAt: output.expiresAt } : undefined;
  if (output.bytes) return { kind: output.kind, mimeType: output.mimeType, bytes: output.bytes, ...(meta ? { meta } : {}) };
  if (!output.url) throw new WorkflowError("WORKFLOW_OUTPUT_MISSING", "provider returned an output without data", { stepId, status: 502 });
  const init: RequestInit = { signal };
  if (output.downloadHeaders) init.headers = { ...output.downloadHeaders };
  const res = await gateway.fetch(output.url, init);
  if (!res.ok) throw new WorkflowError("WORKFLOW_DOWNLOAD_FAILED", "output download failed (HTTP " + res.status + ")", { stepId, status: 502, retryable: res.status >= 500 });
  return { kind: output.kind, mimeType: output.mimeType, bytes: new Uint8Array(await res.arrayBuffer()) };
}

function guard<T>(adapter: MediaProviderAdapter, stepId: string, secrets: readonly string[]) {
  return async (work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      if (error instanceof WorkflowError || isAbort(error) || (error as { name?: string })?.name === "AbortError") throw error;
      throw fromProviderError(adapter.normalizeError(error), stepId, secrets);
    }
  };
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as { code?: string }).code === "ABORT_ERR");
}

export interface MediaStepResult {
  drafts: ArtifactDraft[];
  billedUsd?: number;
}

/** Submits one media step, polls it to a terminal state and downloads the outputs. Never switches routes. */
export async function runMediaStep(step: MediaStep, rt: StepRuntime, deps: MediaRunDeps): Promise<MediaStepResult> {
  const { adapter, ctx: baseCtx } = await deps.gateway.resolve(step.model, step.route);
  deps.secrets.push(...secretsOf(adapter, baseCtx));
  const ctx: MediaAdapterContext = { ...baseCtx, signal: rt.signal };
  const call = guard<unknown>(adapter, step.id, deps.secrets);
  const request = await step.build(rt);
  const inputs = await call(Promise.all(request.inputs.map((input) => prepareInput(adapter, ctx, deps.gateway, input)))) as MediaInput[];
  const job = await call(adapter.submit(ctx, { ...request, inputs })) as MediaJobRef;
  let state: MediaJobState;
  try {
    state = await pollUntilDone(adapter, ctx, job, step.id, deps);
  } catch (error) {
    if (adapter.cancel && (rt.signal.aborted || (error as WorkflowError).code === "WORKFLOW_STEP_TIMEOUT")) {
      await adapter.cancel({ ...baseCtx }, job).catch(() => undefined);
    }
    throw error;
  }
  if (state.status !== "succeeded") throw new WorkflowError("WORKFLOW_INTERNAL", "unexpected state", { stepId: step.id, status: 500 });
  if (state.outputs.length === 0) throw new WorkflowError("WORKFLOW_OUTPUT_MISSING", "provider finished without outputs", { stepId: step.id, status: 502 });
  const drafts: ArtifactDraft[] = [];
  for (const output of state.outputs) drafts.push(await download(output, deps.gateway, rt.signal, step.id));
  return state.billed?.usd === undefined ? { drafts } : { drafts, billedUsd: state.billed.usd };
}

async function pollUntilDone(adapter: MediaProviderAdapter, ctx: MediaAdapterContext, job: MediaJobRef, stepId: string, deps: MediaRunDeps): Promise<MediaJobState> {
  const { poll } = deps;
  const signal = ctx.signal ?? new AbortController().signal;
  const deadline = poll.now() + poll.timeoutMs;
  let delay = job.pollAfterMs ?? poll.defaultDelayMs;
  let errors = 0;
  for (;;) {
    signal.throwIfAborted();
    if (poll.now() >= deadline) throw new WorkflowError("WORKFLOW_STEP_TIMEOUT", "provider did not finish in time", { stepId, status: 504, retryable: true });
    await poll.sleep(Math.min(poll.maxDelayMs, Math.max(poll.minDelayMs, delay)), signal);
    let state: MediaJobState;
    try {
      state = await adapter.poll(ctx, job);
      signal.throwIfAborted();
      errors = 0;
    } catch (error) {
      if (signal.aborted || isAbort(error)) throw error;
      const normalized = adapter.normalizeError(error);
      errors += 1;
      if (!normalized.retryable || errors > poll.maxPollErrors) throw fromProviderError(normalized, stepId, deps.secrets);
      continue;
    }
    if (state.status === "succeeded") return state;
    if (state.status === "failed") throw fromProviderError(state.error, stepId, deps.secrets);
    if (state.status === "canceled") throw new WorkflowError("WORKFLOW_STEP_CANCELED", "provider canceled the job", { stepId, status: 409 });
    deps.emit({ type: "step.progress", runId: deps.runId, stepId, state: state.status, ...(state.progress === undefined ? {} : { progress: state.progress }) });
    delay = state.pollAfterMs ?? poll.defaultDelayMs;
  }
}



