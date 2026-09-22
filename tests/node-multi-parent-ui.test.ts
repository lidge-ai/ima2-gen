import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientNodeId } from "../ui/src/lib/graph.ts";
import { canConnectPorts } from "../ui/src/lib/nodeCompatibility.ts";
import {
  deriveParentServerNodeIds,
  getImageParentEdges,
  getIncomingImageEdges,
  wouldCreateCycle,
} from "../ui/src/lib/nodeGraph.ts";
import { resolveNodePort } from "../ui/src/lib/nodePortCatalog.ts";
import type { GraphEdge, GraphNode, ImageNodeData } from "../ui/src/store/storeTypes.ts";
import { batchEdge, batchNode, withNodeBatch } from "./_nodeBatchFixture.ts";

function imageData(id: string, serverNodeId: string | null): ImageNodeData {
  return {
    clientId: id as ClientNodeId,
    serverNodeId,
    parentServerNodeId: null,
    prompt: `${id} prompt`,
    imageUrl: serverNodeId ? `/generated/${serverNodeId}.png` : null,
    status: serverNodeId ? "ready" : "empty",
    pendingRequestId: null,
  };
}

function imageNode(id: string, serverNodeId: string | null, selected = false): GraphNode {
  return {
    id,
    type: "imageNode",
    position: { x: 0, y: 0 },
    selected,
    data: imageData(id, serverNodeId),
  };
}

function elementNode(id: string): GraphNode {
  return {
    id,
    type: "elementReferenceNode",
    position: { x: 0, y: 0 },
    data: { ...imageData(id, null), nodeType: "element-reference", elementId: "element-1" },
  } as GraphNode;
}

function edge(id: string, source: string, target: string, sourceHandle = "source-right"): GraphEdge {
  return { id, source, target, sourceHandle, targetHandle: "target-left" };
}

describe("multiple image parent graph semantics", () => {
  it("keeps edge order as base then refs and deduplicates server IDs", () => {
    const nodes = [
      imageNode("base", "server-base"),
      imageNode("ref-a", "server-ref"),
      imageNode("ref-duplicate", "server-ref"),
      imageNode("target", null),
    ];
    const edges = [
      edge("z-base", "base", "target"),
      edge("a-ref", "ref-a", "target"),
      edge("m-ref-duplicate", "ref-duplicate", "target"),
    ];

    const target = deriveParentServerNodeIds(nodes, edges).find((node) => node.id === "target")!;
    assert.equal(target.data.parentServerNodeId, "server-base");
    assert.deepEqual(target.data.extraParentServerNodeIds, ["server-ref"]);
  });

  it("clears removed extras and promotes the next ordered image edge after disconnect", () => {
    const nodes = [
      imageNode("base", "server-base"),
      imageNode("ref-a", "server-ref-a"),
      imageNode("ref-b", "server-ref-b"),
      imageNode("target", null),
    ];
    const edges = [
      edge("base-edge", "base", "target"),
      edge("ref-a-edge", "ref-a", "target"),
      edge("ref-b-edge", "ref-b", "target"),
    ];
    const withParents = deriveParentServerNodeIds(nodes, edges);
    const withoutRef = deriveParentServerNodeIds(withParents, edges.filter((item) => item.id !== "ref-a-edge"));
    const targetWithoutRef = withoutRef.find((node) => node.id === "target")!;
    assert.equal(targetWithoutRef.data.parentServerNodeId, "server-base");
    assert.deepEqual(targetWithoutRef.data.extraParentServerNodeIds, ["server-ref-b"]);

    const withoutBase = deriveParentServerNodeIds(withoutRef, edges.filter((item) => item.id === "ref-b-edge"));
    const targetWithoutBase = withoutBase.find((node) => node.id === "target")!;
    assert.equal(targetWithoutBase.data.parentServerNodeId, "server-ref-b");
    assert.deepEqual(targetWithoutBase.data.extraParentServerNodeIds, []);
  });

  it("does not promote a generated secondary when the ordered base is ungenerated", () => {
    const nodes = [imageNode("base", null), imageNode("ref", "server-ref"), imageNode("target", null)];
    const edges = [edge("base-edge", "base", "target"), edge("ref-edge", "ref", "target")];
    const target = deriveParentServerNodeIds(nodes, edges).find((node) => node.id === "target")!;
    assert.equal(target.data.parentServerNodeId, null);
    assert.deepEqual(target.data.extraParentServerNodeIds, ["server-ref"]);
  });

  it("excludes element-reference edges from image roles, derivation, and incoming order", () => {
    const nodes = [
      elementNode("element"),
      imageNode("base", "server-base"),
      imageNode("ref", "server-ref"),
      imageNode("target", null),
    ];
    const edges = [
      edge("element-first", "element", "target", "refs"),
      edge("base-edge", "base", "target"),
      edge("ref-edge", "ref", "target"),
    ];
    assert.deepEqual(getImageParentEdges(nodes, edges).map((item) => item.id), ["base-edge", "ref-edge"]);
    assert.deepEqual(getIncomingImageEdges(nodes, edges, "target").map((item) => item.id), ["base-edge", "ref-edge"]);
    const target = deriveParentServerNodeIds(nodes, edges).find((node) => node.id === "target")!;
    assert.equal(target.data.parentServerNodeId, "server-base");
    assert.deepEqual(target.data.extraParentServerNodeIds, ["server-ref"]);
  });

  it("accepts a second image input while retaining duplicate and cycle refusal", () => {
    const nodes = [imageNode("base", "server-base"), imageNode("ref", "server-ref"), imageNode("target", null)];
    const existing = [edge("base-edge", "base", "target")];
    const source = resolveNodePort(nodes[1], "source-right", "output");
    const target = resolveNodePort(nodes[2], "target-left", "input");
    assert.ok(source && target);
    assert.deepEqual(canConnectPorts(source, target, { nodes, edges: existing }), { allowed: true });
    assert.equal(canConnectPorts(source, target, { nodes, edges: [...existing, edge("ref-edge", "ref", "target")] }).reason, "DUPLICATE_EDGE");
    assert.equal(wouldCreateCycle([...existing, edge("ref-edge", "ref", "target")], "target", "base"), true);
  });
});

describe("multiple image parent batch refresh", () => {
  for (const video of [false, true]) for (const selected of [false, true]) {
    it(`executes secondary ${video ? "video" : "image"} regeneration with ${selected ? "selected" : "unselected"} child keeping its base`, () => withNodeBatch({
      nodes: [batchNode("target", selected, { parentServerNodeId: "base-old", extraParentServerNodeIds: ["secondary-old"] }),
        batchNode("base", false), batchNode("secondary")],
      edges: [batchEdge("base", "target"), batchEdge("secondary", "target")], video,
    }, async ({ store, calls, node, saved }) => {
      await store.getState().runNodeBatch("regenerate-all");
      assert.deepEqual(calls.map(({ id }) => id), selected ? ["secondary", "target"] : ["secondary"]);
      assert.ok(calls.every(({ lane }) => lane === (video ? "video" : "image")));
      assert.equal(node("base").data.serverNodeId, "base-old");
      assert.equal(node("target").data.parentServerNodeId, "base-old");
      assert.deepEqual(node("target").data.extraParentServerNodeIds, ["secondary-new"]);
      assert.equal(node("target").data.status, selected ? "ready" : "stale");
      if (selected) {
        assert.equal(calls[1].storedBase, "base-old");
        assert.deepEqual(calls[1].storedExtras, ["secondary-new"]);
        if (!video) assert.equal(calls[1].options?.parentServerNodeIdOverride, "base-old");
      }
      assert.equal(saved.length, 1);
      const persistedTarget = saved[0].find(({ id }) => id === "target")!;
      assert.equal(persistedTarget.data.parentServerNodeId, "base-old");
      assert.deepEqual(persistedTarget.data.extraParentServerNodeIds, ["secondary-new"]);
    }));
  }

});
