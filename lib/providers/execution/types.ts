import type { RuntimeContext } from "../../runtimeContext.js";
import type { CoreProviderId } from "../registry.js";
import type { validateAndNormalizeRefs } from "../../refs.js";
import type { NaiRequestOptions } from "../../naiOptions.js";
import type { ComfyQueueInfo } from "../../comfyImageAdapter.js";
import type { ResponseDiagnostics } from "../../responsesParse.js";

type CheckedRefs = Extract<
  ReturnType<typeof validateAndNormalizeRefs>, { refs: string[] }
>;
export type ExecutionReference = Pick<
  CheckedRefs["refDetails"][number], "b64" | "declaredMime" | "detectedMime"
>;
export interface ExecutionOptions {
  model: string;
  imageToolModel?: string | undefined;
  quality: string;
  size: string;
  moderation: string;
  mode: "auto" | "direct";
  reasoningEffort: string | undefined;
  webSearchEnabled: boolean;
}
interface ExecutionBase {
  provider: CoreProviderId; // resolved; never "auto" or an arbitrary string
  requestId: string | undefined;
  signal: AbortSignal;
  prompt: string; // effective prompt, including element/background/size text
  rawPrompt: string; // validated user prompt; non-target lanes currently use it
  references: ExecutionReference[]; // validated, not raw request.references
  options: ExecutionOptions;
}
export type ImageExecutionRequest = ExecutionBase & (
  | { surface: "classic"; providerUrl: string | null;
      background: { background: string; outputFormat?: string | undefined } | null;
      backgroundConstraint: string | undefined;
      nai: NaiRequestOptions;
      comfy: { seed?: number | undefined;
        params?: Record<string, number | string | boolean> | undefined } }
  | { surface: "node"; sourceImage: string | null;
      contextMode: "parent-plus-refs" | "parent-only";
      searchMode: "off" | "auto" | "on";
      partialImages: 0 | 2; nai: NaiRequestOptions }
  | { surface: "edit"; sourceImage: string; mask: string | null }
  | { surface: "multimode"; providerUrl: string | null;
      maxImages: number; nai: NaiRequestOptions }
);
export interface ExecutionImage {
  b64: string;
  revisedPrompt?: string | null | undefined;
  mime?: string | undefined;
  providerUrl?: string | undefined;
}
export interface SingleImageExecutionResult extends Omit<ExecutionImage, "providerUrl"> {
  providerUrl?: string | null | undefined;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  text?: string | null | undefined;
  retryKind?: string | undefined;
  initialEventCount?: number | undefined;
  initialEventTypes?: Record<string, number> | undefined;
  hadReferences?: boolean | undefined;
  referencesDroppedOnRetry?: boolean | undefined;
  developerPromptDroppedOnRetry?: boolean | undefined;
  webSearchDroppedOnRetry?: boolean | undefined;
  promptId?: string | undefined;
  origin?: string | undefined;
  effectiveModel?: string | undefined;
}
export interface SequenceImageExecutionResult {
  images: ExecutionImage[];
  originalIndexes?: number[] | undefined; // aligned with images; absent means dense indices
  usage: Record<string, number> | null;
  webSearchCalls: number;
  extraIgnored?: number | undefined;
  error?: unknown;
  text?: string | null | undefined;
  eventCount?: number | undefined;
  eventTypes?: Record<string, number> | undefined;
  diagnostics?: ResponseDiagnostics | undefined;
}
export interface ExecutionProgress {
  onPartialImage?: (partial: {
    b64: string | undefined; index: number | null | undefined
  }) => void;
  onFinalImage?: (image: ExecutionImage, index: number) => void | Promise<void>;
  onQueue?: (info: ComfyQueueInfo) => void;
}
export type ImageExecutionResult =
  | { kind: "single"; value: SingleImageExecutionResult }
  | { kind: "sequence"; value: SequenceImageExecutionResult };
export type ExecutionSurface = ImageExecutionRequest["surface"];
export type ExecutionResultFor<S extends ExecutionSurface> =
  S extends "multimode"
    ? Extract<ImageExecutionResult, { kind: "sequence" }>
    : Extract<ImageExecutionResult, { kind: "single" }>;
export interface PreparedImageExecution<S extends ExecutionSurface> {
  execute(): Promise<ExecutionResultFor<S>>;
}
export type PrepareImageExecution = <R extends ImageExecutionRequest>(
  ctx: RuntimeContext, request: R, progress?: ExecutionProgress
) => Promise<PreparedImageExecution<R["surface"]>>;
