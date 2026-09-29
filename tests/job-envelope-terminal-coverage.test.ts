// #151 stage 2 — terminal production coverage.
//
// Stage 1 proved buildEnvelope's contract by calling it directly, which left a
// production gap invisible to CI: the cancel and failure paths published raw
// events with no envelope, so the cancelled/failed branches of resolvePhase
// were unreachable outside MCP routes. These tests drive the REAL publishers
// (abortJob, dual-emit style error publishes, writeNodeError) and assert the
// envelope that lands on the bus, not one assembled by the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-envelope-coverage-test-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

// .js specifiers so this test shares module instances with ssePublish/eventBus.
const { subscribe, _resetForTest } = await import("../lib/eventBus.js");
const inflight = await import("../lib/inflight.js");
const db = await import("../lib/db.js");

type SeenEvent = { event: string; data: Record<string, unknown>; envelope?: Record<string, unknown> };

function collect(): { seen: SeenEvent[]; stop: () => void } {
  const seen: SeenEvent[] = [];
  const stop = subscribe((ev: { event: string; data: Record<string, unknown>; envelope?: unknown }) => {
    seen.push({ event: ev.event, data: ev.data, envelope: ev.envelope as Record<string, unknown> | undefined });
  });
  return { seen, stop };
}

test.after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test.beforeEach(() => {
  _resetForTest();
  inflight._resetForTests();
});

test("abortJob publishes a cancelled envelope on the error event", () => {
  const requestId = "cover-cancel-1";
  const started = inflight.startJob({ requestId, kind: "generate", prompt: "p" });
  assert.ok(started?.ok);
  const { seen, stop } = collect();
  inflight.abortJob(requestId);
  stop();
  const errorEvent = seen.find((ev) => ev.event === "error");
  assert.ok(errorEvent, "abortJob must publish an error event");
  assert.ok(errorEvent.envelope, "the cancel error must carry an envelope");
  assert.equal(errorEvent.envelope.phase, "cancelled");
  assert.equal(errorEvent.envelope.terminal, true);
  const envErr = errorEvent.envelope.error as Record<string, unknown>;
  assert.equal(envErr?.code, "GENERATION_CANCELED");
  // data itself is unchanged: flat shape, untouched by envelope assembly.
  assert.equal(errorEvent.data.code, "GENERATION_CANCELED");
  assert.equal(errorEvent.data.error, "Generation canceled");
});

test("writeNodeError publishes a flattened record whose envelope classifies cancel", async () => {
  const { writeNodeError } = await import("../lib/nodeHelpers.js");
  const requestId = "cover-node-cancel-1";
  inflight.startJob({ requestId, kind: "node", prompt: "p" });
  const { seen, stop } = collect();
  const fakeRes = {
    writableEnded: true,
    destroyed: false,
    headersSent: true,
  } as unknown as import("express").Response;
  writeNodeError(fakeRes, 499, "GENERATION_CANCELED", "Generation canceled", null, {}, requestId);
  stop();
  const errorEvent = seen.find((ev) => ev.event === "error");
  assert.ok(errorEvent, "writeNodeError must publish an error event");
  assert.ok(errorEvent.envelope, "node error must carry an envelope");
  // The flattening is what makes this classification possible: nested
  // {error:{code}} alone would stamp the phase "failed".
  assert.equal(errorEvent.envelope.phase, "cancelled");
  assert.equal(errorEvent.envelope.terminal, true);
  assert.equal(errorEvent.data.code, "GENERATION_CANCELED");
  assert.equal(errorEvent.data.error, "Generation canceled");
  // The nested object shape also survives for existing consumers.
  const nested = errorEvent.data as { parentNodeId?: unknown; status?: unknown };
  assert.equal(nested.parentNodeId, null);
  assert.equal(nested.status, 499);
});

test("writeNodeError publishes a failed envelope for ordinary errors", async () => {
  const { writeNodeError } = await import("../lib/nodeHelpers.js");
  const requestId = "cover-node-fail-1";
  inflight.startJob({ requestId, kind: "node", prompt: "p" });
  const { seen, stop } = collect();
  const fakeRes = {
    writableEnded: true,
    destroyed: false,
    headersSent: true,
  } as unknown as import("express").Response;
  writeNodeError(fakeRes, 502, "NODE_UPSTREAM_FAILED", "upstream exploded", "parent-1", {}, requestId);
  stop();
  const errorEvent = seen.find((ev) => ev.event === "error");
  assert.ok(errorEvent?.envelope);
  assert.equal(errorEvent.envelope.phase, "failed");
  const envErr = errorEvent.envelope.error as Record<string, unknown>;
  assert.equal(envErr?.code, "NODE_UPSTREAM_FAILED");
  assert.equal(envErr?.message, "upstream exploded");
});
