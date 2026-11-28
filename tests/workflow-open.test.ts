import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { MediaModelSpec } from "../lib/providers/media/contract.js";
import { describeWorkflow, getWorkflow, summarizeSteps } from "../lib/workflows/index.js";
import { prepareWorkflow, runWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep, TextPlanRequest, WorkflowDefinition, WorkflowEvent } from "../lib/workflows/types.js";
import { fakeAdapter, fakeGateway, fakeLocal, instantPoll, spec, tempDir, writeFixture } from "./_workflowFakes.js";

const root = tempDir("ima2-wf-open-");
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const boat = writeFixture(root, "boat.mp4", "source-video");
const short = writeFixture(root, "short.mp4", "short-video");
const long = writeFixture(root, "long.mp4", "long-video");
const duck = writeFixture(root, "duck.png", "duck");
const local = fakeLocal({
  "boat.mp4": { durationSec: 4.04, width: 864, height: 496, hasAudio: true },
  "short.mp4": { durationSec: 6, width: 864, height: 496, hasAudio: false },
  "long.mp4": { durationSec: 9.5, width: 864, height: 496, hasAudio: false },
}, { "boat.mp4": [] });

const video = (path = boat) => [{ path, mimeType: "video/mp4" }];
const images = [{ path: duck, mimeType: "image/png" }];
const image = (id: string, extra: Partial<MediaModelSpec> = {}) => spec(id, { kind: "image", tasks: ["text-to-image", "image-to-image"], params: { maxReferenceImages: 10 }, ...extra });
const videoSpec = (id: string, tasks: MediaModelSpec["tasks"], params: MediaModelSpec["params"] = {}) => spec(id, { tasks, params });
const specs: Record<string, MediaModelSpec> = {
  "bytedance/seedream-5.5": image("bytedance/seedream-5.5"),
  "openai/gpt-image-2.6": image("openai/gpt-image-2.6"),
  "openai/gpt-image-2": image("openai/gpt-image-2"),
  "black-forest-labs/flux-kontext-pro": image("black-forest-labs/flux-kontext-pro", { params: { maxReferenceImages: 1 } }),
  "meta/sam-3": spec("meta/sam-3", { kind: "image", tasks: ["image-segment"] }),
  "bytedance/seedance-2.5": videoSpec("bytedance/seedance-2.5", ["reference-to-video", "video-to-video"], { maxReferenceImages: 30, maxReferenceVideos: 10, durationsSec: [4, 5, 6, 7, 8] }),
  "bytedance/seedance-2": videoSpec("bytedance/seedance-2", ["reference-to-video", "video-to-video"], { maxReferenceImages: 9, maxReferenceVideos: 3, durationsSec: [4, 5, 6] }),
  "xai/grok-imagine-video-1.5": videoSpec("xai/grok-imagine-video-1.5", ["reference-to-video"], { maxReferenceImages: 14 }),
  "xai/grok-imagine-video": videoSpec("xai/grok-imagine-video", ["video-to-video"], { resolutions: ["480p", "720p"] }),
};
const caption = { scene: "misty lake at dawn", subjects: "a white paper boat at frame centre", motion: "the boat drifts slowly left to right", camera: "static wide shot, slight push in", lighting: "low warm sun from the right", references: "a yellow rubber duck" };
const planner = (r: TextPlanRequest) => (r.purpose === "remix-caption" ? caption : {});
const def = (id: string): WorkflowDefinition => getWorkflow(id)!;
const imageOut = (text: string) => fakeAdapter({ states: [{ status: "succeeded", outputs: [{ kind: "image", bytes: new TextEncoder().encode(text), mimeType: "image/png" }] }] });
const only = (allowed: string[]) => (id: string) => allowed.includes(id);
/** Every keyed model runs; no ChatGPT sign-in, so GPT image over openai-oauth does not. */
const noChatGpt = (_id: string, route: string | undefined) => route !== "openai-oauth";
const dec = (b?: Uint8Array) => new TextDecoder().decode(b);

function prep(id: string, values: Record<string, unknown>, gateway: ReturnType<typeof fakeGateway>, selection?: unknown) {
  return prepareWorkflow(def(id), { values, ...(selection ? { selection } : {}) }, { gateway, local, allowedRoots: [root] }, new AbortController().signal);
}

async function run(id: string, p: Awaited<ReturnType<typeof prep>>, gateway: ReturnType<typeof fakeGateway>) {
  const events: WorkflowEvent[] = [];
  const result = await runWorkflow({ runId: id, prepared: p, workDir: join(root, "run-" + id + "-" + Math.random().toString(16).slice(2)), emit: (e) => events.push(e), poll: instantPoll, deps: { gateway, local, allowedRoots: [root] }, concurrency: 3 });
  return { result, events };
}

test("motion transfer (open) runs the open stage layout on BytePlus models with the user's keys", async () => {
  const seedream = imageOut("anchor");
  const seedance = fakeAdapter();
  const gateway = fakeGateway({ "bytedance/seedream-5.5": seedream, "bytedance/seedance-2.5": seedance }, specs, planner, (id) => id.startsWith("bytedance/"));
  const p = await prep("remix-motion-transfer-open", { video: video(), images, prompt: "keep it calm" }, gateway);
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["scenes", "frame-first", "frame-mid", "frame-last", "caption", "subject-first", "render", "sound"]);
  assert.deepEqual(p.notes, [{ slot: "subject", kind: "fallback", message: "openai/gpt-image-2 cannot run now; using bytedance/seedream-5.5" }]);
  const render = p.plan.steps.find((s) => s.id === "render") as MediaStep;
  assert.deepEqual([render.model, render.units.quantity], ["bytedance/seedance-2.5", 4]);
  const { result, events } = await run("mt", p, gateway);
  assert.equal(result.status, "succeeded");
  const cap = gateway.planned.find((r) => r.purpose === "remix-caption");
  assert.equal(cap?.images?.length, 4, "three source frames plus the reference image");
  const req = seedance.calls.find((c) => c.op === "submit")?.request;
  assert.equal(req?.task, "reference-to-video");
  assert.deepEqual(req?.inputs.map((i) => [i.role, dec(i.bytes)]), [["reference-video", "source-video"], ["reference-image", "anchor"], ["reference-image", "duck"]]);
  assert.match(req?.prompt ?? "", /Motion to keep: the boat drifts slowly left to right/);
  assert.match(req?.prompt ?? "", /keep it calm/);
  assert.equal(req?.audio, false);
  const artifacts = events.filter((e) => e.type === "step.artifact").map((e) => e.type === "step.artifact" && e.stepId);
  for (const id of ["scenes", "frame-first", "caption", "subject-first", "render", "sound"]) assert.ok(artifacts.includes(id), id + " artifact emitted");
  const planned = events.find((e) => e.type === "workflow.planned");
  assert.ok(planned && planned.type === "workflow.planned" && Array.isArray(planned.notes));
});

test("without an image key the subject step is left out with a note, and the render still gets the user's images", async () => {
  const seedance = fakeAdapter();
  const gateway = fakeGateway({ "bytedance/seedance-2.5": seedance }, specs, planner, only(["bytedance/seedance-2.5"]));
  const p = await prep("remix-motion-transfer-open", { video: video(), images }, gateway);
  assert.ok(!p.plan.steps.some((s) => s.id.startsWith("subject")));
  assert.equal(p.notes.find((n) => n.slot === "subject")?.kind, "skipped");
  await run("mt2", p, gateway);
  assert.deepEqual(seedance.calls.find((c) => c.op === "submit")?.request?.inputs.map((i) => i.role), ["reference-video", "reference-image"]);
});

test("a render default without a key falls back to the next runnable model and says so", async () => {
  const gateway = fakeGateway({}, specs, planner, only(["bytedance/seedance-2", "bytedance/seedream-5.5"]));
  const p = await prep("remix-motion-transfer-open", { video: video(), images }, gateway);
  assert.equal((p.plan.steps.find((s) => s.id === "render") as MediaStep).model, "bytedance/seedance-2");
  assert.match(p.notes.find((n) => n.slot === "render")?.message ?? "", /seedance-2\.5 cannot run now; using bytedance\/seedance-2/);
  const none = await prep("remix-motion-transfer-open", { video: video(), images }, fakeGateway({}, specs, planner, () => false));
  assert.equal(none.notes.find((n) => n.slot === "render")?.kind, "needs-key");
});

test("no vision planner: the caption step is skipped with a note", async () => {
  const p = await prep("remix-motion-transfer-open", { video: video(), images }, fakeGateway({}, specs, undefined, () => true));
  assert.ok(!p.plan.steps.some((s) => s.id === "caption"));
  assert.equal(p.notes.find((n) => n.stepId === "caption")?.kind, "skipped");
});

test("the subscription combo is this graph with GPT anchors on every pinned frame and Grok 1.5 pins", async () => {
  const gpt = imageOut("pinned");
  const grok = fakeAdapter();
  const gateway = fakeGateway({ "openai/gpt-image-2": gpt, "xai/grok-imagine-video-1.5": grok }, specs, planner, () => true);
  const p = await prep("remix-motion-transfer-open", { video: video(), images, anchors: 2 }, gateway, { combo: "subscription" });
  const ids = p.plan.steps.map((s) => s.id);
  assert.deepEqual(ids.filter((s) => s.startsWith("subject-")), ["subject-first", "subject-key-1", "subject-key-2", "subject-last"]);
  assert.deepEqual(p.plan.steps.filter((s) => s.id.startsWith("subject-")).map((s) => s.label),
    ["Prepare the first frame", "Prepare key frame 1", "Prepare key frame 2", "Prepare the last frame"]);
  assert.ok(p.plan.steps.every((s) => !/\b(?:key|shot|cut|edit)-\d|\bmid\b/.test(s.label)), "no step id in a label");
  const render = p.plan.steps.find((s) => s.id === "render") as MediaStep;
  assert.deepEqual([render.model, render.route, render.units.quantity], ["xai/grok-imagine-video-1.5", "xai-oauth", 4]);
  await run("sub", p, gateway);
  assert.ok(gateway.resolved.every((r) => r.route === "openai-oauth" || r.route === "xai-oauth"));
  const req = grok.calls.find((c) => c.op === "submit")?.request;
  assert.deepEqual(req?.inputs.map((i) => i.role), ["first-frame", "reference-image", "reference-image", "last-frame", "reference-image"]);
  assert.deepEqual((req?.vendorOptions as { keyframes: { inputIndex: number }[] }).keyframes.map((k) => k.inputIndex), [1, 2]);
});

test("pins without any runnable image model are refused", async () => {
  await assert.rejects(prep("remix-motion-transfer-open", { video: video(), images }, fakeGateway({}, specs, planner, only(["xai/grok-imagine-video-1.5"])), { models: { render: "xai/grok-imagine-video-1.5" } }), /needs an image model/);
});

test("object swap (open): SAM 3 mask feeds the OpenAI edit, then Seedance edits the source with the prepared frame", async () => {
  const sam = imageOut("mask");
  const gpt = imageOut("swapped-first");
  const seedance = fakeAdapter();
  const gateway = fakeGateway({ "meta/sam-3": sam, "openai/gpt-image-2.6": gpt, "bytedance/seedance-2.5": seedance }, specs, planner, noChatGpt);
  const p = await prep("remix-object-swap-open", { video: video(), images, target: "the paper boat" }, gateway);
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["scenes", "frame-first", "frame-mid", "frame-last", "caption", "segment", "subject-first", "render", "sound"]);
  await run("swap", p, gateway);
  assert.equal(sam.calls.find((c) => c.op === "submit")?.request?.prompt, "the paper boat");
  assert.deepEqual(gpt.calls.find((c) => c.op === "submit")?.request?.inputs.map((i) => [i.role, dec(i.bytes)]), [["source-image", "frame:first"], ["reference-image", "duck"], ["mask", "mask"]]);
  const req = seedance.calls.find((c) => c.op === "submit")?.request;
  assert.equal(req?.task, "video-to-video");
  assert.deepEqual(req?.inputs.map((i) => [i.role, dec(i.bytes)]), [["source-video", "source-video"], ["reference-image", "swapped-first"], ["reference-image", "duck"]]);
  assert.match(req?.prompt ?? "", /Replace only the paper boat/);
  assert.equal(req?.durationSec, undefined, "edits keep the source length");
});

test("object swap with Grok's text-only edit sends only the video and describes the replacement in words", async () => {
  const grok = fakeAdapter();
  const gateway = fakeGateway({ "xai/grok-imagine-video": grok, "openai/gpt-image-2": imageOut("x") }, specs, planner, () => true);
  const p = await prep("remix-object-swap-open", { video: video(short), images, target: "the paper boat", resolution: "720p", sound: "model" }, gateway, { combo: "subscription" });
  await run("swap-grok", p, gateway);
  const req = grok.calls.find((c) => c.op === "submit")?.request;
  assert.deepEqual(req?.inputs.map((i) => i.role), ["source-video"]);
  assert.match(req?.prompt ?? "", /the subject described as: a yellow rubber duck/);
  assert.equal(req && "audio" in req, false, "Grok's edit takes no audio flag, even when the model's sound is asked for");
  await assert.rejects(prep("remix-object-swap-open", { video: video(long), images, target: "boat" }, gateway, { combo: "subscription" }), /edits clips up to 8.7 seconds/);
  await assert.rejects(prep("remix-object-swap-open", { video: video(short), images, target: "boat", resolution: "1080p" }, gateway, { combo: "subscription" }), /offers 480p, 720p/);
});

test("restyle (open) redraws the first frame and edits the source to match it", async () => {
  const flux = imageOut("styled");
  const seedance = fakeAdapter();
  const gateway = fakeGateway({ "black-forest-labs/flux-kontext-pro": flux, "bytedance/seedance-2.5": seedance }, specs, planner, noChatGpt);
  await assert.rejects(prep("remix-restyle-open", { video: video() }, gateway), /choose a style/);
  const p = await prep("remix-restyle-open", { video: video(), style: "watercolor" }, gateway);
  await run("restyle", p, gateway);
  assert.match(flux.calls.find((c) => c.op === "submit")?.request?.prompt ?? "", /Loose watercolor/);
  assert.match(flux.calls.find((c) => c.op === "submit")?.request?.prompt ?? "", /skin tone, hair/);
  const req = seedance.calls.find((c) => c.op === "submit")?.request;
  assert.deepEqual(req?.inputs.map((i) => [i.role, dec(i.bytes)]), [["source-video", "source-video"], ["reference-image", "styled"]]);
  assert.match(req?.prompt ?? "", /Image 1 is the first frame redrawn/);
  assert.match(req?.prompt ?? "", /skin tone, hair/);
});

test("descriptions carry combos and which models can run now", () => {
  const gateway = fakeGateway({}, specs, planner, only(["bytedance/seedance-2.5"]));
  const d = describeWorkflow(def("remix-object-swap-open"), gateway);
  assert.deepEqual(d.combos?.map((c) => c.id), ["byteplus", "subscription", "fal"]);
  const render = d.slots.find((s) => s.name === "render");
  assert.equal(render?.runnable?.["bytedance/seedance-2.5"], true);
  assert.equal(render?.runnable?.["kling/kling-o1"], false);
  assert.equal(d.slots.find((s) => s.name === "segment")?.optional, true);
});

test("a combination leaves out optional steps it does not name", async () => {
  const p = await prep("remix-object-swap-open", { video: video(short), images, target: "the paper boat" }, fakeGateway({}, specs, planner, () => true), { combo: "byteplus" });
  assert.ok(!p.plan.steps.some((s) => s.id === "segment"));
  assert.match(p.notes.find((n) => n.slot === "segment")?.message ?? "", /not part of BytePlus only/);
  await assert.rejects(prep("remix-object-swap-open", { video: video(short), images, target: "x" }, fakeGateway({}, specs, planner, () => true), { combo: "nope" }), /not a combination/);
});
test("image stages use GPT image over the ChatGPT sign-in first in every open mode", async () => {
  const signedIn = (id: string, route: string | undefined) => route === "openai-oauth" ? id === "openai/gpt-image-2" : id.startsWith("bytedance/");
  for (const [id, extra] of [["remix-motion-transfer-open", {}], ["remix-object-swap-open", { target: "the paper boat" }], ["remix-restyle-open", { style: "watercolor" }]] as const) {
    const gpt = imageOut("gpt-" + id);
    const gateway = fakeGateway({ "openai/gpt-image-2": gpt, "bytedance/seedance-2.5": fakeAdapter() }, specs, planner, signedIn);
    const values = id === "remix-restyle-open" ? { video: video(), ...extra } : { video: video(), images, ...extra };
    const p = await prep(id, values, gateway);
    const subject = p.plan.steps.find((s) => s.id === "subject-first") as MediaStep;
    assert.deepEqual([subject.model, subject.route], ["openai/gpt-image-2", "openai-oauth"], id);
    assert.ok(!p.notes.some((n) => n.slot === "subject"), id + ": no fallback note");
    await run("gpt-" + id, p, gateway);
    assert.ok(gpt.calls.some((c) => c.op === "submit"), id + ": the GPT image adapter was called");
    assert.ok(gateway.resolved.some((r) => r.model === "openai/gpt-image-2" && r.route === "openai-oauth"), id + ": resolved on the sign-in route");
  }
  const d = describeWorkflow(def("remix-object-swap-open"), fakeGateway({}, specs, planner, signedIn));
  assert.equal(d.slots.find((s) => s.name === "subject")?.runnable?.["openai/gpt-image-2"], true);
});

test("Grok's edit is never asked for silence: the source sound replaces its sound, and silent outputs are refused up front", async () => {
  const grok = fakeAdapter();
  const gateway = fakeGateway({ "xai/grok-imagine-video": grok, "openai/gpt-image-2": imageOut("styled") }, specs, planner, () => true);
  const p = await prep("remix-restyle-open", { video: video(), style: "yarn-world", resolution: "720p" }, gateway, { combo: "subscription" });
  assert.deepEqual(p.plan.steps.slice(-2).map((s) => s.id), ["render", "sound"]);
  await run("grok-sound", p, gateway);
  const req = grok.calls.find((c) => c.op === "submit")?.request;
  assert.equal(req && "audio" in req, false, "no audio flag for Grok's edit");
  assert.match(req?.prompt ?? "", /skin tone, hair/, "Grok's edit never sees the restyled first frame, so the prompt keeps each person's features");
  assert.equal(req && "resolution" in req, false, "the edit follows the source size");
  await assert.rejects(prep("remix-restyle-open", { video: video(), style: "yarn-world", resolution: "720p", sound: "none" }, gateway, { combo: "subscription" }), /always returns sound/);
  await assert.rejects(prep("remix-restyle-open", { video: video(short), style: "yarn-world", resolution: "720p" }, gateway, { combo: "subscription" }), /always returns sound/);
});

test("step summaries name the slot each media step runs, so clients need not guess from step ids", async () => {
  const gateway = fakeGateway({}, specs, planner, (id) => id.startsWith("bytedance/"));
  const p = await prep("remix-motion-transfer-open", { video: video(), images }, gateway);
  const media = summarizeSteps(p.plan).filter((s) => s.kind === "media").map((s) => [s.id, s.slot, s.model]);
  assert.deepEqual(media, [["subject-first", "subject", "bytedance/seedream-5.5"], ["render", "render", "bytedance/seedance-2.5"]]);
  assert.ok(summarizeSteps(p.plan).filter((s) => s.kind !== "media").every((s) => s.slot === undefined));
});
