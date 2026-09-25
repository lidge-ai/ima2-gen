import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoreBundle } from "./_storeBundle.mjs";

const store = readStoreBundle();
const canvas = readFileSync("ui/src/components/NodeCanvas.tsx", "utf-8");
const batchBar = readFileSync("ui/src/components/NodeBatchBar.tsx", "utf-8");
const ko = readFileSync("ui/src/i18n/ko.json", "utf-8");
const en = readFileSync("ui/src/i18n/en.json", "utf-8");

describe("node edge disconnect contract", () => {
  it("exposes explicit edge disconnect actions in the graph store", () => {
    assert.match(store, /disconnectEdge:\s*\(edgeId:\s*string\)\s*=>\s*void/);
    assert.match(store, /disconnectEdges:\s*\(edgeIds:\s*string\[\]\)\s*=>\s*void/);
    assert.match(store, /disconnectEdge:\s*\(edgeId\)\s*=>\s*\{/);
    assert.match(store, /get\(\)\.disconnectEdges\(\[edgeId\]\)/);
  });

  it("routes React Flow edge removal through disconnectEdges", () => {
    assert.match(canvas, /const disconnectEdges = useAppStore\(\(s\) => s\.disconnectEdges\)/);
    assert.match(canvas, /change\.type === "remove"/);
    assert.match(canvas, /disconnectEdges\(removedEdgeIds\)/);
    assert.match(canvas, /setGraphEdges\(applyEdgeChanges\(changes, edges\) as GraphEdge\[\]\)/);
  });

  it("removes visual edges before saving the graph", () => {
    assert.match(store, /const nextEdges = get\(\)\.graphEdges\.filter\(\(edge\) => !edgeIdSet\.has\(edge\.id\)\)/);
    assert.match(store, /deriveParentServerNodeIds\(nextNodes, nextEdges\)/);
    assert.match(store, /set\(\{ graphNodes: deriveParentServerNodeIds\(nextNodes, nextEdges\), graphEdges: nextEdges \}\)/);
    assert.match(store, /get\(\)\.scheduleGraphSave\(\)/);
  });

  it("flushes graph save immediately after edge disconnect", () => {
    assert.match(store, /"edge-disconnect"/);
    assert.match(store, /void get\(\)\.flushGraphSave\("edge-disconnect"\)/);
  });

  it("preserves handle metadata in beforeunload graph saves", () => {
    assert.match(store, /function serializeGraphEdgesForSave\(graphEdges: GraphEdge\[\]\)/);
    assert.match(store, /sourceHandle:\s*e\.sourceHandle \?\? null/);
    assert.match(store, /targetHandle:\s*e\.targetHandle \?\? null/);
    assert.match(store, /const edges = serializeGraphEdgesForSave\(graphEdges\)/);
    assert.match(store, /const edges = serializeGraphEdgesForSave\(s\.graphEdges\)/);
    assert.doesNotMatch(
      store,
      /flushGraphSaveBeacon[\s\S]*?const edges = s\.graphEdges\.map\(\(e\) => \(\{[\s\S]*?data:\s*\{\}/,
    );
  });

  it("clears target parentServerNodeId when no incoming edge remains", () => {
    assert.match(store, /const remainingIncoming = nextEdges\.find\(\(edge\) => edge\.target === node\.id\)/);
    assert.match(store, /parentServerNodeId:\s*remainingParent\?\.data\.serverNodeId \?\? null/);
  });

  it("keeps directional target handles available after disconnect", () => {
    const imageNode = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");

    assert.match(imageNode, /const NODE_HANDLE_POSITIONS = \[/);
    assert.match(imageNode, /id:\s*"top"/);
    assert.match(imageNode, /id:\s*"right"/);
    assert.match(imageNode, /id:\s*"bottom"/);
    assert.match(imageNode, /id:\s*"left"/);
    assert.match(imageNode, /type="target"/);
    assert.match(imageNode, /id=\{`target-\$\{handleId\}`\}/);
    assert.doesNotMatch(imageNode, /d\.parentServerNodeId\s*\?\s*\(\s*<Handle\s+type="target"/s);
  });

  it("preserves a remaining parent when another incoming edge still exists", () => {
    assert.match(store, /const remainingParent = remainingIncoming/);
    assert.match(store, /candidate\.id === remainingIncoming\.source/);
  });

  it("disables delete-key removal while node selection mode is active", () => {
    assert.match(canvas, /if \(nodeSelectionMode\) return/);
    assert.match(canvas, /deleteKeyCode=\{nodeSelectionMode \? null : \["Delete", "Backspace"\]\}/);
    assert.match(canvas, /\[disconnectEdges, edges, nodeSelectionMode, setGraphEdges\]/);
  });

  it("adds localized disconnect feedback", () => {
    assert.match(ko, /"disconnected":\s*"연결선을 끊었습니다\."/);
    assert.match(en, /"disconnected":\s*"Connection removed\."/);
    assert.match(store, /showToast\(t\("edge\.disconnected"\)\)/);
  });

  it("shows an explicit disconnect action when an edge is selected", () => {
    assert.match(batchBar, /const disconnectEdges = useAppStore\(\(s\) => s\.disconnectEdges\)/);
    assert.match(batchBar, /const selectedEdgeIds = edges\.filter\(\(edge\) => edge\.selected\)\.map\(\(edge\) => edge\.id\)/);
    assert.match(batchBar, /selectedEdgeIds\.length > 0/);
    assert.match(batchBar, /disconnectEdges\(selectedEdgeIds\)/);
    assert.match(batchBar, /node-batch-bar__danger/);
    assert.match(ko, /"disconnect":\s*"끊기"/);
    assert.match(en, /"disconnect":\s*"Disconnect"/);
  });
});
