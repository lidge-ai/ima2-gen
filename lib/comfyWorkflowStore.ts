// lib/comfyWorkflowStore.ts — the comfy lane's model registry.
//
// A registered workflow IS a model: it appears in the selector where
// grok-imagine-image-2.0 sits in the grok lane. Records live on disk rather
// than in lib/providers/registry.ts because the set is user-authored and
// cannot be known at compile time.
//
// Each record carries its OWN origin. That single decision collapses the
// one-instance and many-instance cases (8188 for SDXL, 8189 for Flux) into one
// code path; config.comfy.defaultUrl is only what the registration form starts
// with, never the address a generation actually uses.
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { atomicWriteJson } from "./atomicWrite.js";
import { ComfyAccess } from "./comfy/access.js";
import { logError } from "./logger.js";

export const COMFY_WORKFLOW_ERROR = {
  ID_INVALID: "COMFY_WORKFLOW_ID_INVALID",
  ID_TAKEN: "COMFY_WORKFLOW_ID_TAKEN",
  NOT_FOUND: "COMFY_WORKFLOW_NOT_FOUND",
  GRAPH_INVALID: "COMFY_WORKFLOW_GRAPH_INVALID",
  BIND_INVALID: "COMFY_WORKFLOW_BIND_INVALID",
  STORE_CORRUPT: "COMFY_WORKFLOW_STORE_CORRUPT",
  MEDIA_KIND_INVALID: "COMFY_WORKFLOW_MEDIA_KIND_INVALID",
  MEDIA_KIND_MISMATCH: "COMFY_WORKFLOW_MEDIA_KIND_MISMATCH",
} as const;

export class ComfyWorkflowError extends Error {
  code: string;
  status: number;
  /** A machine-readable reason under the code, so a client can show its own steps ("ui-format"). */
  hint?: string;
  constructor(code: string, message: string, status = 400, hint?: string) {
    super(message);
    this.name = "ComfyWorkflowError";
    this.code = code;
    this.status = status;
    if (hint) this.hint = hint;
  }
}

export function isComfyWorkflowError(error: unknown): error is ComfyWorkflowError {
  return error instanceof ComfyWorkflowError;
}

/** One ComfyUI API-format node. `inputs` values are scalars or ["nodeId", slot] links. */
export interface ComfyGraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyGraph = Record<string, ComfyGraphNode>;
/** What the workflow saves. "audio" workflows run through the media route only; the classic image and video lanes do not list them. */
export type ComfyMediaKind = "image" | "video" | "audio";

/** The role a file plays when it is fed to a workflow; the media contract's input roles. */
export type ComfyInputRole =
  | "first-frame" | "last-frame" | "reference-image" | "reference-video" | "reference-audio"
  | "source-image" | "source-video" | "source-audio" | "mask";

/** A node input that takes an uploaded file (a LoadImage, LoadVideo or LoadAudio picker). */
export interface ComfyMediaSlot {
  role: ComfyInputRole;
  kind: "image" | "video" | "audio";
  node: string;
  input: string;
}

/** Where one request field is injected into the graph. */
export interface ComfyBinding {
  node: string;
  input: string;
  /**
   * Other inputs that must carry the same value. A size is often written twice
   * (the empty latent and the scheduler); binding only one would run a graph
   * that disagrees with itself.
   */
  also?: Array<{ node: string; input: string }>;
}

export interface ComfyWorkflowBindings {
  prompt: ComfyBinding;
  negativePrompt?: ComfyBinding;
  width?: ComfyBinding;
  height?: ComfyBinding;
  seed?: ComfyBinding;
  refImage?: ComfyBinding;
  /** Frame count for video graphs. H3 uses the 17n+5 grid at 24fps. */
  length?: ComfyBinding;
  /** Frames per second, when the graph exposes it as a scalar. */
  fps?: ComfyBinding;
  /**
   * Files the workflow takes, by role. A record written before this field existed
   * has only refImage; mediaSlots() reads both.
   */
  inputs?: ComfyMediaSlot[];
  /** SaveImage-like node whose outputs are collected. No input key. */
  output: { node: string };
}

export interface ComfyWorkflowParam {
  name: string;
  node: string;
  input: string;
  type: "number" | "string" | "boolean";
  default?: number | string | boolean;
  min?: number;
  max?: number;
  options?: ReadonlyArray<number | string | boolean>;
}

export interface ComfyWorkflowRecord {
  id: string;
  label: string;
  origin: string;
  mediaKind: ComfyMediaKind;
  graph: ComfyGraph;
  bind: ComfyWorkflowBindings;
  params: ComfyWorkflowParam[];
  /** Paid partner node classes the server reported at registration. ComfyUI may charge the user's Comfy account for them. */
  paidNodes?: string[];
  createdAt: number;
  updatedAt: number;
}

// A workflow id reaches URLs, filenames, and the model selector, so the
// alphabet is closed rather than merely "not empty".
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateWorkflowId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.ID_INVALID,
      "Workflow id must be 1-64 chars of lowercase letters, digits, '-' or '_', starting with a letter or digit.",
    );
  }
  return id;
}

function storePath(): string {
  return join(config.storage.configDir, "comfy", "workflows.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shape check on read.
 *
 * The file is user-editable, and a half-written record would otherwise surface
 * as a selector entry that fails only once a generation is billed. Anything
 * that does not carry an id, an origin, and a prompt/output binding is dropped.
 */
function normalizeWorkflowRecord(value: unknown): ComfyWorkflowRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !ID_RE.test(value.id)) return null;
  if (typeof value.origin !== "string" || !value.origin) return null;
  if (!isRecord(value.graph)) return null;
  const bind = value.bind;
  if (!isRecord(bind)) return null;
  const prompt = bind.prompt;
  const output = bind.output;
  if (!isRecord(prompt) || typeof prompt.node !== "string" || typeof prompt.input !== "string") return null;
  if (!isRecord(output) || typeof output.node !== "string") return null;
  if (value.mediaKind !== undefined && value.mediaKind !== "image" && value.mediaKind !== "video" && value.mediaKind !== "audio") return null;
  return {
    ...(value as unknown as ComfyWorkflowRecord),
    label: typeof value.label === "string" && value.label.trim() ? value.label : value.id,
    mediaKind: value.mediaKind === "video" || value.mediaKind === "audio" ? value.mediaKind : "image",
    params: Array.isArray(value.params) ? value.params as ComfyWorkflowParam[] : [],
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

export function validateComfyMediaKind(value: unknown): ComfyMediaKind {
  if (value !== "image" && value !== "video" && value !== "audio") {
    throw new ComfyWorkflowError(
      COMFY_WORKFLOW_ERROR.MEDIA_KIND_INVALID,
      "Workflow media kind must be 'image', 'video' or 'audio'.",
    );
  }
  return value;
}

/**
 * The files a workflow takes. A record from before bind.inputs has one reference
 * image at most: the frame a video starts from, or the image an image workflow edits.
 */
export function mediaSlots(record: Pick<ComfyWorkflowRecord, "bind" | "mediaKind">): ComfyMediaSlot[] {
  if (Array.isArray(record.bind.inputs)) return record.bind.inputs;
  const ref = record.bind.refImage;
  if (!ref) return [];
  return [{ role: record.mediaKind === "video" ? "first-frame" : "source-image", kind: "image", node: ref.node, input: ref.input }];
}

/**
 * Reads every registered workflow.
 *
 * A missing file is an empty list, not an error: no workflow registered yet is
 * the normal first-run state. A corrupt file is also an empty list, logged
 * rather than thrown, so one bad byte cannot make the whole settings surface
 * unreachable — the user can still register a new workflow over it.
 */
export async function listWorkflows(): Promise<ComfyWorkflowRecord[]> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeWorkflowRecord)
      .filter((record): record is ComfyWorkflowRecord => record !== null);
  } catch (error: unknown) {
    logError("comfy", "workflow_store:parse", error);
    return [];
  }
}

export async function getWorkflow(id: string): Promise<ComfyWorkflowRecord | null> {
  const all = await listWorkflows();
  return all.find((record) => record.id === id) ?? null;
}

/** Distinct origins across all records, for parallel health probing. */
export async function listOrigins(): Promise<string[]> {
  const all = await listWorkflows();
  return [...new Set(all.map((record) => record.origin))];
}

async function writeAll(records: ComfyWorkflowRecord[]): Promise<void> {
  const path = storePath();
  await mkdir(join(config.storage.configDir, "comfy"), { recursive: true });
  await atomicWriteJson(path, records);
}

/**
 * Creates or replaces a workflow.
 *
 * The origin goes through the allow list, so a record can only name a loopback
 * server or one the user added. The same check runs again before every job,
 * because the list can shrink after a workflow was registered.
 */
export async function putWorkflow(
  input: Omit<ComfyWorkflowRecord, "createdAt" | "updatedAt" | "mediaKind">
    & Partial<Pick<ComfyWorkflowRecord, "createdAt" | "mediaKind">>,
  options: { allowReplace?: boolean; access?: ComfyAccess } = {},
): Promise<ComfyWorkflowRecord> {
  const id = validateWorkflowId(input.id);
  const access = options.access ?? await ComfyAccess.load(config.storage.configFile);
  const origin = access.target(input.origin).origin;
  const all = await listWorkflows();
  const existing = all.find((record) => record.id === id);
  if (existing && options.allowReplace !== true) {
    throw new ComfyWorkflowError(COMFY_WORKFLOW_ERROR.ID_TAKEN, `Workflow '${id}' already exists.`, 409);
  }
  const now = Date.now();
  const mediaKind = input.mediaKind === undefined
    ? existing?.mediaKind ?? "image"
    : validateComfyMediaKind(input.mediaKind);
  const record: ComfyWorkflowRecord = {
    id,
    label: typeof input.label === "string" && input.label.trim() ? input.label.trim() : id,
    origin,
    mediaKind,
    graph: input.graph,
    bind: input.bind,
    params: input.params ?? [],
    ...(input.paidNodes && input.paidNodes.length > 0 ? { paidNodes: [...input.paidNodes] } : {}),
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  const next = all.filter((entry) => entry.id !== id);
  next.push(record);
  next.sort((a, b) => a.id.localeCompare(b.id));
  await writeAll(next);
  return record;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const all = await listWorkflows();
  const next = all.filter((record) => record.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}
