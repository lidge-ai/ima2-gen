import type { GenerateItem } from "../types";
import { cancelInflight } from "../lib/api";
import { newClientNodeId, type ClientNodeId } from "../lib/graph";
import {
  deriveParentServerNodeIds,

  wouldCreateCycle,
} from "../lib/nodeGraph";
import { getNextChildPosition, getNextRootPosition } from "../lib/nodeLayout";
import { clearNodeRefs as clearStoredNodeRefs } from "../lib/nodeRefStorage";
import { isVideoUrl, extractLastFrame } from "../lib/videoMedia";
import { t } from "../i18n";
import { compressReferenceSource } from "./storeHelpers";
import type { GraphNode, GraphEdge, StoreSet, StoreGet } from "./storeTypes";

const DEFAULT_CHILD_SOURCE_HANDLE = "source-right";
const DEFAULT_CHILD_TARGET_HANDLE = "target-left";

function newGraphEdgeId(
  sourceClientId: ClientNodeId,
  targetClientId: ClientNodeId,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): string {
  const sourceAnchor = sourceHandle ?? "auto";
  const targetAnchor = targetHandle ?? "auto";
  return `${sourceClientId}:${sourceAnchor}->${targetClientId}:${targetAnchor}`;
}

function normalizeNodeHandleId(
  handleId: string | null | undefined,
  type: "source" | "target",
): string | null {
  if (!handleId) return null;
  return handleId.startsWith(`${type}-`) ? handleId : null;
}

function getOppositeTargetHandle(sourceHandle?: string | null): string | null {
  switch (sourceHandle) {
    case "source-top":
      return "target-bottom";
    case "source-right":
      return "target-left";
    case "source-bottom":
      return "target-top";
    case "source-left":
      return "target-right";
    default:
      return null;
  }
}

export function addRootNodeImpl(set: StoreSet, get: StoreGet): ClientNodeId {
  const clientId = newClientNodeId();
  get().recordGraphHistory("add-root");
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position: getNextRootPosition(get().graphNodes),
    data: {
      clientId,
      serverNodeId: null,
      parentServerNodeId: null,
      prompt: "",
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
    },
  };
  set({ graphNodes: [...get().graphNodes, node] });
  get().scheduleGraphSave();
  return clientId;
}

export function createRootNodeFromHistoryItemImpl(
  item: GenerateItem,
  set: StoreSet,
  get: StoreGet,
): ClientNodeId {
  const clientId = newClientNodeId();
  get().recordGraphHistory("add-root-from-history");
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position: getNextRootPosition(get().graphNodes),
    data: {
      clientId,
      serverNodeId: item.nodeId ?? null,
      parentServerNodeId: null,
      prompt: item.prompt ?? "",
      imageUrl: item.image,
      status: "ready",
      pendingRequestId: null,
      pendingPhase: null,
      model: item.model ?? null,
      size: item.size ?? null,
      elapsed: item.elapsed ?? undefined,
      video: item.video ?? null,
    },
  };
  set({
    uiMode: "node",
    graphNodes: [...get().graphNodes, node],
  });
  get().scheduleGraphSave();
  return clientId;
}

export function addChildNodeImpl(
  parentClientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): ClientNodeId {
  const parent = get().graphNodes.find((n) => n.id === parentClientId);
  if (!parent) return parentClientId;
  get().recordGraphHistory("add-child");
  const clientId = newClientNodeId();
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position: getNextChildPosition(parent, get().graphNodes, get().graphEdges),
    data: {
      clientId,
      serverNodeId: null,
      parentServerNodeId: parent.data.serverNodeId,
      prompt: isVideoUrl(parent.data.imageUrl) ? (parent.data.prompt || "") : "",
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
    },
  };
  const edge: GraphEdge = {
    id: newGraphEdgeId(parentClientId, clientId, DEFAULT_CHILD_SOURCE_HANDLE, DEFAULT_CHILD_TARGET_HANDLE),
    source: parentClientId,
    target: clientId,
    sourceHandle: DEFAULT_CHILD_SOURCE_HANDLE,
    targetHandle: DEFAULT_CHILD_TARGET_HANDLE,
  };
  set({
    graphNodes: [...get().graphNodes, node],
    graphEdges: [...get().graphEdges, edge],
  });
  get().scheduleGraphSave();

  if (parent.data.imageUrl && isVideoUrl(parent.data.imageUrl)) {
    const videoSrc = parent.data.imageUrl;
    if (parent.data.video && parent.data.video.topic) {
      get().setVideoTopic(parent.data.video.topic);
    }
    void (async () => {
      try {
        const frameDataUrl = await extractLastFrame(videoSrc);
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === clientId
              ? { ...n, data: { ...n.data, referenceImages: [frameDataUrl] } }
              : n,
          ),
        });
        get().scheduleGraphSave();
      } catch { /* non-fatal */ }
    })();
  }

  return clientId;
}

export function addSiblingNodeImpl(
  sourceClientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): ClientNodeId {
  const source = get().graphNodes.find((n) => n.id === sourceClientId);
  if (!source) return sourceClientId;
  get().recordGraphHistory("add-sibling");

  const incomingEdge = get().graphEdges.find((e) => e.target === sourceClientId);
  if (!incomingEdge) {
    const clientId = newClientNodeId();
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: getNextRootPosition(get().graphNodes),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: null,
        prompt: source.data.prompt,
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
      },
    };
    set({ graphNodes: [...get().graphNodes, node] });
    get().scheduleGraphSave();
    return clientId;
  }

  const parentClientId = incomingEdge.source;
  const parent = get().graphNodes.find((n) => n.id === parentClientId);
  if (!parent) return sourceClientId;

  const clientId = newClientNodeId();
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position: getNextChildPosition(parent, get().graphNodes, get().graphEdges),
    data: {
      clientId,
      serverNodeId: null,
      parentServerNodeId: source.data.parentServerNodeId,
      prompt: source.data.prompt,
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
    },
  };
  const edge: GraphEdge = {
    id: newGraphEdgeId(parentClientId, clientId, DEFAULT_CHILD_SOURCE_HANDLE, DEFAULT_CHILD_TARGET_HANDLE),
    source: parentClientId,
    target: clientId,
    sourceHandle: DEFAULT_CHILD_SOURCE_HANDLE,
    targetHandle: DEFAULT_CHILD_TARGET_HANDLE,
  };
  set({
    graphNodes: [...get().graphNodes, node],
    graphEdges: [...get().graphEdges, edge],
  });
  get().scheduleGraphSave();
  return clientId;
}

export function addChildNodeAtImpl(
  parentClientId: ClientNodeId,
  position: { x: number; y: number },
  sourceHandle: string | undefined | null,
  set: StoreSet,
  get: StoreGet,
): ClientNodeId {
  const parent = get().graphNodes.find((n) => n.id === parentClientId);
  if (!parent) return parentClientId;
  get().recordGraphHistory("add-child-at");
  const clientId = newClientNodeId();
  const normalizedSourceHandle =
    normalizeNodeHandleId(sourceHandle, "source") ?? DEFAULT_CHILD_SOURCE_HANDLE;
  const targetHandle = getOppositeTargetHandle(normalizedSourceHandle) ?? DEFAULT_CHILD_TARGET_HANDLE;
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position,
    data: {
      clientId,
      serverNodeId: null,
      parentServerNodeId: parent.data.serverNodeId,
      prompt: "",
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
    },
  };
  const edge: GraphEdge = {
    id: newGraphEdgeId(parentClientId, clientId, normalizedSourceHandle, targetHandle),
    source: parentClientId,
    target: clientId,
    sourceHandle: normalizedSourceHandle,
    targetHandle,
  };
  set({
    graphNodes: [...get().graphNodes, node],
    graphEdges: [...get().graphEdges, edge],
  });
  get().scheduleGraphSave();
  return clientId;
}

export function duplicateBranchRootImpl(
  sourceClientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): ClientNodeId {
  const source = get().graphNodes.find((n) => n.id === sourceClientId);
  if (!source) return sourceClientId;
  get().recordGraphHistory("duplicate-branch");
  const clientId = newClientNodeId();
  const node: GraphNode = {
    id: clientId,
    type: "imageNode",
    position: { x: source.position.x + 420, y: source.position.y + 40 },
    data: {
      clientId,
      serverNodeId: null,
      parentServerNodeId: null,
      prompt: source.data.prompt,
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
    },
  };
  set({ graphNodes: [...get().graphNodes, node] });
  get().scheduleGraphSave();

  if (source.data.imageUrl) {
    const sourceUrl = source.data.imageUrl;
    void (async () => {
      try {
        const dataUrl = await compressReferenceSource(sourceUrl, "node-reference.png");
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === clientId
              ? { ...n, data: { ...n.data, referenceImages: [dataUrl] } }
              : n,
          ),
        });
      } catch { /* non-fatal */ }
    })();
  }
  return clientId;
}

export function updateNodePromptImpl(
  clientId: ClientNodeId,
  prompt: string,
  set: StoreSet,
  get: StoreGet,
): void {
  set({
    graphNodes: get().graphNodes.map((n) =>
      n.id === clientId ? { ...n, data: { ...n.data, prompt } } : n,
    ),
  });
  get().scheduleGraphSave();
}


export function deleteNodeImpl(
  clientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): void {
  const doomed = get().graphNodes.find((n) => n.id === clientId);
  if (!doomed) return;
  get().recordGraphHistory("delete-node");
  const reqId = doomed?.data?.pendingRequestId;
  if (reqId) void cancelInflight(reqId);
  clearStoredNodeRefs(get().activeSessionId, clientId);
  const graphNodes = get().graphNodes.filter((n) => n.id !== clientId);
  const graphEdges = get().graphEdges.filter((e) => e.source !== clientId && e.target !== clientId);
  set({
    graphNodes: deriveParentServerNodeIds(graphNodes, graphEdges),
    graphEdges,
  });
  get().scheduleGraphSave();
}

export function deleteNodesImpl(
  clientIds: ClientNodeId[],
  set: StoreSet,
  get: StoreGet,
): void {
  const idSet = new Set(clientIds);
  if (idSet.size === 0) return;
  get().recordGraphHistory("delete-nodes");
  for (const clientId of idSet) clearStoredNodeRefs(get().activeSessionId, clientId);
  for (const n of get().graphNodes) {
    if (idSet.has(n.id) && n.data?.pendingRequestId) {
      void cancelInflight(n.data.pendingRequestId);
    }
  }
  const graphNodes = get().graphNodes.filter((n) => !idSet.has(n.id));
  const graphEdges = get().graphEdges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
  set({
    graphNodes: deriveParentServerNodeIds(graphNodes, graphEdges),
    graphEdges,
  });
  get().scheduleGraphSave();
}

export function disconnectEdgesImpl(
  edgeIds: string[],
  set: StoreSet,
  get: StoreGet,
): void {
  const edgeIdSet = new Set(edgeIds);
  if (edgeIdSet.size === 0) return;
  const removedEdges = get().graphEdges.filter((edge) => edgeIdSet.has(edge.id));
  if (removedEdges.length === 0) return;
  get().recordGraphHistory("disconnect-edges");
  const nextEdges = get().graphEdges.filter((edge) => !edgeIdSet.has(edge.id));
  const removedTargets = new Set(removedEdges.map((edge) => edge.target));
  const nextNodes = get().graphNodes.map((node) => {
    if (!removedTargets.has(node.id)) return node;
    const remainingIncoming = nextEdges.find((edge) => edge.target === node.id);
    const remainingParent = remainingIncoming
      ? get().graphNodes.find((candidate) => candidate.id === remainingIncoming.source)
      : null;
    return {
      ...node,
      data: {
        ...node.data,
        parentServerNodeId: remainingParent?.data.serverNodeId ?? null,
      },
    };
  });
  set({ graphNodes: deriveParentServerNodeIds(nextNodes, nextEdges), graphEdges: nextEdges });
  get().scheduleGraphSave();
  void get().flushGraphSave("edge-disconnect");
  get().showToast(t("edge.disconnected"));
}

export function connectNodesImpl(
  sourceClientId: ClientNodeId,
  targetClientId: ClientNodeId,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
  set: StoreSet,
  get: StoreGet,
): void {
  if (sourceClientId === targetClientId) return;
  const existing = get().graphEdges.find(
    (e) => e.source === sourceClientId && e.target === targetClientId,
  );
  if (existing) return;
  if (wouldCreateCycle(get().graphEdges, sourceClientId, targetClientId)) {
    get().showToast(t("edge.cycleBlocked"), true);
    return;
  }
  const source = get().graphNodes.find((n) => n.id === sourceClientId);
  if (!source) return;
  get().recordGraphHistory("connect-nodes");
  const graphEdges = [
    ...get().graphEdges,
    {
      id: newGraphEdgeId(sourceClientId, targetClientId, sourceHandle, targetHandle),
      source: sourceClientId,
      target: targetClientId,
      sourceHandle,
      targetHandle,
    },
  ];
  set({
    graphNodes: deriveParentServerNodeIds(get().graphNodes, graphEdges),
    graphEdges,
  });
  get().scheduleGraphSave();
}
