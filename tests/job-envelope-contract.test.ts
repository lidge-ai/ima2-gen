import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-envelope-test-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

// .js specifiers, matching the rest of the suite: ssePublish imports
// ./eventBus.js, so importing the .ts twin here would give the test a second
// module instance and its subscribers would never fire.
const {
  JOB_PHASES,
  RAW_PHASE_MAP,
  buildEnvelope,
  isTerminalPhase,
  toCanonicalPhase,
  toProviderState,
} = await import("../lib/jobs/envelope.js");
const { publish, subscribe, replaySince, _resetForTest } = await import("../lib/eventBus.js");
const inflight = await import("../lib/inflight.js");
const { publishJobEvent } = await import("../lib/ssePublish.js");
const db = await import("../lib/db.js");

test.after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("every canonical phase is one of the eight #151 names", () => {
  assert.deepEqual([...JOB_PHASES], [
    "validating", "queued", "running", "post_processing",
    "completed", "failed", "cancelled", "timed_out",
  ]);
  for (const canonical of Object.values(RAW_PHASE_MAP)) {
    assert.ok(JOB_PHASES.includes(canonical), `${canonical} is not a canonical phase`);
  }
});

test("terminal phases are exactly the four that end a job", () => {
  const terminal = JOB_PHASES.filter(isTerminalPhase);
  assert.deepEqual(terminal, ["completed", "failed", "cancelled", "timed_out"]);
});

test("every raw phase in the codebase maps to an accurate canonical phase", () => {
  // The three post_processing values are the ones a naive mapping gets wrong:
  // they are work done after the provider replied, not the provider running.
  const expected: Record<string, string> = {
    queued: "queued",
    "provider-queued": "queued",
    validating: "validating",
    planning: "validating",
    preparing: "validating",
    streaming: "running",
    partial: "running",
    uploading: "running",
    "provider-running": "running",
    "provider-poll": "running",
    polling: "running",
    progress: "running",
    submitted: "running",
    decoding: "post_processing",
    downloading: "post_processing",
    "media-processing": "post_processing",
    "extracting-frame": "post_processing",
    persisting: "post_processing",
  };
  for (const [raw, canonical] of Object.entries(expected)) {
    assert.equal(toCanonicalPhase(raw), canonical, `${raw} should map to ${canonical}`);
  }
  assert.equal(Object.keys(RAW_PHASE_MAP).length, Object.keys(expected).length);
});

test("an unmapped phase degrades to running and keeps its original word", () => {
  assert.equal(toCanonicalPhase("some-future-provider-state"), "running");
  assert.equal(toProviderState("some-future-provider-state"), "some-future-provider-state");
  // A phase whose canonical name says the same thing needs no restatement.
  assert.equal(toProviderState("streaming"), undefined);
  assert.equal(toProviderState("queued"), undefined);
});

test("the event name decides terminal state, not the inflight row", () => {
  // The classic pipeline publishes done before finishJob runs, so inflight
  // still reads streaming at that moment. Trusting inflight would report a
  // finished job as running.
  const done = buildEnvelope({ jobId: "j1", sequence: 1, event: "done", data: {}, inflightPhase: "streaming" });
  assert.equal(done.phase, "completed");
  assert.equal(done.terminal, true);

  const failed = buildEnvelope({ jobId: "j1", sequence: 2, event: "error", data: { code: "UPSTREAM_5XX", error: "boom", status: 502 }, inflightPhase: "streaming" });
  assert.equal(failed.phase, "failed");
  assert.deepEqual(failed.error, { code: "UPSTREAM_5XX", message: "boom", status: 502 });

  const canceled = buildEnvelope({ jobId: "j1", sequence: 3, event: "error", data: { code: "GENERATION_CANCELED" }, inflightPhase: "streaming" });
  assert.equal(canceled.phase, "cancelled");

  const timedOut = buildEnvelope({ jobId: "j1", sequence: 4, event: "error", data: { code: "PROVIDER_TIMEOUT" }, inflightPhase: "streaming" });
  assert.equal(timedOut.phase, "timed_out");
});

test("a self-reported phase outranks a stale inflight row", () => {
  // routes/mcpMedia.ts publishes submitted right after startJob without
  // calling setJobPhase, so inflight still says queued. The publisher knows
  // better than the row does.
  const envelope = buildEnvelope({
    jobId: "j2", sequence: 1, event: "progress",
    data: { phase: "submitted" }, inflightPhase: "queued",
  });
  assert.equal(envelope.phase, "running");
  assert.equal(envelope.providerState, "submitted");
});

test("inflight is the fallback when the event says nothing", () => {
  const envelope = buildEnvelope({ jobId: "j3", sequence: 1, event: "image", data: {}, inflightPhase: "downloading" });
  assert.equal(envelope.phase, "post_processing");
  assert.equal(envelope.providerState, "downloading");
});

test("progress is carried through from either field name", () => {
  assert.equal(buildEnvelope({ jobId: "j4", sequence: 1, event: "progress", data: { percent: 42 } }).progress, 42);
  assert.equal(buildEnvelope({ jobId: "j4", sequence: 2, event: "progress", data: { progress: 7 } }).progress, 7);
  assert.equal(buildEnvelope({ jobId: "j4", sequence: 3, event: "progress", data: {} }).progress, undefined);
});

test("jobSeq counts per job, independently of the global cursor", () => {
  _resetForTest();
  const seen: Array<{ jobId: string; id: number; jobSeq?: number }> = [];
  const stop = subscribe((ev) => seen.push({ jobId: ev.jobId, id: ev.id, jobSeq: ev.jobSeq }));
  publish("alpha", "phase", {});
  publish("beta", "phase", {});
  publish("alpha", "progress", {});
  publish("alpha", "done", {});
  stop();
  assert.deepEqual(seen.map((e) => e.id), [1, 2, 3, 4], "global cursor stays sequential");
  assert.deepEqual(seen.filter((e) => e.jobId === "alpha").map((e) => e.jobSeq), [1, 2, 3]);
  assert.deepEqual(seen.filter((e) => e.jobId === "beta").map((e) => e.jobSeq), [1]);
});

test("a late event after terminal keeps counting forward", () => {
  // ssePublish only suppresses done-after-cancel; an error can still arrive
  // after done. Resetting the counter at terminal would rewind the sequence.
  _resetForTest();
  const seqs: Array<number | undefined> = [];
  const stop = subscribe((ev) => { if (ev.jobId === "late") seqs.push(ev.jobSeq); });
  publish("late", "phase", {});
  publish("late", "done", {});
  publish("late", "error", { code: "AFTER_DONE" });
  stop();
  assert.deepEqual(seqs, [1, 2, 3]);
});

test("publish leaves event.data untouched so subscribers see the old shape", () => {
  // tests/mcp-generation-integration.test.ts deep-compares event.data. The
  // envelope rides beside it precisely so that assertion keeps passing.
  _resetForTest();
  const captured: Array<Record<string, unknown>> = [];
  const stop = subscribe((ev) => captured.push(ev.data));
  publishJobEvent("shape-check", "progress", { phase: "uploading", current: 1, total: 4 });
  stop();
  assert.deepEqual(captured[0], { phase: "uploading", current: 1, total: 4 });
  assert.ok(!("envelope" in captured[0]!), "envelope must not be inside data");
});

test("publishJobEvent attaches an envelope carrying the allocated sequence", () => {
  _resetForTest();
  inflight._resetForTests();
  const seen: Array<{ jobSeq?: number; envelope?: { sequence: number; phase: string; terminal: boolean } }> = [];
  const stop = subscribe((ev) => seen.push({ jobSeq: ev.jobSeq, envelope: ev.envelope as never }));
  inflight.startJob({ requestId: "env-job", kind: "classic", prompt: "x" });
  inflight.setJobPhase("env-job", "streaming");
  publishJobEvent("env-job", "phase", { phase: "streaming" });
  publishJobEvent("env-job", "done", { ok: true });
  stop();
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.envelope!.sequence, seen[0]!.jobSeq, "envelope sequence must equal the allocated jobSeq");
  assert.equal(seen[0]!.envelope!.phase, "running");
  assert.equal(seen[0]!.envelope!.terminal, false);
  assert.equal(seen[1]!.envelope!.phase, "completed");
  assert.equal(seen[1]!.envelope!.terminal, true);
  assert.equal(seen[1]!.envelope!.sequence, 2);
});

test("the ring replays the envelope that was true at publish time", () => {
  _resetForTest();
  inflight._resetForTests();
  inflight.startJob({ requestId: "replay-job", kind: "classic", prompt: "x" });
  inflight.setJobPhase("replay-job", "streaming");
  publishJobEvent("replay-job", "phase", { phase: "streaming" });
  // The job moves on, but the already-published event must not.
  inflight.setJobPhase("replay-job", "decoding");
  const replayed = replaySince(0).filter((e) => e.jobId === "replay-job");
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]!.envelope!.phase, "running", "replay must not re-derive the current phase");
});
