import { openSse, sseFields, type OpenSseResult, type SseEvent } from "./sse.js";
import { MediaApiError, toMediaApiError } from "./mediaErrors.js";
export type WaitOptions = { timeoutMs: number; onEvent?: (event: SseEvent) => void; signal?: AbortSignal };
export async function openMediaSse(base: string, signal?: AbortSignal): Promise<OpenSseResult> {
  try { return await openSse(new URL("/api/events", base).href, { signal }); }
  catch (error) { throw toMediaApiError(error); }
}
export async function waitForJob(stream: OpenSseResult, id: string, options: WaitOptions): Promise<Record<string, unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new MediaApiError("MEDIA_WAIT_TIMEOUT", "Timed out waiting; the job is still running.")), options.timeoutMs);
    abort = () => reject(new MediaApiError("MEDIA_WAIT_ABORTED", "Waiting was aborted; the job may still be running."));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
  async function consume(): Promise<Record<string, unknown>> {
    for await (const event of stream.events) {
      if (event.event === "replay-gap") throw new MediaApiError("MEDIA_EVENTS_GAP", `Event replay gap; inspect: ima2 media status ${id}`);
      const data = sseFields(event.data);
      if (data.jobId !== id) continue;
      options.onEvent?.(event);
      if (event.event === "error") throw toMediaApiError(data);
      if (event.event === "done") return data;
    }
    throw new MediaApiError("MEDIA_EVENTS_GAP", `Event stream ended; inspect: ima2 media status ${id}`);
  }
  try { return await Promise.race([consume(), stopped]); }
  catch (error) { throw toMediaApiError(error); }
  finally { clearTimeout(timer); if (abort) options.signal?.removeEventListener("abort", abort); stream.close(); }
}
