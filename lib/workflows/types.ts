/**
 * Workflow contract (L6). A workflow is a multi-step job that turns validated
 * inputs into a fixed step graph before anything runs, so the same plan prices
 * the job (estimate) and executes it (run).
 *
 * Model calls go only through MediaProviderAdapter (lib/providers/media/contract.ts).
 * Route choice, keys, uploads to public URLs and history storage belong to the
 * caller, which supplies them through WorkflowGateway.
 */
import type {
  MediaAdapterContext, MediaInput, MediaKind, MediaModelSpec, MediaPrice,
  MediaProviderAdapter, MediaProviderError, MediaSubmitRequest, MediaTask,
} from "../providers/media/contract.js";

export type WorkflowId =
  | "remix-motion-transfer" | "remix-object-swap" | "remix-restyle"
  | "director-studio" | "director-cast" | "director-locations" | "director-cinema";

/* ---------- Input schema: rendered by any UI, validated by the server ---------- */

interface FieldBase {
  name: string;
  label: string;
  help?: string;
  required: boolean;
}
export interface TextField extends FieldBase { type: "text"; maxLength: number; multiline?: boolean }
export interface EnumField extends FieldBase {
  type: "enum";
  options: readonly { value: string; label: string }[];
  default?: string;
}
export interface IntegerField extends FieldBase { type: "integer"; min: number; max: number; default?: number }
export interface BooleanField extends FieldBase { type: "boolean"; default: boolean }
export interface MediaField extends FieldBase {
  type: "media";
  accept: MediaKind;
  min: number;
  max: number;
  /** Applies to video/audio inputs; checked after probing. */
  minDurationSec?: number;
  maxDurationSec?: number;
  maxBytes?: number;
}
export interface ColorsField extends FieldBase { type: "colors"; min: number; max: number }
export type WorkflowField = TextField | EnumField | IntegerField | BooleanField | MediaField | ColorsField;

/** A media value as the server sees it: a local file the route stored, or an HTTPS URL. */
export interface WorkflowMediaRef {
  path?: string;
  url?: string;
  mimeType: string;
  /** Filled by probing before planning. */
  durationSec?: number;
  hasAudio?: boolean;
  width?: number;
  height?: number;
}
export type WorkflowValue = string | number | boolean | readonly string[] | readonly WorkflowMediaRef[];
export type WorkflowValues = Readonly<Record<string, WorkflowValue | undefined>>;

/* ---------- Model slots: one per media step family, user-overridable ---------- */

export interface ModelSlot {
  /** Stable slot key, e.g. "render", "firstFrame", "depth". */
  name: string;
  label: string;
  task: MediaTask;
  defaultModel: string;
  /** Other model ids the workflow knows how to drive in this slot. */
  alternatives: readonly string[];
  /** Default per tier value (see WorkflowDefinition.tierField), e.g. { lite: "bytedance/seedance-2.5-flash" }. */
  tierModels?: Readonly<Record<string, string>>;
  /** Why this model fits, with the evidence source; shown to users and reviewers. */
  rationale: string;
}

export interface WorkflowSelection {
  /** slot name -> model id (must be defaultModel or an alternative). */
  models?: Readonly<Record<string, string>>;
  /** slot name -> adapter id the user pinned. Absent: the gateway's route policy decides. */
  routes?: Readonly<Record<string, string>>;
}

export interface WorkflowRequest {
  values: WorkflowValues;
  selection?: WorkflowSelection;
}

/* ---------- Plan ---------- */

export interface CostUnits {
  unit: MediaPrice["unit"];
  quantity: number;
  /** Matches MediaPrice.variant, e.g. "720p" or "720p+audio". */
  variant?: string;
}

export interface StepEstimate {
  stepId: string;
  model?: string;
  units?: CostUnits;
  /** null when no public price matches; never guessed. */
  usd: number | null;
  source?: string;
  checkedAt?: string;
  note?: string;
}

export interface WorkflowEstimate {
  /** Sum of the priced steps. */
  usd: number;
  /** False when any paid step has no public price. */
  complete: boolean;
  steps: readonly StepEstimate[];
}

export type ArtifactKind = MediaKind | "json";

export interface WorkflowArtifact {
  id: string;
  stepId: string;
  kind: ArtifactKind;
  mimeType: string;
  /** Absolute path under the run's work directory. */
  path: string;
  sizeBytes: number;
  final: boolean;
  meta?: Readonly<Record<string, unknown>>;
}

/** What a step hands back before the runner stores it. */
export interface ArtifactDraft {
  kind: ArtifactKind;
  mimeType: string;
  bytes?: Uint8Array;
  /** A file the step already wrote inside the work directory. */
  path?: string;
  meta?: Readonly<Record<string, unknown>>;
}

export interface StepRuntime {
  readonly values: WorkflowValues;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly local: WorkflowLocalOps;
  readonly gateway: WorkflowGateway;
  /** Artifacts a dependency produced, in order. Throws if the step is not a dependency. */
  artifactsOf(stepId: string): readonly WorkflowArtifact[];
  /** Reads an artifact or a local media ref as a contract MediaInput. */
  asInput(source: WorkflowArtifact | WorkflowMediaRef, role: MediaInput["role"]): Promise<MediaInput>;
  /** A fresh path inside the work directory. */
  tempPath(name: string): string;
}

interface StepBase {
  id: string;
  label: string;
  dependsOn: readonly string[];
  /** Final artifacts are the workflow's result; the rest are kept as intermediates. */
  final?: boolean;
}
export interface MediaStep extends StepBase {
  kind: "media";
  slot: string;
  model: string;
  route?: string;
  outputKind: MediaKind;
  units: CostUnits;
  build(rt: StepRuntime): Promise<MediaSubmitRequest>;
}
export interface LocalStep extends StepBase {
  kind: "local";
  op: string;
  run(rt: StepRuntime): Promise<readonly ArtifactDraft[]>;
}
export interface TextStep extends StepBase {
  kind: "text";
  run(rt: StepRuntime): Promise<readonly ArtifactDraft[]>;
}
export type WorkflowStep = MediaStep | LocalStep | TextStep;

export interface WorkflowPlan {
  workflowId: WorkflowId;
  steps: readonly WorkflowStep[];
}

export interface PlanEnv {
  catalog(modelId: string): MediaModelSpec | undefined;
}

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  description: string;
  /** Public products this workflow matches in function (ids from Sume's public list). */
  equivalents: readonly string[];
  fields: readonly WorkflowField[];
  slots: readonly ModelSlot[];
  /** An enum field whose value picks ModelSlot.tierModels defaults. */
  tierField?: string;
  /** Cross-field checks after field validation. Return an error message or null. */
  check?(values: WorkflowValues): string | null;
  plan(values: WorkflowValues, models: Readonly<Record<string, ResolvedSlot>>, env: PlanEnv): WorkflowPlan;
}

export interface ResolvedSlot {
  model: string;
  route?: string;
}

/* ---------- Gateway and local operations: injected by the caller ---------- */

export interface ResolvedRoute {
  adapter: MediaProviderAdapter;
  /** Everything except signal; the runner adds its own. */
  ctx: Omit<MediaAdapterContext, "signal">;
}

export interface TextPlanRequest {
  purpose: string;
  system: string;
  user: string;
}

export interface WorkflowGateway {
  catalog(modelId: string): MediaModelSpec | undefined;
  /** Picks the adapter and key for a model. Throws a coded error when no keyed route exists. */
  resolve(modelId: string, route: string | undefined): Promise<ResolvedRoute>;
  /** Makes bytes reachable by URL for adapters whose inputTransport is "url". */
  publishInput?(input: MediaInput, signal: AbortSignal): Promise<{ url: string }>;
  /** Used for output downloads. */
  fetch: typeof fetch;
  /** JSON-returning text model call (shot planning). Absent: steps that need it fail with a coded error. */
  planText?(request: TextPlanRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface WorkflowLocalOps {
  probe(path: string, signal: AbortSignal): Promise<ProbeResult>;
  /** position: "first" | "last" | seconds as a string. Writes a PNG. */
  frame(videoPath: string, outPath: string, position: string, signal: AbortSignal): Promise<void>;
  /** Copies the audio of audioSource onto video (trimmed to the video). Video stream is copied. */
  muxAudio(videoPath: string, audioSource: string, outPath: string, signal: AbortSignal): Promise<void>;
  concat(paths: readonly string[], outPath: string, signal: AbortSignal): Promise<void>;
}

/* ---------- Events and results ---------- */

export type WorkflowEvent =
  | { type: "workflow.planned"; runId: string; workflowId: WorkflowId; estimate: WorkflowEstimate; steps: readonly StepSummary[] }
  | { type: "step.started"; runId: string; stepId: string }
  | { type: "step.progress"; runId: string; stepId: string; state: "queued" | "running"; progress?: number }
  | { type: "step.artifact"; runId: string; stepId: string; artifact: WorkflowArtifact }
  | { type: "step.succeeded"; runId: string; stepId: string; billedUsd?: number }
  | { type: "step.failed"; runId: string; stepId: string; error: WorkflowErrorInfo }
  | { type: "workflow.succeeded"; runId: string; artifacts: readonly WorkflowArtifact[] }
  | { type: "workflow.failed"; runId: string; error: WorkflowErrorInfo }
  | { type: "workflow.canceled"; runId: string };

export interface StepSummary {
  id: string;
  label: string;
  kind: WorkflowStep["kind"];
  dependsOn: readonly string[];
  model?: string;
  route?: string;
  final: boolean;
}

export interface WorkflowErrorInfo {
  code: string;
  message: string;
  stepId?: string;
  category?: MediaProviderError["category"];
  retryable: boolean;
}

export interface WorkflowResult {
  runId: string;
  status: "succeeded" | "failed" | "canceled";
  artifacts: readonly WorkflowArtifact[];
  error?: WorkflowErrorInfo;
}

