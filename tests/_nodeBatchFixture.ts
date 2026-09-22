import assert from "node:assert/strict";
import type { AppState, GraphEdge, GraphNode, ImageNodeData } from "../ui/src/store/storeTypes.ts";
import { withJobTrackingUi } from "./_jobTrackingUiFixture.ts";

export function batchNode(id: string, selected = true, data: Partial<ImageNodeData> = {}): GraphNode {
  return { id, type: "imageNode", position: { x: 0, y: 0 }, selected, data: {
    clientId: id, serverNodeId: `${id}-old`, parentServerNodeId: null,
    extraParentServerNodeIds: [], prompt: `${id} prompt`, imageUrl: `/generated/${id}-old.png`,
    status: "ready", pendingRequestId: null, ...data,
  } };
}

export function batchEdge(source: string, target: string): GraphEdge {
  return { id: `${source}-${target}`, source, target,
    sourceHandle: "source-right", targetHandle: "target-left" };
}

type BatchCall = {
  id: string;
  lane: "image" | "video";
  storedBase: string | null;
  storedExtras: string[];
  options: Parameters<AppState["runGenerateNodeInPlace"]>[1];
};
type BatchInput = { nodes: GraphNode[]; edges: GraphEdge[]; video?: boolean; fail?: string[]; stopAfter?: string };

export async function withNodeBatch(
  input: BatchInput,
  run: (fixture: {
    store: import("./_jobTrackingUiFixture.ts").JobTrackingUiRuntime["useAppStore"];
    calls: BatchCall[];
    saved: GraphNode[][];
    notices: Array<{ message: string; error: boolean }>;
    node(id: string): GraphNode;
  }) => Promise<void>,
): Promise<void> {
  await withJobTrackingUi(async (f) => {
    const store = f.runtime.useAppStore;
    const calls: BatchCall[] = [], saved: GraphNode[][] = [];
    const notices: Array<{ message: string; error: boolean }> = [];
    const node = (id: string) => {
      const found = store.getState().graphNodes.find((entry) => entry.id === id);
      assert.ok(found, `missing fixture node ${id}`);
      return found;
    };
    const generate = async (id: string, lane: BatchCall["lane"], options?: BatchCall["options"]) => {
      const data = node(id).data;
      calls.push({ id, lane, storedBase: data.parentServerNodeId,
        storedExtras: [...(data.extraParentServerNodeIds ?? [])], options });
      if (input.fail?.includes(id)) return null;
      // Stub only the generation result. The real batch action must derive child lineage.
      store.setState({ graphNodes: store.getState().graphNodes.map((entry) => entry.id === id
        ? { ...entry, data: { ...entry.data, serverNodeId: `${id}-new`,
          imageUrl: `/generated/${id}-new.png`, status: "ready" } }
        : entry) });
      if (input.stopAfter === id) store.setState({ nodeBatchStopping: true });
      return `${id}-new`;
    };
    store.setState({
      locale: "en", graphNodes: structuredClone(input.nodes), graphEdges: structuredClone(input.edges),
      nodeBatchRunning: false, nodeBatchStopping: false,
      videoModelSelected: input.video ? "grok-imagine-video-1.5" : false,
      runGenerateNodeInPlace: (id, options) => generate(id, "image", options),
      runVideoGenerate: async (id) => { await generate(id!, "video"); },
      scheduleGraphSave: () => { saved.push(structuredClone(store.getState().graphNodes)); },
      showToast: (message, error = false) => { notices.push({ message, error }); },
    });
    await run({ store, calls, saved, notices, node });
    assert.deepEqual(f.requests, [], "batch orchestration must not reach transport");
    assert.equal(store.getState().nodeBatchRunning, false);
    assert.equal(store.getState().nodeBatchStopping, false);
  });
}
