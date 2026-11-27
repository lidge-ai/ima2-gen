/**
 * Wire shapes of the ima2 server (lane L0, routes/media.ts, routes/workflows.ts,
 * routes/history.ts, routes/keys.ts). Only adapt.ts reads these; the rest of
 * the kit and every studio work with the UI-facing types in types.ts.
 */
import type { MediaKind, MediaModelSpec, MediaPrice, MediaProviderError, MediaTask, WorkflowCredit, WorkflowText } from "./types.ts";

export interface WireLogo {
  id: string;
  name: string;
  urls: { primary?: string; dark?: string; light?: string; mark?: string };
  source?: string;
}

export interface WireRoute {
  adapter: string;
  route: "direct" | "aggregator";
  label: string;
  logo?: WireLogo | null;
  upstreamId: string;
  tasks: readonly MediaTask[];
  params: MediaModelSpec["params"];
  pricing: readonly MediaPrice[];
  docsUrl: string;
  hasKey: boolean;
}

export interface WireModel {
  id: string;
  label: string;
  vendor: string;
  logo?: WireLogo | null;
  kind: MediaKind;
  tasks: readonly MediaTask[];
  routes: readonly WireRoute[];
  defaultRoute: string | null;
}

export interface WireExtraField {
  name: string;
  secret: boolean;
  required: boolean;
  configured: boolean;
  source?: string;
  value?: string | null;
}

export interface WireAdapter {
  id: string;
  label: string;
  route: "direct" | "aggregator";
  logo?: WireLogo | null;
  keyVocabulary: string;
  consoleUrl: string;
  keyPrefix: string | null;
  hasKey: boolean;
  keySource: string | null;
  maskedKey?: string | null;
  extraFields: readonly WireExtraField[];
  modelCount: number;
}

export interface WireCatalog {
  models: readonly WireModel[];
  adapters: readonly WireAdapter[];
}

export interface WireInput {
  ref: string;
  mimeType: string;
  bytes: number;
}

export interface WireAccepted {
  requestId: string;
  model?: string;
  adapter?: string;
  workflow?: string;
}

/** Inflight or terminal job record (lib/inflight.ts). */
export interface WireJob {
  requestId: string;
  kind: string;
  prompt?: string;
  meta?: Readonly<Record<string, unknown>>;
  startedAt: number;
  phase?: string;
  phaseAt?: number;
  status?: string;
  finishedAt?: number;
  errorCode?: string;
}

export interface WireOutput {
  filename: string;
  url: string;
  mediaType: MediaKind;
  mimeType: string;
  bytes: number;
}

export interface WireErrorBody {
  ok?: false;
  code?: string;
  error?: string;
  status?: number;
  category?: MediaProviderError["category"];
  retryable?: boolean;
  field?: string;
}

/* ---------- workflows (lib/workflows/types.ts) ---------- */

interface WireFieldBase {
  name: string;
  label: string;
  help?: string;
  required: boolean;
}
export type WireField =
  | (WireFieldBase & { type: "text"; maxLength: number; multiline?: boolean })
  | (WireFieldBase & { type: "enum"; options: readonly { value: string; label: string }[]; default?: string })
  | (WireFieldBase & { type: "integer"; min: number; max: number; default?: number })
  | (WireFieldBase & { type: "boolean"; default: boolean })
  | (WireFieldBase & { type: "media"; accept: MediaKind; min: number; max: number; minDurationSec?: number; maxDurationSec?: number })
  | (WireFieldBase & { type: "colors"; min: number; max: number });

export interface WireSlot {
  name: string;
  label: string;
  task: MediaTask;
  defaultModel: string;
  alternatives: readonly string[];
  tierModels?: Readonly<Record<string, string>>;
  defaultRoute?: string;
  /** One plain sentence for people: what the step does. */
  description?: string;
  /** Projects and papers the step follows (shown once per workflow, collapsed). */
  credits?: readonly WorkflowCredit[];
  available: Readonly<Record<string, boolean>>;
  /** model id -> can run now (a saved key, or the slot's signed-in session). Absent when the server cannot tell. */
  runnable?: Readonly<Record<string, boolean>>;
}

export interface WireWorkflow {
  id: string;
  label: string;
  description: string;
  fields: readonly WireField[];
  slots: readonly WireSlot[];
  tierField?: string;
  preset?: unknown;
  i18n?: Readonly<Record<string, WorkflowText>>;
}

export interface WireStepEstimate {
  stepId: string;
  model?: string;
  usd: number | null;
  source?: string;
  checkedAt?: string;
  note?: string;
  units?: { unit: MediaPrice["unit"]; quantity: number; variant?: string };
}

export interface WireStepSummary {
  id: string;
  label: string;
  kind: string;
  dependsOn: readonly string[];
  model?: string;
  route?: string;
  /** Workflow slot this media step fills (servers with step slots). */
  slot?: string;
  final: boolean;
}

export interface WireEstimateResponse {
  estimate: { usd: number; complete: boolean; steps: readonly WireStepEstimate[] };
  steps: readonly WireStepSummary[];
}

/* ---------- history (routes/history.ts) ---------- */

export interface WireHistoryRow {
  filename: string;
  url: string;
  thumb: string | null;
  mediaType: string;
  createdAt: number;
  prompt: string | null;
  model: string | null;
  provider: string | null;
  requestId: string | null;
  kind: string | null;
  isFavorite?: boolean;
  width?: number;
  height?: number;
  duration?: number;
  workflow?: string;
}

export interface WireHistoryPage {
  items: readonly WireHistoryRow[];
  total: number;
  nextCursor: { before: number; beforeFilename: string } | null;
}
