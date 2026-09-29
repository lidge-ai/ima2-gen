import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "ima2-terminal-guard-"));
process.env.IMA2_CONFIG_DIR = testRoot;
process.env.IMA2_DB_PATH = join(testRoot, "sessions.db");
const jobs = await import("../lib/inflight.ts");
const bus = await import("../lib/eventBus.ts");
const { publishJobEvent } = await import("../lib/ssePublish.ts");
const { getDb, closeDb } = await import("../lib/db.ts");
const { config } = await import("../config.ts");

beforeEach(() => { jobs._resetForTests(); bus._resetForTest(); });
after(() => { closeDb(); rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

function start(id: string): AbortController {
  assert.deepEqual(jobs.startJob({ requestId: id, kind: "node", prompt: "owned prompt",
    meta: { sessionId: "owned-session", clientNodeId: "owned-client" } }), { ok: true });
  const controller = new AbortController();
  jobs.registerJobAbortController(id, controller);
  return controller;
}

function stale(id: string): void {
  getDb().prepare("UPDATE inflight SET started_at = ? WHERE request_id = ?")
    .run(Date.now() - config.inflight.ttlMs - 10, id);
}

function failDelete(id: string): void {
  // Fault applies only to our exact owned row; no external input is interpolated.
  assert.equal(id, "residual");
  getDb().exec("CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON inflight WHEN OLD.request_id = 'residual' BEGIN SELECT RAISE(ABORT, 'owned delete fault'); END");
}

test("cancel is visible before synchronous abort listeners; late terminals never allocate sequence", () => {
  const controller = start("cancel");
  let canceledInListener = false;
  const late: boolean[] = [];
  controller.signal.addEventListener("abort", () => {
    canceledInListener = jobs.isJobCanceled("cancel");
    late.push(publishJobEvent("cancel", "error", { error: "late", code: "INVALID_REQUEST", status: 499 }));
    late.push(publishJobEvent("cancel", "done", {}));
  });
  assert.deepEqual(jobs.abortJob("cancel"), { requestId: "cancel", active: true, aborted: true });
  assert.equal(canceledInListener, true);
  assert.deepEqual(late, [false, false]);
  const [first] = jobs.listTerminalJobs();
  jobs.abortJob("cancel");
  jobs.finishJob("cancel", { status: "error", errorCode: "LATE_ERROR" });
  assert.deepEqual(jobs.listTerminalJobs(), [first]);
  assert.equal(bus.peekJobSeq("cancel"), 1);
  assert.deepEqual(bus.replaySince(0).map(e => [e.event, e.envelope?.phase, e.envelope?.terminal]),
    [["error", "cancelled", true]]);
});

test("late controller is aborted after canceled or expired tracking; ordinary completion unchanged", () => {
  start("cancel"); jobs.abortJob("cancel");
  start("expire"); stale("expire"); jobs.purgeStaleJobs();
  for (const id of ["cancel", "expire"]) {
    const controller = new AbortController();
    jobs.registerJobAbortController(id, controller);
    assert.equal(controller.signal.aborted, true);
  }
  start("done"); jobs.finishJob("done");
  const controller = new AbortController();
  jobs.registerJobAbortController("done", controller);
  assert.equal(controller.signal.aborted, false);
  jobs.abortJob("done");
  assert.equal(jobs.listTerminalJobs().find(j => j.requestId === "done")?.status, "completed");
});

test("expiry commits before abort, preserves column-first IDs and rejects subsequent cancellation/error/done", () => {
  const controller = start("expiry");
  stale("expiry");
  jobs.updateJobAdmission("expiry", { meta: { sessionId: "conflict", clientNodeId: "conflict", other: 9 } });
  let late: boolean | undefined;
  controller.signal.addEventListener("abort", () => {
    late = publishJobEvent("expiry", "error", { error: "late", code: "INVALID_REQUEST" });
  });
  jobs.purgeStaleJobs();
  assert.equal(controller.signal.aborted, true);
  assert.equal(late, false);
  const [terminal] = jobs.listTerminalJobs({ sessionId: "owned-session" });
  assert.equal(terminal.errorCode, "JOB_TRACKING_TIMEOUT");
  assert.equal(terminal.httpStatus, 504);
  assert.equal(terminal.meta.clientNodeId, "owned-client");
  assert.equal(terminal.meta.other, 9);
  assert.equal(terminal.prompt, undefined);
  jobs.abortJob("expiry"); jobs.purgeStaleJobs();
  assert.equal(publishJobEvent("expiry", "done", {}), false);
  assert.deepEqual(jobs.listTerminalJobs(), [terminal]);
  assert.deepEqual(bus.replaySince(0).map(e => [e.envelope?.phase, e.envelope?.terminal]), [["timed_out", true]]);
});

test("cancel cleanup failure still aborts; recovered purge keeps the original terminal and emits nothing", () => {
  const controller = start("residual"); stale("residual");
  failDelete("residual");
  try { assert.throws(() => jobs.abortJob("residual"), /owned delete fault/); }
  finally { getDb().exec("DROP TRIGGER fail_delete"); }
  assert.equal(controller.signal.aborted, true);
  const [terminal] = jobs.listTerminalJobs();
  jobs.purgeStaleJobs();
  assert.deepEqual(jobs.listTerminalJobs(), [terminal]);
  assert.equal(jobs.listJobs().length, 0);
  assert.equal(terminal.status, "canceled");
  assert.equal(bus.replaySince(0).length, 1);
});

test("fresh restore preserves canceled residual instead of writing expiry", async () => {
  try {
    start("residual"); stale("residual"); failDelete("residual");
    try { assert.throws(() => jobs.abortJob("residual"), /owned delete fault/); }
    finally { getDb().exec("DROP TRIGGER fail_delete"); }
    const [before] = jobs.listTerminalJobs();
    const fresh = await import(`../lib/inflight.ts?residual=${Date.now()}`);
    fresh.purgeStaleJobs();
    assert.deepEqual(fresh.listTerminalJobs(), [before]);
    assert.equal(fresh.listJobs().length, 0);
    assert.equal(bus.replaySince(0).length, 1);
  } catch (error) { throw error; }
});

test("intentional settled ID reuse removes the old disk terminal atomically", async () => {
  try {
    start("reuse"); jobs.abortJob("reuse");
    assert.deepEqual(jobs.startJob({ requestId: "reuse", kind: "classic" }), { ok: true });
    assert.equal(getDb().prepare("SELECT request_id FROM terminal_jobs WHERE request_id = ?").get("reuse"), undefined);
    const fresh = await import(`../lib/inflight.ts?reuse=${Date.now()}`);
    assert.equal(fresh.isJobCanceled("reuse"), false);
    assert.equal(publishJobEvent("reuse", "done", {}), true);
  } catch (error) { throw error; }
});

test("strict expiry cutoff commits all terminal records before any abort listener", () => {
  const now = Date.now();
  const first = start("first"); const second = start("second");
  getDb().prepare("UPDATE inflight SET started_at = ?").run(now - config.inflight.ttlMs);
  jobs.purgeStaleJobs(now);
  assert.equal(first.signal.aborted, false);
  assert.equal(second.signal.aborted, false);
  let otherTerminalSeen = false;
  first.signal.addEventListener("abort", () => {
    otherTerminalSeen = jobs.isJobTrackingExpired("second");
    assert.equal(publishJobEvent("second", "done", {}), false);
  });
  jobs.purgeStaleJobs(now + 1);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(otherTerminalSeen, true);
  assert.equal(bus.replaySince(0).length, 2);
});

test("failed expiry insert rolls back all rows with no abort or event", () => {
  const first = start("first"); const second = start("second");
  stale("first"); stale("second");
  getDb().exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON terminal_jobs WHEN NEW.request_id = 'second' BEGIN SELECT RAISE(ABORT, 'owned terminal fault'); END");
  try {
    jobs.purgeStaleJobs();
    assert.equal(first.signal.aborted, false);
    assert.equal(second.signal.aborted, false);
    assert.equal(bus.replaySince(0).length, 0);
    assert.equal(jobs.listTerminalJobs().length, 0);
    const row = getDb().prepare("SELECT COUNT(*) AS count FROM inflight").get() as { count: number };
    assert.equal(row.count, 2);
  } finally { getDb().exec("DROP TRIGGER fail_insert"); }
  jobs.purgeStaleJobs();
  assert.equal(jobs.listJobs().length, 0);
  assert.equal(bus.replaySince(0).length, 2);
});

test("memory-only canceled snapshot is repaired before residual deletion; failed repair is inert", () => {
  const controller = start("residual"); stale("residual"); failDelete("residual");
  getDb().exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON terminal_jobs BEGIN SELECT RAISE(ABORT, 'owned persist fault'); END");
  try { assert.throws(() => jobs.abortJob("residual"), /owned delete fault/); }
  finally { getDb().exec("DROP TRIGGER fail_delete"); }
  const [terminal] = jobs.listTerminalJobs();
  try {
    jobs.purgeStaleJobs();
    assert.ok(getDb().prepare("SELECT request_id FROM inflight WHERE request_id = ?").get("residual"));
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(jobs.listTerminalJobs(), [terminal]);
    assert.equal(bus.replaySince(0).length, 1);
  } finally { getDb().exec("DROP TRIGGER fail_insert"); }
  jobs.purgeStaleJobs();
  const row = getDb().prepare("SELECT finished_at, status FROM terminal_jobs WHERE request_id = ?")
    .get("residual") as { finished_at: number; status: string };
  assert.equal(row.finished_at, terminal.finishedAt);
  assert.equal(row.status, "canceled");
  assert.equal(jobs.listJobs().length, 0);
  assert.equal(bus.replaySince(0).length, 1);
});

test("completed residual preserves outcome and does not need a redundant terminal rewrite", () => {
  const controller = start("residual"); stale("residual"); failDelete("residual");
  try { assert.throws(() => jobs.finishJob("residual", { status: "completed", httpStatus: 200 }), /owned delete fault/); }
  finally { getDb().exec("DROP TRIGGER fail_delete"); }
  const [terminal] = jobs.listTerminalJobs();
  getDb().exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON terminal_jobs BEGIN SELECT RAISE(ABORT, 'redundant write'); END");
  try {
    jobs.purgeStaleJobs();
    assert.equal(jobs.listJobs().length, 0);
    assert.deepEqual(jobs.listTerminalJobs(), [terminal]);
    assert.equal(controller.signal.aborted, false);
    assert.equal(bus.replaySince(0).length, 0);
  } finally { getDb().exec("DROP TRIGGER fail_insert"); }
});

test("failed new admission cannot delete the retained terminal", () => {
  start("reuse"); jobs.abortJob("reuse");
  getDb().exec("CREATE TEMP TRIGGER fail_admission BEFORE INSERT ON inflight BEGIN SELECT RAISE(ABORT, 'owned admission fault'); END");
  try {
    assert.throws(() => jobs.startJob({ requestId: "reuse", kind: "node" }), /owned admission fault/);
    assert.equal(jobs.isJobCanceled("reuse"), true);
    assert.ok(getDb().prepare("SELECT request_id FROM terminal_jobs WHERE request_id = ?").get("reuse"));
  } finally { getDb().exec("DROP TRIGGER fail_admission"); }
});
