import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import express from "express";

import { config } from "../config.js";
import { describeParams, detectBindCandidates, detectMediaKind, detectMediaSlots, findWorkflowProblems } from "../lib/comfy/detect.ts";
import { fetchComfyObjectInfo, parseInputSpec, type ComfyObjectInfo } from "../lib/comfy/objectInfo.ts";
import { bindGraph, parseApiGraph, unambiguousBindings } from "../lib/comfyGraphBind.ts";
import type { ComfyGraph, ComfyWorkflowBindings } from "../lib/comfyWorkflowStore.ts";
import { registerComfyRoutes } from "../routes/comfy.ts";
import { startFakeComfy, type FakeComfy } from "./_fakeComfyServer.ts";

// Node schemas read from a live ComfyUI 0.46.0 (GET /object_info/{class}, 2026-11-27), tooltips removed.
// Slot detection is tested against what a real server says, not a mock-up.
const INFO = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "comfy-object-info.json"), "utf8")) as ComfyObjectInfo;

/** FLUX.2 klein text-to-image as ComfyUI exports it: the size is written in two nodes, the negative is the zeroed positive. */
const KLEIN: ComfyGraph = {
  "9": { class_type: "SaveImage", inputs: { images: ["65", 0], filename_prefix: "ima2" } },
  "61": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  "62": { class_type: "Flux2Scheduler", inputs: { steps: 4, width: 1024, height: 1024 } },
  "63": { class_type: "CFGGuider", inputs: { model: ["70", 0], positive: ["74", 0], negative: ["76", 0], cfg: 1 } },
  "64": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["73", 0], guider: ["63", 0], sampler: ["61", 0], sigmas: ["62", 0], latent_image: ["66", 0] } },
  "65": { class_type: "VAEDecode", inputs: { samples: ["64", 0], vae: ["72", 0] } },
  "66": { class_type: "EmptyFlux2LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "70": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b.safetensors", weight_dtype: "default" } },
  "71": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "flux2", device: "default" } },
  "72": { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
  "73": { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
  "74": { class_type: "CLIPTextEncode", inputs: { clip: ["71", 0], text: "" } },
  "76": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["74", 0] } },
};

/** The classic checkpoint graph: two text encoders that only the sampler's wiring tells apart. */
const SD: ComfyGraph = {
  "3": { class_type: "KSampler", inputs: { model: ["4", 0], seed: 5, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "simple", positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0], denoise: 1 } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "missing-checkpoint.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 768, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "a cat" }, _meta: { title: "anything" } },
  "7": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "blurry" }, _meta: { title: "also anything" } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "x" } },
};

/** Image-to-video: both prompts pass through the conditioner on their way to the sampler. */
const I2V: ComfyGraph = {
  "3": { class_type: "KSampler", inputs: { model: ["4", 0], seed: 5, steps: 20, cfg: 6, sampler_name: "euler", scheduler: "simple", positive: ["50", 0], negative: ["50", 1], latent_image: ["50", 2], denoise: 1 } },
  "4": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b.safetensors", weight_dtype: "default" } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["38", 0], text: "waves" } },
  "7": { class_type: "CLIPTextEncode", inputs: { clip: ["38", 0], text: "static" } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["39", 0] } },
  "38": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "wan", device: "default" } },
  "39": { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
  "50": { class_type: "WanImageToVideo", inputs: { positive: ["6", 0], negative: ["7", 0], vae: ["39", 0], start_image: ["52", 0], width: 832, height: 480, length: 81, batch_size: 1 } },
  "52": { class_type: "LoadImage", inputs: { image: "first.png" } },
  "60": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 16 } },
  "61": { class_type: "SaveVideo", inputs: { video: ["60", 0], filename_prefix: "video/ima2", format: "mp4", codec: "h264" } },
};

const settled = (graph: ComfyGraph) => unambiguousBindings(detectBindCandidates(graph, INFO));

describe("comfy input specs", () => {
  it("reads a choice list in either encoding and knows an upload list from a fixed one", () => {
    const image = parseInputSpec(INFO.LoadImage!.input!.required!.image)!;
    assert.deepEqual([image.type, image.options, image.upload, Array.isArray(image.choices)], ["COMBO", { image_upload: true }, "image", true]);
    assert.equal(parseInputSpec(INFO.LoadVideo!.input!.required!.file)?.upload, "video");
    assert.equal(parseInputSpec(INFO.LoadAudio!.input!.required!.audio)?.upload, "audio");
    const fixed = parseInputSpec(INFO.UNETLoader!.input!.required!.unet_name)!;
    assert.deepEqual([fixed.type, fixed.choices, fixed.upload], ["COMBO", ["flux-2-klein-4b.safetensors"], undefined]);
    assert.deepEqual(parseInputSpec(["COMBO", { options: ["vp9", "av1"] }])?.choices, ["vp9", "av1"]);
    assert.equal(parseInputSpec(INFO.KSampler!.input!.required!.steps)?.type, "INT");
    assert.equal(parseInputSpec(undefined), null);
  });
});

describe("comfy slot detection", () => {
  it("finds the prompt by following the sampler, and binds a size written twice as one setting", () => {
    assert.deepEqual(settled(KLEIN), {
      prompt: { node: "74", input: "text" },
      width: { node: "62", input: "width", also: [{ node: "66", input: "width" }] },
      height: { node: "62", input: "height", also: [{ node: "66", input: "height" }] },
      seed: { node: "73", input: "noise_seed" },
      output: { node: "9" },
    });
    // The negative here is the positive text zeroed out: it is not a second prompt to bind.
    assert.equal(detectBindCandidates(KLEIN, INFO).some((candidate) => candidate.field === "negativePrompt"), false);
    assert.equal(detectMediaKind(KLEIN, INFO), "image");
  });

  it("tells the positive prompt from the negative one without reading a title", () => {
    const bind = settled(SD);
    assert.deepEqual(bind.prompt, { node: "6", input: "text" });
    assert.deepEqual(bind.negativePrompt, { node: "7", input: "text" });
    assert.deepEqual(bind.seed, { node: "3", input: "seed" });
    assert.deepEqual([bind.width, bind.height], [{ node: "5", input: "width" }, { node: "5", input: "height" }]);
    // The other text box stays on offer for the prompt, unsettled, so a person can still choose it.
    assert.deepEqual(
      detectBindCandidates(SD, INFO).filter((candidate) => candidate.field === "prompt").map((candidate) => [candidate.node, candidate.unambiguous]),
      [["6", true], ["7", false]],
    );
  });

  it("follows both prompts through an image-to-video conditioner and finds the frame, length and fps", () => {
    assert.deepEqual(settled(I2V), {
      prompt: { node: "6", input: "text" },
      negativePrompt: { node: "7", input: "text" },
      width: { node: "50", input: "width" },
      height: { node: "50", input: "height" },
      seed: { node: "3", input: "seed" },
      refImage: { node: "52", input: "image" },
      length: { node: "50", input: "length" },
      fps: { node: "60", input: "fps" },
      output: { node: "61" },
    });
    assert.equal(detectMediaKind(I2V, INFO), "video");
    // Its one image is the frame the clip starts from; nothing else in the graph is a file.
    assert.deepEqual(detectMediaSlots(I2V, INFO, "video"), [{ kind: "image", node: "52", input: "image", classType: "LoadImage", role: "first-frame" }]);
    assert.deepEqual(detectMediaSlots(KLEIN, INFO, "image"), []);
  });

  it("assigns a lone file its role and leaves two of a kind for a person to tell apart", () => {
    const talk: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } }, "2": { class_type: "LoadAudio", inputs: { audio: "a.mp3" } },
      "3": { class_type: "LoadVideo", inputs: { file: "a.mp4" } }, "4": { class_type: "LoadImageMask", inputs: { image: "m.png", channel: "alpha" } },
    };
    assert.deepEqual(detectMediaSlots(talk, INFO, "video").map((slot) => [slot.node, slot.kind, slot.role]), [
      ["1", "image", "first-frame"], ["2", "audio", "source-audio"], ["3", "video", "source-video"], ["4", "image", "mask"],
    ]);
    assert.equal(detectMediaSlots(talk, INFO, "image")[0]!.role, "source-image");
    const two: ComfyGraph = { ...talk, "5": { class_type: "LoadImage", inputs: { image: "b.png" } } };
    assert.deepEqual(detectMediaSlots(two, INFO, "video").filter((slot) => slot.kind === "image").map((slot) => [slot.node, slot.role]), [["1", undefined], ["4", "mask"], ["5", undefined]]);
  });

  it("asks when the graph does not settle it", () => {
    // Two samplers fed by different texts: neither is "the" prompt.
    const two: ComfyGraph = { ...SD, "30": { class_type: "KSampler", inputs: { ...SD["3"]!.inputs, positive: ["7", 0], negative: ["6", 0] } } };
    const prompts = detectBindCandidates(two, INFO).filter((candidate) => candidate.field === "prompt");
    assert.deepEqual(prompts.map((candidate) => [candidate.node, candidate.unambiguous]), [["6", false], ["7", false]]);
    // Two sizes that differ are two settings.
    const sizes: ComfyGraph = { ...KLEIN, "66": { class_type: "EmptyFlux2LatentImage", inputs: { width: 512, height: 1024, batch_size: 1 } } };
    const widths = detectBindCandidates(sizes, INFO).filter((candidate) => candidate.field === "width");
    assert.deepEqual(widths.map((candidate) => [candidate.node, candidate.unambiguous, candidate.also]), [["62", false, undefined], ["66", false, undefined]]);
    assert.equal(settled(sizes).height?.also?.length, 1, "the height still agrees, so it is still one setting");
    // A prompt that reaches the sampler through a fork is not traced.
    const fork: ComfyGraph = { ...SD, "20": { class_type: "ConditioningCombine", inputs: { conditioning_1: ["6", 0], conditioning_2: ["7", 0] } },
      "3": { class_type: "KSampler", inputs: { ...SD["3"]!.inputs, positive: ["20", 0] } } };
    assert.equal(settled(fork).prompt, undefined);
  });

  it("does not call an animation saver an image, or an audio saver a video", () => {
    const webm: ComfyGraph = { "1": { class_type: "SaveWEBM", inputs: { images: ["2", 0], filename_prefix: "x", codec: "vp9", fps: 24, crf: 32 } } };
    assert.equal(detectMediaKind(webm, INFO), undefined);
    const audio: ComfyGraph = { "1": { class_type: "SaveAudioMP3", inputs: { audio: ["2", 0], filename_prefix: "x", quality: "V0" } } };
    assert.equal(detectMediaKind(audio, INFO), "audio");
  });
});

describe("comfy workflow problems", () => {
  it("names the node type, the model file and the paid node a server would trip over", () => {
    const graph: ComfyGraph = {
      ...SD,
      "40": { class_type: "SomeCustomUpscaler", inputs: { image: ["8", 0] } },
      "41": { class_type: "SomeCustomUpscaler", inputs: { image: ["8", 0] } },
      "42": { class_type: "LoadImage", inputs: { image: "not-uploaded-yet.png" } },
      "43": { class_type: "PaidThing", inputs: { prompt: "x" } },
    };
    const info = { ...INFO, PaidThing: { input: { required: { prompt: ["STRING", { multiline: true }] } }, api_node: true } };
    assert.deepEqual(findWorkflowProblems(graph, info), {
      missingNodes: [{ classType: "SomeCustomUpscaler", nodes: ["40", "41"] }],
      // An upload list is filled at run time, so its current value is not a missing choice.
      missingChoices: [{ node: "4", classType: "CheckpointLoaderSimple", input: "ckpt_name", value: "missing-checkpoint.safetensors", model: true }],
      paidNodes: ["PaidThing"],
    });
    assert.deepEqual(findWorkflowProblems(KLEIN, INFO), { missingNodes: [], missingChoices: [], paidNodes: [] });
  });
});

describe("comfy workflow parameters", () => {
  it("carry the range and the choices the server enforces, and leave out what is bound", () => {
    const params = describeParams(KLEIN, settled(KLEIN) as ComfyWorkflowBindings, INFO);
    const byName = Object.fromEntries(params.map((param) => [param.name, param]));
    assert.deepEqual(byName["Flux2Scheduler.steps"], { name: "Flux2Scheduler.steps", node: "62", input: "steps", type: "number", default: 4, min: 1, max: 4096 });
    assert.deepEqual(byName["KSamplerSelect.sampler_name"]?.options?.slice(0, 2), ["euler", "euler_cfg_pp"]);
    for (const bound of ["Flux2Scheduler.width", "EmptyFlux2LatentImage.width", "EmptyFlux2LatentImage.height", "RandomNoise.noise_seed", "CLIPTextEncode.text"]) {
      assert.equal(byName[bound], undefined, bound);
    }
  });

  it("a bound size reaches every node that holds it", () => {
    const bind = settled(KLEIN) as ComfyWorkflowBindings;
    const bound = bindGraph(KLEIN, bind, { prompt: "a fox", width: 768, height: 1344, seed: 9 });
    assert.deepEqual(
      [bound["62"]!.inputs.width, bound["66"]!.inputs.width, bound["62"]!.inputs.height, bound["66"]!.inputs.height, bound["73"]!.inputs.noise_seed, bound["74"]!.inputs.text],
      [768, 768, 1344, 1344, 9, "a fox"],
    );
    assert.equal(KLEIN["66"]!.inputs.width, 1024, "the stored graph is untouched");
  });
});

describe("comfy inspect and register against a server", () => {
  const original = { configDir: config.storage.configDir, configFile: config.storage.configFile, defaultUrl: config.comfy.defaultUrl };
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanup.length > 0) await cleanup.pop()!();
    Object.assign(config.storage, { configDir: original.configDir, configFile: original.configFile });
    (config.comfy as { defaultUrl: string }).defaultUrl = original.defaultUrl;
  });

  async function setup(fakeOptions: Parameters<typeof startFakeComfy>[0] | null): Promise<{ base: string; fake: FakeComfy | null }> {
    const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-detect-"));
    Object.assign(config.storage, { configDir: dir, configFile: join(dir, "config.json") });
    cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const fake = fakeOptions ? await startFakeComfy(fakeOptions) : null;
    if (fake) cleanup.push(() => fake.close());
    // Port 9 (discard) refuses at once: a server that is not running.
    (config.comfy as { defaultUrl: string }).defaultUrl = fake?.origin ?? "http://127.0.0.1:9";
    const app = express();
    app.use(express.json({ limit: "20mb" }));
    registerComfyRoutes(app, { config } as never);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return { base: "http://127.0.0.1:" + String((server.address() as import("node:net").AddressInfo).port), fake };
  }
  const post = (base: string, path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("reads only the classes the workflow uses and reports what the server lacks", async () => {
    const { base, fake } = await setup({ objectInfo: INFO });
    const info = await fetchComfyObjectInfo({ origin: fake!.origin, headers: {}, secrets: [] }, ["SaveImage", "SaveImage", "NoSuchNode"], 2_000);
    assert.deepEqual(Object.keys(info), ["SaveImage"]);
    const before = fake!.requests.length;
    const res = await post(base, "/api/comfy/inspect", { graph: SD });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.needsConfirmation, true, "the second text box is still offered for the prompt");
    assert.deepEqual(body.candidates.filter((c: any) => c.unambiguous).map((c: any) => c.field), ["prompt", "negativePrompt", "width", "height", "seed", "output"]);
    assert.deepEqual(body.server, {
      origin: fake!.origin, reachable: true, missingNodes: [], paidNodes: [],
      missingChoices: [{ node: "4", classType: "CheckpointLoaderSimple", input: "ckpt_name", value: "missing-checkpoint.safetensors", model: true }],
    });
    const asked = fake!.requests.slice(before).filter((request) => request.path.startsWith("/object_info/")).map((request) => request.path).sort();
    assert.deepEqual(asked, ["CLIPTextEncode", "CheckpointLoaderSimple", "EmptyLatentImage", "KSampler", "SaveImage", "VAEDecode"].map((name) => "/object_info/" + name));
  });

  it("still proposes slots from node names when the server is not running, and says it was not asked", async () => {
    const { base } = await setup(null);
    const body = await (await post(base, "/api/comfy/inspect", { graph: SD })).json();
    assert.equal(body.server.reachable, false);
    assert.equal(body.server.origin, "http://127.0.0.1:9");
    assert.deepEqual(body.candidates.filter((c: any) => c.field === "prompt").map((c: any) => c.unambiguous), [false, false]);
  });

  it("registers with ranged parameters, the server report and the media model it became; audio and file slots included", async () => {
    const { base, fake } = await setup({ objectInfo: INFO });
    const res = await post(base, "/api/comfy/workflows", { id: "klein", graph: KLEIN, bind: settled(KLEIN) });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.workflow.origin, fake!.origin);
    assert.equal(body.workflow.mediaKind, "image");
    assert.deepEqual(body.workflow.bind.width, { node: "62", input: "width", also: [{ node: "66", input: "width" }] });
    assert.deepEqual(body.workflow.params.find((p: any) => p.name === "Flux2Scheduler.steps"), { name: "Flux2Scheduler.steps", node: "62", input: "steps", type: "number", default: 4, min: 1, max: 4096 });
    assert.deepEqual(body.server, { origin: fake!.origin, reachable: true, missingNodes: [], missingChoices: [], paidNodes: [] });
    assert.deepEqual(body.media, { model: "comfy/klein", task: "text-to-image" });
    const audio = { "1": { class_type: "SaveAudioMP3", inputs: { audio: ["2", 0], filename_prefix: "x", quality: "V0" } }, "3": { class_type: "CLIPTextEncode", inputs: { text: "" } } };
    const song = await (await post(base, "/api/comfy/workflows", { id: "song", graph: audio, bind: { prompt: { node: "3", input: "text" }, output: { node: "1" } } })).json();
    assert.deepEqual([song.workflow.mediaKind, song.media], ["audio", { model: "comfy/song", task: "text-to-audio" }]);
    // A file slot is stored with its role; one image slot also serves the classic lane's single reference.
    const inspected = await (await post(base, "/api/comfy/inspect", { graph: I2V })).json();
    assert.deepEqual(inspected.mediaSlots, [{ kind: "image", node: "52", input: "image", classType: "LoadImage", role: "first-frame" }]);
    const clip = await (await post(base, "/api/comfy/workflows", { id: "clip", graph: I2V, bind: { ...settled(I2V), refImage: undefined, inputs: inspected.mediaSlots.map(({ classType: _c, ...slot }: any) => slot) } })).json();
    assert.deepEqual(clip.workflow.bind.inputs, [{ kind: "image", role: "first-frame", node: "52", input: "image" }]);
    assert.deepEqual(clip.workflow.bind.refImage, { node: "52", input: "image" });
    assert.deepEqual(clip.media, { model: "comfy/clip", task: "image-to-video" });
    const wrong = await post(base, "/api/comfy/workflows", { id: "bad", graph: I2V, bind: { ...settled(I2V), inputs: [{ kind: "image", role: "source-audio", node: "52", input: "image" }] } });
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error.message, /image slot's role must be one of/);
  });

  it("explains an editor-format file where it is refused", async () => {
    const { base } = await setup(null);
    const res = await post(base, "/api/comfy/inspect", { graph: { last_node_id: 9, nodes: [{ id: 1, type: "KSampler" }], links: [], version: 0.4 } });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "COMFY_WORKFLOW_GRAPH_INVALID");
    assert.equal(body.error.hint, "ui-format");
    assert.match(body.error.message, /editor format/);
    assert.match(body.error.message, /Workflow > Export \(API\)/);
    assert.match(body.error.message, /PNG that ComfyUI saved/);
    assert.throws(() => parseApiGraph({ nodes: [] }), (e: any) => e.hint === "ui-format");
  });
});
