/**
 * Wire types for the studio HTTP API. Every studio talks to the ima2 server only
 * through these shapes, so a new UI can be written against this file alone.
 *
 * Model, price, input and error shapes come from the media provider contract
 * (lib/providers/media/contract.ts). This file adds what crosses HTTP on top:
 * catalog routes with key state, uploads, jobs, events, history and workflows.
 */
import type {
  MediaInputRole,
  MediaKind,
  MediaModelSpec,
  MediaPrice,
  MediaProviderError,
  MediaTask,
} from "../../../lib/providers/media/contract.ts";

export type { MediaInputRole, MediaKind, MediaModelSpec, MediaPrice, MediaProviderError, MediaTask };

/** One adapter that can run a model: a direct maker API or an aggregator. */
export interface CatalogRoute {
  providerId: string;
  route: "direct" | "aggregator";
  label: string;
  upstreamId: string;
  pricing: readonly MediaPrice[];
  docsUrl: string;
  /** True when the server holds a usable key for this provider. Never the key itself. */
  keyConfigured: boolean;
}

export interface CatalogModel {
  id: string;
  vendor: string;
  label: string;
  kind: MediaKind;
  tasks: readonly MediaTask[];
  /** Union of what the routes accept; a route may accept less (see routeParams). */
  params: MediaModelSpec["params"];
  /** Ordered by the server's default preference: direct with key, then aggregators with key, then keyless. */
  routes: readonly CatalogRoute[];
  routeParams?: Readonly<Record<string, MediaModelSpec["params"]>>;
  /** Route the server would pick right now, or null when no route has a key. */
  defaultRoute?: string | null;
}

export interface CatalogProvider {
  id: string;
  label: string;
  route: "direct" | "aggregator";
  keyVocabulary: string;
  consoleUrl: string;
  keyPrefix?: string;
  keyConfigured: boolean;
  extraFields?: readonly { name: string; secret: boolean; required: boolean }[];
}

export interface Catalog {
  models: readonly CatalogModel[];
  providers: readonly CatalogProvider[];
}

export interface KeyStatus {
  keyVocabulary: string;
  providerIds: readonly string[];
  configured: boolean;
  /** Where the active key comes from. Env keys cannot be removed from the UI. */
  source: "config" | "env" | null;
  extraFields: readonly { name: string; secret: boolean; required: boolean; configured: boolean }[];
}

export interface KeySaveBody {
  apiKey: string;
  extra?: Readonly<Record<string, string>>;
}

export interface UploadedInput {
  inputId: string;
  mimeType: string;
  bytes: number;
  /** Same-origin URL the UI can preview. */
  url: string;
}

export type SubmitInput = { role: MediaInputRole; inputId: string } | { role: MediaInputRole; url: string };

export interface MediaSubmitBody {
  model: string;
  /** Provider id from CatalogRoute. Omit to let the server pick the default keyed route. */
  provider?: string;
  task: MediaTask;
  prompt?: string;
  negativePrompt?: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  audio?: boolean;
  count?: number;
  inputs: readonly SubmitInput[];
  vendorOptions?: Readonly<Record<string, unknown>>;
  /** Idempotency token: resubmitting the same value returns the existing job. */
  clientRequestId?: string;
}

export interface Accepted {
  jobId: string;
  provider: string;
  estimate?: CostEstimate;
}

export interface CostEstimate {
  usd: number | null;
  /** Human-readable breakdown, e.g. "5 s x $0.10/s". Null usd means no published price. */
  basis: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface JobOutput {
  kind: MediaKind;
  mimeType: string;
  /** Same-origin URL of the locally saved file. */
  url: string;
  historyId: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

/** Errors as the server reports them: the contract error, already scrubbed of secrets. */
export type JobError = MediaProviderError;

export interface WorkflowStepState {
  id: string;
  label: string;
  status: JobStatus;
  model?: string;
  provider?: string;
  estimate?: CostEstimate;
}

export interface Job {
  jobId: string;
  kind: "media" | "workflow";
  /** Model id for media jobs, workflow id for workflow jobs. */
  target: string;
  provider?: string;
  status: JobStatus;
  /** 0 to 1. Absent when the provider reports no progress. */
  progress?: number;
  createdAt: string;
  updatedAt: string;
  request: MediaSubmitBody | WorkflowRunBody;
  outputs: readonly JobOutput[];
  error?: JobError;
  steps?: readonly WorkflowStepState[];
  billed?: { usd?: number };
}

export interface ApiErrorBody {
  error: { code: string; message: string; category?: MediaProviderError["category"]; details?: unknown };
}

/** Event names on GET /api/events for jobs this API creates. */
export type JobEventName = "queued" | "progress" | "step" | "done" | "error" | "canceled";

export interface JobEvent {
  /** SSE id, process-wide cursor. */
  id: number;
  event: JobEventName;
  jobId: string;
  job: Job;
}

export interface HistoryItem {
  historyId: string;
  jobId: string;
  kind: MediaKind;
  mimeType: string;
  url: string;
  thumbUrl?: string;
  model: string;
  provider?: string;
  workflow?: string;
  prompt?: string;
  createdAt: string;
  width?: number;
  height?: number;
  durationSec?: number;
  favorite?: boolean;
}

export interface HistoryQuery {
  kind?: MediaKind;
  model?: string;
  workflow?: string;
  favorite?: boolean;
  cursor?: string;
  limit?: number;
}

export interface HistoryPage {
  items: readonly HistoryItem[];
  nextCursor: string | null;
}

export interface WorkflowInputSpec {
  name: string;
  label: string;
  kind: MediaKind | "text";
  role?: MediaInputRole;
  required: boolean;
  /** Accept attribute for file inputs. */
  accept?: string;
  maxCount?: number;
  description?: string;
}

export interface WorkflowParamSpec {
  name: string;
  label: string;
  type: "select" | "number" | "text" | "boolean";
  options?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: string | number | boolean;
}

export interface WorkflowStepSpec {
  id: string;
  label: string;
  /** Model the step calls by default; the run body may override per step. */
  model?: string;
  /** Models the step accepts as overrides. */
  modelChoices?: readonly string[];
  pricingBasis?: string;
  /** model id -> whether a registered route can run it for this step. */
  available?: Readonly<Record<string, boolean>>;
  /** model id -> whether it can run now: a saved key, or the step's signed-in session. Absent when the server cannot tell. */
  runnable?: Readonly<Record<string, boolean>>;
  /** Route the step uses by default when it is not a keyed provider route, e.g. a subscription session ("openai-oauth"). */
  route?: string;
  /** Why the workflow uses this model, with its evidence. */
  rationale?: string;
}

export interface WorkflowDef {
  id: string;
  /** "remix" covers motion transfer, subject swap and restyle; "director" covers studio, cast, locations, cinema. */
  family: "remix" | "director" | "other";
  label: string;
  description: string;
  output: MediaKind;
  inputs: readonly WorkflowInputSpec[];
  params: readonly WorkflowParamSpec[];
  steps: readonly WorkflowStepSpec[];
}

export interface WorkflowRunBody {
  inputs: Readonly<Record<string, readonly SubmitInput[] | string>>;
  params?: Readonly<Record<string, string | number | boolean>>;
  /** Per-step model and provider overrides, keyed by step id. */
  steps?: Readonly<Record<string, { model?: string; provider?: string }>>;
  clientRequestId?: string;
}

export interface WorkflowEstimate {
  steps: readonly { id: string; label?: string; model?: string; estimate: CostEstimate }[];
  total: CostEstimate;
}

/**
 * Spend limits of a shared web instance (GET /api/web/session). Such a server runs only jobs whose
 * published-price estimate is complete and fits both caps; a local server has none (null).
 */
export interface WebSpend {
  spentUsd: number;
  dailyCapUsd: number;
  requestCapUsd: number;
}

/** A finished example clip from the server's showcase folder (GET /api/showcase). */
export interface ShowcaseItem {
  id: string;
  title: { en: string; ko?: string };
  /** Workflow that made it; studios open this workflow to make one like it. */
  workflow?: string;
  preset?: string;
  /** Field values to prefill (prompt, target, style...). */
  values?: Record<string, string | number | boolean>;
  /** Same-origin URLs. */
  result: string;
  source?: string;
  poster?: string;
  compare?: string;
  /** Models used, and the key vocabularies needed to make one like it. */
  models: readonly string[];
  keys: readonly string[];
  /** What the example cost when it was made, or null when a price was not published. */
  estimate?: { usd: number | null; basis?: string };
  durationSec?: number;
}
