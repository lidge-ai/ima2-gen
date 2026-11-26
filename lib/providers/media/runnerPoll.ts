import type { MediaAdapterContext, MediaJobRef, MediaJobState, MediaProviderAdapter, MediaProviderError } from "./contract.js";
import { MediaJobError, mediaJobErrorFromProvider } from "./errors.js";
import { redactSecrets } from "./redact.js";
import { DEFAULT_MAX_WAIT_MS, DEFAULT_POLL_MS, MAX_POLL_MS, MAX_POLL_RETRIES, MIN_POLL_MS, type MediaRunnerDeps } from "./runnerTypes.js";

export type TerminalState = Exclude<MediaJobState, { status: "queued" | "running" }>;

export function clampPollMs(ms: number | undefined): number {
  const v = typeof ms === "number" && Number.isFinite(ms) ? ms : DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, v));
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** adapter.normalizeError, guarded: a throwing normalizer still yields a contract-shaped error without secrets. */
export function normalizeAdapterError(adapter: MediaProviderAdapter, error: unknown, secrets: readonly string[]): MediaProviderError {
  let normalized: MediaProviderError;
  try {
    normalized = adapter.normalizeError(error);
  } catch {
    normalized = { code: `${adapter.errorPrefix}_UNKNOWN`, message: "Provider error", retryable: false, category: "unknown" };
  }
  return { ...normalized, message: redactSecrets(String(normalized.message ?? ""), secrets) };
}

export function adapterJobError(adapter: MediaProviderAdapter, error: unknown, secrets: readonly string[]): MediaJobError {
  if (error instanceof MediaJobError) return error;
  return mediaJobErrorFromProvider(normalizeAdapterError(adapter, error, secrets));
}

export interface PollLoopArgs {
  deps: MediaRunnerDeps;
  adapter: MediaProviderAdapter;
  actx: MediaAdapterContext;
  job: MediaJobRef;
  signal: AbortSignal;
  secrets: readonly string[];
  onProgress: (state: { status: "queued" | "running"; progress?: number | undefined }) => void;
}

async function pollOnce(args: PollLoopArgs, failures: number): Promise<{ state?: MediaJobState; failures: number }> {
  try {
    return { state: await args.adapter.poll(args.actx, args.job), failures: 0 };
  } catch (error) {
    if (args.signal.aborted) throw error;
    const err = normalizeAdapterError(args.adapter, error, args.secrets);
    if (!err.retryable || failures + 1 > MAX_POLL_RETRIES) throw mediaJobErrorFromProvider(err);
    return { failures: failures + 1 };
  }
}

/** Polls one job until it is terminal. Retries retryable poll errors on the same job only. */
export async function pollUntilTerminal(args: PollLoopArgs): Promise<TerminalState> {
  const sleep = args.deps.sleep ?? abortableSleep;
  const deadline = Date.now() + (args.deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  let delay = clampPollMs(args.job.pollAfterMs);
  let failures = 0;
  for (;;) {
    await sleep(delay, args.signal);
    if (Date.now() > deadline) {
      throw new MediaJobError("MEDIA_TIMEOUT", "The provider did not finish in time", { status: 504, category: "timeout", retryable: true });
    }
    const step = await pollOnce(args, failures);
    failures = step.failures;
    if (!step.state) { delay = clampPollMs(delay * 2); continue; }
    const state: MediaJobState = step.state;
    if (state.status === "queued" || state.status === "running") {
      args.onProgress({ status: state.status, progress: state.progress });
      delay = clampPollMs(state.pollAfterMs);
      continue;
    }
    return state as TerminalState;
  }
}
