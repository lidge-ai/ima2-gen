import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-inflight-persist-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const inflight = await import("../lib/inflight.ts");
const db = await import("../lib/db.ts");
const { config } = await import("../config.ts");

beforeEach(() => {
  inflight._resetForTests();
});

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("active inflight metadata survives database close and reopen", () => {
  inflight.startJob({
    requestId: "req_persist",
    kind: "node",
    prompt: "persist me",
    meta: {
      kind: "node",
      sessionId: "s_1",
      parentNodeId: "n_parent",
      clientNodeId: "nc_1",
    },
  });
  inflight.setJobPhase("req_persist", "streaming");

  db.closeDb();

  const jobs = inflight.listJobs({ kind: "node", sessionId: "s_1" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].requestId, "req_persist");
  assert.equal(jobs[0].prompt, "persist me");
  assert.equal(jobs[0].phase, "streaming");
  assert.equal(jobs[0].meta.sessionId, "s_1");
  assert.equal(jobs[0].meta.parentNodeId, "n_parent");
  assert.equal(jobs[0].meta.clientNodeId, "nc_1");
});

test("stale inflight jobs are purged by ttl", () => {
  inflight.startJob({
    requestId: "req_stale",
    kind: "classic",
    prompt: "stale",
    meta: {},
  });

  // Derive the advance from the configured TTL rather than a hardcoded window: the TTL now
  // has to outlive the longest legal Grok video request, so a fixed 20 minutes no longer
  // reaches past it. devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
  inflight.purgeStaleJobs(Date.now() + config.inflight.ttlMs + 60_000);

  assert.equal(inflight.listJobs({ kind: "classic" }).length, 0);
  const [terminal] = inflight.listTerminalJobs({ kind: "classic" });
  assert.equal(terminal.errorCode, "JOB_TRACKING_TIMEOUT");
  assert.equal(terminal.httpStatus, 504);
  assert.equal(terminal.status, "error");
  assert.equal(terminal.prompt, undefined);
  const row = db.getDb().prepare("SELECT error_code, http_status FROM terminal_jobs WHERE request_id = ?")
    .get("req_stale") as { error_code: string; http_status: number };
  assert.deepEqual(row, { error_code: "JOB_TRACKING_TIMEOUT", http_status: 504 });
});

test("migration records schema version 7", () => {
  const row = db
    .getDb()
    .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  // 7 adds terminal_jobs and idempotency_keys (#151).
  assert.equal(row?.value, "7");
});
