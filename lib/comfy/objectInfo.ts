// lib/comfy/objectInfo.ts — what a ComfyUI server says its node types accept.
//
// GET /object_info/{class} is the server's own schema for a node: each input's
// type, range and choices, whether a choice list is an upload target, whether
// the node saves an output, and whether it is a paid partner node. Reading it
// replaces a table of class names that only knew the nodes it was written for.
import type { ComfyTarget } from "./access.js";
import { comfyFetch } from "./client.js";

export interface ComfyNodeInfo {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> };
  output?: unknown[];
  output_name?: unknown[];
  output_node?: boolean | null;
  api_node?: boolean | null;
  display_name?: string | null;
}

/** Node class → its schema. A class the server does not have is absent. */
export type ComfyObjectInfo = Record<string, ComfyNodeInfo>;

export type ComfyUploadKind = "image" | "video" | "audio" | "file";

export interface ComfyInputSpec {
  /** "INT", "STRING", "IMAGE", ... or "COMBO" for a choice list in either encoding. */
  type: string;
  options: Record<string, unknown>;
  /** Present for a choice list. Empty when the server has nothing to offer yet. */
  choices?: unknown[];
  /** The choice list is a file picker: its values are files ima2 uploads, not fixed choices. */
  upload?: ComfyUploadKind;
}

const UPLOAD_FLAGS: ReadonlyArray<[string, ComfyUploadKind]> = [
  ["image_upload", "image"], ["video_upload", "video"], ["audio_upload", "audio"], ["file_upload", "file"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one input spec. ComfyUI writes a choice list two ways: the older
 * [[choices...], options?] and the V3 ["COMBO", { options: [...] }]. Both
 * become type "COMBO" with choices.
 */
export function parseInputSpec(raw: unknown): ComfyInputSpec | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const options = isRecord(raw[1]) ? raw[1] : {};
  const upload = UPLOAD_FLAGS.find(([flag]) => options[flag] === true)?.[1];
  if (Array.isArray(raw[0])) return { type: "COMBO", options, choices: raw[0], ...(upload ? { upload } : {}) };
  if (typeof raw[0] !== "string") return null;
  if (raw[0] === "COMBO") {
    return { type: "COMBO", options, choices: Array.isArray(options.options) ? options.options : [], ...(upload ? { upload } : {}) };
  }
  return { type: raw[0], options };
}

export function inputSpec(info: ComfyObjectInfo, classType: string, input: string): ComfyInputSpec | null {
  const node = info[classType];
  return parseInputSpec(node?.input?.required?.[input] ?? node?.input?.optional?.[input]);
}

/** The type an output slot carries ("CONDITIONING", "IMAGE"), when the server names it. */
export function outputType(info: ComfyObjectInfo, classType: string, slot: unknown): string | null {
  const outputs = info[classType]?.output;
  const type = Array.isArray(outputs) && typeof slot === "number" ? outputs[slot] : undefined;
  return typeof type === "string" ? type : null;
}

/** The name of an output slot ("positive", "negative"), when the server names it. */
export function outputName(info: ComfyObjectInfo, classType: string, slot: unknown): string | null {
  const names = info[classType]?.output_name;
  const name = Array.isArray(names) && typeof slot === "number" ? names[slot] : undefined;
  return typeof name === "string" ? name : null;
}

/**
 * Fetches the schema of each class, in parallel.
 *
 * One request per class rather than the whole /object_info: a server with many
 * custom nodes returns several megabytes there, and a workflow uses a few dozen
 * classes. An unknown class answers {} and is left out, which is how a missing
 * custom node is found. Throws when the server cannot be reached at all.
 */
export async function fetchComfyObjectInfo(
  target: ComfyTarget,
  classTypes: readonly string[],
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ComfyObjectInfo> {
  const unique = [...new Set(classTypes)];
  const entries = await Promise.all(unique.map(async (classType): Promise<[string, ComfyNodeInfo] | null> => {
    const res = await comfyFetch(target, fetchImpl, "/object_info/" + encodeURIComponent(classType), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error("HTTP " + String(res.status));
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    const node = body?.[classType];
    return isRecord(node) ? [classType, node as ComfyNodeInfo] : null;
  }));
  return Object.fromEntries(entries.filter((entry): entry is [string, ComfyNodeInfo] => entry !== null));
}
