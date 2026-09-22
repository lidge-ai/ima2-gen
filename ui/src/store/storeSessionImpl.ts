import {
  listSessions as apiListSessions,
  createSession as apiCreateSession,
  getSession as apiGetSession,
  renameSession as apiRenameSession,
  deleteSession as apiDeleteSession,
  getInflight,
  type SessionSummary,
} from "../lib/api";
import { t } from "../i18n";
import {
  loadActiveSessionId,
  saveActiveSessionId,
} from "./storePersistence";
import {
  mapSessionToGraph,
  recoverGraphNodesFromHistory,
} from "./storeGraphSave";
import { napRefCuaPhien } from "../lib/nodeRefStorage";
import type { StoreSet, StoreGet } from "./storeTypes";

export async function loadSessionsImpl(set: StoreSet, get: StoreGet): Promise<void> {
  try {
    const { sessions } = await apiListSessions();
    set({ sessions });
    const current = get().activeSessionId;
    if (!current) {
      const savedId = loadActiveSessionId();
      const savedExists = savedId ? sessions.some((s) => s.id === savedId) : false;
      if (savedId && savedExists) {
        await get().switchSession(savedId);
      } else {
        await get().createAndSwitchSession(t("session.firstGraph"));
      }
    }
  } catch (err) {
    console.warn("[sessions] load failed:", err);
    get().showToast(t("modal.sessionInitialLoadFailed"), true);
    if (window.confirm(t("modal.sessionInitialLoadRetry"))) {
      await loadSessionsImpl(set, get);
    }
  }
}

export async function switchSessionImpl(
  id: string,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (id === get().activeSessionId) return;
  try {
    await get().flushGraphSave("switch-session");
  } catch (err) {
    console.warn("[sessions] switch blocked by save failure:", err);
    set({ sessionLoading: false });
    get().showToast(t("modal.sessionSwitchSaveFailed"), true);
    return;
  }
  set({ sessionLoading: true });
  try {
    const { session } = await apiGetSession(id);
    // Anh dinh tren node nam o bang rieng tren may chu, khong nam trong graph.
    // Phai nap TRUOC khi dung graph, khong thi node hien ra khong co anh nao.
    await napRefCuaPhien(id);
    const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
    set({
      activeSessionId: id,
      activeSessionGraphVersion: graphVersion,
      graphNodes,
      graphEdges,
      graphHistoryPast: [],
      graphHistoryFuture: [],
      sessionLoading: false,
    });
    saveActiveSessionId(id);
    // Luot chay do may chu dieu khien co the dang giua chung: hoi mot lan de node
    // dang sinh sang len ngay, thay vi doi su kien tiep theo.
    void get().napWfApiDangChay(id);
    await get().reconcileGraphPending().catch(() => {});
  } catch (err) {
    console.warn("[sessions] switch failed:", err);
    set({ sessionLoading: false });
    get().showToast(t("toast.sessionLoadFailed"), true);
  }
}

export async function reconcileGraphPendingImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const sid = get().activeSessionId;
  if (!sid) return;
  const pendingNodes = get().graphNodes.filter(
    (n) => n.data?.pendingRequestId && (n.data.status === "pending" || n.data.status === "reconciling"),
  );
  if (pendingNodes.length > 0) {
    let jobs: Array<{ requestId: string; phase?: string }> = [];
    try {
      const res = await getInflight({ kind: "node", sessionId: sid });
      jobs = res.jobs;
    } catch {
      jobs = [];
    }
    const byId = new Map(jobs.map((j) => [j.requestId, j.phase] as const));
    const now = Date.now();
    const GRACE_MS = 10_000;
    const next = get().graphNodes.map((n) => {
      const reqId = n.data?.pendingRequestId;
      if (!reqId) return n;
      if (n.data.status !== "pending" && n.data.status !== "reconciling") return n;
      if (byId.has(reqId)) {
        const phase = byId.get(reqId) ?? null;
        return {
          ...n,
          data: { ...n.data, status: "reconciling" as const, pendingPhase: phase },
        };
      }
      const startedAt = n.data.pendingStartedAt ?? 0;
      if (startedAt && now - startedAt < GRACE_MS) {
        return {
          ...n,
          data: { ...n.data, status: "reconciling" as const },
        };
      }
      const hasAsset = !!n.data.imageUrl || !!n.data.serverNodeId;
      return {
        ...n,
        data: {
          ...n.data,
          pendingRequestId: null,
          pendingPhase: null,
          pendingStartedAt: null,
          partialImageUrl: null,
          status: hasAsset ? ("ready" as const) : ("stale" as const),
          error: hasAsset ? undefined : t("session.assetAbortedError"),
        },
      };
    });
    set({ graphNodes: next });
  }
  await recoverGraphNodesFromHistory(get, set).catch(() => {});
}

export async function createAndSwitchSessionImpl(
  title: string | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (title == null) title = t("session.untitled");
  try {
    const { session } = await apiCreateSession(title);
    set({
      sessions: [session as SessionSummary, ...get().sessions],
      activeSessionId: session.id,
      activeSessionGraphVersion: session.graphVersion,
      graphNodes: [],
      graphEdges: [],
      graphHistoryPast: [],
      graphHistoryFuture: [],
    });
    saveActiveSessionId(session.id);
  } catch (err) {
    console.warn("[sessions] create failed:", err);
    get().showToast(t("toast.sessionCreateFailed"), true);
  }
}

export async function renameCurrentSessionImpl(
  title: string,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const id = get().activeSessionId;
  if (!id) return;
  try {
    await apiRenameSession(id, title);
    set({
      sessions: get().sessions.map((s) =>
        s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
      ),
    });
  } catch (err) {
    get().showToast(t("toast.sessionRenameFailed"), true);
  }
}

export async function deleteSessionByIdImpl(
  id: string,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  try {
    await apiDeleteSession(id);
    const remaining = get().sessions.filter((s) => s.id !== id);
    set({ sessions: remaining });
    if (get().activeSessionId === id) {
      set({
        activeSessionId: null,
        activeSessionGraphVersion: null,
        graphNodes: [],
        graphEdges: [],
      });
      saveActiveSessionId(null);
      if (remaining.length > 0) {
        await get().switchSession(remaining[0].id);
      } else {
        await get().createAndSwitchSession(t("session.firstGraph"));
      }
    }
  } catch (err) {
    get().showToast(t("toast.sessionDeleteFailed"), true);
  }
}
