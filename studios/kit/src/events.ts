import { readSse } from "./sse.ts";
import type { Http } from "./http.ts";
import { reduceJobEvent, type WireEventData } from "./jobReducer.ts";
import type { Job, JobEvent } from "./types.ts";

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

/**
 * Turns one SSE message into a job event, folding it into the job snapshot
 * kept in jobs. Returns null for events other APIs publish on the shared stream.
 */
export function toJobEvent(message: { id?: string; event: string; data: string }, jobs: Map<string, Job>): JobEvent | null {
  let data: WireEventData;
  try {
    data = JSON.parse(message.data) as WireEventData;
  } catch {
    return null;
  }
  const jobId = typeof data.requestId === "string" ? data.requestId : typeof data.jobId === "string" ? data.jobId : null;
  if (!jobId) return null;
  const reduced = reduceJobEvent(jobs.get(jobId), message.event, { ...data, requestId: jobId });
  if (!reduced) return null;
  jobs.set(jobId, reduced.job);
  return { id: Number(message.id ?? 0), event: reduced.event, jobId, job: reduced.job };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function readOnce(http: Http, options: SubscribeOptions, cursor: { id: number }, jobs: Map<string, Job>): Promise<void> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (cursor.id > 0) headers["Last-Event-ID"] = String(cursor.id);
  const init: RequestInit = { headers };
  if (options.signal) init.signal = options.signal;
  const response = await http.fetchImpl(http.url("/api/events"), init);
  if (!response.ok || !response.body) throw new Error("events stream refused: HTTP " + response.status);
  options.onStatus?.("open");
  for await (const message of readSse(response.body)) {
    if (message.id) cursor.id = Math.max(cursor.id, Number(message.id) || 0);
    if (message.event === "replay-gap") { options.onGap?.(); continue; }
    const event = toJobEvent(message, jobs);
    if (event) options.onEvent(event);
  }
}

/**
 * Follows GET /api/events until the signal aborts, resuming with Last-Event-ID
 * after every disconnect. Resolves when aborted.
 */
export async function followEvents(http: Http, options: SubscribeOptions, jobs: Map<string, Job> = new Map()): Promise<void> {
  const cursor = { id: options.lastEventId ?? 0 };
  const min = options.minDelayMs ?? 500;
  const max = options.maxDelayMs ?? 10_000;
  let delay = min;
  options.onStatus?.("connecting");
  while (!options.signal?.aborted) {
    try {
      await readOnce(http, options, cursor, jobs);
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
