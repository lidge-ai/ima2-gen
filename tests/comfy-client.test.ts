import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cancelComfyJob, comfyFetch, explainComfyExecution, explainComfyRejection, redactForTarget } from "../lib/comfy/client.ts";
import { ComfyProgressTracker, comfySocketUrl } from "../lib/comfy/progress.ts";
import { startFakeComfy } from "./_fakeComfyServer.ts";

const JOB = "0b9f4c0e-7d1a-4c55-9a3e-5d2f6a1b8c77";

describe("comfy cancel", () => {
  it("uses the jobs endpoint alone on a server that has it", async () => {
    const fake = await startFakeComfy({ hold: true });
    try {
      await fetch(fake.origin + "/prompt", { method: "POST", body: JSON.stringify({ prompt: {}, prompt_id: JOB }) });
      await cancelComfyJob(fake.origin, JOB);
      assert.deepEqual(fake.canceledBy, ["jobs"], "one targeted call, no global interrupt");
    } finally {
      await fake.close();
    }
  });

  it("falls back to queue delete plus a targeted interrupt on an older server", async () => {
    const fake = await startFakeComfy({ hold: true, jobsApi: false });
    try {
      await fetch(fake.origin + "/prompt", { method: "POST", body: JSON.stringify({ prompt: {}, prompt_id: JOB }) });
      await cancelComfyJob(fake.origin, JOB);
      assert.deepEqual(fake.canceledBy, ["queue", "interrupt"]);
      const interrupt = fake.requests.find((request) => request.path === "/interrupt");
      assert.deepEqual(interrupt?.body, { prompt_id: JOB }, "never a bare interrupt: that would stop someone else's job");
    } finally {
      await fake.close();
    }
  });
});

describe("comfy requests to a server behind a token", () => {
  it("attaches the token and never follows a redirect with it", async () => {
    const elsewhere = await startFakeComfy();
    const fake = await startFakeComfy({ token: "proxy-token-123456", redirectHistoryTo: elsewhere.origin + "/history/x" });
    try {
      const target = { origin: fake.origin, headers: { Authorization: "Bearer proxy-token-123456" }, secrets: ["proxy-token-123456"] };
      const stats = await comfyFetch(target, fetch, "/system_stats");
      assert.equal(stats.status, 200);
      const redirected = await comfyFetch(target, fetch, "/history/x");
      assert.equal(redirected.status, 302, "the redirect is returned, not followed");
      assert.equal(elsewhere.requests.length, 0, "the token never reached the other host");
      assert.equal((await fetch(fake.origin + "/system_stats")).status, 401, "the fixture does require the token");
    } finally {
      await fake.close();
      await elsewhere.close();
    }
  });

  it("keeps the token out of messages built from server text", () => {
    const target = { origin: "https://comfy.example", headers: {}, secrets: ["proxy-token-123456"] };
    assert.equal(
      redactForTarget(target, "upstream said: bad token proxy-token-123456"),
      "upstream said: bad token [redacted]",
    );
  });
});

describe("comfy rejection messages", () => {
  it("names a missing custom node and says what to do", () => {
    const reasons = explainComfyRejection({
      error: { type: "missing_node_type", message: "Node 'WanAnimate' not found.", extra_info: { node_id: "12", class_type: "WanAnimate" } },
      node_errors: {},
    });
    assert.equal(reasons.length, 1);
    assert.match(reasons[0]!, /no node type 'WanAnimate' \(node 12\)/);
    assert.match(reasons[0]!, /Install the custom node pack/);
  });

  it("names a missing model file with its node and input", () => {
    const reasons = explainComfyRejection({
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
      node_errors: {
        "4": {
          class_type: "CheckpointLoaderSimple",
          errors: [{
            type: "value_not_in_list", message: "Value not in list",
            details: "ckpt_name: 'flux2-klein.safetensors' not in ['a.safetensors']",
            extra_info: { input_name: "ckpt_name", received_value: "flux2-klein.safetensors" },
          }],
        },
      },
    });
    assert.deepEqual(reasons, [
      "node 4 (CheckpointLoaderSimple) ckpt_name: model file 'flux2-klein.safetensors' is not on this ComfyUI server",
    ]);
  });

  it("caps a long list instead of flooding the message", () => {
    const node_errors = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      String(index), { class_type: "X", errors: [{ type: "required_input_missing", extra_info: { input_name: "image" } }] },
    ]));
    const reasons = explainComfyRejection({ node_errors });
    assert.equal(reasons.length, 6);
    assert.equal(reasons[5], "and 4 more");
    assert.equal(reasons[0], "node 0 (X) is missing its required input 'image'");
  });

  it("reports the node that raised during execution", () => {
    assert.equal(
      explainComfyExecution([
        ["execution_start", { prompt_id: JOB }],
        ["execution_error", { node_id: "3", node_type: "KSampler", exception_type: "torch.OutOfMemoryError", exception_message: "Allocation on device \n" }],
      ]),
      "node 3 (KSampler) failed: Allocation on device",
    );
    assert.equal(explainComfyExecution([]), "");
  });
});

describe("comfy progress", () => {
  const graph = {
    "3": { class_type: "KSampler" }, "6": { class_type: "CLIPTextEncode" }, "9": { class_type: "SaveImage" },
  };
  const message = (type: string, data: Record<string, unknown>) => JSON.stringify({ type, data: { prompt_id: JOB, ...data } });

  it("folds cached nodes, the running node and its steps into one picture", () => {
    const tracker = new ComfyProgressTracker(graph, JOB);
    assert.deepEqual(tracker.accept(message("execution_cached", { nodes: ["6"] })), { fraction: 1 / 3 });
    assert.deepEqual(tracker.accept(message("executing", { node: "3" })), { fraction: 1 / 3, node: "3", nodeType: "KSampler" });
    assert.deepEqual(
      tracker.accept(message("progress_state", { nodes: { "3": { value: 10, max: 20, state: "running" } } })),
      { fraction: 0.5, node: "3", nodeType: "KSampler" },
    );
    assert.deepEqual(
      tracker.accept(message("progress", { node: "3", value: 10, max: 20 })),
      { fraction: 0.5, node: "3", nodeType: "KSampler", step: { value: 10, max: 20 } },
    );
  });

  it("never reports completion from messages alone", () => {
    const tracker = new ComfyProgressTracker(graph, JOB);
    const done = tracker.accept(message("progress_state", {
      nodes: Object.fromEntries(Object.keys(graph).map((id) => [id, { value: 1, max: 1, state: "finished" }])),
    }));
    assert.equal(done?.fraction, 0.99);
  });

  it("ignores another job's messages and anything that is not a status message", () => {
    const tracker = new ComfyProgressTracker(graph, JOB);
    assert.equal(tracker.accept(JSON.stringify({ type: "progress", data: { prompt_id: "someone-else", node: "3", value: 1, max: 2 } })), null);
    assert.equal(tracker.accept(JSON.stringify({ type: "status", data: { status: {} } })), null);
    assert.equal(tracker.accept("not json"), null);
  });

  it("derives the socket URL from the server origin", () => {
    assert.equal(comfySocketUrl("http://127.0.0.1:8188", "ima2-a b"), "ws://127.0.0.1:8188/ws?clientId=ima2-a%20b");
    assert.equal(comfySocketUrl("https://comfy.example", "c"), "wss://comfy.example/ws?clientId=c");
  });
});
