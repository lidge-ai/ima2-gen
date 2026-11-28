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
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const studio = getWorkflow("director-studio");
assert.ok(studio);
const price = (variant: string, usd: number) => ({ unit: "second" as const, usd, variant, source: "https://example.test/p", checkedAt: "2026-11-26" });
const specs = {
  "bytedance/seedance-2.5": spec("bytedance/seedance-2.5", { tasks: ["text-to-video", "reference-to-video"], params: { nativeAudio: true }, pricing: [price("720p", 0.2)] }),
  "bytedance/seedance-2": spec("bytedance/seedance-2", { params: { nativeAudio: true, durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }, pricing: [price("720p", 0.1)] }),
  "google/gemini-omni-flash-1.2": spec("google/gemini-omni-flash-1.2", { params: { nativeAudio: false } }),
  "google/veo-3.1": spec("google/veo-3.1", { params: { nativeAudio: true, durationsSec: [4, 6, 8] }, pricing: [price("720p", 0.4)] }),
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
    "remix-motion-transfer-open", "remix-object-swap-open", "remix-restyle-open",
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

const shots = (...list: [number, string][]) => list.map(([durationSec, prompt]) => ({ prompt, durationSec }));
const rejects = (values: Record<string, unknown>, pattern: RegExp, selection?: unknown) =>
  assert.rejects(prep(values, selection), (e: { code?: string; status?: number; message?: string }) =>
    e.code === "WORKFLOW_INPUT_INVALID" && e.status === 400 && pattern.test(e.message ?? ""));

test("explicit shots: one step per shot, no planner, the scene as shared context, chained by last frames and joined", async () => {
  const adapter = fakeAdapter();
  const gateway = fakeGateway({ "bytedance/seedance-2.5": adapter }, specs);
  const p = await prepareWorkflow(studio!, { values: { prompt: "a misty lake at dawn", shots: shots([5, "wide: a canoe glides in"], [7, "close: the paddle dips"]) } },
    { gateway, local, allowedRoots: [root] }, new AbortController().signal);
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["shot-1", "shot-1-last", "shot-2", "join"]);
  assert.deepEqual(p.plan.steps.find((s) => s.id === "shot-2")?.dependsOn, ["shot-1-last"]);
  assert.deepEqual(p.plan.steps.filter((s) => s.kind === "media").map((s) => (s as MediaStep).units.quantity), [5, 7]);
  assert.deepEqual([p.estimate.usd, p.estimate.complete], [2.4, true]);
  const result = await runWorkflow({ runId: "x1", prepared: p, workDir: join(root, "run-x1"), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
  assert.equal(result.status, "succeeded");
  assert.equal(gateway.planned.length, 0, "explicit shots never ask the planner");
  const submits = adapter.calls.filter((c) => c.op === "submit").map((c) => c.request);
  assert.deepEqual(submits.map((r) => r?.durationSec), [5, 7]);
  assert.match(submits[0]?.prompt ?? "", /^wide: a canoe glides in/);
  assert.match(submits[0]?.prompt ?? "", /a misty lake at dawn/);
  assert.match(submits[1]?.prompt ?? "", /^close: the paddle dips/);
  assert.deepEqual(submits[1]?.inputs.map((i) => i.role), ["first-frame"]);
  assert.deepEqual(result.artifacts.map((a) => a.stepId), ["join"]);
  const independent = await prep({ shots: shots([5, "a"], [5, "b"], [5, "c"]), continuity: "independent" });
  assert.deepEqual(independent.plan.steps.map((s) => s.id), ["shot-1", "shot-2", "shot-3", "join"]);
});

test("explicit shots fit the model's listed lengths, name the shot that cannot, and keep the sound bed", async () => {
  const veo = await prep({ prompt: "rain", shots: shots([5, "a"], [8, "b"]) }, { models: { render: "google/veo-3.1" } });
  assert.deepEqual(veo.plan.steps.filter((s) => s.kind === "media").map((s) => (s as MediaStep).units.quantity), [6, 8]);
  await rejects({ shots: shots([5, "a"], [10, "b"]) }, /shot 2.*4-8 s/, { models: { render: "google/veo-3.1" } });
  await rejects({ shots: shots([5, "a"], [3, "b"]) }, /shot 2.*4-15 s/, { models: { render: "bytedance/seedance-2" } });
  await rejects({ shots: shots([31, "a"], [5, "b"]) }, /shot 1.*4-30 s/);
  const quiet = await prep({ shots: shots([5, "a"], [5, "b"]) }, { models: { render: "google/gemini-omni-flash-1.2" } });
  assert.deepEqual(quiet.plan.steps.map((s) => s.id), ["shot-1", "shot-1-last", "shot-2", "join", "sound", "mix"]);
  assert.equal((quiet.plan.steps.find((s) => s.id === "sound") as MediaStep).units.quantity, 10);
});

test("explicit shots refuse a length, the wrong count, more than 60 s or a bad shot; without shots the scene is still required", async () => {
  await rejects({ prompt: "x", duration: 10, shots: shots([5, "a"], [5, "b"]) }, /duration.*shots|shots.*duration/);
  await rejects({ shots: shots([5, "a"]) }, /shots: needs 2-6 shots/);
  await rejects({ shots: shots([5, "a"], [5, "b"], [5, "c"], [5, "d"], [5, "e"], [5, "f"], [5, "g"]) }, /shots: needs 2-6 shots/);
  await rejects({ shots: shots([30, "a"], [30, "b"], [5, "c"]) }, /shots: .*60 s/);
  await rejects({ shots: [{ prompt: " ", durationSec: 5 }, { prompt: "b", durationSec: 5 }] }, /shots: shot 1 needs a prompt/);
  await rejects({ shots: [{ prompt: "a", durationSec: 5 }, { prompt: "b", durationSec: 5.5 }] }, /shots: shot 2 needs a whole number of seconds/);
  await rejects({ shots: [{ prompt: "a", durationSec: 5 }, { prompt: "b", durationSec: 5, camera: "x" }] }, /shots: shot 2/);
  await rejects({ shots: [{ prompt: "a".repeat(1001), durationSec: 5 }, { prompt: "b", durationSec: 5 }] }, /shots: shot 1 .*1000 characters/);
  await assert.rejects(prep({ duration: 5 }), (e: { code?: string; options?: { field?: string }; message?: string }) =>
    e.code === "WORKFLOW_INPUT_INVALID" && e.options?.field === "prompt" && e.message === "prompt: is required");
  const field = studio!.fields.find((f) => f.name === "shots");
  assert.deepEqual(field && { ...field }, { name: "shots", type: "shots", label: "Shots", required: false, min: 2, max: 6, promptMaxLength: 1000, help: field?.help });
});
