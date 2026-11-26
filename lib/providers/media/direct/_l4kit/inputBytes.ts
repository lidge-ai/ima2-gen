/**
 * Multipart vendors need file bytes. With inputTransport "inline" the runner
 * passes bytes as bytes and a public https URL as a URL (lanes/L0.md, notice 1),
 * so a URL input is fetched here through ctx.fetch, without any credential and
 * with a size cap.
 */
import type { MediaAdapterContext, MediaInput, MediaSubmitRequest } from "../../contract.js";
import { fail } from "./errors.js";

export const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;

export interface ResolvedInput { bytes: Uint8Array; mimeType: string }

export async function resolveInputBytes(
  prefix: string, ctx: MediaAdapterContext, input: MediaInput, maxBytes = DEFAULT_MAX_INPUT_BYTES,
): Promise<ResolvedInput> {
  if (input.bytes) return { bytes: input.bytes, mimeType: input.mimeType };
  const url = input.url ? safeHttpsUrl(input.url) : undefined;
  if (!url) fail(prefix, "INPUT_URL_INVALID", `Input ${input.role} needs bytes or a public https URL`, { category: "invalid-request" });
  const res = await ctx.fetch(url, { method: "GET", ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (!res.ok) {
    fail(prefix, "INPUT_FETCH_FAILED", `Could not read input ${input.role} (HTTP ${res.status})`, { category: "invalid-request", status: res.status });
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) fail(prefix, "INPUT_TOO_LARGE", `Input ${input.role} exceeds ${maxBytes} bytes`, { category: "invalid-request" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) fail(prefix, "INPUT_TOO_LARGE", `Input ${input.role} exceeds ${maxBytes} bytes`, { category: "invalid-request" });
  const mimeType = input.mimeType || res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { bytes, mimeType };
}

function safeHttpsUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The same request with every URL input replaced by its bytes, for adapters that upload files. */
export async function withResolvedInputs(
  prefix: string, ctx: MediaAdapterContext, request: MediaSubmitRequest, maxBytes = DEFAULT_MAX_INPUT_BYTES,
): Promise<MediaSubmitRequest> {
  if (request.inputs.every((input) => input.bytes)) return request;
  const inputs = await Promise.all(request.inputs.map(async (input): Promise<MediaInput> => {
    if (input.bytes) return input;
    const resolved = await resolveInputBytes(prefix, ctx, input, maxBytes);
    return { role: input.role, bytes: resolved.bytes, mimeType: resolved.mimeType };
  }));
  return { ...request, inputs };
}
