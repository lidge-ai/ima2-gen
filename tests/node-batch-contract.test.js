import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSourceTree } from "./_readTree.mjs";
import { batchEdge, batchNode, withNodeBatch } from "./_nodeBatchFixture.ts";

const store = readSourceTree("ui/src/store/useAppStore.ts");
const canvas = readFileSync("ui/src/components/NodeCanvas.tsx", "utf-8");
const batchBar = readFileSync("ui/src/components/NodeBatchBar.tsx", "utf-8");
const css = readSourceTree("ui/src/index.css");
const ko = readFileSync("ui/src/i18n/ko.json", "utf-8");
const selectionLib = readFileSync("ui/src/lib/nodeSelection.ts", "utf-8");

describe("node selection batch contract", () => {
  it("executes parent before selected child and saves fresh lineage for unselected descendants", () => withNodeBatch({
    nodes: [batchNode("selected-child", true, { parentServerNodeId: "parent-old" }),
      batchNode("unselected-child", false, { parentServerNodeId: "parent-old" }),
      batchNode("grandchild", false, { parentServerNodeId: "unselected-child-old" }), batchNode("parent")],
    edges: [batchEdge("parent", "selected-child"), batchEdge("parent", "unselected-child"),
      batchEdge("unselected-child", "grandchild")],
  }, async ({ store, calls, saved, node }) => {
    await store.getState().runNodeBatch("regenerate-all");
    assert.deepEqual(calls.map(({ id }) => id), ["parent", "selected-child"]);
    assert.equal(calls[1].options.parentServerNodeIdOverride, "parent-new");
    assert.equal(calls[1].storedBase, "parent-new");
    assert.equal(node("selected-child").data.serverNodeId, "selected-child-new");
    assert.equal(node("selected-child").data.status, "ready");
    assert.equal(node("unselected-child").data.serverNodeId, "unselected-child-old");
    assert.equal(node("unselected-child").data.parentServerNodeId, "parent-new");
    assert.equal(node("unselected-child").data.status, "stale");
    assert.equal(node("grandchild").data.parentServerNodeId, "unselected-child-old");
    assert.equal(node("grandchild").data.status, "stale");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].find(({ id }) => id === "unselected-child").data.parentServerNodeId, "parent-new");
    assert.equal(store.getState().graphNodes.length, 4, "regeneration must stay in place");
  }));

  it("executes no child generation when its unselected image parent is ungenerated", () => withNodeBatch({
    nodes: [batchNode("parent", false, { serverNodeId: null, imageUrl: null, status: "empty" }), batchNode("child")],
    edges: [batchEdge("parent", "child")],
  }, async ({ store, calls, notices, saved }) => {
    await store.getState().runNodeBatch("regenerate-all");
    assert.deepEqual(calls, []);
    assert.deepEqual(saved, []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].error, true);
  }));

  it("executes the active result then stops remaining queued candidates", () => withNodeBatch({
    nodes: [batchNode("first"), batchNode("second")], edges: [], stopAfter: "first",
  }, async ({ store, calls, node }) => {
    await store.getState().runNodeBatch("regenerate-all");
    assert.deepEqual(calls.map(({ id }) => id), ["first"]);
    assert.equal(node("first").data.serverNodeId, "first-new");
    assert.equal(node("second").data.serverNodeId, "second-old");
  }));

  it("uses React Flow selected nodes as the visual source of truth", () => {
    assert.match(selectionLib, /applySelectedNodeIds/);
    assert.match(selectionLib, /selected:\s*selected\.has\(n\.id\)/);
    assert.match(store, /graphNodes:\s*applyComponentSelection/);
    assert.match(canvas, /onNodeClick=\{onNodeClick\}/);
    assert.match(canvas, /multiSelectionKeyCode=\{nodeSelectionMode \? null : undefined\}/);
  });

  it("selects undirected connected components and supports additive exceptions", () => {
    assert.match(selectionLib, /neighbors\.get\(edge\.source\)\?\.add\(edge\.target\)/);
    assert.match(selectionLib, /neighbors\.get\(edge\.target\)\?\.add\(edge\.source\)/);
    assert.match(selectionLib, /componentHasSelection/);
    assert.match(selectionLib, /nextSelected\.delete\(nodeId\)/);
  });

  it("renders a canvas-level batch action bar", () => {
    assert.match(canvas, /<NodeBatchBar \/>/);
    assert.match(batchBar, /nodeBatch\.generateMissing/);
    assert.match(batchBar, /nodeBatch\.regenerateSelected/);
    assert.match(batchBar, /nodeBatch\.stopRemaining/);
  });

  it("keeps Korean batch controls compact and single-line", () => {
    assert.match(batchBar, /nodeBatch\.selectAll/);
    assert.match(css, /\.node-batch-bar button \{[^}]*white-space:\s*nowrap/s);
    assert.match(ko, /"selectAll":\s*"전체"/);
    assert.match(ko, /"generateMissing":\s*"미생성"/);
    assert.match(ko, /"regenerateSelected":\s*"재생성"/);
    assert.match(ko, /"stopRemaining":\s*"중단"/);
  });
});
