/** Minimal text/event-stream parser that works on any fetch ReadableStream (browser or Node). */
export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

interface Pending {
  id?: string;
  event?: string;
  data: string[];
}

function applyField(pending: Pending, line: string): void {
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? "" : line.slice(colon + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  if (field === "data") pending.data.push(value);
  else if (field === "event") pending.event = value;
  else if (field === "id" && !value.includes("\0")) pending.id = value;
}

function flush(pending: Pending): SseMessage | null {
  if (pending.data.length === 0 && pending.event === undefined) return null;
  const message: SseMessage = { event: pending.event || "message", data: pending.data.join("\n") };
  if (pending.id !== undefined) message.id = pending.id;
  return message;
}

/** Splits buffered text into complete lines, returning the unfinished tail. */
function takeLines(buffer: string): { lines: string[]; rest: string } {
  const trailingCr = buffer.endsWith("\r");
  const parts = (trailingCr ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/);
  const rest = (parts.pop() ?? "") + (trailingCr ? "\r" : "");
  return { lines: parts, rest };
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: Pending = { data: [] };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = takeLines(buffer);
      buffer = rest;
      for (const line of lines) {
        if (line === "") {
          const message = flush(pending);
          pending = { data: [] };
          if (message) yield message;
        } else if (!line.startsWith(":")) {
          applyField(pending, line);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
