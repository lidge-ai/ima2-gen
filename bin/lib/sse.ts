// SSE consumer for CLI streaming endpoints. Plain fetch + line-based parser, no external libs.

import { parseEventCursor } from "../../lib/eventsPolicy.js";
import { fetchServerUrl } from "./client.js";

let CLI_VERSION = "0.0.0";
export function setCliVersion(v: string) { CLI_VERSION = v; }

export type SseEvent = { event: string; data: unknown; id?: string };

/** Field view of an SSE payload; non-object payloads expose no fields. */
export function sseFields(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export interface SseInit {
  method?: string | undefined;
  body?: unknown | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
}

export interface OpenSseResult {
  events: AsyncGenerator<SseEvent>;
  /** Validated pre-replay bookmark, available before the caller submits a job. */
  initialEventId?: string;
  close(): void;
}

type CodedError = Error & { code?: string; status?: number; body?: unknown };

function requestHeaders(init: SseInit): Record<string, string> {
  return {
    Accept: "text/event-stream",
    ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    "X-ima2-client": `cli/${CLI_VERSION}`,
    ...(init.headers || {}),
  };
}

function abortError(error: unknown): boolean {
  return (error as { name?: string })?.name === "AbortError";
}

async function errorFromResponse(res: Response): Promise<CodedError> {
  try {
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* retain text */ }
    const envelope = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = envelope.error && typeof envelope.error === "object"
      ? envelope.error as Record<string, unknown>
      : {};
    const message = String(nested.message ?? envelope.message ?? envelope.error ?? `SSE failed: HTTP ${res.status}`);
    const error = new Error(message) as CodedError;
    error.status = res.status;
    error.code = String(nested.code ?? envelope.code ?? "SSE_HTTP_ERROR");
    error.body = body;
    return error;
  } catch (error) {
    const fallback = new Error(`SSE failed: HTTP ${res.status}`) as CodedError;
    fallback.status = res.status;
    fallback.code = "SSE_HTTP_ERROR";
    fallback.body = error;
    return fallback;
  }
}

function frameBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

async function* parseBody(
  body: ReadableStream<Uint8Array> | null,
  closed: () => boolean,
): AsyncGenerator<SseEvent> {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = frameBoundary(buffer);
      while (boundary) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = frameBoundary(buffer);
      }
    }
  } catch (error) {
    if (closed() && abortError(error)) return;
    throw error;
  }
}

async function openWithMethod(url: string, init: SseInit, defaultMethod: string): Promise<OpenSseResult> {
  const controller = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };
  const forwardAbort = () => close();
  init.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (init.signal?.aborted) close();
  try {
    const res = await fetchServerUrl(url, {
      method: init.method || defaultMethod,
      headers: requestHeaders(init),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      close();
      throw await errorFromResponse(res);
    }
    const cursorHeader = res.headers.get("x-ima2-event-cursor");
    if (cursorHeader !== null && parseEventCursor(cursorHeader) === null) {
      close();
      throw new Error("SSE_INVALID_EVENT_CURSOR");
    }
    const events = parseBody(res.body, () => closed);
    return {
      events,
      ...(cursorHeader !== null ? { initialEventId: cursorHeader } : {}),
      close: () => {
        init.signal?.removeEventListener("abort", forwardAbort);
        close();
      },
    };
  } catch (error) {
    init.signal?.removeEventListener("abort", forwardAbort);
    close();
    throw error;
  }
}

/** Opens a GET SSE stream and resolves as soon as response headers are accepted. */
export async function openSse(url: string, init: SseInit = {}): Promise<OpenSseResult> {
  try {
    return await openWithMethod(url, init, "GET");
  } catch (error) {
    throw error;
  }
}

/** Existing POST-default streaming interface retained for generation consumers. */
export async function* streamSse(url: string, init: SseInit = {}): AsyncGenerator<SseEvent> {
  let stream: OpenSseResult | undefined;
  try {
    stream = await openWithMethod(url, init, "POST");
    for await (const event of stream.events) yield event;
  } catch (error) {
    if (init.signal?.aborted && abortError(error)) return;
    throw error;
  } finally {
    stream?.close();
  }
}

export function sseUrlWithCursor(base: string, path: string, lastEventId?: string): string {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  if (lastEventId !== undefined && lastEventId !== "") {
    url.searchParams.set("lastEventId", lastEventId);
  }
  return url.toString();
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("id:")) id = line.slice(3).replace(/^\s/, "");
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw), ...(id !== undefined ? { id } : {}) };
  } catch {
    return { event, data: raw, ...(id !== undefined ? { id } : {}) };
  }
}
