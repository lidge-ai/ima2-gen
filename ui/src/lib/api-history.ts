import { jsonFetch, jsonFetchWithBrowserId } from "./api-core";

export type HistoryItem = {
  filename: string;
  url: string;
  providerUrl?: string | null;
  thumb?: string | null;
  mediaType?: "image" | "video" | string;
  video?: import("../types").GenerateItemVideo | null;
  videoSeries?: { topic?: string; chainIndex?: number } | null;
  videoContinuity?: import("../types").VideoContinuityLineage | null;
  videoLineage?: import("../types").VideoLineage | null;
  createdAt: number;
  prompt: string | null;
  userPrompt?: string | null;
  revisedPrompt?: string | null;
  promptMode?: "auto" | "direct" | null;
  composerPrompt?: string | null;
  composerInsertedPrompts?: import("../types").ComposerInsertedPromptSnapshot[] | null;
  quality: string | null;
  size: string | null;
  moderation?: string | null;
  model?: string | null;
  imageToolModel?: import("../types").ImageToolModel | null;
  reasoningEffort?: string | null;
  elapsed?: number | null;
  format: string;
  provider: string;
  usage: Record<string, unknown> | null;
  webSearchCalls: number;
  sessionId?: string | null;
  nodeId?: string | null;
  parentNodeId?: string | null;
  clientNodeId?: string | null;
  requestId?: string | null;
  kind?: string | null;
  canvasVersion?: boolean;
  canvasSourceFilename?: string | null;
  canvasEditableFilename?: string | null;
  canvasMergedAt?: number | null;
  annotationsBaked?: boolean;
  annotationSnapshot?: import("../types/canvas").SavedCanvasAnnotations | null;
  annotationOnly?: boolean;
  setId?: string | null;
  cardId?: string | null;
  cardOrder?: number | null;
  headline?: string | null;
  body?: string | null;
  cards?: Array<{
    url?: string;
    headline?: string;
    body?: string;
    cardOrder?: number;
    imageFilename?: string;
    status?: string;
  }>;
  refsCount?: number;
  isFavorite?: boolean;
  sequenceId?: string | null;
  sequenceIndex?: number | null;
  sequenceTotalRequested?: number | null;
  sequenceTotalReturned?: number | null;
  sequenceStatus?: "complete" | "partial" | "empty" | null;
};

export type HistoryCursor = { before: number; beforeFilename: string };

export type HistoryPage = {
  items: HistoryItem[];
  total: number;
  nextCursor: HistoryCursor | null;
};

export type HistorySessionGroup = {
  sessionId: string;
  title?: string | null;
  label?: string | null;
  items: HistoryItem[];
  lastUsedAt: number;
};

export type HistoryGroupedPage = {
  sessions: HistorySessionGroup[];
  loose: HistoryItem[];
  total: number;
  nextCursor: HistoryCursor | null;
};

export type StorageStatusState = "ok" | "recoverable" | "not_found" | "unknown";

export type StorageStatus = {
  generatedDirLabel: string;
  generatedCount: number;
  legacyCandidatesScanned: number;
  legacySourcesFound: number;
  legacyFilesFound: number;
  state: StorageStatusState;
  messageKind: StorageStatusState | "apology";
  recoveryDocsPath: string;
  doctorCommand: string;
  overrides: {
    generatedDir: boolean;
    configDir: boolean;
  };
};

export function getHistory(
  params: {
    limit?: number;
    since?: number;
    cursor?: HistoryCursor;
    sessionId?: string;
    favoritesOnly?: boolean;
  } = {},
): Promise<HistoryPage> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit ?? 50));
  if (params.since != null) qs.set("since", String(params.since));
  if (params.cursor) {
    qs.set("before", String(params.cursor.before));
    qs.set("beforeFilename", params.cursor.beforeFilename);
  }
  if (params.sessionId) qs.set("sessionId", params.sessionId);
  if (params.favoritesOnly) qs.set("favoritesOnly", "1");
  return jsonFetchWithBrowserId(`/api/history?${qs.toString()}`);
}

export function getHistoryGrouped(
  params: { limit?: number; cursor?: HistoryCursor; sessionId?: string | null } = {},
): Promise<HistoryGroupedPage> {
  const qs = new URLSearchParams();
  qs.set("groupBy", "session");
  qs.set("limit", String(params.limit ?? 200));
  if (params.cursor) {
    qs.set("before", String(params.cursor.before));
    qs.set("beforeFilename", params.cursor.beforeFilename);
  }
  if (params.sessionId) qs.set("sessionId", params.sessionId);
  return jsonFetchWithBrowserId(`/api/history?${qs.toString()}`);
}

export function toggleGalleryFavorite(filename: string): Promise<{ isFavorite: boolean }> {
  return jsonFetchWithBrowserId<{ isFavorite: boolean }>("/api/history/favorite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const res = await jsonFetch<{ ok: boolean; data: StorageStatus }>("/api/storage/status");
  return res.data;
}

export function openGeneratedDir(): Promise<{ ok: boolean }> {
  return jsonFetch<{ ok: boolean }>("/api/storage/open-generated-dir", {
    method: "POST",
  });
}

export function deleteHistoryItem(filename: string): Promise<{
  ok: boolean;
  filename: string;
  trash: "system";
  undoableInApp: false;
  sessionsTouched: number;
  nodesTouched: number;
}> {
  return jsonFetch(`/api/history/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export function permanentlyDeleteHistoryItem(filename: string): Promise<{
  ok: boolean;
  filename: string;
  sessionsTouched: number;
  nodesTouched: number;
}> {
  return jsonFetch(`/api/history/${encodeURIComponent(filename)}/permanent`, {
    method: "DELETE",
  });
}

export function restoreHistoryItem(filename: string, trashId: string): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/history/${encodeURIComponent(filename)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashId }),
  });
}

export type ComfyExportResponse = {
  ok: true;
  sourceFilename: string;
  uploadedFilename: string;
};

export function exportImageToComfy(input: { filename: string }): Promise<ComfyExportResponse> {
  return jsonFetch<ComfyExportResponse>("/api/comfy/export-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: input.filename }),
  });
}
