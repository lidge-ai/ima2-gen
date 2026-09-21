import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  dauVaoVideoCuaNode,
  timChuoiChay,
  viecCuaNode,
} from "../ui/src/lib/chayWorkflow.ts";
import { mucGopCuaNode } from "../ui/src/lib/gopMedia.ts";
import { laNodeMoc, VAI_TRO } from "../ui/src/lib/vaiTroNode.ts";
import type { GraphEdge, GraphNode, ImageNodeData } from "../ui/src/store/storeTypes.ts";
import type { ClientNodeId } from "../ui/src/lib/graph.ts";

function node(id: string, extra: Partial<ImageNodeData> = {}): GraphNode {
  return {
    id,
    type: "imageNode",
    position: { x: 0, y: 0 },
    data: {
      clientId: id as ClientNodeId,
      serverNodeId: `srv_${id}`,
      parentServerNodeId: null,
      prompt: "",
      imageUrl: null,
      status: "empty",
      pendingRequestId: null,
      pendingPhase: null,
      ...extra,
    } as ImageNodeData,
  };
}

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}->${target}`, source, target };
}

describe("workflow START/END run contracts", () => {
  it("WF-01 both markers exist as roles and are marked as markers", () => {
    assert.ok(VAI_TRO["bat-dau"].moc, "bat-dau must be a marker");
    assert.ok(VAI_TRO["ket-thuc"].moc, "ket-thuc must be a marker");
    assert.equal(laNodeMoc("bat-dau"), true);
    assert.equal(laNodeMoc("ket-thuc"), true);
    // A marker carrying a fixed prompt would silently generate something.
    assert.equal(VAI_TRO["bat-dau"].promptCoDinh, undefined);
    assert.equal(VAI_TRO["ket-thuc"].promptCoDinh, undefined);
    assert.equal(laNodeMoc("canh"), false);
  });

  it("WF-02 each role maps to the work it is allowed to do", () => {
    assert.equal(viecCuaNode(node("a", { vaiTro: "bat-dau" })), "moc");
    assert.equal(viecCuaNode(node("b", { vaiTro: "ket-thuc" })), "moc");
    assert.equal(viecCuaNode(node("c", { vaiTro: "gop-anh" })), "bo-qua");
    assert.equal(viecCuaNode(node("d", { vaiTro: "gop-video" })), "gop-video");
    assert.equal(viecCuaNode(node("e", { vaiTro: "video" })), "video");
    assert.equal(viecCuaNode(node("f", { vaiTro: "canh" })), "anh");
    assert.equal(viecCuaNode(node("g")), "anh");
    // Element reference nodes are inputs, never generation targets.
    assert.equal(
      viecCuaNode({ ...node("h"), type: "elementReferenceNode" } as GraphNode),
      "bo-qua",
    );
  });

  it("WF-03 the chain runs in dependency order and counts only real work", () => {
    const nodes = [
      node("start", { vaiTro: "bat-dau" }),
      node("canh", { vaiTro: "canh" }),
      node("vid", { vaiTro: "video" }),
      node("end", { vaiTro: "ket-thuc" }),
    ];
    const edges = [edge("start", "canh"), edge("canh", "vid"), edge("vid", "end")];
    const kq = timChuoiChay("start", nodes, edges);
    assert.ok(kq.ok);
    assert.deepEqual(kq.thuTu, ["start", "canh", "vid", "end"]);
    assert.equal(kq.ketThuc, "end");
    // Two markers do no work, so a four-node chain is two steps.
    assert.equal(kq.soViec, 2);
  });

  it("WF-04 a branch that does not reach END still runs", () => {
    const nodes = [
      node("start", { vaiTro: "bat-dau" }),
      node("a", { vaiTro: "canh" }),
      node("re", { vaiTro: "canh" }),
      node("end", { vaiTro: "ket-thuc" }),
    ];
    const edges = [edge("start", "a"), edge("a", "end"), edge("start", "re")];
    const kq = timChuoiChay("start", nodes, edges);
    assert.ok(kq.ok);
    // Dropping "re" in silence is the failure this guards: the user drew it on
    // purpose, so it belongs in the run.
    assert.ok(kq.thuTu.includes("re"));
    assert.equal(kq.soViec, 2);
  });

  it("WF-05 a chain without an END marker is refused", () => {
    const nodes = [node("start", { vaiTro: "bat-dau" }), node("a", { vaiTro: "canh" })];
    const kq = timChuoiChay("start", nodes, [edge("start", "a")]);
    assert.deepEqual(kq, { ok: false, loi: "thieu-ket-thuc" });
  });

  it("WF-06 running from a node that is not a START marker is refused", () => {
    const nodes = [node("a", { vaiTro: "canh" }), node("end", { vaiTro: "ket-thuc" })];
    assert.deepEqual(timChuoiChay("a", nodes, [edge("a", "end")]), {
      ok: false,
      loi: "khong-phai-moc-dau",
    });
  });

  it("WF-07 a loop inside the chain is refused instead of running forever", () => {
    const nodes = [
      node("start", { vaiTro: "bat-dau" }),
      node("a", { vaiTro: "canh" }),
      node("b", { vaiTro: "canh" }),
      node("end", { vaiTro: "ket-thuc" }),
    ];
    const edges = [edge("start", "a"), edge("a", "b"), edge("b", "a"), edge("a", "end")];
    assert.deepEqual(timChuoiChay("start", nodes, edges), { ok: false, loi: "vong-lap" });
  });

  it("WF-08 a video node inherits the scene image and appends its own prompt", () => {
    const nodes = [
      node("canh", { vaiTro: "canh", imageUrl: "/generated/a.png", prompt: "a coffee shop" }),
      node("vid", { vaiTro: "video", prompt: "she turns around" }),
    ];
    const edges = [edge("canh", "vid")];
    assert.deepEqual(dauVaoVideoCuaNode("vid", nodes, edges), {
      anh: "/generated/a.png",
      ta: "a coffee shop she turns around",
    });
  });

  it("WF-09 an empty video prompt falls back to the scene prompt alone", () => {
    const nodes = [
      node("canh", { vaiTro: "canh", imageUrl: "/generated/a.png", prompt: "a coffee shop" }),
      node("vid", { vaiTro: "video", prompt: "" }),
    ];
    assert.equal(dauVaoVideoCuaNode("vid", nodes, [edge("canh", "vid")]).ta, "a coffee shop");
  });

  it("WF-10 an unconnected video node uses what was attached to it", () => {
    const nodes = [node("vid", { vaiTro: "video", prompt: "pan left", imageUrl: "/generated/x.png" })];
    assert.deepEqual(dauVaoVideoCuaNode("vid", nodes, []), {
      anh: "/generated/x.png",
      ta: "pan left",
    });
  });

  it("WF-11 the node and the run read the merge list through one function", () => {
    const nodes = [
      node("c1", { imageUrl: "/generated/1.mp4" }),
      node("c2", { imageUrl: "/generated/2.mp4" }),
      node("gop", { vaiTro: "gop-video" }),
    ];
    const edges = [edge("c1", "gop"), edge("c2", "gop")];
    const data = { referenceImages: ["/generated/3.png"], thuTuGop: ["/generated/2.mp4"] };
    const muc = mucGopCuaNode("gop", nodes, edges, data);
    assert.deepEqual(muc.map((m) => m.url), ["/generated/2.mp4", "/generated/1.mp4", "/generated/3.png"]);
    assert.deepEqual(muc.map((m) => m.loai), ["video", "video", "anh"]);

    // Both sides must call it, or the order shown and the order merged drift.
    const nodeSrc = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
    const runSrc = readFileSync("ui/src/store/storeWorkflowImpl.ts", "utf-8");
    assert.match(nodeSrc, /mucGopCuaNode\(id, graphNodes, graphEdges, d\)/);
    assert.match(runSrc, /mucGopCuaNode\(nodeId, get\(\)\.graphNodes, get\(\)\.graphEdges, node\.data\)/);
    assert.match(nodeSrc, /dauVaoVideoCuaNode\(id, graphNodes, graphEdges\)/);
  });

  it("WF-12 the run awaits each node and stops on the first failure", () => {
    const src = readFileSync("ui/src/store/storeWorkflowImpl.ts", "utf-8");
    // Sequential await inside the loop: a Promise.all here would feed a later
    // node the previous image instead of the fresh one.
    assert.match(src, /const ok = await chayMotNode\(/);
    assert.match(src, /if \(!ok\) \{ hong = id; break; \}/);
    assert.doesNotMatch(src, /Promise\.all/);
    // A second run while one is in flight would double-spend on every node.
    assert.match(src, /if \(get\(\)\.wfDangChay\) return;/);
    assert.match(src, /if \(get\(\)\.wfDungLai\) break;/);
  });
});
