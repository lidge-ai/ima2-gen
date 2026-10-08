import { downloadApi88Bytes } from "./download.js";
function downloadError(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code: "API88_VIDEO_DOWNLOAD_FAILED", status: 502 });
}

export async function downloadApi88Video(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw downloadError("Invalid video URL");
  const bytes = await downloadApi88Bytes(url, signal, maxBytes);
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw downloadError("Result is not an MP4 container");
  return bytes;
}
