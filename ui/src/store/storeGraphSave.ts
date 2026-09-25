import { fetchApi } from "../lib/api-core";
import type { GenerateItem, GenerateItemVideo } from "../types";
import type { SessionFull, SessionGraphEdge } from "../lib/api";
import {
  getHistory,
  getSession as apiGetSession,
  saveSessionGraph,
} from "../lib/api";
import { compressImage } from "../lib/image";
import { type ClientNodeId } from "../lib/graph";
import { deriveParentServerNodeIds } from "../lib/nodeGraph";
import { loadNodeRefs, pruneNodeRefs } from "../lib/nodeRefStorage";
import { isVideoItem } from "../lib/videoMedia";
import { t } from "../i18n";
import { GRAPH_TAB_ID_KEY } from "./persistenceRegistry";
import { saveSelectedFilename } from "./storePersistence";
import {
  HISTORY_LIMIT,
  findHistoryDuplicate,
  preserveHistoryMetadata,
  withoutHistoryDuplicate,
  retainHistoryItems,
} from "./storeHelpers";
import type {
  AppState,
  ImageNodeData,
  ImageNodeStatus,
  GraphNode,
  GraphEdge,
  GraphSaveReason,
  GraphSaveResult,
} from "./storeTypes";

export function mapSessionToGraph(session: SessionFull): {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphVersion: number;
} {
  const graphNodes: GraphNode[] = session.nodes.map((n) => {
    const d = (n.data ?? {}) as Partial<ImageNodeData>;
    const explicitImageUrl =
      typeof d.imageUrl === "string" && d.imageUrl.length > 0 ? d.imageUrl : null;
    const fallbackImageUrl =
      typeof d.serverNodeId === "string" && d.serverNodeId.length > 0
        ? `/generated/${d.serverNodeId}.png`
        : null;
    const imageUrl = explicitImageUrl ?? fallbackImageUrl;
    // Spread first so element/branch fields the mapper does not manage
    // (nodeType, elementId, elementName, thumbnailUrl, refCount, notesPreview,
    // missing, provider, resolvedRevision) survive save→reload (Socrates B2).
    const data: ImageNodeData = {
      ...(d as unknown as ImageNodeData),
      clientId: n.id as ClientNodeId,
      serverNodeId: (d.serverNodeId ?? null) as string | null,
      parentServerNodeId: (d.parentServerNodeId ?? null) as string | null,
      prompt: typeof d.prompt === "string" ? d.prompt : "",
      imageUrl,
      status: (d.status ?? (imageUrl ? "ready" : "empty")) as ImageNodeStatus,
      pendingRequestId: (d.pendingRequestId ?? null) as string | null,
      recoveryRequestId: (d.recoveryRequestId ?? null) as string | null,
      pendingPhase: (d.pendingPhase ?? null) as string | null,
      pendingStartedAt:
        typeof d.pendingStartedAt === "number" ? d.pendingStartedAt : null,
      partialImageUrl: null,
      error: d.error as string | undefined,
      elapsed: d.elapsed as number | undefined,
      reasoningEffort: d.reasoningEffort as ImageNodeData["reasoningEffort"] | undefined,
      webSearchCalls: d.webSearchCalls as number | undefined,
      model: (d.model ?? null) as string | null,
      size: (d.size ?? null) as string | null,
      referenceImages: loadNodeRefs(session.id, n.id),
      video: (d.video ?? null) as ImageNodeData["video"],
    };
    return {
      id: n.id,
      // Restore the renderer discriminator from data (element nodes save with
      // data.nodeType = "element-reference"; image nodes have none).
      type: (d as Record<string, unknown>).nodeType === "element-reference" ? "elementReferenceNode" : "imageNode",
      position: { x: n.x, y: n.y },
      data,
    };
  });
  const graphEdges: GraphEdge[] = session.edges.map((e) => {
    const data = (e.data ?? {}) as Record<string, unknown>;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: typeof data.sourceHandle === "string" ? data.sourceHandle : null,
      targetHandle: typeof data.targetHandle === "string" ? data.targetHandle : null,
    };
  });
  return {
    graphNodes: deriveParentServerNodeIds(graphNodes, graphEdges),
    graphEdges,
    graphVersion: session.graphVersion,
  };
}

const SAVE_DEBOUNCE_MS = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isSavingGraph = false;
let needsGraphSave = false;
let activeGraphSavePromise: Promise<GraphSaveResult> | null = null;
let graphSaveSeq = 0;

function getGraphTabId(): string {
  try {
    const existing = sessionStorage.getItem(GRAPH_TAB_ID_KEY);
    if (existing) return existing;
    const next = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(GRAPH_TAB_ID_KEY, next);
    return next;
  } catch {
    return "tab_unavailable";
  }
}

function sanitizeForSave(d: ImageNodeData): Record<string, unknown> {
  const safe = { ...(d as unknown as Record<string, unknown>) };
  delete safe.referenceImages;
  delete safe.partialImageUrl;
  const shouldSanitize = d.status === "pending" || d.status === "reconciling";
  if (!shouldSanitize) return safe;
  return {
    ...safe,
    status: "empty",
    pendingRequestId: null,
    recoveryRequestId: d.pendingRequestId ?? d.recoveryRequestId ?? null,
    pendingPhase: null,
    pendingStartedAt: null,
    error: undefined,
  };
}

function serializeGraphEdgesForSave(graphEdges: GraphEdge[]): SessionGraphEdge[] {
  return graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: {
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    },
  }));
}

export async function recoverGraphNodesFromHistory(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const sid = get().activeSessionId;
  if (!sid) return;
  const candidates = get().graphNodes.filter(
    (n) => !n.data.imageUrl && !n.data.serverNodeId,
  );
  if (candidates.length === 0) return;

  let items: Array<{
    url: string;
    createdAt: number;
    size?: string | null;
    elapsed?: number | null;
    reasoningEffort?: string | null;
    sessionId?: string | null;
    nodeId?: string | null;
    clientNodeId?: string | null;
    requestId?: string | null;
    video?: GenerateItemVideo | null;
  }> = [];
  try {
    const res = await getHistory({ sessionId: sid, limit: HISTORY_LIMIT });
    items = res.items;
  } catch {
    return;
  }

  let changed = false;
  const next = get().graphNodes.map((n) => {
    if (n.data.imageUrl || n.data.serverNodeId) return n;
    const startedAt = n.data.pendingStartedAt ?? 0;
    const requestKey = n.data.pendingRequestId ?? n.data.recoveryRequestId ?? null;
    const byRequest = requestKey
      ? items.find(
          (h) =>
            (h.sessionId ?? null) === sid &&
            (h.requestId ?? null) === requestKey,
        )
      : null;
    const recovered = byRequest ?? items.find(
      (h) =>
        (h.sessionId ?? null) === sid &&
        (h.clientNodeId ?? null) === n.id &&
        (!startedAt || (h.createdAt ?? 0) >= startedAt),
    );
    if (!recovered) return n;
    changed = true;
    return {
      ...n,
      data: {
        ...n.data,
        status: "ready" as const,
        imageUrl: recovered.url,
        serverNodeId: recovered.nodeId ?? n.data.serverNodeId,
        size: recovered.size ?? n.data.size ?? null,
        elapsed: recovered.elapsed ?? n.data.elapsed,
        reasoningEffort: (recovered.reasoningEffort as ImageNodeData["reasoningEffort"]) ?? n.data.reasoningEffort,
        video: recovered.video ?? n.data.video ?? null,
        pendingRequestId: null,
        recoveryRequestId: null,
        pendingPhase: null,
        pendingStartedAt: null,
        partialImageUrl: null,
        error: undefined,
      },
    };
  });

  if (!changed) return;
  set({ graphNodes: next });
  scheduleGraphSaveImpl(get, set, "recovery");
}

async function reloadSessionAfterConflict(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const id = get().activeSessionId;
  if (!id) return;
  const { session } = await apiGetSession(id);
  const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
  set({
    graphNodes,
    graphEdges,
    activeSessionGraphVersion: graphVersion,
  });
  get().showToast(t("toast.sessionReloadedElsewhere"), true);
  await recoverGraphNodesFromHistory(get, set).catch(() => {});
}

async function doSave(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason,
): Promise<GraphSaveResult> {
  const id = get().activeSessionId;
  const graphVersion = get().activeSessionGraphVersion;
  if (!id) return "skipped";
  if (graphVersion == null) return "skipped";
  const { graphNodes, graphEdges, sessionLoading } = get();
  if (sessionLoading) return "skipped";
  if (graphNodes.length === 0 && graphVersion > 0) return "skipped";
  const nodes = graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: sanitizeForSave(n.data),
  }));
  const edges = serializeGraphEdgesForSave(graphEdges);
  const saveId = `gs_${Date.now().toString(36)}_${++graphSaveSeq}`;
  try {
    const res = await saveSessionGraph(id, graphVersion, nodes, edges, {
      saveId,
      saveReason: reason,
      tabId: getGraphTabId(),
    });
    if (get().activeSessionId !== id) return "skipped";
    pruneNodeRefs(id, get().graphNodes.map((n) => n.id));
    set({ activeSessionGraphVersion: res.graphVersion });
    return "saved";
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      await reloadSessionAfterConflict(get, set);
      return "conflict";
    }
    console.warn("[sessions] save failed:", err);
    return "failed";
  }
}

async function runGraphSaveQueue(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason,
): Promise<GraphSaveResult> {
  if (isSavingGraph) {
    needsGraphSave = true;
    if (activeGraphSavePromise) return activeGraphSavePromise;
    return "skipped";
  }

  isSavingGraph = true;
  activeGraphSavePromise = (async () => {
    let nextReason = reason;
    let lastResult: GraphSaveResult = "skipped";
    do {
      needsGraphSave = false;
      lastResult = await doSave(get, set, nextReason);
      if (lastResult === "conflict" || lastResult === "failed") break;
      nextReason = "queued";
    } while (needsGraphSave);
    return lastResult;
  })().finally(() => {
    isSavingGraph = false;
    activeGraphSavePromise = null;
  });

  return activeGraphSavePromise;
}

export function scheduleGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason = "debounced",
): void {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.sessionLoading) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void runGraphSaveQueue(get, set, reason);
  }, SAVE_DEBOUNCE_MS);
}

export async function flushGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  reason: GraphSaveReason = "manual",
): Promise<void> {
  let shouldSaveNow = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    shouldSaveNow = true;
  }
  if (isSavingGraph) {
    needsGraphSave = true;
    const result = activeGraphSavePromise ? await activeGraphSavePromise : "skipped";
    if (result === "failed") throw new Error(t("modal.graphSaveFailed"));
    return;
  }
  if (shouldSaveNow) {
    const result = await runGraphSaveQueue(get, set, reason);
    if (result === "failed") throw new Error(t("modal.graphSaveFailed"));
  }
}

export function flushGraphSaveBeacon(get: () => AppState): void {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.activeSessionGraphVersion == null) return;
  if (s.sessionLoading) return;
  if (s.graphNodes.length === 0 && s.activeSessionGraphVersion > 0) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const nodes = s.graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: sanitizeForSave(n.data),
  }));
  const edges = serializeGraphEdgesForSave(s.graphEdges);
  const url = `/api/sessions/${encodeURIComponent(s.activeSessionId)}/graph`;
  const body = JSON.stringify({ nodes, edges });
  try {
    void fetchApi(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(s.activeSessionGraphVersion),
        "X-Ima2-Graph-Save-Id": `gs_${Date.now().toString(36)}_${++graphSaveSeq}`,
        "X-Ima2-Graph-Save-Reason": "beforeunload",
        "X-Ima2-Tab-Id": getGraphTabId(),
      },
      body,
      keepalive: true,
    }).catch(() => { /* Keep the draft; unload has no response UI. */ });
  } catch { /* best-effort: unload has no response UI; the local draft is kept */ }
}

type AddHistoryOptions = {
  autoSelectStartedAt?: number;
};

export async function addHistory(
  item: GenerateItem,
  set: (p: Partial<AppState>) => void,
  get: () => AppState,
  options: AddHistoryOptions = {},
): Promise<void> {
  const thumb = isVideoItem(item)
    ? undefined
    : await compressImage(item.image).catch(() => item.image);
  const url = item.filename ? `/generated/${item.filename}` : item.image;
  const withThumb: GenerateItem = {
    ...item,
    thumb,
    url,
    createdAt: item.createdAt || Date.now(),
  };
  const state = get();
  const existing = findHistoryDuplicate(state.history, withThumb);
  const merged = preserveHistoryMetadata(withThumb, existing);
  const historyWithoutDuplicate = withoutHistoryDuplicate(state.history, merged);
  const history = retainHistoryItems(
    [merged, ...historyWithoutDuplicate],
    state.loadedHistoryRetainLimit + 1,
  );
  const userSelectedDuringGeneration =
    options.autoSelectStartedAt != null &&
    state.lastHistorySelectedAt > options.autoSelectStartedAt;
  const shouldAutoSelect =
    !userSelectedDuringGeneration &&
    (
      !state.currentImage ||
      options.autoSelectStartedAt == null ||
      state.lastHistorySelectedAt <= options.autoSelectStartedAt
    );
  if (shouldAutoSelect) {
    saveSelectedFilename(merged.filename ?? null);
  }
  set({
    history,
    ...(shouldAutoSelect ? { currentImage: merged } : {}),
    loadedHistoryRetainLimit: Math.max(
      state.loadedHistoryRetainLimit,
      Math.min(state.history.length + 1, state.loadedHistoryRetainLimit + 1),
    ),
    unseenGeneratedCount: state.unseenGeneratedCount + 1,
  });
}

export function selectCurrentSessionId(state: AppState): string | null {
  for (const item of state.history) {
    if (item.sessionId) return item.sessionId;
  }
  return null;
}
