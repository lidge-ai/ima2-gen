import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describeWorkflow, getWorkflow, WORKFLOWS } from "../lib/workflows/index.js";
import { prepareWorkflow, runWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep, WorkflowEvent } from "../lib/workflows/types.js";
import { fitDuration, maxShotSeconds, splitDuration } from "../lib/workflows/definitions/directorShots.js";
import { fakeAdapter, fakeGateway, fakeLocal, instantPoll, spec, tempDir, writeFixture } from "./_workflowFakes.js";

const root = tempDir("ima2-wf-studio-");
after(() => rmSync(root, { recursive: true, force: true }));
const studio = getWorkflow("director-studio");
assert.ok(studio);
const price = (variant: string, usd: number) => ({ unit: "second" as const, usd, variant, source: "https://example.test/p", checkedAt: "2026-11-26" });
const specs = {
  "bytedance/seedance-2.5": spec("bytedance/seedance-2.5", { tasks: ["text-to-video", "reference-to-video"], params: { nativeAudio: true }, pricing: [price("720p", 0.2)] }),
  "bytedance/seedance-2": spec("bytedance/seedance-2", { params: { nativeAudio: true, durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }, pricing: [price("720p", 0.1)] }),
  "google/gemini-omni-flash-1.2": spec("google/gemini-omni-flash-1.2", { params: { nativeAudio: false } }),
};
const local = fakeLocal({});

function prep(values: Record<string, unknown>, selection?: unknown, planner?: (r: { user: string }) => unknown) {
  const gateway = fakeGateway({}, specs, planner);
  return prepareWorkflow(studio!, { values, ...(selection ? { selection } : {}) }, { gateway, local, allowedRoots: [root] }, new AbortController().signal);
}

test("shot splitting and duration fitting", () => {
  assert.deepEqual(splitDuration(30, 15), [15, 15]);
  assert.deepEqual(splitDuration(23, 10), [8, 8, 7]);
  assert.deepEqual(splitDuration(10, 30), [10]);
  assert.equal(fitDuration(7, spec("x/y", { params: { durationsSec: [5, 10] } })), 10);
  assert.equal(fitDuration(12, spec("x/y", { params: { durationsSec: [5, 10] } })), 10);
  assert.equal(fitDuration(7, undefined), 7);
});

test("a clip that fits one call is one final render with native sound, priced per second", async () => {
  const p = await prep({ prompt: "a canoe at dawn", duration: 12 });
  assert.deepEqual(p.plan.steps.map((s) => [s.id, s.final === true]), [["render", true]]);
  assert.deepEqual((p.plan.steps[0] as MediaStep).units, { unit: "second", quantity: 12, variant: "720p+audio" });
  assert.deepEqual([p.estimate.usd, p.estimate.complete], [2.4, true]);
});

test("a clip longer than one call is planned, shot, chained by last frames and joined", async () => {
  const p = await prep({ prompt: "a chase", duration: 30 }, { models: { render: "bytedance/seedance-2" } });
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["plan-shots", "shot-1", "shot-1-last", "shot-2", "join"]);
  assert.deepEqual(p.plan.steps.find((s) => s.id === "shot-2")?.dependsOn, ["plan-shots", "shot-1-last"]);
  assert.equal(p.plan.steps.at(-1)?.final, true);
  assert.equal(p.estimate.usd, 3);
  const independent = await prep({ prompt: "a chase", duration: 30, continuity: "independent" }, { models: { render: "bytedance/seedance-2" } });
  assert.deepEqual(independent.plan.steps.map((s) => s.id), ["plan-shots", "shot-1", "shot-2", "join"]);
});

test("a model without native sound gets a sound bed step and a mix", async () => {
  const p = await prep({ prompt: "rain on a window", duration: 8 }, { models: { render: "google/gemini-omni-flash-1.2" } });
  assert.deepEqual(p.plan.steps.map((s) => [s.id, s.final === true]), [["render", false], ["sound", false], ["mix", true]]);
  assert.equal((p.plan.steps[0] as MediaStep).units.variant, "720p");
  assert.equal(p.estimate.complete, false);
  const quiet = await prep({ prompt: "rain", duration: 8, generateAudio: false }, { models: { render: "google/gemini-omni-flash-1.2" } });
  assert.deepEqual(quiet.plan.steps.map((s) => s.id), ["render"]);
});

test("references go in as reference roles and the look becomes prompt direction", async () => {
  const img = writeFixture(root, "hero.png", "hero");
  const adapter = fakeAdapter();
  const gateway = fakeGateway({ "bytedance/seedance-2.5": adapter }, specs);
  const p = await prepareWorkflow(studio!, { values: { prompt: "image 1 walks in", images: [{ path: img, mimeType: "image/png" }], camera: "35mm-film", palette: "neon-noir", aspectRatio: "9:16" } },
    { gateway, local, allowedRoots: [root] }, new AbortController().signal);
  await runWorkflow({ runId: "s1", prepared: p, workDir: join(root, "run1"), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
  const request = adapter.calls.find((c) => c.op === "submit")?.request;
  assert.equal(request?.task, "reference-to-video");
  assert.deepEqual(request?.inputs.map((i) => i.role), ["reference-image"]);
  assert.equal(request?.aspectRatio, "9:16");
  assert.equal(request?.audio, true);
  assert.match(request?.prompt ?? "", /35mm motion picture film/);
  assert.match(request?.prompt ?? "", /#ff2e88/);
});

test("multi-shot run asks the planner, feeds the previous last frame as first-frame and joins", async () => {
  const adapter = fakeAdapter();
  const planner = (r: { user: string }) => ({ shots: [{ prompt: "shot A " + r.user.length }, { prompt: "shot B" }] });
  const gateway = fakeGateway({ "bytedance/seedance-2": adapter }, specs, planner);
  const p = await prepareWorkflow(studio!, { values: { prompt: "a chase", duration: 20 }, selection: { models: { render: "bytedance/seedance-2" } } },
    { gateway, local, allowedRoots: [root] }, new AbortController().signal);
  const events: WorkflowEvent[] = [];
  const result = await runWorkflow({ runId: "s2", prepared: p, workDir: join(root, "run2"), emit: (e) => events.push(e), poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
  assert.equal(result.status, "succeeded");
  assert.match(gateway.planned[0]?.user ?? "", /Shots: 2 with lengths in seconds 10, 10/);
  const submits = adapter.calls.filter((c) => c.op === "submit").map((c) => c.request);
  assert.match(submits[0]?.prompt ?? "", /^shot A/);
  assert.deepEqual(submits[1]?.inputs.map((i) => [i.role, new TextDecoder().decode(i.bytes)]), [["first-frame", "frame:last"]]);
  assert.equal(submits[1]?.task, "reference-to-video");
  assert.deepEqual(result.artifacts.map((a) => a.stepId), ["join"]);
  assert.ok(local.ops.some((o) => o.op === "concat" && o.args.length === 3));
});

test("multi-shot without a planner or with a bad plan fails with a coded error", async () => {
  for (const [planner, code] of [[undefined, "WORKFLOW_PLANNER_UNAVAILABLE"], [() => ({ shots: [{ prompt: "only one" }] }), "WORKFLOW_PLANNER_INVALID"]] as const) {
    const gateway = fakeGateway({ "bytedance/seedance-2": fakeAdapter() }, specs, planner);
    const p = await prepareWorkflow(studio!, { values: { prompt: "x", duration: 20 }, selection: { models: { render: "bytedance/seedance-2" } } },
      { gateway, local, allowedRoots: [root] }, new AbortController().signal);
    const result = await runWorkflow({ runId: "s3", prepared: p, workDir: join(root, "run3-" + code), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
    assert.equal(result.error?.code, code);
    assert.equal(result.error?.stepId, "plan-shots");
  }
});

test("clip length comes from the catalog, then the known table; otherwise the model is refused", () => {
  assert.equal(maxShotSeconds("x/listed", spec("x/listed", { params: { durationsSec: [5, 10] } })), 10);
  assert.equal(maxShotSeconds("bytedance/seedance-2-mini", undefined), 15);
  assert.throws(() => maxShotSeconds("acme/unknown", spec("acme/unknown")), (e: { code?: string }) => e.code === "WORKFLOW_MODEL_UNAVAILABLE");
});

test("every workflow describes itself as JSON and marks models the gateway knows", () => {
  assert.deepEqual(WORKFLOWS.map((w) => w.id), [
    "remix-motion-transfer", "remix-object-swap", "remix-restyle",
    "remix-motion-transfer-subscription", "remix-object-swap-subscription", "remix-restyle-subscription",
    "director-studio", "director-cast", "director-locations", "director-cinema",
  ]);
  const described = describeWorkflow(studio!, fakeGateway({}, specs));
  assert.equal(described.slots[0]?.available["bytedance/seedance-2.5"], true);
  assert.equal(described.slots[0]?.available["bytedance/seedance-2-mini"], false);
  for (const w of WORKFLOWS) assert.doesNotThrow(() => JSON.parse(JSON.stringify(describeWorkflow(w))));
});


test("a still model's reference limit is enforced at planning", async () => {
  const kontext = { "black-forest-labs/flux-kontext-max": { id: "black-forest-labs/flux-kontext-max", upstreamId: "k", vendor: "black-forest-labs", label: "k", kind: "image" as const, tasks: ["text-to-image", "image-to-image"] as const, params: { maxReferenceImages: 1 }, pricing: [], docsUrl: "https://docs.bfl.ai" } };
  const cast = WORKFLOWS.find((w) => w.id === "director-cast")!;
  const refs = [1, 2, 3].map((i) => ({ url: "https://img.example/" + i + ".png", mimeType: "image/png" }));
  await assert.rejects(prepareWorkflow(cast, { values: { prompt: "hero", images: refs } }, { gateway: fakeGateway({}, kontext), local, allowedRoots: [root] }, new AbortController().signal), /at most 1 reference images/);
});
