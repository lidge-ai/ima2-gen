import { jsonFetch } from "./api-core";

export type ComfyMediaKind = "image" | "video" | "audio";

export interface ComfyHealth {
  ok: boolean;
  version?: string;
  queueRemaining?: number;
  reason?: string;
}

export interface ComfyBinding {
  node: string;
  input: string;
}

export interface ComfyWorkflowBindings {
  prompt: ComfyBinding;
  negativePrompt?: ComfyBinding;
  width?: ComfyBinding;
  height?: ComfyBinding;
  seed?: ComfyBinding;
  refImage?: ComfyBinding;
  /** Every node input that takes an uploaded file, with the role its file plays. */
  inputs?: ComfyMediaSlot[];
  output: { node: string };
}

export type ComfyInputRole =
  | "first-frame" | "last-frame" | "reference-image" | "reference-video" | "reference-audio"
  | "source-image" | "source-video" | "source-audio" | "mask";

export interface ComfyMediaSlot {
  role: ComfyInputRole;
  kind: "image" | "video" | "audio";
  node: string;
  input: string;
}

/** A file picker the inspection found. role is absent when a person must say which file it is. */
export interface ComfyMediaSlotCandidate {
  kind: "image" | "video" | "audio";
  node: string;
  input: string;
  classType: string;
  title?: string;
  role?: ComfyInputRole;
}

export interface ComfyMissingChoice { node: string; classType: string; input: string; value: string; model: boolean }

/** What the server the workflow will run on says about it, or why it could not be asked. */
export type ComfyServerReport =
  | { origin: string; reachable: true; missingNodes: Array<{ classType: string; nodes: string[] }>; missingChoices: ComfyMissingChoice[]; paidNodes: string[] }
  | { origin: string; reachable: false; reason: string };

/** A ComfyUI server beyond this computer. The token is write-only: only whether one is saved comes back. */
export interface ComfyRemote { origin: string; hasToken: boolean; insecure: boolean }

export interface ComfyWorkflowParam {
  name: string;
  node: string;
  input: string;
  type: "number" | "string" | "boolean";
  default?: number | string | boolean;
  min?: number;
  max?: number;
  options?: Array<number | string | boolean>;
}

export interface ComfyWorkflowRecord {
  id: string;
  label: string;
  origin: string;
  mediaKind: ComfyMediaKind;
  bind: ComfyWorkflowBindings;
  params: ComfyWorkflowParam[];
  createdAt: number;
  updatedAt: number;
  health?: ComfyHealth;
}

export type ComfyBindField = Exclude<keyof ComfyWorkflowBindings, "inputs">;

export interface ComfyBindCandidate {
  field: ComfyBindField;
  node: string;
  input: string;
  classType: string;
  title?: string;
  /** False when several nodes match and a human must choose. */
  unambiguous: boolean;
}

export interface ComfyInspectResult {
  ok: true;
  nodes: Array<{ id: string; classType: string; title: string | null }>;
  candidates: ComfyBindCandidate[];
  needsConfirmation: boolean;
  mediaKind?: ComfyMediaKind;
  /** File pickers in the graph; empty when the server could not be asked. */
  mediaSlots?: ComfyMediaSlotCandidate[];
  server?: ComfyServerReport;
}

export function listComfyWorkflows(): Promise<{ ok: true; workflows: ComfyWorkflowRecord[] }> {
  return jsonFetch("/api/comfy/workflows");
}

/**
 * Parses a workflow file without saving it, so bindings can be confirmed first.
 * With an origin, that server is asked what its nodes accept and what the workflow needs that it lacks.
 */
export function inspectComfyWorkflow(source: { graph?: unknown; pngBase64?: string }, origin?: string): Promise<ComfyInspectResult> {
  return jsonFetch("/api/comfy/inspect", { method: "POST", body: JSON.stringify(origin ? { ...source, origin } : source) });
}

/**
 * Checks an origin through the SERVER, never with a browser fetch.
 *
 * The route runs normalizeComfyOrigin first, so a typed string cannot become an
 * arbitrary outbound request. A malformed origin comes back as a thrown 400
 * while an unreachable one resolves with health.ok false — two different
 * problems that deserve two different messages.
 */
export function probeComfyOrigin(origin: string): Promise<{ ok: true; origin: string; health: ComfyHealth }> {
  return jsonFetch("/api/comfy/probe", { method: "POST", body: JSON.stringify({ origin }) });
}

export function createComfyWorkflow(input: {
  id: string;
  label?: string;
  origin?: string;
  mediaKind: ComfyMediaKind;
  bind: ComfyWorkflowBindings;
  graph?: unknown;
  pngBase64?: string;
  replace?: boolean;
}): Promise<{ ok: true; workflow: ComfyWorkflowRecord; server?: ComfyServerReport; media?: { model: string; task: string } }> {
  return jsonFetch("/api/comfy/workflows", { method: "POST", body: JSON.stringify(input) });
}

export function deleteComfyWorkflow(id: string): Promise<{ ok: true; id: string }> {
  return jsonFetch(`/api/comfy/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listComfyRemotes(): Promise<{ ok: true; remotes: ComfyRemote[] }> {
  return jsonFetch("/api/comfy/remotes");
}

/** Adds a server, or updates its token. An empty token leaves a saved one as it is. */
export function putComfyRemote(origin: string, token?: string): Promise<{ ok: true; remote: ComfyRemote }> {
  return jsonFetch("/api/comfy/remotes", { method: "PUT", body: JSON.stringify(token ? { origin, token } : { origin }) });
}

/** strandedWorkflows: registered workflows that still point at the removed server and can no longer run. */
export function deleteComfyRemote(origin: string): Promise<{ ok: true; origin: string; strandedWorkflows: string[] }> {
  return jsonFetch(`/api/comfy/remotes?origin=${encodeURIComponent(origin)}`, { method: "DELETE" });
}

export interface ComfyLaneModel {
  id: string;
  label: string;
  /** The origin, or "<origin> (offline)" when that instance did not answer. */
  description?: string;
  executable?: boolean;
  lockReason?: string;
}

export interface ComfyLaneModels {
  image: ComfyLaneModel[];
  video: ComfyLaneModel[];
}

/**
 * Reads the comfy lane out of /api/models.
 *
 * The selector needs the same view the server publishes — including which
 * workflows are on an instance that answered — rather than a second opinion
 * assembled from the workflow list.
 */
export async function getComfyLaneModels(signal?: AbortSignal): Promise<ComfyLaneModels> {
  const catalog = await getLaneCatalog(signal);
  return catalog.comfy?.models ?? { image: [], video: [] };
}

/** The four states the server publishes per lane. */
export type LaneStatus = "ready" | "locked" | "disconnected" | "key-missing";

export interface LaneCatalogEntry {
  status: LaneStatus;
  /** Human-readable detail. Present on some ready lanes too. */
  reason?: string;
  models: ComfyLaneModels;
}

export type LaneCatalog = Record<string, LaneCatalogEntry>;

/**
 * Reads every lane out of /api/models.
 *
 * The selector used to hardcode which lanes exist and which of them do video,
 * while the server was already publishing both — along with a reason for every
 * lane that cannot run. This is the same endpoint getComfyLaneModels reads,
 * widened from one lane to all of them.
 */
export async function getLaneCatalog(signal?: AbortSignal): Promise<LaneCatalog> {
  return parseLaneCatalog(await jsonFetch<unknown>("/api/models", signal ? { signal } : {}));
}

function isLaneStatus(value: unknown): value is LaneStatus {
  return value === "ready" || value === "locked" || value === "disconnected" || value === "key-missing";
}

function invalidCatalog(): never {
  throw Object.assign(new Error("Invalid model catalog response"), { code: "MODEL_CATALOG_INVALID" });
}

function catalogRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogModel(value: unknown): ComfyLaneModel {
  if (!catalogRecord(value) || typeof value.id !== "string" || !value.id.trim()
    || typeof value.label !== "string" || !value.label.trim()) return invalidCatalog();
  const model: ComfyLaneModel = { id: value.id, label: value.label };
  for (const key of ["description", "lockReason"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") return invalidCatalog();
    model[key] = value[key];
  }
  if (value.executable !== undefined) {
    if (typeof value.executable !== "boolean") return invalidCatalog();
    model.executable = value.executable;
  }
  return model;
}

/** Project only this client's consumed fields; defaults/surfaces are not selection instructions. */
export function parseLaneCatalog(value: unknown): LaneCatalog {
  if (!catalogRecord(value) || value.ok !== true || !catalogRecord(value.lanes)) return invalidCatalog();
  return Object.fromEntries(Object.entries(value.lanes).map(([id, lane]) => {
    if (!catalogRecord(lane) || !isLaneStatus(lane.status) || !catalogRecord(lane.models)
      || !Array.isArray(lane.models.image) || !Array.isArray(lane.models.video)
      || (lane.reason !== undefined && typeof lane.reason !== "string")) return invalidCatalog();
    const entry: LaneCatalogEntry = { status: lane.status,
      ...(typeof lane.reason === "string" ? { reason: lane.reason } : {}),
      models: { image: lane.models.image.map(catalogModel), video: lane.models.video.map(catalogModel) } };
    // fromEntries defines own properties even for unknown IDs such as __proto__.
    return [id, entry];
  }));
}
