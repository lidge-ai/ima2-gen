import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

test("inflight startJob guards duplicate requestId and concurrent capacity", () => {
  const inflight = readSource("lib/inflight.ts");
  assert.match(inflight, /config\.limits\.maxParallel/);
  assert.match(inflight, /REQUEST_ID_IN_USE/);
  assert.match(inflight, /TOO_MANY_JOBS/);
  assert.match(inflight, /if \(getJob\(requestId\)\)/);
  assert.match(inflight, /countActiveJobs\(\) >= MAX_CONCURRENT_JOBS/);
  assert.match(inflight, /INSERT INTO inflight/);
  assert.doesNotMatch(inflight, /INSERT OR REPLACE INTO inflight/);
  assert.match(inflight, /purgeStaleJobs\(\)/);
});

test("nodes, multimode, and video routes map startJob failures to 409 and 429", () => {
  for (const relPath of ["lib/nodeGeneration.ts", "lib/multimodePipeline.ts", "routes/video.ts"]) {
    const src = readSource(relPath);
    assert.match(src, /const started = startJob\(/);
    assert.match(src, /if \(started && isStartJobFailure\(started\)\)/);
    assert.match(src, /started\.code === "TOO_MANY_JOBS" \? 429 : 409/);
    assert.match(src, /REQUEST_ID_IN_USE|TOO_MANY_JOBS/);
    assert.match(src, /Retry-After/);
  }
});

test("all generation pipelines only finish jobs they successfully started", () => {
  for (const relPath of [
    "lib/generatePipeline.ts",
    "lib/multimodePipeline.ts",
    "lib/nodeGeneration.ts",
    "routes/video.ts",
    "routes/edit.ts",
  ]) {
    const src = readSource(relPath);
    assert.match(src, /let jobOwned = false;/, relPath);
    assert.match(src, /jobOwned = true;\s+registerJobAbortController\(/, relPath);
    assert.match(src, /finally \{\s+if \(jobOwned\) finishJob\(/, relPath);
  }
});

test("edit route maps startJob failures to 409 and 429", () => {
  const src = readSource("routes/edit.ts");
  assert.match(src, /const started = startJob\(/);
  assert.match(src, /if \(started && isStartJobFailure\(started\)\)/);
  assert.match(src, /started\.code === "TOO_MANY_JOBS" \? 429 : 409/);
  assert.match(src, /res\.setHeader\("Retry-After", String\(INFLIGHT_RETRY_AFTER_SECONDS\)\)/);
  assert.match(src, /code: started\.code,\s+requestId,/);
});

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-inflight-guard-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const {
  MAX_CONCURRENT_JOBS,
  _resetForTests,
  finishJob,
  startJob,
} = await import("../lib/inflight.ts");
const { closeDb } = await import("../lib/db.ts");

beforeEach(() => {
  _resetForTests();
});

after(() => {
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("startJob returns REQUEST_ID_IN_USE for duplicate active requestId", () => {
  const first = startJob({
    requestId: "req_dup",
    kind: "node",
    prompt: "one",
    meta: { sessionId: "s_1" },
  });
  assert.deepEqual(first, { ok: true });

  const second = startJob({
    requestId: "req_dup",
    kind: "node",
    prompt: "two",
    meta: { sessionId: "s_1" },
  });
  assert.deepEqual(second, { ok: false, code: "REQUEST_ID_IN_USE" });
});

test("startJob returns TOO_MANY_JOBS when active count reaches MAX_CONCURRENT_JOBS", () => {
  for (let i = 0; i < MAX_CONCURRENT_JOBS; i += 1) {
    const result = startJob({
      requestId: `req_cap_${i}`,
      kind: "node",
      prompt: "queued",
      meta: {},
    });
    assert.deepEqual(result, { ok: true }, `slot ${i}`);
  }

  const overflow = startJob({
    requestId: "req_overflow",
    kind: "node",
    prompt: "blocked",
    meta: {},
  });
  assert.deepEqual(overflow, { ok: false, code: "TOO_MANY_JOBS" });
});

test("finishJob frees capacity so a new startJob can succeed", () => {
  for (let i = 0; i < MAX_CONCURRENT_JOBS; i += 1) {
    startJob({
      requestId: `req_free_${i}`,
      kind: "node",
      prompt: "queued",
      meta: {},
    });
  }

  finishJob("req_free_0", { status: "completed", httpStatus: 200 });

  const next = startJob({
    requestId: "req_after_finish",
    kind: "node",
    prompt: "accepted",
    meta: {},
  });
  assert.deepEqual(next, { ok: true });
});
