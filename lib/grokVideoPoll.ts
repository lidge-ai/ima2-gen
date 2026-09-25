import { thrownFields } from "./errInfo.js";
/**
 * Grok video polling: one status read, and the loop that waits for a render to finish.
 *
 * Split out of grokVideoAdapter.ts so the adapter stays under the 500-line limit and so
 * the dependency runs one way (adapter -> poll -> shared). This module never imports the
 * adapter.
 *
 * Polling is a GET against an existing job id, so it is safe to retry: a network blip must
 * not discard a render that can take fifteen minutes.
 */
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { grokError } from "./grokImageCore.js";
import { grokFetchWithRetry } from "./grokUpstreamRetry.js";
import type { GrokCredential } from "./grokRuntime.js";
import {
  FAILED_CODE_MAP,
  STALE_PROGRESS_MS,
  normalizeVideoPoll,
  sleep,
  videoConfig,
  videoEndpoint,
  withTimeoutSignal,
  type GrokVideoOptions,
  type GrokVideoPollResult,
  type XaiVideoPollJson,
} from "./grokVideoShared.js";

/** Poll failures that say nothing about the job itself and may be waited out. */
const RECOVERABLE_POLL_CODES = new Set(["GROK_VIDEO_POLL_FAILED", "GROK_VIDEO_TIMEOUT"]);

export function isRecoverablePollError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  if (!RECOVERABLE_POLL_CODES.has(code)) return false;
  const status = (err as { status?: unknown }).status;
  // A 4xx means the request itself is wrong (bad id, revoked auth) — not transient.
  return typeof status !== "number" || status >= 500 || status === 429;
}

export async function pollVideoOnce(
  ctx: RouteRuntimeContext,
  requestId: string,
  signal?: AbortSignal,
  credential?: GrokCredential,
): Promise<GrokVideoPollResult> {
  const cfg = videoConfig(ctx);
  const { url, headers } = videoEndpoint(ctx, `/v1/videos/${requestId}`, credential);
  const { combinedSignal, timer } = withTimeoutSignal(signal, cfg.startTimeoutMs);
  try {
    const res = await grokFetchWithRetry(
      () => fetch(url, { method: "GET", headers, signal: combinedSignal }),
      { signal: combinedSignal, label: "video-poll" },
    );
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw grokError(`Grok video poll failed: ${text || `HTTP ${res.status}`}`, res.status >= 500 ? 502 : res.status, "GROK_VIDEO_POLL_FAILED");
    }
    const pollData = await res.json() as XaiVideoPollJson;
    return normalizeVideoPoll(pollData);
  } catch (e: unknown) {
    const eFields = thrownFields(e);
    clearTimeout(timer);
    if (eFields.name === "AbortError") {
      if (signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
      throw grokError("Grok video poll timed out", 504, "GROK_VIDEO_TIMEOUT");
    }
    if (eFields.code && eFields.status) throw e;
    throw grokError(`Grok video poll request failed: ${eFields.message}`, 502, "GROK_VIDEO_POLL_FAILED");
  }
}

export function failedToError(poll: GrokVideoPollResult): Error {
  if (poll.status === "expired") return grokError("Grok video job expired", 502, "GROK_VIDEO_EXPIRED");
  const mapped = poll.failedCode ? FAILED_CODE_MAP[poll.failedCode] : undefined;
  if (mapped) return grokError(`Grok video failed: ${poll.failedCode}`, mapped.status, mapped.code);
  return grokError("Grok video generation failed", 502, "GROK_VIDEO_FAILED");
}

export async function pollVideoUntilDone(
  ctx: RouteRuntimeContext,
  requestId: string,
  options: GrokVideoOptions,
): Promise<GrokVideoPollResult> {
  const cfg = videoConfig(ctx);
  const deadline = Date.now() + cfg.totalTimeoutMs;
  let lastProgress = -1;
  let lastProgressAt = Date.now();
  let consecutiveErrors = 0;
  for (;;) {
    if (Date.now() > deadline) throw grokError("Grok video poll budget exceeded", 504, "GROK_VIDEO_TIMEOUT");
    let poll: GrokVideoPollResult;
    try {
      poll = await pollVideoOnce(ctx, requestId, options.signal, options.credential);
      consecutiveErrors = 0;
    } catch (e: unknown) {
      const eFields = thrownFields(e);
      // The upstream job outlives a transient poll failure, so a blip must not discard a
      // fifteen-minute render. Cancellation and a genuinely dead job still end the wait,
      // and the outer deadline still caps the total.
      if (eFields.code === "GENERATION_CANCELED" || !isRecoverablePollError(e)) throw e;
      consecutiveErrors += 1;
      if (consecutiveErrors > cfg.pollMaxConsecutiveErrors) throw e;
      console.warn(`[grok] video poll failed (${consecutiveErrors}/${cfg.pollMaxConsecutiveErrors}) — ${eFields.message}`);
      options.onEvent?.({ phase: "progress", progress: lastProgress >= 0 ? lastProgress : undefined, stalled: true });
      await sleep(cfg.pollIntervalMs, options.signal);
      continue;
    }
    if (poll.status === "done") return poll;
    if (poll.status === "failed" || poll.status === "expired") throw failedToError(poll);
    const progress = poll.progress ?? lastProgress;
    if (progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = Date.now();
    }
    const stalled = Date.now() - lastProgressAt > STALE_PROGRESS_MS;
    options.onEvent?.({ phase: "progress", progress: poll.progress, stalled });
    await sleep(cfg.pollIntervalMs, options.signal);
  }
}
