import { readSse } from "./sse.ts";
import type { Http } from "./http.ts";
import type { Job, JobEvent, JobEventName } from "./types.ts";

const JOB_EVENTS: ReadonlySet<string> = new Set<JobEventName>([
  "queued",
  "progress",
  "step",
  "done",
  "error",
  "canceled",
]);

export type StreamStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SubscribeOptions {
  onEvent: (event: JobEvent) => void;
  /** Called when the server could not replay everything since the last id; refetch job snapshots. */
  onGap?: () => void;
  onStatus?: (status: StreamStatus) => void;
  lastEventId?: number;
  signal?: AbortSignal;
  /** Reconnect backoff bounds in ms. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

/** Turns one SSE message into a job event, or null for events other APIs publish on the shared stream. */
export function toJobEvent(message: { id?: string; event: string; data: string }): JobEvent | null {
  if (!JOB_EVENTS.has(message.event)) return null;
  let payload: { jobId?: unknown; job?: unknown };
  try {
    payload = JSON.parse(message.data) as { jobId?: unknown; job?: unknown };
  } catch {
    return null;
  }
  const job = payload.job as Job | undefined;
  if (!job || typeof job !== "object" || (job.kind !== "media" && job.kind !== "workflow")) return null;
  const jobId = typeof payload.jobId === "string" ? payload.jobId : job.jobId;
  return { id: Number(message.id ?? 0), event: message.event as JobEventName, jobId, job };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function readOnce(http: Http, options: SubscribeOptions, cursor: { id: number }): Promise<void> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (cursor.id > 0) headers["Last-Event-ID"] = String(cursor.id);
  const init: RequestInit = { headers };
  if (options.signal) init.signal = options.signal;
  const response = await http.fetchImpl(http.url("/api/events"), init);
  if (!response.ok || !response.body) throw new Error("events stream refused: HTTP " + response.status);
  options.onStatus?.("open");
  for await (const message of readSse(response.body)) {
    if (message.id) cursor.id = Math.max(cursor.id, Number(message.id) || 0);
    if (message.event === "replay-gap") {
      options.onGap?.();
      continue;
    }
    const event = toJobEvent(message);
    if (event) options.onEvent(event);
  }
}

/**
 * Follows GET /api/events until the signal aborts, resuming with Last-Event-ID
 * after every disconnect. Resolves when aborted.
 */
export async function followEvents(http: Http, options: SubscribeOptions): Promise<void> {
  const cursor = { id: options.lastEventId ?? 0 };
  const min = options.minDelayMs ?? 500;
  const max = options.maxDelayMs ?? 10_000;
  let delay = min;
  options.onStatus?.("connecting");
  while (!options.signal?.aborted) {
    try {
      await readOnce(http, options, cursor);
      delay = min;
    } catch {
      if (options.signal?.aborted) break;
    }
    if (options.signal?.aborted) break;
    options.onStatus?.("reconnecting");
    await sleep(delay, options.signal);
    delay = Math.min(max, delay * 2);
  }
  options.onStatus?.("closed");
}
