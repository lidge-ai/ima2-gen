import { api88Error } from "./errors.js";
import { detectImageMimeFromB64 } from "../refs.js";

export async function downloadApi88Bytes(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  if (!/^https:\/\//.test(url)) throw api88Error("API88_DOWNLOAD_FAILED", "88API result URL must use HTTPS", 502);
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "follow", credentials: "omit" });
    if (!response.ok || !response.body) throw api88Error("API88_DOWNLOAD_FAILED", `88API result download HTTP ${response.status}`, 502);
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body.cancel();
      throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
    }
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
        chunks.push(chunk.value);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (typeof (error as { code?: unknown }).code === "string") throw error;
    throw api88Error("API88_DOWNLOAD_FAILED", "88API result download failed", 502);
  }
}

export function parseApi88ImageBytes(bytes: Buffer, maxBytes: number) {
  if (bytes.length === 0 || bytes.length > maxBytes) throw api88Error("API88_IMAGE_INVALID", "88API returned empty or oversized image bytes", 502);
  const b64 = bytes.toString("base64");
  const mime = detectImageMimeFromB64(b64);
  if (!mime) throw api88Error("API88_IMAGE_INVALID", "88API returned non-image bytes", 502);
  return { b64, mime };
}

export async function readApi88Image(value: string, signal: AbortSignal, maxBytes: number) {
  const data = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/);
  if (data) return parseApi88ImageBytes(Buffer.from(data[1]!, "base64"), maxBytes);
  return { ...parseApi88ImageBytes(await downloadApi88Bytes(value, signal, maxBytes), maxBytes), providerUrl: value };
}
