import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-node-parent-contract-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const db = await import("../lib/db.ts");
const sessionStore = await import("../lib/sessionStore.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function node(id: string, serverNodeId?: string, nodeType?: string) {
  return {
    id,
    x: 0,
    y: 0,
    data: { ...(serverNodeId ? { serverNodeId } : {}), ...(nodeType ? { nodeType } : {}) },
  };
}

test("saveGraph clears stale parent ids when visual image edges are missing", () => {
  const session = sessionStore.createSession({ title: "parent contract" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [
      node("a", "n_a"),
      { ...node("b", "n_b"), data: { serverNodeId: "n_b", parentServerNodeId: "stale", extraParentServerNodeIds: ["also-stale"] } },
    ],
    edges: [],
  });

  const graph = sessionStore.getSession(session.id)!;
  const child = graph.nodes.find((entry) => entry.id === "b")!;
  assert.equal(child.data.parentServerNodeId, null);
  assert.deepEqual(child.data.extraParentServerNodeIds, []);
});

test("saveGraph keeps ordered image parents, ignores element inputs, and retains a missing primary", () => {
  const session = sessionStore.createSession({ title: "multi parent" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [
      node("element", "n_element", "element-reference"),
      node("missing-primary"),
      node("z-base", "n_base"),
      node("a-extra", "n_extra"),
      node("duplicate-extra", "n_extra"),
      node("child", "n_child"),
    ],
    edges: [
      { id: "z-element", source: "element", target: "child", data: {} },
      { id: "y-missing", source: "missing-primary", target: "child", data: {} },
      { id: "x-base", source: "z-base", target: "child", data: {} },
      { id: "b-extra", source: "a-extra", target: "child", data: {} },
      { id: "a-duplicate", source: "duplicate-extra", target: "child", data: {} },
    ],
  });

  const graph = sessionStore.getSession(session.id)!;
  const child = graph.nodes.find((entry) => entry.id === "child")!;
  assert.equal(child.data.parentServerNodeId, null, "a missing first image parent is not replaced");
  assert.deepEqual(child.data.extraParentServerNodeIds, ["n_base", "n_extra"]);
});

test("edge insertion order survives reverse scan, reopen, and removal", () => {
  const session = sessionStore.createSession({ title: "edge order" });
  const nodes = [node("z-source", "n_z"), node("a-source", "n_a"), node("m-source", "n_m"), node("child", "n_child")];
  const edges = [
    { id: "z-edge", source: "z-source", target: "child", data: {} },
    { id: "a-edge", source: "a-source", target: "child", data: {} },
    { id: "m-edge", source: "m-source", target: "child", data: {} },
  ];
  sessionStore.saveGraph(session.id, { expectedVersion: 0, nodes, edges });

  db.getDb().pragma("reverse_unordered_selects = ON");
  let graph = sessionStore.getSession(session.id)!;
  assert.deepEqual(graph.edges.map((edge) => edge.id), ["z-edge", "a-edge", "m-edge"]);
  let child = graph.nodes.find((entry) => entry.id === "child")!;
  assert.equal(child.data.parentServerNodeId, "n_z");
  assert.deepEqual(child.data.extraParentServerNodeIds, ["n_a", "n_m"]);

  db.closeDb();
  db.getDb().pragma("reverse_unordered_selects = ON");
  graph = sessionStore.getSession(session.id)!;
  assert.deepEqual(graph.edges.map((edge) => edge.id), ["z-edge", "a-edge", "m-edge"]);
  child = graph.nodes.find((entry) => entry.id === "child")!;
  assert.equal(child.data.parentServerNodeId, "n_z");
  assert.deepEqual(child.data.extraParentServerNodeIds, ["n_a", "n_m"]);

  sessionStore.saveGraph(session.id, { expectedVersion: graph.graphVersion, nodes, edges: [edges[0]] });
  db.closeDb();
  graph = sessionStore.getSession(session.id)!;
  child = graph.nodes.find((entry) => entry.id === "child")!;
  assert.equal(child.data.parentServerNodeId, "n_z");
  assert.deepEqual(child.data.extraParentServerNodeIds, []);
});
