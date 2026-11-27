import "./helpers/isolatedConfig.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abortJob,
  finishJob,
  isJobCanceled,
  isStartJobFailure,
  setJobPhase,
  startJob,
} from "../lib/inflight.js";

// WP10 Tier 1 long-job recovery, per
// devlog/_plan/260715_subscription-mcp-providers/090_verification_rollout.md.
//
// MCP media jobs outlive a single request, so the failure modes that matter are about
// lifecycle bookkeeping rather than provider responses. No network, no credentials.

let seq = 0;
const nextId = () => `test_job_${Date.now()}_${seq++}`;

test("cancel: an aborted job is observably canceled", () => {
  const requestId = nextId();
  const started = startJob({ requestId, kind: "video", prompt: "x" });
  assert.ok(!isStartJobFailure(started), "job should start");

  assert.equal(isJobCanceled(requestId), false);
  abortJob(requestId);
  assert.equal(isJobCanceled(requestId), true, "the cancel branch must actually fire");
  finishJob(requestId, { status: "canceled" });
});

test("cancel tombstone: a canceled id cannot be silently restarted", () => {
  const requestId = nextId();
  startJob({ requestId, kind: "video", prompt: "x" });
  abortJob(requestId);
  finishJob(requestId, { status: "canceled" });

  const restart = startJob({ requestId, kind: "video", prompt: "x", respectCanceledTombstone: true });
  assert.ok(
    isStartJobFailure(restart),
    "replaying a canceled request id must be refused, not treated as a fresh job",
  );
});

test("duplicate admission: the same in-flight id cannot start twice", () => {
  const requestId = nextId();
  const first = startJob({ requestId, kind: "image", prompt: "x" });
  assert.ok(!isStartJobFailure(first));
  const second = startJob({ requestId, kind: "image", prompt: "x" });
  assert.ok(isStartJobFailure(second), "a duplicate submit must be rejected");
  finishJob(requestId, { status: "done" });
});

test("phase tracking survives long-running jobs", () => {
  const requestId = nextId();
  startJob({ requestId, kind: "video", prompt: "x" });
  for (const phase of ["submitted", "polling", "downloading"]) {
    setJobPhase(requestId, phase);
  }
  // Phase updates on an unknown id must not throw — a late event from a finished job is
  // normal after a restart.
  finishJob(requestId, { status: "done" });
  assert.doesNotThrow(() => setJobPhase(requestId, "polling"));
  assert.doesNotThrow(() => setJobPhase("never_existed", "polling"));
});

test("orphan cleanup: finishing an unknown job is a no-op, not a crash", () => {
  // After a server restart the client may still report completion for jobs the new
  // process has never seen.
  assert.doesNotThrow(() => finishJob("orphan_after_restart", { status: "done" }));
  assert.doesNotThrow(() => abortJob("orphan_after_restart"));
});

test("null and undefined ids are tolerated everywhere in the lifecycle", () => {
  // These arrive from optional metadata paths; throwing here would take down a request
  // that is otherwise fine.
  assert.equal(isJobCanceled(null), false);
  assert.equal(isJobCanceled(undefined), false);
  assert.doesNotThrow(() => abortJob(null));
  assert.doesNotThrow(() => setJobPhase(undefined, "polling"));
  assert.doesNotThrow(() => finishJob(null, { status: "done" }));
});
