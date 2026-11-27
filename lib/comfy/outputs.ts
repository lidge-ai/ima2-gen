// lib/comfy/outputs.ts — every file a finished ComfyUI job saved, whatever kind it is.
//
// ComfyUI has no "video" output key: a saved video arrives under "images" with
// animated set, audio under "audio", and custom nodes add keys of their own
// ("gifs"). The kind is therefore decided by the bytes that come back, not by
// the key they were listed under.
import { sniffMime } from "../providers/media/mime.js";
import type { ComfyTarget } from "./access.js";
import { COMFY_ERR, buildViewUrl, canceled, comfyError, type HistoryEntry } from "./artifacts.js";
import { comfyFetch } from "./client.js";

type FileEntry = Record<string, unknown>;
const FILE_KEYS = ["images", "audio", "gifs", "videos", "video"] as const;

function filesOf(node: Record<string, unknown> | undefined): FileEntry[] {
  if (!node) return [];
  const out: FileEntry[] = [];
  for (const key of FILE_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (entry && typeof entry === "object" && typeof (entry as FileEntry).filename === "string") out.push(entry as FileEntry);
    }
  }
  return out;
}

/**
 * The files to bring back: what the bound output node saved, or, when that node
 * saved nothing (it was swapped since registration), what any node saved.
 * Preview nodes write to ComfyUI's temp folder; those are not results.
 */
export function collectOutputFiles(entry: HistoryEntry, outputNode: string): FileEntry[] {
  const outputs = (entry.outputs ?? {}) as Record<string, Record<string, unknown>>;
  const saved = (files: FileEntry[]) => files.filter((file) => file.type !== "temp");
  const bound = saved(filesOf(outputs[outputNode]));
  if (bound.length > 0) return bound;
  return saved(Object.values(outputs).flatMap((node) => filesOf(node)));
}

export interface ComfyOutputFile {
  kind: "image" | "video" | "audio";
  bytes: Uint8Array;
  mimeType: string;
}

/** Downloads one saved file within the size limit and names its kind from its bytes. */
export async function downloadOutputFile(
  target: ComfyTarget,
  file: FileEntry,
  maxBytes: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ComfyOutputFile> {
  const url = buildViewUrl(target.origin, file);
  let res: Response;
  try {
    res = await comfyFetch(target, fetchImpl, url.slice(target.origin.length), { ...(signal ? { signal } : {}) });
  } catch (error: unknown) {
    if (signal?.aborted) throw canceled();
    throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "Could not download the ComfyUI output: " + (error instanceof Error ? error.message : "unknown error"));
  }
  if (!res.ok) throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "ComfyUI returned HTTP " + String(res.status) + " for a saved output.");
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "ComfyUI output exceeds the download limit.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw comfyError(COMFY_ERR.DOWNLOAD_FAILED, "ComfyUI output exceeds the download limit.");
  // Trust the bytes, not the name or the Content-Type: an HTML error page saved as .png is what this guards against.
  const mimeType = sniffMime(bytes);
  const kind = mimeType?.split("/")[0];
  if (!mimeType || (kind !== "image" && kind !== "video" && kind !== "audio")) {
    throw comfyError(COMFY_ERR.OUTPUT_INVALID, "ComfyUI saved '" + String(file.filename) + "', which is not an image, video or audio file ima2 can store.");
  }
  return { kind, bytes, mimeType };
}
