import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MediaKind, MediaOutput } from "./contract.js";
import { MediaJobError } from "./errors.js";
import { baseMime, extFromMime, mimeFromName, sniffMime } from "./mime.js";
import { DEFAULT_MAX_DOWNLOAD_BYTES, type MediaRunnerDeps, type SavedMediaOutput } from "./runnerTypes.js";
import { persistVideoArtifact } from "../../videoArtifactPersistence.js";
import { generateVideoThumbnail } from "../../videoThumb.js";
import { generateImageThumbnail } from "../../imageThumb.js";
import { invalidateHistoryIndex } from "../../historyIndex.js";

const DEFAULT_EXT: Record<MediaKind, string> = { image: "png", video: "mp4", audio: "mp3" };

function downloadFailed(message: string, status = 502): MediaJobError {
  return new MediaJobError("MEDIA_DOWNLOAD_FAILED", message, { status, category: "upstream", retryable: false });
}

function tooLarge(): MediaJobError {
  return new MediaJobError("MEDIA_OUTPUT_TOO_LARGE", "Provider output exceeds the download limit", { status: 502, category: "upstream" });
}

function decodeDataUrl(url: string): { buffer: Buffer; mimeType: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw downloadFailed("Malformed data URL output");
  const buffer = m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!));
  return { buffer, mimeType: baseMime(m[1]) };
}

async function fetchOutput(deps: MediaRunnerDeps, out: MediaOutput, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType: string }> {
  const url = out.url!;
  if (url.startsWith("data:")) return decodeDataUrl(url);
  if (!/^https?:\/\//i.test(url)) throw downloadFailed("Provider returned a non-http output URL");
  const limit = deps.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(url, { ...(out.downloadHeaders ? { headers: { ...out.downloadHeaders } } : {}), signal });
  if (!res.ok) throw downloadFailed(`Output download failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > limit) throw tooLarge();
  return { buffer, mimeType: baseMime(res.headers.get("content-type")) };
}

/** Bytes for one output; vendor URLs expire, so this runs as soon as the job succeeds. */
export async function materializeOutput(deps: MediaRunnerDeps, out: MediaOutput, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType: string }> {
  if (out.bytes) {
    const declared = baseMime(out.mimeType);
    return { buffer: Buffer.from(out.bytes), mimeType: extFromMime(declared) ? declared : sniffMime(out.bytes) ?? declared };
  }
  if (!out.url) throw downloadFailed("Provider output has neither url nor bytes");
  const got = await fetchOutput(deps, out, signal);
  const declared = baseMime(out.mimeType);
  if (got.buffer.length === 0) throw downloadFailed("Provider output is empty");
  const candidates = [declared, got.mimeType, mimeFromName(out.url), sniffMime(got.buffer)];
  const mimeType = candidates.find((m) => m && extFromMime(m)) ?? declared;
  return { buffer: got.buffer, mimeType };
}

function thumbnail(kind: MediaKind, fullPath: string): void {
  if (kind === "video") generateVideoThumbnail(fullPath).catch(() => {});
  else if (kind === "image") generateImageThumbnail(fullPath).catch(() => {});
}

export async function saveOutput(
  deps: MediaRunnerDeps,
  kind: MediaKind,
  data: { buffer: Buffer; mimeType: string },
  metadata: Record<string, unknown>,
): Promise<SavedMediaOutput> {
  await mkdir(deps.generatedDir, { recursive: true });
  const ext = extFromMime(data.mimeType) ?? DEFAULT_EXT[kind];
  const filename = `${Date.now()}_${randomBytes(8).toString("hex")}.${ext}`;
  const mimeType = data.mimeType || `${kind}/${ext}`;
  await persistVideoArtifact(deps.generatedDir, filename, data.buffer, { ...metadata, mimeType });
  if (deps.thumbnails !== false) thumbnail(kind, join(deps.generatedDir, filename));
  invalidateHistoryIndex();
  return { kind, mediaType: kind, filename, url: `/generated/${encodeURIComponent(filename)}`, mimeType, bytes: data.buffer.length };
}
