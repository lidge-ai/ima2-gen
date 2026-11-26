import { openSse, sseUrlWithCursor, type OpenSseResult, type SseEvent } from "./sse.js";
import { normalizeTerminalStatus } from "../../lib/jobStatus.js";
import { fetchServer } from "./client.js";

const JOB_TRACKING_TIMEOUT_MESSAGE =
  "Job tracking expired; upstream completion is unknown. Inspect history before retrying.";

export interface McpJobOptions {
  serverBase: string;
  kind: "image" | "video";
  body: Record<string, unknown>;
  requestId: string;
  timeoutMs: number;
  json: boolean;
  onProgress?: (phase: string) => void | undefined;
  /** POST path override (default /api/mcp/generate; media actions use /api/mcp/media-action). */
  postPath?: string | undefined;
}

export interface McpJobResult {
  filename: string;
  url: string;
  meta: Record<string, unknown>;
}

export class McpJobError extends Error {
  code: string;
  status?: number | undefined;
  body?: unknown | undefined;

  constructor(code: string, message: string, options: { status?: number; body?: unknown } = {}) {
    super(message);
    this.name = "McpJobError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.body !== undefined) this.body = options.body;
  }
}

type StreamOutcome =
  | { kind: "done"; result: McpJobResult; lastEventId?: string | undefined }
  | { kind: "error"; error: McpJobError; lastEventId?: string | undefined }
  | { kind: "replay-gap"; lastEventId?: string | undefined }
  | { kind: "dropped"; lastEventId?: string | undefined };

function baseUrl(serverBase: string): string {
  return serverBase.replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeError(error: unknown, fallbackCode = "MCP_JOB_FAILED"): McpJobError {
  if (error instanceof McpJobError) return error;
  const value = error as { code?: unknown; message?: unknown; status?: unknown; body?: unknown };
  return new McpJobError(
    typeof value?.code === "string" && value.code ? value.code : fallbackCode,
    typeof value?.message === "string" && value.message ? value.message : String(error),
    {
      ...(typeof value?.status === "number" ? { status: value.status } : {}),
      ...(value?.body !== undefined ? { body: value.body } : {}),
    },
  );
}

async function responseError(response: Response): Promise<McpJobError> {
  try {
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* retain text */ }
    const envelope = asRecord(body) ?? {};
    const nested = asRecord(envelope.error) ?? {};
    const code = String(nested.code ?? envelope.code ?? "MCP_JOB_REJECTED");
    const message = String(nested.message ?? envelope.message ?? envelope.error ?? `HTTP ${response.status}`);
    return new McpJobError(code, message, { status: response.status, body });
  } catch (error) {
    return new McpJobError("MCP_JOB_REJECTED", `HTTP ${response.status}`, {
      status: response.status,
      body: error,
    });
  }
}

async function submitJob(opts: McpJobOptions, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetchServer(opts.serverBase, opts.postPath ?? "/api/mcp/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...opts.body, kind: opts.kind, requestId: opts.requestId }),
      signal,
    });
    if (response.status !== 202) throw await responseError(response);
    await response.arrayBuffer();
  } catch (error) {
    throw normalizeError(error, "MCP_JOB_SUBMIT_FAILED");
  }
}

function doneResult(data: Record<string, unknown>): StreamOutcome {
  if (typeof data.filename !== "string" || typeof data.url !== "string") {
    return {
      kind: "error",
      error: new McpJobError("MCP_JOB_INVALID_EVENT", "MCP done event is missing filename or url"),
    };
  }
  return {
    kind: "done",
    result: { filename: data.filename, url: data.url, meta: data },
  };
}

/** Human-readable failure text. Non-MCP producers put it in data.error; MCP routes use data.message. */
function errorMessage(data: Record<string, unknown>): string {
  if (typeof data.error === "string" && data.error) return data.error;
  if (typeof data.message === "string" && data.message) return data.message;
  return "MCP job failed";
}

/** Defensive code fallback per canonical phase; producers normally supply data.code. */
function fallbackCode(phase: string): string {
  if (phase === "cancelled") return "GENERATION_CANCELED";
  if (phase === "timed_out") return "MCP_JOB_TIMEOUT";
  return "MCP_JOB_FAILED";
}

function matchingOutcome(event: SseEvent, opts: McpJobOptions): StreamOutcome | null {
  if (event.event === "replay-gap") return { kind: "replay-gap", lastEventId: event.id };
  const data = asRecord(event.data);
  if (!data || data.jobId !== opts.requestId) return null;
  if (event.event === "progress") {
    if (typeof data.phase === "string") opts.onProgress?.(data.phase);
    return null;
  }
  // #151 stage 2: the canonical envelope is the primary terminal signal. The
  // event-name branches below stay as the fallback for servers that predate it.
  const envelope = asRecord(data.envelope);
  if (envelope && envelope.terminal === true) {
    const phase = String(envelope.phase ?? "");
    if (phase === "completed") {
      // Only a real done event carries filename/url; a non-done event with a
      // completed envelope falls through rather than minting an invalid-event
      // error.
      if (event.event === "done") return doneResult(data);
    } else {
      const envErr = asRecord(envelope.error);
      const code = typeof envErr?.code === "string" ? envErr.code
        : typeof data.code === "string" ? data.code : fallbackCode(phase);
      return {
        kind: "error",
        error: code === "JOB_TRACKING_TIMEOUT"
          ? new McpJobError(code, JOB_TRACKING_TIMEOUT_MESSAGE, { status: 504 })
          : new McpJobError(code, errorMessage(data)),
      };
    }
  }
  if (event.event === "done") return doneResult(data);
  if (event.event === "error") {
    const code = typeof data.code === "string" ? data.code : "MCP_JOB_FAILED";
    return {
      kind: "error",
      error: code === "JOB_TRACKING_TIMEOUT"
        ? new McpJobError(code, JOB_TRACKING_TIMEOUT_MESSAGE, { status: 504 })
        : new McpJobError(code, typeof data.message === "string" ? data.message : "MCP job failed"),
    };
  }
  return null;
}

/** Rejects once signal aborts, so a body iterator that never observes the abort cannot outlive the deadline. */
function abortRace(signal: AbortSignal): { promise: Promise<never>; dispose(): void } {
  let onAbort = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(() => { /* observed through Promise.race below */ });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

async function consumeStream(stream: OpenSseResult, opts: McpJobOptions, signal: AbortSignal): Promise<StreamOutcome> {
  // Keep the server's pre-job bookmark until an event is actually observed.
  // This makes an EOF before the first frame recoverable without reposting.
  let lastEventId: string | undefined = stream.initialEventId;
  const abort = abortRace(signal);
  try {
    while (true) {
      const next = await Promise.race([stream.events.next(), abort.promise]);
      if (next.done) break;
      const event = next.value;
      if (event.id !== undefined) lastEventId = event.id;
      const outcome = matchingOutcome(event, opts);
      if (outcome) return { ...outcome, lastEventId: outcome.lastEventId ?? lastEventId };
    }
    return { kind: "dropped", lastEventId };
  } catch {
    return { kind: "dropped", lastEventId };
  } finally {
    abort.dispose();
  }
}

function terminalResult(job: Record<string, unknown>): McpJobResult | McpJobError | null {
  const status = String(job.status ?? "");
  const meta = asRecord(job.meta) ?? {};
  const normalized = normalizeTerminalStatus(status);
  if (normalized === "error") {
    if (job.errorCode === "JOB_TRACKING_TIMEOUT") {
      return new McpJobError("JOB_TRACKING_TIMEOUT", JOB_TRACKING_TIMEOUT_MESSAGE, { status: 504 });
    }
    return new McpJobError(
      typeof job.errorCode === "string" ? job.errorCode : "MCP_JOB_FAILED",
      typeof meta.message === "string" ? meta.message : "MCP job failed",
    );
  }
  // A canceled job is terminal too. Falling through would report the generic
  // SSE_REPLAY_GAP instead of telling the caller the job was canceled.
  if (normalized === "canceled") {
    return new McpJobError(
      typeof job.errorCode === "string" ? job.errorCode : "GENERATION_CANCELED",
      typeof meta.message === "string" ? meta.message : "MCP job was canceled",
    );
  }
  // Accept every success spelling, not just "done": finishJob defaults to
  // "completed", so a route that omits the status used to strand recovery.
  if (normalized !== "done" || typeof meta.filename !== "string") return null;
  return {
    filename: meta.filename,
    url: typeof meta.url === "string" ? meta.url : `/generated/${encodeURIComponent(meta.filename)}`,
    meta: { ...meta, requestId: job.requestId, status },
  };
}

async function recoverReplayGap(opts: McpJobOptions, signal: AbortSignal): Promise<McpJobResult> {
  try {
    const response = await fetchServer(opts.serverBase, "/api/inflight?includeTerminal=1", { signal });
    if (!response.ok) throw await responseError(response);
    const envelope = asRecord(await response.json()) ?? {};
    const jobs = Array.isArray(envelope.terminalJobs) ? envelope.terminalJobs : [];
    const match = jobs.map(asRecord).find((job) => job?.requestId === opts.requestId);
    const terminal = match ? terminalResult(match) : null;
    if (terminal instanceof McpJobError) throw terminal;
    if (terminal) return terminal;
    throw new McpJobError("SSE_REPLAY_GAP", `Cannot recover terminal state for ${opts.requestId}`);
  } catch (error) {
    throw normalizeError(error, "SSE_REPLAY_GAP");
  }
}

async function waitForTerminal(
  opts: McpJobOptions,
  initial: OpenSseResult,
  signal: AbortSignal,
): Promise<McpJobResult> {
  let stream = initial;
  let lastEventId: string | undefined;
  try {
    while (true) {
      const outcome = await consumeStream(stream, opts, signal);
      if (outcome.lastEventId !== undefined) lastEventId = outcome.lastEventId;
      if (outcome.kind === "done") return outcome.result;
      if (outcome.kind === "error") throw outcome.error;
      if (outcome.kind === "replay-gap") return await recoverReplayGap(opts, signal);
      stream.close();
      stream = await openSse(sseUrlWithCursor(opts.serverBase, "/api/events", lastEventId), { signal });
    }
  } catch (error) {
    throw normalizeError(error);
  } finally {
    stream.close();
  }
}

export async function runMcpJob(opts: McpJobOptions): Promise<McpJobResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, opts.timeoutMs));
  let initial: OpenSseResult | undefined;
  try {
    initial = await openSse(`${baseUrl(opts.serverBase)}/api/events`, { signal: controller.signal });
    await submitJob(opts, controller.signal);
    return await waitForTerminal(opts, initial, controller.signal);
  } catch (error) {
    if (timedOut) throw new McpJobError("MCP_JOB_TIMEOUT", `MCP ${opts.kind} job timed out`);
    throw normalizeError(error);
  } finally {
    clearTimeout(timer);
    initial?.close();
    controller.abort();
  }
}
