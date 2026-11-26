import type { MediaInputRole, MediaKind } from "./contract.js";
import type { MediaInputRef } from "./inputs.js";
import type { MediaCatalogModel } from "./registry.js";
import type { MediaJobResult, SavedMediaOutput } from "./runnerTypes.js";
import type { MediaJobBody } from "./validate.js";

export type { MediaJobResult, SavedMediaOutput } from "./runnerTypes.js";

/** One field of a workflow's input form. Media fields take a MediaSource value. */
export interface MediaWorkflowInputSpec {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "image" | "video" | "audio" | "model";
  required: boolean;
  description?: string;
  /** Allowed values for "select". */
  options?: readonly string[];
  /** For "model": which kind of model the picker lists. */
  modelKind?: MediaKind;
  default?: string | number | boolean;
}

/** A media value in workflow input: one of ref (upload), filename (generated/), url (https), dataUrl. */
export type MediaSource = Omit<MediaInputRef, "role">;

export interface MediaWorkflowStepEstimate {
  id: string;
  label: string;
  model?: string;
  /** Estimated cost from catalog prices; absent when no public price applies. */
  usd?: number;
  note?: string;
}

/** Read-only view of the media catalog for estimates and model choice. */
export interface MediaWorkflowCatalog {
  getModel(id: string): MediaCatalogModel | undefined;
  listModels(kind?: MediaKind): readonly MediaCatalogModel[];
}

/** A step request is a POST /api/media body without requestId; inputs are MediaSource + role. */
export type MediaWorkflowStepRequest = Omit<MediaJobBody, "adapter">;

export interface MediaWorkflowRunContext {
  /** The workflow job's requestId; steps run as "<requestId>.<stepId>". */
  requestId: string;
  signal: AbortSignal;
  input: Readonly<Record<string, unknown>>;
  catalog: MediaWorkflowCatalog;
  /** Runs one generation through the runner: route and key choice, polling, download, history. */
  runStep(stepId: string, request: MediaWorkflowStepRequest, options?: { adapter?: string }): Promise<MediaJobResult>;
  /** Turns a MediaSource from input (or a step output's { filename }) into a step input. */
  asInput(source: MediaSource, role: MediaInputRole): MediaInputRef;
  /** Reads a MediaSource as bytes, e.g. to extract frames locally. */
  loadSource(source: MediaSource): Promise<{ bytes: Uint8Array; mimeType: string }>;
  /** Saves a locally produced file (ffmpeg output, composite) into history. */
  saveOutput(data: { bytes: Uint8Array; mimeType: string; kind: MediaKind }, meta?: Record<string, unknown>): Promise<SavedMediaOutput>;
  progress(stepId: string, data: { progress?: number; message?: string }): void;
}

export interface MediaWorkflow {
  /** Lowercase kebab, used in POST /api/workflows/:id. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly inputs: readonly MediaWorkflowInputSpec[];
  estimate(input: Readonly<Record<string, unknown>>, catalog: MediaWorkflowCatalog): readonly MediaWorkflowStepEstimate[];
  run(ctx: MediaWorkflowRunContext): Promise<{ outputs: readonly SavedMediaOutput[] }>;
}
