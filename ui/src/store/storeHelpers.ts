import { fetchApi } from "../lib/api-core";
import type {
  Format,
  GenerateItem,
  UIMode,
} from "../types";
import {
  getInflight,
  getHistory,
} from "../lib/api";
import { compressToBase64 } from "../lib/compress";
import { JOB_TRACKING_TIMEOUT_MESSAGE } from "../lib/errorCodes";
import { IN_FLIGHT_STORAGE_KEY } from "./persistenceRegistry";
import { normalizeCustomSizePairDetailed } from "../lib/size";
import { resolveNaiOptions, type NaiOptions } from "../lib/naiOptions";
import {
  normalizeInsertedPromptArray,
  cloneInsertedPrompts,
} from "./storePersistence";
import type {
  AppState,
  PersistedInFlight,
  ServerInFlightJob,
  ServerTerminalJob,
  InflightQueryScope,
  GraphSaveReason,
  GraphSaveResult,
  MultimodeSequenceState,
  CustomSizeConfirmState,
} from "./storeTypes";

export type { PersistedInFlight, ServerInFlightJob, ServerTerminalJob, InflightQueryScope, GraphSaveReason, GraphSaveResult, MultimodeSequenceState };
export const INFLIGHT_TTL_MS = 180_000;

export function getInflightQueryScopes(state: {
  uiMode: UIMode;
  activeSessionId?: string | null;
  inFlight: PersistedInFlight[];
}): InflightQueryScope[] {
  const scopes: InflightQueryScope[] = state.uiMode === "node"
    ? [{ kind: "node", sessionId: state.activeSessionId ?? undefined }]
    : [{ kind: "classic" }];
  if (state.inFlight.some((job) => job.kind === "multimode")) {
    scopes.push({ kind: "multimode" });
  }
  scopes.push({ kind: "video" });
  scopes.push({ kind: "mcp-image" }, { kind: "mcp-video" });
  for (const job of state.inFlight) {
    if (!matchesInflightScope(job, scopes)) {
      scopes.push({ kind: job.kind ?? "classic", ...(job.kind === "node" ? { sessionId: job.sessionId ?? undefined } : {}) });
    }
  }
  return scopes;
}

export function matchesInflightScope(job: PersistedInFlight, scopes: InflightQueryScope[]): boolean {
  const kind = job.kind ?? "classic";
  return scopes.some((scope) =>
    kind === scope.kind &&
    (scope.kind !== "node" || (job.sessionId ?? null) === (scope.sessionId ?? null)),
  );
}

export async function fetchInflightScopes(scopes: InflightQueryScope[]): Promise<{
  jobs: ServerInFlightJob[];
  terminalJobs: ServerTerminalJob[];
}> {
  const responses = await Promise.all(scopes.map((scope) =>
    getInflight({
      // api-inflight's legacy union has not yet adopted the server's extensible MCP kinds.
      kind: scope.kind as NonNullable<Parameters<typeof getInflight>[0]>["kind"],
      sessionId: scope.sessionId,
      includeTerminal: true,
    }),
  ));
  return {
    jobs: responses.flatMap((response) => response.jobs),
    terminalJobs: responses.flatMap((response) => response.terminalJobs ?? []) as ServerTerminalJob[],
  };
}

export function toPersistedInFlightJob(job: ServerInFlightJob): PersistedInFlight {
  const meta = job.meta ?? {};
  const kind =
    job.kind === "classic" || job.kind === "node" || job.kind === "multimode" || job.kind === "video"
      ? job.kind
      : meta.kind === "classic" || meta.kind === "node" || meta.kind === "multimode" || meta.kind === "video"
        ? meta.kind
        : normalizeInflightKind(job.kind) ?? normalizeInflightKind(meta.kind);
  return {
    id: job.requestId,
    prompt: typeof job.prompt === "string" ? job.prompt : "",
    startedAt: job.startedAt,
    composerPrompt: typeof meta.composerPrompt === "string" ? meta.composerPrompt : undefined,
    composerInsertedPrompts: normalizeInsertedPromptArray(meta.composerInsertedPrompts) ?? undefined,
    phase: typeof job.phase === "string" ? job.phase : undefined,
    sessionId: typeof meta.sessionId === "string" ? meta.sessionId : null,
    parentNodeId: typeof meta.parentNodeId === "string" ? meta.parentNodeId : null,
    clientNodeId: typeof meta.clientNodeId === "string" ? meta.clientNodeId : null,
    kind,
  };
}

export function terminalJobError(job: ServerTerminalJob): Error & { code?: string; status?: number } {
  const code = typeof job.errorCode === "string" && job.errorCode
    ? job.errorCode
    : "UNKNOWN";
  const e = new Error(code === "JOB_TRACKING_TIMEOUT"
    ? JOB_TRACKING_TIMEOUT_MESSAGE
    : code === "EMPTY_RESPONSE"
    ? "No image data returned from the image backend."
    : "Generation failed on the server.") as Error & { code?: string; status?: number };
  e.code = code;
  e.status = typeof job.httpStatus === "number" ? job.httpStatus : undefined;
  return e;
}

export function isCanceledGenerationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const value = err as { code?: unknown; status?: unknown };
  return value.code === "GENERATION_CANCELED" || value.status === 499;
}

export function multimodeImageKey(item: GenerateItem): string {
  return item.filename || item.image;
}

export function mergeMultimodeImages(current: GenerateItem[], incoming: GenerateItem[]): GenerateItem[] {
  const byKey = new Map(current.map((item) => [multimodeImageKey(item), item] as const));
  for (const item of incoming) byKey.set(multimodeImageKey(item), item);
  return [...byKey.values()].sort((a, b) =>
    (a.sequenceIndex ?? Number.MAX_SAFE_INTEGER) -
    (b.sequenceIndex ?? Number.MAX_SAFE_INTEGER),
  );
}

export function loadInFlight({ includeExpired = false }: { includeExpired?: boolean } = {}): PersistedInFlight[] {
  try {
    const raw = localStorage.getItem(IN_FLIGHT_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .filter(
        (x: any) =>
          x && typeof x.id === "string" && typeof x.prompt === "string" &&
          typeof x.startedAt === "number" && (includeExpired || now - x.startedAt < INFLIGHT_TTL_MS),
      )
      .map((x: any) => ({
        id: x.id,
        prompt: x.prompt,
        startedAt: x.startedAt,
        composerPrompt: typeof x.composerPrompt === "string" ? x.composerPrompt : undefined,
        composerInsertedPrompts: normalizeInsertedPromptArray(x.composerInsertedPrompts) ?? undefined,
        phase: typeof x.phase === "string" ? x.phase : undefined,
        sessionId: typeof x.sessionId === "string" ? x.sessionId : null,
        parentNodeId: typeof x.parentNodeId === "string" ? x.parentNodeId : null,
        clientNodeId: typeof x.clientNodeId === "string" ? x.clientNodeId : null,
        kind: x.kind === "classic" || x.kind === "node" || x.kind === "multimode" || x.kind === "video"
          ? x.kind
          : normalizeInflightKind(x.kind),
      }));
  } catch {
    return [];
  }
}

export function normalizeInflightKind(value: unknown): PersistedInFlight["kind"] {
  if (
    value === "classic" || value === "node" || value === "multimode" || value === "video" ||
    value === "mcp-image" || value === "mcp-video"
  ) return value;
  return typeof value === "string" && value.startsWith("mcp-action-") ? value as `mcp-action-${string}` : undefined;
}

export const HISTORY_LIMIT = 500;
export const DEFAULT_REFERENCE_IMAGE_LIMIT = 5;

export function narrowGenerateKind(k?: string | null): GenerateItem["kind"] {
  return k === "classic" || k === "edit" || k === "generate" ||
    k === "card-news-card" || k === "card-news-set" ? k : null;
}

export function mapHistoryItem(it: Awaited<ReturnType<typeof getHistory>>["items"][number]): GenerateItem {
  const composerInsertedPrompts = normalizeInsertedPromptArray(it.composerInsertedPrompts);
  const isVideo = it.mediaType === "video" || /\.(mp4|webm|mov)$/i.test(it.filename ?? "");
  return {
    image: it.url,
    url: it.url,
    providerUrl: it.providerUrl ?? null,
    mediaType: it.mediaType,
    video: it.video ?? null,
    videoSeries: it.videoSeries ?? null,
    videoContinuity: it.videoContinuity ?? null,
    videoLineage: it.videoLineage ?? null,
    filename: it.filename,
    thumb: it.thumb ?? (isVideo ? undefined : it.url),
    prompt: it.prompt ?? undefined,
    userPrompt: it.userPrompt ?? null,
    revisedPrompt: it.revisedPrompt ?? null,
    promptMode: it.promptMode ?? null,
    composerPrompt: it.composerPrompt ?? null,
    composerInsertedPrompts: composerInsertedPrompts
      ? cloneInsertedPrompts(composerInsertedPrompts)
      : null,
    size: it.size ?? undefined,
    quality: it.quality ?? undefined,
    format: it.format as Format | undefined,
    model: it.model ?? undefined,
    imageToolModel: it.imageToolModel ?? null,
    reasoningEffort: (it.reasoningEffort as GenerateItem["reasoningEffort"]) ?? undefined,
    elapsed: it.elapsed ?? undefined,
    provider: it.provider,
    usage: (it.usage as GenerateItem["usage"]) ?? undefined,
    createdAt: it.createdAt,
    sessionId: it.sessionId ?? null,
    nodeId: it.nodeId ?? null,
    parentNodeId: it.parentNodeId ?? null,
    clientNodeId: it.clientNodeId ?? null,
    requestId: it.requestId ?? null,
    kind: narrowGenerateKind(it.kind),
    canvasVersion: Boolean(it.canvasVersion),
    canvasSourceFilename: it.canvasSourceFilename ?? null,
    canvasEditableFilename: it.canvasEditableFilename ?? null,
    canvasMergedAt: it.canvasMergedAt ?? undefined,
    annotationsBaked: Boolean(it.annotationsBaked),
    annotationSnapshot: it.annotationSnapshot ?? null,
    annotationOnly: Boolean(it.annotationOnly),
    setId: it.setId ?? null,
    cardId: it.cardId ?? null,
    cardOrder: it.cardOrder ?? null,
    headline: it.headline ?? null,
    body: it.body ?? null,
    cards: it.cards,
    refsCount: it.refsCount ?? 0,
    webSearchCalls: it.webSearchCalls ?? 0,
    isFavorite: it.isFavorite ?? false,
    sequenceId: it.sequenceId ?? null,
    sequenceIndex: it.sequenceIndex ?? null,
    sequenceTotalRequested: it.sequenceTotalRequested ?? null,
    sequenceTotalReturned: it.sequenceTotalReturned ?? null,
    sequenceStatus: it.sequenceStatus ?? null,
  };
}

export function historyKey(item: Pick<GenerateItem, "filename" | "image">): string {
  return item.filename ?? item.image;
}

export function withoutHistoryDuplicate(
  history: GenerateItem[],
  item: Pick<GenerateItem, "filename" | "image">,
): GenerateItem[] {
  const key = historyKey(item);
  return history.filter((existing) => historyKey(existing) !== key);
}

export function findHistoryDuplicate(
  history: GenerateItem[],
  item: Pick<GenerateItem, "filename" | "image">,
): GenerateItem | undefined {
  const key = historyKey(item);
  return history.find((existing) => historyKey(existing) === key);
}

export function preserveHistoryMetadata(incoming: GenerateItem, existing?: GenerateItem): GenerateItem {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    createdAt: incoming.createdAt ?? existing.createdAt,
    requestId: incoming.requestId ?? existing.requestId,
    sessionId: incoming.sessionId ?? existing.sessionId,
    kind: incoming.kind ?? existing.kind,
    refsCount: incoming.refsCount ?? existing.refsCount,
    isFavorite: incoming.isFavorite ?? existing.isFavorite,
  };
}

export function mergeHistoryItems(current: GenerateItem[], incoming: GenerateItem[]): GenerateItem[] {
  const byKey = new Map(current.map((item) => [historyKey(item), item]));
  for (const item of incoming) byKey.set(historyKey(item), item);
  return [
    ...current.map((item) => byKey.get(historyKey(item)) ?? item),
    ...incoming.filter((item) => !current.some((h) => historyKey(h) === historyKey(item))),
  ];
}

export function retainHistoryItems(items: GenerateItem[], limit: number): GenerateItem[] {
  return items.slice(0, Math.max(HISTORY_LIMIT, limit));
}

export function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

export async function compressReferenceSource(src: string, filename = "reference.png"): Promise<string> {
  const resp = await fetchApi(src);
  if (!resp.ok) throw new Error(`reference fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  return compressToBase64(file, {
    preserveTransparency: false,
  });
}

export function removeImageFromMultimodeSequences(
  sequences: Record<string, MultimodeSequenceState>,
  filename: string,
): Record<string, MultimodeSequenceState> {
  let changed = false;
  const next: Record<string, MultimodeSequenceState> = {};
  for (const [id, sequence] of Object.entries(sequences)) {
    const images = sequence.images.filter((image) => image.filename !== filename);
    if (images.length === sequence.images.length) {
      next[id] = sequence;
      continue;
    }
    changed = true;
    if (images.length === 0) continue;
    next[id] = {
      ...sequence,
      images,
      returned: images.length,
      status:
        sequence.status === "complete" && images.length < sequence.requested
          ? "partial"
          : sequence.status,
    };
  }
  return changed ? next : sequences;
}

export function saveInFlight(list: PersistedInFlight[]): void {
  try {
    localStorage.setItem(IN_FLIGHT_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    const w = window as unknown as { __ima2QuotaWarned?: boolean };
    if (!w.__ima2QuotaWarned) {
      w.__ima2QuotaWarned = true;
      console.warn("[ima2] localStorage write failed:", err);
    }
  }
}

/**
 * The displayed NovelAI options: compiled fallback, then the operator's
 * published defaults, then whatever the user explicitly changed. There is no
 * naiOptions state field — this resolves at read time so an untouched field
 * keeps tracking the server (020).
 *
 * Consume it with useShallow: it returns a fresh object per call and Zustand 5
 * hands selector output straight to useSyncExternalStore.
 */
export function selectResolvedNaiOptions(state: AppState): NaiOptions {
  return resolveNaiOptions(state.naiServerDefaults, state.naiOptionOverrides);
}

export function getCustomSizeConfirmation(
  state: AppState,
  continuation: NonNullable<CustomSizeConfirmState>["continuation"],
): CustomSizeConfirmState {
  // Hosted lanes take a size string rather than a free-form pixel pair, so the
  // custom-size confirmation dialog does not apply to them. nai is included
  // for the same reason: its sizes are fixed presets on NovelAI's side.
  if (state.provider === "grok" || state.provider === "grok-api" || state.provider === "agy" || state.provider === "gemini-api" || state.provider === "atlascloud" || state.provider === "minimax" || state.provider === "nai") return null;
  if (state.sizePreset !== "custom") return null;
  const result = normalizeCustomSizePairDetailed(
    state.customW,
    state.customH,
    state.customW,
    state.customH,
  );
  if (!result.adjusted) return null;
  return {
    requestedW: result.requestedW,
    requestedH: result.requestedH,
    adjustedW: result.w,
    adjustedH: result.h,
    reasons: result.reasons,
    continuation,
  };
}
