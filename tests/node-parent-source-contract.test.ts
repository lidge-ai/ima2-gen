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

test("saveGraph clears stale parentServerNodeId when the visual edge is missing", () => {
  const session = sessionStore.createSession({ title: "parent contract" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [
      { id: "a", x: 0, y: 0, data: { serverNodeId: "n_a", parentServerNodeId: null } },
      { id: "b", x: 1, y: 1, data: { serverNodeId: "n_b", parentServerNodeId: "n_a" } },
    ],
    edges: [],
  });

  const graph = sessionStore.getSession(session.id);
  const b = graph.nodes.find((node) => node.id === "b");
  assert.equal(b.data.parentServerNodeId, null);
});

test("saveGraph derives parentServerNodeId from the incoming visual edge", () => {
  const session = sessionStore.createSession({ title: "derive parent" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [
      { id: "a", x: 0, y: 0, data: { serverNodeId: "n_a", parentServerNodeId: null } },
      { id: "b", x: 1, y: 1, data: { serverNodeId: "n_b", parentServerNodeId: "wrong" } },
    ],
    edges: [{ id: "a->b", source: "a", target: "b", data: {} }],
  });

  const graph = sessionStore.getSession(session.id);
  const b = graph.nodes.find((node) => node.id === "b");
  assert.equal(b.data.parentServerNodeId, "n_a");
});

test("saveGraph keeps every incoming edge: first is the base image, the rest are references", () => {
  const session = sessionStore.createSession({ title: "multi parent" });
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [
      { id: "a", x: 0, y: 0, data: { serverNodeId: "n_a" } },
      { id: "b", x: 1, y: 1, data: { serverNodeId: "n_b" } },
      { id: "c", x: 2, y: 2, data: { serverNodeId: "n_c" } },
      { id: "d", x: 3, y: 3, data: {} },
    ],
    edges: [
      { id: "a->c", source: "a", target: "c", data: {} },
      { id: "b->c", source: "b", target: "c", data: {} },
      { id: "d->c", source: "d", target: "c", data: {} },
      { id: "a->c2", source: "a", target: "c", data: {} },
    ],
  });
  const saved = sessionStore.getSession(session.id);
  const c = saved!.nodes.find((n: { id: string }) => n.id === "c")!;
  // Canh dau: anh goc dem di sua.
  assert.equal((c.data as { parentServerNodeId?: string }).parentServerNodeId, "n_a");
  // Canh sau: chi gop ANH lam tham chieu. Cha chua sinh (d, khong co serverNodeId)
  // va cha trung voi cha chinh (a lan hai) deu bi bo qua.
  assert.deepEqual((c.data as { extraParentServerNodeIds?: string[] }).extraParentServerNodeIds, ["n_b"]);
});
