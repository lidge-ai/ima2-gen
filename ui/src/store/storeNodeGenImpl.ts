import type { ClientNodeId } from "../lib/graph";
import { postNodeGenerateStream } from "../lib/api";
import { deriveParentServerNodeIds } from "../lib/nodeGraph";
import { canhAnhVao, locCanhAnh } from "../lib/canhAnh";
import { dienOTrong, kichThuocCuaKhuon, kichThuocKeThua } from "../lib/chayWorkflow";
import { moTaTrangPhucGanNhat, O_TRANG_PHUC } from "../lib/moTaTrangPhuc";
import { getSelectedNodeIds } from "../lib/nodeSelection";
import {
  getDirectUnselectedChildren,
  getUnselectedDownstreamIds,
  collectDownstream,
  findCycleNodeIds,
  nodeHasImage,
  topologicalSortSelected,
  validateBatchDependencies,
  type NodeBatchMode,
} from "../lib/nodeBatch";
import { handleError } from "../lib/errorHandler";
import { buildNodeErrorInfo } from "../lib/nodeErrorInfo";
import { effectiveReferenceLimit } from "../lib/referenceLimits";
import { t } from "../i18n";
import {
  type PersistedInFlight,
  stripDataUrlPrefix,
  isCanceledGenerationError,
} from "./storeHelpers";
import { naiPayloadFields } from "../lib/naiPayload";
import type { AppState } from "./storeTypes";
import { clearFlightAbort, registerFlightAbort } from "./flightAbortRegistry";
import { getAssetById } from "../lib/api-assets";
import { assetMediaUrl } from "../lib/assetPreview";
import { elementReferenceFilenames, upsertElementCatalog } from "../lib/elementCatalog";
import { collectElementInputs, type ElementInputNode } from "../lib/nodeElementInputs";
import { fetchAsDataUrl } from "../lib/image";

type StoreSet = (p: Partial<AppState>) => void; type StoreGet = () => AppState;

const nodeGenerationLocks = new Set<string>();

/**
 * Resolve every upstream element input before a run (higgsfield 120 EN,
 * Socrates B3): missing/deleted elements block; existing elements are
 * re-fetched so the run uses the LATEST refs/notes and records a revision
 * snapshot on the element node. Returns ref dataURLs to merge into the
 * request, or the blocking element's display name.
 */
async function resolveElementInputsForRun(
  inputs: ElementInputNode[],
  set: StoreSet,
  get: StoreGet,
): Promise<{ ok: true; referenceDataUrls: string[]; notes: string[]; elementIds: string[]; revisions: Record<string, unknown> } | { ok: false; name: string }> {
  const dataUrls: string[] = [];
  const notes: string[] = [];
  const elementIds: string[] = [];
  const revisions: Record<string, unknown> = {};
  for (const input of inputs) {
    if (input.missing || !input.elementId) {
      if (input.missing) return { ok: false, name: input.name };
      continue;
    }
    let asset;
    try {
      asset = (await getAssetById(input.elementId)).asset;
    } catch {
      return { ok: false, name: input.name };
    }
    // Keep the catalog fresh and snapshot the resolved revision on the node.
    const catalog = upsertElementCatalog(get().elementCatalog, asset);
    const revision = (asset as unknown as Record<string, unknown>).updatedAt ?? asset.createdAt;
    elementIds.push(asset.id);
    revisions[asset.id] = revision;
    if (typeof asset.notes === "string" && asset.notes.trim()) notes.push(`${asset.name}: ${asset.notes.trim()}`);
    set({
      elementCatalog: catalog,
      graphNodes: get().graphNodes.map((n) => n.id === input.nodeId
        ? { ...n, data: { ...n.data, resolvedRevision: revision, missing: false } as typeof n.data }
        : n),
    });
    for (const file of elementReferenceFilenames(asset)) {
      try {
        const dataUrl = await fetchAsDataUrl(assetMediaUrl(file));
        if (!dataUrls.includes(dataUrl)) dataUrls.push(dataUrl);
      } catch { /* an unreadable ref is dropped, not fatal */ }
    }
  }
  return { ok: true, referenceDataUrls: dataUrls, notes, elementIds, revisions };
}

function mergeRunReferences(nodeRefs: string[], elementRefs: string[], activeLimit: number): string[] {
  const merged: string[] = [];
  for (const ref of [...nodeRefs, ...elementRefs]) {
    if (!merged.includes(ref)) merged.push(ref);
    if (merged.length >= activeLimit) break;
  }
  return merged;
}

/**
 * Danh dau lo thoi cho moi node phia sau mot node vua doi anh.
 *
 * Di theo CA HAI loai canh: canh base (anh nen) lan canh ref (tham chieu). Node
 * "mac do" lay anh trang phuc lam THAM CHIEU chu khong phai anh nen, nen neu chi
 * di theo canh base thi doi trang phuc xong no van bao "Done" voi anh cu.
 */
function danhDauLoThoi(
  goc: string,
  set: StoreSet,
  get: StoreGet,
  t: (key: string, vars?: Record<string, string | number>) => string,
): void {
  const canh = get().graphEdges;
  const phiaSau = new Set<string>();
  let bien = [goc];
  while (bien.length) {
    const tiep: string[] = [];
    for (const id of bien) {
      for (const e of canh) {
        if (e.source !== id || phiaSau.has(e.target) || e.target === goc) continue;
        phiaSau.add(e.target);
        tiep.push(e.target);
      }
    }
    bien = tiep;
  }
  if (!phiaSau.size) return;
  set({
    graphNodes: get().graphNodes.map((n) =>
      phiaSau.has(n.id) && n.data.status === "ready"
        ? { ...n, data: { ...n.data, status: "stale" as const, error: t("nodeBatch.staleBecauseParentChanged") } }
        : n,
    ),
  });
}

export async function runGenerateNodeInPlaceImpl(
  clientId: ClientNodeId,
  options: {
    sizeOverride?: string;
    parentServerNodeIdOverride?: string | null;
    suppressToast?: boolean;
  },
  set: StoreSet,
  get: StoreGet,
  saveInflightFn: (list: PersistedInFlight[]) => void,
): Promise<string | null> {
  if (nodeGenerationLocks.has(clientId)) return null;
  nodeGenerationLocks.add(clientId);
  const beforeRepair = get().graphNodes;
  const repairedNodes = deriveParentServerNodeIds(beforeRepair, get().graphEdges);
  if (repairedNodes.some((n, i) => n.data.parentServerNodeId !== beforeRepair[i]?.data.parentServerNodeId)) {
    set({ graphNodes: repairedNodes });
  }
  const node = repairedNodes.find((n) => n.id === clientId);
  if (!node) {
    nodeGenerationLocks.delete(clientId);
    return null;
  }
  // Element inputs (upstream traversal): missing/deleted blocks; existing
  // elements are re-fetched and their latest refs merge into the request.
  const elementInputs = collectElementInputs(get().graphNodes, get().graphEdges, [clientId]);
  const elementResolution = await resolveElementInputsForRun(elementInputs, set, get);
  if (elementResolution.ok === false) {
    get().showToast(t("node.elementMissing", { name: elementResolution.name }), true);
    nodeGenerationLocks.delete(clientId);
    return null;
  }
  const { parentServerNodeId } = node.data;
  // Dien `{{TRANG_PHUC}}` tu cau ta cua node BOC DO gan nhat phia truoc. Bam
  // GEN mot node le thi khong co buoc nao doc anh ca, va prompt trong graph co
  // y giu nguyen o trong - khong dien thi chuoi "{{TRANG_PHUC}}" di thang len
  // may sinh anh.
  const moTaBoDo = moTaTrangPhucGanNhat(clientId, get().graphNodes, get().graphEdges);
  const prompt = dienOTrong(
    node.data.prompt,
    moTaBoDo ? { [O_TRANG_PHUC]: moTaBoDo } : {},
  );
  if (!prompt.trim()) {
    get().showToast(t("toast.promptRequired"), true);
    nodeGenerationLocks.delete(clientId);
    return null;
  }
  const s = get();
  // Branch variants carry per-node provider/model/size (settingsPatch) —
  // prefer them over global settings (higgsfield 120 NB).
  const nodeProvider = (typeof node.data.provider === "string" && node.data.provider ? node.data.provider : s.provider) as AppState["provider"];
  // Reference capacity follows the VARIANT's provider, not the global one
  // (Socrates round 3): a grok variant must not hit oauth's smaller limit
  // (or vice versa).
  const variantRefLimit = effectiveReferenceLimit({
    provider: nodeProvider,
    serverLimit: s.referenceLimit,
    videoModelSelected: Boolean(s.videoModelSelected),
    mcpProvider: s.mcpProvider ?? null,
  });
  const nodeRefs = mergeRunReferences(node.data.referenceImages ?? [], elementResolution.referenceDataUrls, variantRefLimit);
  const nodeModel = (typeof node.data.model === "string" && node.data.model ? node.data.model : s.imageModel) as AppState["imageModel"];
  // Kich thuoc: cua rieng node -> ke thua tu ANH NEN -> ti le cua ca khuon
  // (node BAT DAU) -> bang dieu khien. Cung thu tu voi luot chay o may chu, de
  // bam GEN mot node va chay ca khuon ra cung mot ti le.
  const size = options.sizeOverride
    ?? (typeof node.data.size === "string" && node.data.size ? node.data.size : null)
    ?? kichThuocKeThua(clientId, get().graphNodes, get().graphEdges)
    ?? kichThuocCuaKhuon(clientId, get().graphNodes, get().graphEdges)
    ?? s.getResolvedSize();
  const effectiveParentServerNodeId =
    options.parentServerNodeIdOverride !== undefined
      ? options.parentServerNodeIdOverride
      : parentServerNodeId;
  // Cha phu: anh cua chung duoc gui kem lam tham chieu (xem extraParentNodeIds).
  const extraParentServerNodeIds = (node.data.extraParentServerNodeIds ?? [])
    .filter((id) => id && id !== effectiveParentServerNodeId);
  // Chi canh ANH moi bat buoc phai co anh cha. Canh tu node MOC chi la thu tu
  // chay, doi no sinh anh thi node dau khuon khong bao gio chay duoc.
  const incoming = canhAnhVao(get().graphEdges, get().graphNodes, clientId)[0];
  if (incoming && !effectiveParentServerNodeId) {
    get().showToast(t("node.parentImageRequired"), true);
    nodeGenerationLocks.delete(clientId);
    return null;
  }

  const requestSessionId = s.activeSessionId;
  const startedAt = Date.now();
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const flightId = `fn_${clientId}_${startedAt}_${randSuffix}`;
  const controller = new AbortController();
  registerFlightAbort(flightId, controller);
  const nextInFlight: PersistedInFlight[] = [
    ...s.inFlight,
    {
      id: flightId,
      prompt,
      startedAt,
      kind: "node",
      sessionId: requestSessionId,
      clientNodeId: clientId,
    },
  ];
  saveInflightFn(nextInFlight);
  set({
    graphNodes: get().graphNodes.map((n) =>
      n.id === clientId
        ? {
            ...n,
            data: {
              ...n.data,
              status: "pending",
              pendingRequestId: flightId,
              recoveryRequestId: flightId,
              pendingPhase: "queued",
              pendingStartedAt: startedAt,
              partialImageUrl: null,
              error: undefined,
              errorInfo: null,
              size,
            },
          }
        : n,
    ),
    activeGenerations: s.activeGenerations + 1,
    inFlight: nextInFlight,
  });
  get().startInFlightPolling();

  let graphMutated = true;

  try {
    const res = await postNodeGenerateStream({
      parentNodeId: effectiveParentServerNodeId,
      ...(extraParentServerNodeIds.length ? { extraParentNodeIds: extraParentServerNodeIds } : {}),
      prompt,
      quality: s.quality,
      size,
      format: s.format,
      moderation: s.moderation,
      provider: nodeProvider,
      model: nodeModel,
      reasoningEffort: s.reasoningEffort,
      storyboard: s.storyboardActive || undefined,
      requestId: flightId,
      sessionId: requestSessionId,
      clientNodeId: clientId,
      contextMode: "parent-plus-refs",
      searchMode: s.webSearchEnabled ? "on" : "off",
      webSearchEnabled: s.webSearchEnabled,
      ...naiPayloadFields(s, { provider: nodeProvider, imageModel: nodeModel }),
      ...(nodeRefs.length
        ? { references: nodeRefs.map(stripDataUrlPrefix) }
        : {}),
      ...(elementResolution.elementIds.length
        ? { elementIds: elementResolution.elementIds, elementRevisions: elementResolution.revisions, elementNotes: elementResolution.notes }
        : {}),
    }, {
        onPartial: (partial) => {
          if (get().activeSessionId !== requestSessionId) return;
          set({
            graphNodes: get().graphNodes.map((n) =>
              n.id === clientId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "pending",
                      partialImageUrl: partial.image,
                      pendingPhase: "partial",
                    },
                  }
                : n,
            ),
          });
        },
        onPhase: (phase) => {
          if (get().activeSessionId !== requestSessionId) return;
          if (!phase.phase) return;
          set({
            graphNodes: get().graphNodes.map((n) =>
              n.id === clientId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      pendingPhase: phase.phase ?? n.data.pendingPhase,
                    },
                  }
                : n,
            ),
          });
        },
      },
      { signal: controller.signal },
    );
    if (get().activeSessionId === requestSessionId) {
      set({
        graphNodes: get().graphNodes.map((n) => {
          if (n.id !== clientId) return n;
          const nextData = { ...n.data };
          delete nextData.partialImageUrl;
          return {
            ...n,
            data: {
              ...nextData,
              serverNodeId: res.nodeId,
              imageUrl: res.url,
              status: "ready",
              pendingRequestId: null,
              recoveryRequestId: null,
              pendingPhase: null,
              pendingStartedAt: null,
              elapsed: res.elapsed,
              reasoningEffort: res.reasoningEffort,
              webSearchCalls: res.webSearchCalls,
              model: res.model ?? null,
              size: res.size ?? null,
              errorInfo: null,
            },
          };
        }),
      });
      // Anh cua node vua doi -> moi node phia sau (ke ca node chi dung no lam
      // THAM CHIEU) van dang giu ket qua lam tu anh cu. Danh dau lo thoi thay vi
      // de chung nam im nhu the van dung: truoc day chi danh dau khi sinh hang
      // loat, sinh mot node thi con chau khong he duoc danh dau.
      danhDauLoThoi(clientId, set, get, t);
      graphMutated = true;
      if (!options.suppressToast) {
        get().showToast(t("toast.nodeCreated", { id: res.nodeId.slice(0, 8), elapsed: res.elapsed }));
      }
    }
    return res.nodeId;
    // cross-session: result will be restored via recoverGraphNodesFromHistory
    // when the user returns to the originating session.
  } catch (err) {
    if (isCanceledGenerationError(err)) {
      if (get().activeSessionId === requestSessionId) {
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === clientId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: n.data.imageUrl ? "ready" : "empty",
                    pendingRequestId: null,
                    recoveryRequestId: null,
                    pendingPhase: null,
                    pendingStartedAt: null,
                    partialImageUrl: null,
                    error: undefined,
                    errorInfo: null,
                  },
                }
              : n,
          ),
        });
        graphMutated = true;
      }
      return null;
    }
    const msg = err instanceof Error ? err.message : t("toast.nodeCreateFailed");
    if (get().activeSessionId === requestSessionId) {
      set({
        graphNodes: get().graphNodes.map((n) =>
          n.id === clientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: "error",
                  pendingRequestId: null,
                  pendingPhase: null,
                  pendingStartedAt: null,
                  partialImageUrl: null,
                  error: msg,
                  errorInfo: buildNodeErrorInfo(err),
                },
              }
            : n,
        ),
      });
      graphMutated = true;
      handleError(err, get());
    }
    // cross-session: silent — user is on a different graph
    return null;
  } finally {
    nodeGenerationLocks.delete(clientId);
    const remaining = get().inFlight.filter((f) => f.id !== flightId);
    saveInflightFn(remaining);
    clearFlightAbort(flightId);
    set({
      activeGenerations: Math.max(0, get().activeGenerations - 1),
      inFlight: remaining,
    });
    if (get().activeSessionId === requestSessionId && graphMutated) {
      get().scheduleGraphSave();
      void get().flushGraphSave("node-complete");
    }
  }
}

export async function runNodeBatchImpl(
  mode: NodeBatchMode,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (get().nodeBatchRunning) return;
  // Element reference nodes are inputs, never generation targets (Socrates B4).
  const selectedIds = getSelectedNodeIds(get().graphNodes)
    .filter((id) => get().graphNodes.find((n) => n.id === id)?.type !== "elementReferenceNode");
  if (selectedIds.length === 0) {
    get().showToast(t("nodeBatch.noneSelected"), true);
    return;
  }
  const blocked = validateBatchDependencies(
    get().graphNodes,
    locCanhAnh(get().graphEdges, get().graphNodes),
    selectedIds,
  );
  if (blocked.length > 0) {
    get().showToast(t("nodeBatch.parentRequired", { count: blocked.length }), true);
    return;
  }
  const cycleIds = findCycleNodeIds(get().graphNodes, get().graphEdges, selectedIds);
  if (cycleIds.length > 0) {
    get().showToast(t("nodeBatch.cycleBlocked", { count: cycleIds.length }), true);
    return;
  }
  const orderedIds = topologicalSortSelected(get().graphNodes, get().graphEdges, selectedIds);
  const selectedSet = new Set(selectedIds);
  const candidates = orderedIds.filter((id) => {
    if (mode === "regenerate-all") return true;
    const node = get().graphNodes.find((n) => n.id === id);
    return node ? !nodeHasImage(node) : false;
  });
  if (candidates.length === 0) {
    get().showToast(t("nodeBatch.nothingToRun"));
    return;
  }
  // Missing element inputs block the whole batch (upstream traversal —
  // per-candidate re-fetch happens inside each runGenerateNodeInPlace).
  const batchElementInputs = collectElementInputs(get().graphNodes, get().graphEdges, candidates);
  const batchMissing = batchElementInputs.find((input) => input.missing);
  if (batchMissing) {
    get().showToast(t("node.elementMissing", { name: batchMissing.name }), true);
    return;
  }

  set({ nodeBatchRunning: true, nodeBatchStopping: false });
  const latestServerNodeIdByClientId = new Map<string, string>();
  let completed = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const skipIds = new Set<string>();
  try {
    for (const candidateId of candidates) {
      if (get().nodeBatchStopping) break;
      if (skipIds.has(candidateId)) {
        skippedCount += 1;
        continue;
      }
      const incoming = canhAnhVao(get().graphEdges, get().graphNodes, candidateId)[0];
      const parentOverride = incoming
        ? latestServerNodeIdByClientId.get(incoming.source)
          ?? get().graphNodes.find((n) => n.id === candidateId)?.data.parentServerNodeId
          ?? null
        : null;
      const nodeId = get().videoModelSelected
        ? await get().runVideoGenerate(candidateId as ClientNodeId).then(() => {
            const n = get().graphNodes.find((nd) => nd.id === candidateId);
            return n?.data.serverNodeId ?? null;
          })
        : await get().runGenerateNodeInPlace(candidateId as ClientNodeId, {
            parentServerNodeIdOverride: parentOverride,
            suppressToast: true,
          });
      if (!nodeId) {
        // Partial failure (020, wp2): skip everything downstream of the
        // failed node but keep independent candidates running.
        failedCount += 1;
        for (const id of collectDownstream(get().graphEdges, candidateId)) skipIds.add(id);
        continue;
      }
      completed += 1;
      latestServerNodeIdByClientId.set(candidateId, nodeId);
      const directChildren = getDirectUnselectedChildren(get().graphEdges, candidateId, selectedSet);
      // Selected direct children too (020, wp2 audit blocker #2): the video
      // batch path resolves lineage from the stored parentServerNodeId, so
      // propagate the fresh server id to every direct child.
      const selectedDirectChildren = get().graphEdges
        .filter((e) => e.source === candidateId && selectedSet.has(e.target))
        .map((e) => e.target);
      const downstream = new Set(getUnselectedDownstreamIds(get().graphEdges, selectedSet));
      set({
        graphNodes: get().graphNodes.map((n) => {
          if (selectedDirectChildren.includes(n.id)) {
            return { ...n, data: { ...n.data, parentServerNodeId: nodeId } };
          }
          if (!downstream.has(n.id)) return n;
          return {
            ...n,
            data: {
              ...n.data,
              status: "stale",
              parentServerNodeId: directChildren.includes(n.id)
                ? nodeId
                : n.data.parentServerNodeId,
              error: t("nodeBatch.staleBecauseParentChanged"),
            },
          };
        }),
      });
    }
    if (failedCount > 0) {
      get().showToast(
        t("nodeBatch.partialFinished", {
          done: completed,
          failed: failedCount,
          skipped: skippedCount,
          total: candidates.length,
        }),
        true,
      );
    } else {
      get().showToast(t("nodeBatch.finished", { done: completed, total: candidates.length }));
    }
    get().scheduleGraphSave();
  } finally {
    set({ nodeBatchRunning: false, nodeBatchStopping: false });
  }
}
