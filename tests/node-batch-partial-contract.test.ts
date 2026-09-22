import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectDownstream } from "../ui/src/lib/nodeBatch.ts";
import { batchEdge, batchNode, withNodeBatch } from "./_nodeBatchFixture.ts";

describe("node batch partial-failure contracts", () => {
  it("executes an independent branch after failure and reports skipped transitive descendants", () => withNodeBatch({
    nodes: [batchNode("failed"), batchNode("child"), batchNode("grandchild"),
      batchNode("independent"), batchNode("independent-child")],
    edges: [batchEdge("failed", "child"), batchEdge("child", "grandchild"),
      batchEdge("independent", "independent-child")], fail: ["failed"],
  }, async ({ store, calls, node, notices, saved }) => {
    await store.getState().runNodeBatch("regenerate-all");
    assert.deepEqual(calls.map(({ id }) => id), ["failed", "independent", "independent-child"]);
    assert.equal(node("child").data.serverNodeId, "child-old");
    assert.equal(node("grandchild").data.serverNodeId, "grandchild-old");
    assert.equal(node("independent-child").data.serverNodeId, "independent-child-new");
    assert.equal(calls[2].options?.parentServerNodeIdOverride, "independent-new");
    assert.deepEqual(notices, [{ message: "Finished 2/5 — 1 failed, 2 skipped.", error: true }]);
    assert.equal(saved.length, 1);
  }));

  it("executes video children with the newly generated base already stored", () => withNodeBatch({
    nodes: [batchNode("child", true, { parentServerNodeId: "parent-old" }), batchNode("parent"),
      batchNode("unselected", false, { parentServerNodeId: "parent-old" })],
    edges: [batchEdge("parent", "child"), batchEdge("parent", "unselected")], video: true,
  }, async ({ store, calls, node, saved }) => {
    await store.getState().runNodeBatch("regenerate-all");
    assert.deepEqual(calls.map(({ id, lane }) => [id, lane]), [["parent", "video"], ["child", "video"]]);
    assert.equal(calls[1].storedBase, "parent-new");
    assert.equal(calls[1].options, undefined, "video resolves stored lineage, without an image override");
    assert.equal(node("child").data.parentServerNodeId, "parent-new");
    assert.equal(node("unselected").data.parentServerNodeId, "parent-new");
    assert.equal(node("unselected").data.status, "stale");
    assert.equal(saved.length, 1);
  }));

  it("BP-01a collectDownstream covers chains", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    assert.deepEqual(collectDownstream(edges, "a").sort(), ["b", "c"]);
  });
  it("BP-01b collectDownstream covers diamonds without duplicates", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ];
    assert.deepEqual(collectDownstream(edges, "a").sort(), ["b", "c", "d"]);
    assert.deepEqual(collectDownstream(edges, "d"), []);
  });

});
