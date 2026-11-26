import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describeWorkflow, getWorkflow } from "../lib/workflows/index.js";
import { prepareWorkflow, runWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep, WorkflowDefinition } from "../lib/workflows/types.js";
import { anchorTimes, pinnedDuration, segmentPlan } from "../lib/workflows/definitions/subscription.js";
import { fakeAdapter, fakeGateway, fakeLocal, instantPoll, spec, tempDir, writeFixture } from "./_workflowFakes.js";

const root = tempDir("ima2-wf-sub-");
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const clip = writeFixture(root, "clip.mp4", "source-video");
const short = writeFixture(root, "short.mp4", "short-video");
const face = writeFixture(root, "face.png", "face");
const local = fakeLocal({
  "clip.mp4": { durationSec: 12.4, width: 1080, height: 1920, hasAudio: true },
  "short.mp4": { durationSec: 6.2, width: 640, height: 480, hasAudio: false },
});
const specs = {
  "xai/grok-imagine-video": spec("xai/grok-imagine-video", { pricing: [{ unit: "second", usd: 0.07, variant: "720p", source: "https://docs.x.ai", checkedAt: "2026-11-26" }, { unit: "second", usd: 0.05, variant: "480p", source: "https://docs.x.ai", checkedAt: "2026-11-26" }] }),
  "xai/grok-imagine-video-1.5": spec("xai/grok-imagine-video-1.5", { tasks: ["reference-to-video"], params: { maxReferenceImages: 14 } }),
  "openai/gpt-image-2": spec("openai/gpt-image-2", { kind: "image", tasks: ["image-to-image"] }),
};
const def = (id: string): WorkflowDefinition => getWorkflow(id)!;
const images = [{ path: face, mimeType: "image/png" }];
const prep = (id: string, values: Record<string, unknown>, gateway = fakeGateway({}, specs)) =>
  prepareWorkflow(def(id), { values }, { gateway, local, allowedRoots: [root] }, new AbortController().signal);

test("grid and segment math follow the Grok limits", () => {
  assert.deepEqual(segmentPlan(12.4, 8.7).map((s) => s.durationSec), [6.2, 6.2]);
  assert.deepEqual(segmentPlan(8.7, 8.7).length, 1);
  assert.equal(pinnedDuration(12.4), 12);
  assert.equal(pinnedDuration(15), 15);
  const times = anchorTimes(4, 4);
  assert.deepEqual(times, [0.667, 1.667, 2.333, 3.333]);
  for (const t of times) assert.ok(Math.abs(t * 3 - Math.round(t * 3)) < 0.01 && t > 0 && t < 4);
  assert.deepEqual(anchorTimes(1, 4), [0.333, 0.667], "a 1 s clip holds two grid slots");
});

test("the preset says what it needs and what it loses", () => {
  const described = describeWorkflow(def("remix-motion-transfer-subscription"));
  assert.equal(described.preset?.basedOn, "remix-motion-transfer");
  assert.deepEqual(described.preset?.requires.map((r) => r.route), ["openai-oauth", "xai-oauth"]);
  assert.deepEqual(new Set(described.preset?.losses.map((l) => l.aspect)), new Set(["motion", "identity", "length", "resolution", "audio"]));
  assert.match(described.preset?.billingNote ?? "", /x\.ai\/pricing/);
  assert.deepEqual(described.slots.map((s) => [s.name, s.defaultModel, s.defaultRoute]), [["composite", "openai/gpt-image-2", "openai-oauth"], ["render", "xai/grok-imagine-video-1.5", "xai-oauth"]]);
  const restyle = describeWorkflow(def("remix-restyle-subscription"));
  assert.ok(restyle.preset?.losses.some((l) => l.aspect === "resolution"));
  assert.ok(!restyle.fields.some((f) => f.name === "styleImage"), "Grok edit takes no style image");
});

test("subscription restyle cuts a 12.4 s clip into two edits on the Grok OAuth route, joins and restores sound", async () => {
  const p = await prep("remix-restyle-subscription", { video: [{ path: clip, mimeType: "video/mp4" }], style: "watercolor" });
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["cut-1", "edit-1", "cut-2", "edit-2", "render", "sound"]);
  const edit = p.plan.steps[1] as MediaStep;
  assert.deepEqual([edit.model, edit.route, edit.units.quantity, edit.units.variant], ["xai/grok-imagine-video", "xai-oauth", 7, "720p"]);
  assert.equal(p.estimate.usd, 0.98);
  const adapter = fakeAdapter();
  const gateway = fakeGateway({ "xai/grok-imagine-video": adapter }, specs);
  const result = await runWorkflow({ runId: "rs", prepared: p, workDir: join(root, "run-rs"), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(gateway.resolved.map((r) => r.route), ["xai-oauth", "xai-oauth"]);
  const sent = adapter.calls.filter((c) => c.op === "submit").map((c) => c.request);
  // The two segment edits run in parallel, so their submit order is not fixed.
  assert.deepEqual(sent.map((r) => new TextDecoder().decode(r?.inputs[0]?.bytes)).sort(), ["cut:0.000+6.200", "cut:6.200+6.200"]);
  assert.ok(sent.every((r) => r?.inputs.length === 1 && r.inputs[0]?.role === "source-video"), "edit sends only the segment");
  assert.match(sent[0]?.prompt ?? "", /Loose watercolor/);
  assert.equal(sent[0]?.prompt, sent[1]?.prompt, "one prompt for every segment");
});

test("a silent short source is one edit, final as returned", async () => {
  const p = await prep("remix-restyle-subscription", { video: [{ path: short, mimeType: "video/mp4" }], prompt: "claymation" });
  assert.deepEqual(p.plan.steps.map((s) => [s.id, s.final === true]), [["cut-1", false], ["render", true]]);
  assert.equal((p.plan.steps[1] as MediaStep).units.variant, "480p");
  await assert.rejects(prep("remix-restyle-subscription", { video: [{ path: short, mimeType: "video/mp4" }] }), /choose a style or describe the look/);
});

test("subscription motion transfer pins GPT-composited frames into a Grok 1.5 reference-to-video request", async () => {
  const p = await prep("remix-motion-transfer-subscription", { video: [{ path: clip, mimeType: "video/mp4" }], images, prompt: "dance" });
  const ids = p.plan.steps.map((s) => s.id);
  assert.deepEqual(ids, [
    "frame-first", "frame-key-1", "frame-key-2", "frame-key-3", "frame-key-4", "frame-last",
    "swap-first", "swap-key-1", "swap-key-2", "swap-key-3", "swap-key-4", "swap-last", "render", "sound",
  ]);
  const render = p.plan.steps.find((s) => s.id === "render") as MediaStep;
  assert.deepEqual([render.route, render.units.quantity, render.units.variant], ["xai-oauth", 12, "720p"]);
  const gpt = fakeAdapter({ states: [{ status: "succeeded", outputs: [{ kind: "image", bytes: new TextEncoder().encode("composited"), mimeType: "image/png" }] }] });
  const grok = fakeAdapter();
  const gateway = fakeGateway({ "openai/gpt-image-2": gpt, "xai/grok-imagine-video-1.5": grok }, specs);
  const result = await runWorkflow({ runId: "mt", prepared: p, workDir: join(root, "run-mt"), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] }, concurrency: 4 });
  assert.equal(result.status, "succeeded");
  const edits = gpt.calls.filter((c) => c.op === "submit").map((c) => c.request);
  assert.equal(edits.length, 6);
  assert.deepEqual(edits[0]?.inputs.map((i) => i.role), ["source-image", "reference-image"]);
  assert.match(edits[0]?.prompt ?? "", /Keep each pose/);
  const frames = local.ops.filter((o) => o.op === "frame").map((o) => o.args[2]);
  assert.ok(frames.includes("first") && frames.includes("last"));
  const req = grok.calls.find((c) => c.op === "submit")?.request;
  assert.equal(req?.task, "reference-to-video");
  assert.deepEqual(req?.inputs.map((i) => i.role), ["first-frame", "last-frame", "reference-image", "reference-image", "reference-image", "reference-image", "reference-image"]);
  const keyframes = (req?.vendorOptions as { keyframes: { inputIndex: number; timestampS: number }[] }).keyframes;
  assert.deepEqual(keyframes.map((k) => k.inputIndex), [2, 3, 4, 5]);
  assert.ok(keyframes.every((k) => k.timestampS > 0 && k.timestampS < 12 && Math.abs(k.timestampS * 3 - Math.round(k.timestampS * 3)) < 0.01));
  assert.equal(req?.durationSec, 12);
  assert.equal(req?.audio, false, "source sound is restored locally");
  assert.equal(readFileSync(result.artifacts[0]?.path ?? "", "utf8"), "bytes-of https://cdn.example/out.mp4");
});

test("object swap names the target; fewer anchors mean fewer GPT edits; 1080p is not offered", async () => {
  const p = await prep("remix-object-swap-subscription", { video: [{ path: short, mimeType: "video/mp4" }], images, target: "the mug", anchors: 1 });
  assert.equal(p.plan.steps.filter((s) => s.id.startsWith("swap-")).length, 3);
  const gpt = fakeAdapter({ states: [{ status: "succeeded", outputs: [{ kind: "image", bytes: new TextEncoder().encode("x"), mimeType: "image/png" }] }] });
  const gateway = fakeGateway({ "openai/gpt-image-2": gpt, "xai/grok-imagine-video-1.5": fakeAdapter() }, specs);
  await runWorkflow({ runId: "os", prepared: p, workDir: join(root, "run-os"), emit: () => undefined, poll: instantPoll, deps: { gateway, local, allowedRoots: [root] } });
  assert.match(gpt.calls.find((c) => c.op === "submit")?.request?.prompt ?? "", /Replace only the mug/);
  await assert.rejects(prep("remix-object-swap-subscription", { video: [{ path: short, mimeType: "video/mp4" }], images, resolution: "1080p" }), /must be one of 480p, 720p/);
});

test("subscription slots keep their route and model even when the catalog lacks them", async () => {
  const p = await prep("remix-motion-transfer-subscription", { video: [{ path: short, mimeType: "video/mp4" }], images }, fakeGateway({}, {}));
  const composite = p.plan.steps.find((s) => s.id === "swap-first") as MediaStep;
  assert.deepEqual([composite.model, composite.route], ["openai/gpt-image-2", "openai-oauth"]);
});
