import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #151: "서버 재시작 후 terminal result 복구".
 *
 * Before this, a finished job lived only in a process-local Map. A client that
 * reconnected after a restart could not learn how its job ended, which is the
 * exact moment it most needs to know.
 *
 * A fresh module registry stands in for the restart: same database file, new
 * in-memory state, which is what a real restart leaves behind.
 */
const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-terminal-restart-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const inflight = await import("../lib/inflight.js");
const db = await import("../lib/db.js");
const { config } = await import("../config.ts");

test.after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a terminal snapshot is written to the database when a job finishes", () => {
  inflight._resetForTests();
  inflight.startJob({ requestId: "restart_done", kind: "classic", prompt: "keep me", meta: { sessionId: "s_restart" } });
  inflight.setJobPhase("restart_done", "streaming");
  inflight.finishJob("restart_done", { status: "completed", httpStatus: 200 });

  const row = db.getDb()
    .prepare("SELECT request_id, kind, status, http_status, phase FROM terminal_jobs WHERE request_id = ?")
    .get("restart_done") as Record<string, unknown> | undefined;
  assert.ok(row, "finishJob must persist the snapshot");
  assert.equal(row!.kind, "classic");
  assert.equal(row!.status, "completed");
  assert.equal(row!.http_status, 200);
  assert.equal(row!.phase, "streaming");
});

test("a canceled tombstone survives too, so a retry still sees the cancel", () => {
  inflight._resetForTests();
  inflight.startJob({ requestId: "restart_cancel", kind: "classic", prompt: "x" });
  inflight.abortJob("restart_cancel");

  const row = db.getDb()
    .prepare("SELECT status FROM terminal_jobs WHERE request_id = ?")
    .get("restart_cancel") as { status?: string } | undefined;
  assert.equal(row?.status, "canceled");
});

test("a restarted process recovers terminal results from the database", async () => {
  inflight._resetForTests();
  inflight.startJob({ requestId: "restart_recover", kind: "node", prompt: "recover me", meta: { sessionId: "s_recover" } });
  inflight.setJobPhase("restart_recover", "decoding");
  inflight.finishJob("restart_recover", { status: "completed", httpStatus: 200 });
  assert.equal(inflight.listTerminalJobs({}).length, 1);

  // The restart: a second module instance with an empty Map, same database.
  const restarted = await import(`../lib/inflight.js?restart=${Date.now()}`);
  const recovered = restarted.listTerminalJobs({ sessionId: "s_recover" });
  assert.equal(recovered.length, 1, "terminal result must survive the restart");
  assert.equal(recovered[0].requestId, "restart_recover");
  assert.equal(recovered[0].status, "completed");
  assert.equal(recovered[0].kind, "node");
  assert.equal(recovered[0].phase, "decoding");
  assert.equal(recovered[0].meta.sessionId, "s_recover");
});

test("a cancel decided before the restart still blocks a done afterwards", async () => {
  inflight._resetForTests();
  inflight.startJob({ requestId: "restart_cancel_guard", kind: "classic", prompt: "x" });
  inflight.abortJob("restart_cancel_guard");

  const restarted = await import(`../lib/inflight.js?restart=guard-${Date.now()}`);
  assert.equal(
    restarted.isJobCanceled("restart_cancel_guard"),
    true,
    "a restart must not resurrect a canceled job as resolvable",
  );
});

test("expired snapshots are reaped from the database, not just the map", () => {
  inflight._resetForTests();
  inflight.startJob({ requestId: "restart_expired", kind: "classic", prompt: "x" });
  inflight.finishJob("restart_expired", { status: "completed" });
  assert.equal(
    (db.getDb().prepare("SELECT COUNT(*) AS c FROM terminal_jobs").get() as { c: number }).c,
    1,
  );

  // Reap with a clock far enough ahead that the TTL has certainly passed.
  inflight.reapTerminalJobs(Date.now() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(
    (db.getDb().prepare("SELECT COUNT(*) AS c FROM terminal_jobs").get() as { c: number }).c,
    0,
    "a reaped snapshot must not linger in the database",
  );
});

test("expiry restores column-only and conflicting correlation IDs with malformed metadata compatibility", async () => {
  try {
    inflight._resetForTests();
    for (const [id, meta] of [["column-only", "{broken"], ["column-wins", '{"sessionId":"wrong","clientNodeId":"wrong"}']]) {
      inflight.startJob({ requestId: id, kind: "node", prompt: "owned private prompt" });
      db.getDb().prepare(`UPDATE inflight SET started_at = ?, meta = ?, session_id = ?,
        client_node_id = ?, parent_node_id = ? WHERE request_id = ?`)
        .run(Date.now() - config.inflight.ttlMs - 1, meta, "owned-session", "owned-client", "owned-parent", id);
    }
    inflight.purgeStaleJobs();
    db.closeDb();
    const fresh = await import(`../lib/inflight.ts?expiry-columns=${Date.now()}`);
    const restored = fresh.listTerminalJobs({ kind: "node", sessionId: "owned-session" });
    assert.equal(restored.length, 2);
    for (const job of restored) {
      assert.equal(job.errorCode, "JOB_TRACKING_TIMEOUT");
      assert.equal(job.httpStatus, 504);
      assert.equal(job.status, "error");
      assert.equal(job.prompt, undefined);
      assert.deepEqual(job.meta, { sessionId: "owned-session", clientNodeId: "owned-client", parentNodeId: "owned-parent" });
    }
  } catch (error) { throw error; }
});
