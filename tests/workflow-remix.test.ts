import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getWorkflow } from "../lib/workflows/index.js";
import { prepareWorkflow, runWorkflow } from "../lib/workflows/runner.js";
import type { MediaStep, WorkflowDefinition, WorkflowEvent } from "../lib/workflows/types.js";
import { fakeAdapter, fakeGateway, fakeLocal, instantPoll, spec, tempDir, writeFixture } from "./_workflowFakes.js";

const root = tempDir("ima2-wf-remix-");
after(() => rmSync(root, { recursive: true, force: true }));
const clip = writeFixture(root, "clip.mp4", "source-video");
const silent = writeFixture(root, "silent.mp4", "silent-video");
const long = writeFixture(root, "long.mp4", "long-video");
const face = writeFixture(root, "face.png", "face");
const local = fakeLocal({
  "clip.mp4": { durationSec: 5.2, width: 720, height: 1280, hasAudio: true },
  "silent.mp4": { durationSec: 8, width: 1280, height: 720, hasAudio: false },
  "long.mp4": { durationSec: 16.4, width: 1280, height: 720, hasAudio: true },
});
const video = (path = clip) => [{ path, mimeType: "video/mp4" }];
const images = [{ path: face, mimeType: "image/png" }, { url: "https://img.example/b.png", mimeType: "image/png" }];
const specs = {
  "bytedance/seedance-2.5": spec("bytedance/seedance-2.5", { pricing: [{ unit: "second", usd: 0.2, variant: "720p", source: "https://example.test/p", checkedAt: "2026-11-26" }] }),
  "bytedance/seedream-5.5": spec("bytedance/seedream-5.5", { kind: "image", pricing: [{ unit: "image", usd: 0.03, source: "https://example.test/p", checkedAt: "2026-11-26" }] }),
};

function def(id: string): WorkflowDefinition {
  const found = getWorkflow(id);
  assert.ok(found, id);
  return found;
}

function prep(id: string, request: unknown, adapters = {}) {
  return prepareWorkflow(def(id), request, { gateway: fakeGateway(adapters, specs), local, allowedRoots: [root] }, new AbortController().signal);
}

test("motion transfer plans an edit and a source-sound step, priced per whole source second", async () => {
  const p = await prep("remix-motion-transfer", { values: { video: video(), images } });
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["render", "sound"]);
  const render = p.plan.steps[0] as MediaStep;
  assert.equal(render.model, "bytedance/seedance-2.5");
  assert.deepEqual(render.units, { unit: "second", quantity: 6, variant: "720p" });
  assert.equal(p.plan.steps[1]?.final, true);
  assert.deepEqual(p.estimate, { usd: 1.2, complete: true, steps: [
    { stepId: "render", model: "bytedance/seedance-2.5", units: render.units, usd: 1.2, source: "https://example.test/p", checkedAt: "2026-11-26" },
    { stepId: "sound", usd: 0, note: "runs locally" },
  ] });
});

test("lite tier and explicit model choices pick the slot model; unknown models and slots are refused", async () => {
  const lite = await prep("remix-object-swap", { values: { video: video(), images, tier: "lite" } });
  assert.equal((lite.plan.steps[0] as MediaStep).model, "bytedance/seedance-2.5-flash");
  const pinned = await prep("remix-object-swap", { values: { video: video(), images }, selection: { models: { render: "bytedance/seedance-2-mini" }, routes: { render: "fal" } } });
  assert.equal((pinned.plan.steps[0] as MediaStep).model, "bytedance/seedance-2-mini");
  assert.equal((pinned.plan.steps[0] as MediaStep).route, "fal");
  await assert.rejects(prep("remix-object-swap", { values: { video: video(), images }, selection: { models: { render: "acme/whatever" } } }), /cannot run this step/);
  await assert.rejects(prep("remix-object-swap", { values: { video: video(), images }, selection: { models: { depth: "x/y" } } }), /not a step/);
});

test("source rules: 4-15 s, 1-8 images, files only from allowed folders, https urls only", async () => {
  await assert.rejects(prep("remix-motion-transfer", { values: { video: video(long), images } }), /4-15 seconds/);
  await assert.rejects(prep("remix-motion-transfer", { values: { video: video() } }), /images: is required/);
  const nine = Array.from({ length: 9 }, () => images[1]);
  await assert.rejects(prep("remix-motion-transfer", { values: { video: video(), images: nine } }), /at most 8/);
  await assert.rejects(prep("remix-motion-transfer", { values: { video: [{ path: "/etc/hosts", mimeType: "video/mp4" }], images } }), /outside the allowed folders/);
  await assert.rejects(prep("remix-motion-transfer", { values: { video: video(), images: [{ url: "http://x.example/a.png", mimeType: "image/png" }] } }), /https/);
  await assert.rejects(prep("remix-motion-transfer", { values: { video: video(), images, extra: 1 } }), /not an input/);
});

test("silent sources and generated sound end at the edit step", async () => {
  const silentPlan = await prep("remix-motion-transfer", { values: { video: video(silent), images } });
  assert.deepEqual(silentPlan.plan.steps.map((s) => [s.id, s.final === true]), [["render", true]]);
  const generated = await prep("remix-motion-transfer", { values: { video: video(), images, sound: "generate", resolution: "1080p" } });
  assert.deepEqual((generated.plan.steps[0] as MediaStep).units, { unit: "second", quantity: 6, variant: "1080p+audio" });
  assert.equal(generated.estimate.complete, false, "no 1080p price is published in the fake catalog");
});

test("object swap sends the source as source-video, references in order and names the target", async () => {
  const adapter = fakeAdapter();
  const p = await prep("remix-object-swap", { values: { video: video(), images, target: "the red car", prompt: "keep the logo" } });
  const events: WorkflowEvent[] = [];
  const result = await runWorkflow({ runId: "r", prepared: p, workDir: join(root, "run-swap"), emit: (e) => events.push(e), poll: instantPoll,
    deps: { gateway: fakeGateway({ "bytedance/seedance-2.5": adapter }, specs), local, allowedRoots: [root] } });
  assert.equal(result.status, "succeeded");
  const request = adapter.calls.find((c) => c.op === "submit")?.request;
  assert.equal(request?.task, "video-to-video");
  assert.deepEqual(request?.inputs.map((i) => i.role), ["source-video", "reference-image", "reference-image"]);
  assert.equal(new TextDecoder().decode(request?.inputs[0]?.bytes), "source-video");
  assert.equal(request?.inputs[2]?.bytes !== undefined, true, "inline adapter receives fetched bytes for url refs");
  assert.match(request?.prompt ?? "", /Replace: the red car\./);
  assert.match(request?.prompt ?? "", /keep the logo/);
  assert.equal(request?.durationSec, 6);
  assert.equal(request?.audio, false);
  assert.deepEqual(local.ops.filter((o) => o.op === "mux").length, 1);
});

test("restyle needs a style or a style image and plans frame -> stylize -> edit -> sound", async () => {
  await assert.rejects(prep("remix-restyle", { values: { video: video() } }), /choose a style/);
  const p = await prep("remix-restyle", { values: { video: video(), style: "watercolor" } });
  assert.deepEqual(p.plan.steps.map((s) => s.id), ["first-frame", "style-frame", "render", "sound"]);
  assert.equal(p.estimate.usd, 1.23);
});

test("restyle run passes the first frame to the image model and the styled frame to the video edit", async () => {
  const image = fakeAdapter({ states: [{ status: "succeeded", outputs: [{ kind: "image", bytes: new TextEncoder().encode("styled"), mimeType: "image/png" }] }] });
  const videoAdapter = fakeAdapter();
  const adapters = { "bytedance/seedream-5.5": image, "bytedance/seedance-2.5": videoAdapter };
  const plate = writeFixture(root, "plate.png", "plate");
  const p = await prep("remix-restyle", { values: { video: video(), style: "pixel-art", styleImage: [{ path: plate, mimeType: "image/png" }], prompt: "night time" } }, adapters);
  const result = await runWorkflow({ runId: "r2", prepared: p, workDir: join(root, "run-restyle"), emit: () => undefined, poll: instantPoll,
    deps: { gateway: fakeGateway(adapters, specs), local, allowedRoots: [root] } });
  assert.equal(result.status, "succeeded");
  const still = image.calls.find((c) => c.op === "submit")?.request;
  assert.deepEqual(still?.inputs.map((i) => [i.role, new TextDecoder().decode(i.bytes)]), [["source-image", "frame:first"], ["reference-image", "plate"]]);
  assert.match(still?.prompt ?? "", /16-bit pixel art/);
  assert.match(still?.prompt ?? "", /night time/);
  const edit = videoAdapter.calls.find((c) => c.op === "submit")?.request;
  assert.deepEqual(edit?.inputs.map((i) => [i.role, new TextDecoder().decode(i.bytes)]), [["source-video", "source-video"], ["reference-image", "styled"]]);
  assert.equal(readFileSync(result.artifacts[0]?.path ?? "", "utf8"), "bytes-of https://cdn.example/out.mp4");
});
