import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import type { MediaInput } from "../lib/providers/media/contract.js";
import { runWorkflow, type PreparedWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep, WorkflowEvent, WorkflowStep } from "../lib/workflows/types.js";
import { fakeAdapter, fakeGateway, fakeLocal, instantPoll, SECRET, tempDir, videoOutput } from "./_workflowFakes.js";

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
function workDir(): string {
  const d = tempDir();
  dirs.push(d);
  return d;
}

function media(id: string, model: string, deps: string[] = [], inputs: MediaInput[] = [], final = false): MediaStep {
  return {
    id, label: id, kind: "media", slot: "render", model, outputKind: "video", dependsOn: deps, final,
    units: { unit: "second", quantity: 5, variant: "720p" },
    build: async () => ({ model, task: "text-to-video", prompt: "p", inputs }),
  };
}

function prepared(steps: WorkflowStep[]): PreparedWorkflow {
  return {
    definition: {} as PreparedWorkflow["definition"], values: {}, slots: {},
    plan: { workflowId: "director-studio", steps }, estimate: { usd: 0, complete: true, steps: [] }, notes: [],
  };
}

async function run(steps: WorkflowStep[], gateway: ReturnType<typeof fakeGateway>, signal?: AbortSignal) {
  const events: WorkflowEvent[] = [];
  const result = await runWorkflow({
    runId: "run-1", prepared: prepared(steps), workDir: workDir(), emit: (e) => events.push(e), poll: instantPoll,
    deps: { gateway, local: fakeLocal({}), allowedRoots: [] }, ...(signal ? { signal } : {}),
  });
  return { result, events };
}

test("media step submits, polls to success, downloads with the adapter's headers and stores a final artifact", async () => {
  const adapter = fakeAdapter();
  const gateway = fakeGateway({ "v/x": adapter });
  const { result, events } = await run([media("render", "v/x", [], [], true)], gateway);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(adapter.calls.map((c) => c.op), ["submit", "poll", "poll", "poll"]);
  assert.equal(gateway.fetched[0]?.headers.authorization, "Bearer " + SECRET);
  const art = result.artifacts[0];
  assert.ok(art?.final);
  assert.equal(readFileSync(art.path, "utf8"), "bytes-of https://cdn.example/out.mp4");
  assert.deepEqual(events.map((e) => e.type), [
    "workflow.planned", "step.started", "step.progress", "step.progress", "step.artifact", "step.succeeded", "workflow.succeeded",
  ]);
  const done = events.find((e) => e.type === "step.succeeded");
  assert.equal(done?.type === "step.succeeded" ? done.billedUsd : undefined, 0.5);
});

test("a failed provider job fails the workflow with the adapter's code and the key redacted", async () => {
  const adapter = fakeAdapter({ states: [{ status: "failed", error: { code: "FAKE_MODERATION", message: "blocked for key " + SECRET, retryable: false, category: "moderation" } }] });
  const { result, events } = await run([media("render", "v/x", [], [], true)], fakeGateway({ "v/x": adapter }));
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "FAKE_MODERATION");
  assert.equal(result.error?.category, "moderation");
  assert.equal(result.error?.stepId, "render");
  assert.ok(!JSON.stringify(events).includes(SECRET), "secret must not reach events");
});

test("submit errors go through normalizeError and are redacted", async () => {
  const adapter = fakeAdapter({ submitError: new Error("401 bad key " + SECRET) });
  const { result } = await run([media("render", "v/x", [], [], true)], fakeGateway({ "v/x": adapter }));
  assert.equal(result.error?.code, "FAKE_BAD_REQUEST");
  assert.ok(!result.error?.message.includes(SECRET));
});

test("a model without a keyed route fails before any submit; no other route is tried", async () => {
  const other = fakeAdapter();
  const gateway = fakeGateway({ "v/other": other });
  const { result } = await run([media("render", "v/x", [], [], true)], gateway);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "MEDIA_NO_KEYED_ROUTE", "a coded gateway error keeps its code");
  assert.match(result.error?.message ?? "", /no keyed route/);
  assert.deepEqual(gateway.resolved, [{ model: "v/x", route: undefined }]);
  assert.equal(other.calls.length, 0);
});

test("retryable poll errors are tolerated, a non-retryable one fails the step", async () => {
  const ok = fakeAdapter({ pollErrors: [new Error("retry later"), new Error("retry again")] });
  assert.equal((await run([media("render", "v/x", [], [], true)], fakeGateway({ "v/x": ok }))).result.status, "succeeded");
  const bad = fakeAdapter({ pollErrors: [new Error("malformed")] });
  const failed = await run([media("render", "v/x", [], [], true)], fakeGateway({ "v/x": bad }));
  assert.equal(failed.result.error?.code, "FAKE_BAD_REQUEST");
});

test("inputs follow the adapter transport: upload uses uploadInput, url-only without a publisher is refused", async () => {
  const bytes: MediaInput = { role: "source-video", bytes: new Uint8Array([1, 2]), mimeType: "video/mp4" };
  const upload = fakeAdapter({ transport: "upload" });
  await run([media("render", "v/x", [], [bytes], true)], fakeGateway({ "v/x": upload }));
  assert.equal(upload.calls[0]?.op, "upload");
  assert.equal(upload.calls[1]?.request?.inputs[0]?.url, "https://uploads.example/source-video");
  const urlOnly = fakeAdapter({ transport: "url" });
  const refused = await run([media("render", "v/x", [], [bytes], true)], fakeGateway({ "v/x": urlOnly }));
  assert.equal(refused.result.error?.code, "WORKFLOW_INPUT_NEEDS_PUBLIC_URL");
  const inline = fakeAdapter({ transport: "inline" });
  const remote: MediaInput = { role: "reference-image", url: "https://img.example/a.png", mimeType: "image/png" };
  await run([media("render", "v/x", [], [remote], true)], fakeGateway({ "v/x": inline }));
  assert.deepEqual([...(inline.calls[0]?.request?.inputs[0]?.bytes ?? [])].length > 0, true);
});

test("canceling the run cancels the provider job and reports workflow.canceled", async () => {
  const controller = new AbortController();
  const adapter = fakeAdapter({ states: [{ status: "running" }] });
  const original = adapter.poll.bind(adapter);
  let polls = 0;
  adapter.poll = async (ctx, job) => {
    polls += 1;
    if (polls === 2) controller.abort();
    return original(ctx, job);
  };
  const { result, events } = await run([media("render", "v/x", [], [], true)], fakeGateway({ "v/x": adapter }), controller.signal);
  assert.equal(result.status, "canceled");
  assert.ok(adapter.calls.some((c) => c.op === "cancel"));
  assert.equal(events.at(-1)?.type, "workflow.canceled");
});

test("one failing step stops its running sibling and cancels the sibling's job", async () => {
  const slow = fakeAdapter({ states: [{ status: "running" }] });
  const failing = fakeAdapter({ states: [{ status: "running" }, { status: "failed", error: { code: "FAKE_QUOTA", message: "quota", retryable: false, category: "quota" } }] });
  const gateway = fakeGateway({ "v/slow": slow, "v/fail": failing });
  const { result, events } = await run([media("a", "v/slow"), media("b", "v/fail"), media("join", "v/slow", ["a", "b"], [], true)], gateway);
  assert.equal(result.error?.code, "FAKE_QUOTA");
  assert.ok(slow.calls.some((c) => c.op === "cancel"));
  assert.deepEqual(events.filter((e) => e.type === "step.failed").map((e) => e.type === "step.failed" && e.stepId), ["b"]);
  assert.ok(!events.some((e) => e.type === "step.started" && e.stepId === "join"));
});

test("a later step reads its dependency's artifact; reading a non-dependency is refused", async () => {
  const adapter = fakeAdapter({ states: [videoOutput()] });
  const seen: string[] = [];
  const steps: WorkflowStep[] = [
    media("render", "v/x"),
    { id: "post", label: "post", kind: "local", op: "test", dependsOn: ["render"], final: true,
      run: async (rt) => {
        seen.push(readFileSync(rt.artifactsOf("render")[0]?.path ?? "", "utf8"));
        assert.throws(() => rt.artifactsOf("other"), /without depending/);
        return [{ kind: "json", mimeType: "application/json", bytes: new TextEncoder().encode("{}") }];
      } },
  ];
  const { result } = await run(steps, fakeGateway({ "v/x": adapter }));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(seen, ["bytes-of https://cdn.example/out.mp4"]);
  assert.deepEqual(result.artifacts.map((a) => a.stepId), ["post"]);
});

test("video inputs go out by URL through the publisher, even to inline adapters", async () => {
  const adapter = fakeAdapter({ transport: "inline" });
  const gateway = fakeGateway({ "v/x": adapter });
  const published: string[] = [];
  gateway.publishInput = async (input) => {
    published.push(input.role + ":" + input.mimeType);
    return { url: "https://media.example/" + input.role };
  };
  const clip: MediaInput = { role: "source-video", bytes: new Uint8Array([9]), mimeType: "video/mp4" };
  const still: MediaInput = { role: "reference-image", bytes: new Uint8Array([7]), mimeType: "image/png" };
  await run([media("render", "v/x", [], [clip, still], true)], gateway);
  assert.deepEqual(published, ["source-video:video/mp4"]);
  const sent = adapter.calls.find((c) => c.op === "submit")?.request?.inputs;
  assert.deepEqual(sent?.map((i) => [i.role, i.url ?? "bytes"]), [["source-video", "https://media.example/source-video"], ["reference-image", "bytes"]]);
});
