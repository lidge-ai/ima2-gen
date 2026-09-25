// Higgsfield media inputs (260925 audit): local files go media_upload ->
// presigned PUT -> media_confirm; public https inputs go media_import_url.
// Both produce the media_id that generate_*'s medias[].value requires —
// higgsfield never accepts raw URLs or runway-hosted assets.
import { readFile } from "node:fs/promises";
import type { McpConnectionManager } from "../connectionManager.js";
import { assertPublicHttps } from "../downloadMediaResult.js";

export type HiggsfieldMediaType = "image" | "video" | "audio";

function structuredOf(result: Record<string, unknown>): Record<string, unknown> {
  const value = result.structuredContent;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mediaTypeFor(mimeType: string): HiggsfieldMediaType {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

function providerError(result: Record<string, unknown>): string | null {
  const error = structuredOf(result).error;
  return typeof error === "string" && error ? error.slice(0, 120) : null;
}

/** Upload a validated local file; returns the higgsfield media_id for medias[].value. */
export async function uploadLocalMediaToHiggsfield(
  manager: McpConnectionManager,
  filePath: string,
  options: { fileName: string; mimeType: string; maxBytes?: number },
): Promise<string> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0) throw new Error("MCP_UPLOAD_EMPTY");
  if (bytes.byteLength > (options.maxBytes ?? 100 * 1024 * 1024)) throw new Error("MCP_UPLOAD_TOO_LARGE");

  const type = mediaTypeFor(options.mimeType);
  const init = await manager.callTool("higgsfield", "media_upload", {
    filename: options.fileName,
    content_type: options.mimeType,
  });
  const uploads = structuredOf(init).uploads;
  const slot = Array.isArray(uploads) ? uploads[0] as Record<string, unknown> | undefined : undefined;
  const uploadUrl = typeof slot?.upload_url === "string" ? slot.upload_url : null;
  const mediaId = typeof slot?.media_id === "string" ? slot.media_id : null;
  if (!uploadUrl || !mediaId) {
    const detail = providerError(init);
    throw new Error(`MCP_UPLOAD_INIT_INVALID${detail ? `:${detail}` : ""}`);
  }

  // Same public-HTTPS/IP validation as downloads — hostile MCP output must not
  // redirect local media elsewhere.
  const target = new URL(uploadUrl);
  await assertPublicHttps(target);
  const response = await fetch(target, {
    method: "PUT",
    redirect: "error",
    body: bytes,
    headers: { "content-type": options.mimeType, "content-length": String(bytes.byteLength) },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`MCP_UPLOAD_PUT_FAILED:${response.status}`);

  const confirmed = await manager.callTool("higgsfield", "media_confirm", { type, media_id: mediaId });
  const confirmError = providerError(confirmed);
  if (confirmError) throw new Error(`MCP_UPLOAD_CONFIRM_FAILED:${confirmError}`);
  const results = structuredOf(confirmed).results;
  const confirmedId = Array.isArray(results)
    ? (results[0] as Record<string, unknown> | undefined)?.media_id
    : undefined;
  if (typeof confirmedId !== "string" || !confirmedId) throw new Error("MCP_UPLOAD_CONFIRM_INVALID");
  return confirmedId;
}

/** Import a public https URL into a higgsfield media_id via media_import_url. */
export async function importUrlToHiggsfield(
  manager: McpConnectionManager,
  url: string,
  type: HiggsfieldMediaType,
): Promise<string> {
  const result = await manager.callTool("higgsfield", "media_import_url", { url, type });
  const detail = providerError(result);
  if (detail) throw new Error(`MCP_IMPORT_URL_FAILED:${detail}`);
  const mediaId = structuredOf(result).media_id;
  if (typeof mediaId !== "string" || !mediaId) throw new Error("MCP_IMPORT_URL_INVALID");
  return mediaId;
}
