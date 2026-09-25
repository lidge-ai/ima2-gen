import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from "node:stream/web";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { grokError } from "./grokImageAdapter.js";
import { grokFetchWithRetry } from "./grokUpstreamRetry.js";

const MAX_VIDEO_DOWNLOAD_BYTES = 100 * 1024 * 1024;

function downloadTimeoutMs(ctx: RouteRuntimeContext): number {
  const g = ctx.config?.grokProvider || {};
  return g.videoDownloadTimeoutMs || 300_000;
}

function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  return { combinedSignal, timer };
}

export function isMp4Container(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function videoDownloadFailure(message: string): Error {
  return grokError(message, 502, "GROK_VIDEO_DOWNLOAD_FAILED");
}

function assertVideoDownloadUrl(url: string): void {
  const parsed = new URL(url);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw videoDownloadFailure("Grok video download URL must be HTTPS");
  }
}

function assertDeclaredVideoLength(res: Response, maxBytes: number): void {
  const contentLength = Number(res.headers.get("content-length") || "0");
  if (contentLength > maxBytes) {
    throw videoDownloadFailure("Grok video download exceeds the 100MB limit");
  }
}

function videoDownloadContentType(res: Response): string {
  if (!res.ok) throw videoDownloadFailure(`Grok video download failed: HTTP ${res.status}`);
  assertDeclaredVideoLength(res, MAX_VIDEO_DOWNLOAD_BYTES);
  const contentType = res.headers.get("content-type") || "video/mp4";
  if (!/^video\/mp4\b/i.test(contentType) && !/^application\/octet-stream\b/i.test(contentType)) {
    throw videoDownloadFailure("Grok video download returned a non-video response");
  }
  return contentType;
}

function cancelVideoBodyBestEffort(target?: { cancel(reason?: unknown): Promise<void> } | null): void {
  try {
    const cancellation = target?.cancel("video download rejected");
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Cleanup must neither replace the original failure nor delay settlement.
  }
}

async function readVideoChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  let onAbort = () => {};
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Internal byte-limit seam; public download callers always use the fixed cap. */
export async function readVideoDownloadBody(
  res: Response, signal: AbortSignal, maxBytes = MAX_VIDEO_DOWNLOAD_BYTES,
): Promise<Buffer> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Buffer[] = [];
  const prefix = Buffer.alloc(12);
  let total = 0;
  let complete = false;
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new RangeError("Invalid internal video byte limit");
    }
    assertDeclaredVideoLength(res, maxBytes);
    if (!res.body) throw videoDownloadFailure("Grok video download was empty");
    reader = res.body.getReader();
    while (true) {
      const { done, value } = await readVideoChunk(reader, signal);
      signal.throwIfAborted();
      if (done) break;
      if (value.byteLength > maxBytes - total) {
        throw videoDownloadFailure("Grok video download exceeds the 100MB limit");
      }
      if (value.byteLength === 0) continue;
      const chunk = Buffer.from(value);
      if (total < 12) chunk.copy(prefix, total, 0, Math.min(chunk.length, 12 - total));
      total += chunk.byteLength;
      chunks.push(chunk);
    }
    if (total === 0) throw videoDownloadFailure("Grok video download was empty");
    if (!isMp4Container(prefix.subarray(0, Math.min(total, 12)))) {
      throw videoDownloadFailure("Grok video download returned an invalid MP4 container");
    }
    signal.throwIfAborted();
    const buffer = Buffer.concat(chunks, total);
    complete = true;
    return buffer;
  } finally {
    chunks.length = 0;
    if (!complete) cancelVideoBodyBestEffort(reader ?? res.body);
    try { reader?.releaseLock(); } catch { /* Preserve the original result. */ }
  }
}

function mapVideoDownloadError(
  error: unknown, caller: AbortSignal | undefined, combined: AbortSignal,
): unknown {
  if (caller?.aborted) return grokError("Generation canceled", 499, "GENERATION_CANCELED");
  if (combined.aborted) return grokError("Grok video download timed out", 504, "GROK_VIDEO_TIMEOUT");
  const fields = error !== null && (typeof error === "object" || typeof error === "function")
    ? error as { name?: unknown; code?: unknown; status?: unknown } : undefined;
  if (fields?.name === "AbortError") {
    return grokError("Grok video download timed out", 504, "GROK_VIDEO_TIMEOUT");
  }
  if (fields?.code && fields.status) return error;
  if (fields?.name === "TimeoutError") {
    return grokError("Grok video download timed out", 504, "GROK_VIDEO_TIMEOUT");
  }
  const detail = error instanceof Error && typeof error.message === "string" ? error.message : "Unknown error";
  return videoDownloadFailure(`Grok video download request failed: ${detail}`);
}

export async function downloadVideo(ctx: RouteRuntimeContext, url: string, signal?: AbortSignal): Promise<{ buffer: Buffer; contentType: string }> {
  const { combinedSignal, timer } = withTimeoutSignal(signal, downloadTimeoutMs(ctx));
  let response: Response | undefined;
  let readerOwnsBody = false;
  try {
    combinedSignal.throwIfAborted();
    assertVideoDownloadUrl(url);
    // Safe to replay: downloading a finished artifact creates nothing upstream.
    response = await grokFetchWithRetry(
      () => fetch(url, { signal: combinedSignal }),
      { signal: combinedSignal, label: "video-download" },
    );
    combinedSignal.throwIfAborted();
    const contentType = videoDownloadContentType(response);
    readerOwnsBody = true;
    const buffer = await readVideoDownloadBody(response, combinedSignal);
    combinedSignal.throwIfAborted();
    return { buffer, contentType };
  } catch (error: unknown) {
    throw mapVideoDownloadError(error, signal, combinedSignal);
  } finally {
    clearTimeout(timer);
    if (!readerOwnsBody) cancelVideoBodyBestEffort(response?.body);
  }
}
