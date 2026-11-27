// The user's own ComfyUI as a media route (adapter comfy-local): registered workflows are
// models, files are uploaded into their slots, every kind of saved file comes back, and the
// estimate is this machine's own run time. A fake ComfyUI answers over real HTTP; nothing is paid.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const configDir = await mkdtemp(join(tmpdir(), "ima2-comfy-media-"));
process.env.IMA2_CONFIG_DIR = configDir;

const { config } = await import("../config.ts");
const { adapter } = await import("../lib/providers/media/local/comfy.ts");
const { estimateLocalRun, listLocalSpecs, recordLocalRun, syncLocalCatalog, workflowSpec, workflowTask } = await import("../lib/comfy/localCatalog.ts");
const { putWorkflow } = await import("../lib/comfyWorkflowStore.ts");
const { getMediaRegistry } = await import("../lib/providers/media/registry.ts");
const { registerComfyRoutes } = await import("../routes/comfy.ts");
const { registerMediaRoutes } = await import("../routes/media.ts");
const { registerMediaToolRoutes } = await import("../routes/mediaTools.ts");
const { FAKE_PNG, startFakeComfy } = await import("./_fakeComfyServer.ts");
import type { FakeComfy, FakeComfyOptions } from "./_fakeComfyServer.ts";
import { releaseDatabase } from "./helpers/releaseDatabase.ts";

(config.comfy as { pollIntervalMs: number }).pollIntervalMs = 500;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(40)]);
const closers: Array<() => Promise<void>> = [];

test.after(async () => {
  await releaseDatabase();
  await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
test.afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  await rm(join(configDir, "comfy"), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await writeFile(join(configDir, "config.json"), "{}");
  await syncLocalCatalog();
});

async function fakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
  const fake = await startFakeComfy(options);
  closers.push(() => fake.close());
  return fake;
}

const T2I = {
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, sampler_name: "euler", positive: ["6", 0], negative: ["7", 0] } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "stored prompt" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "stored negative" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ima2", images: ["3", 0] } },
};
const T2I_BIND = {
  prompt: { node: "6", input: "text" }, negativePrompt: { node: "7", input: "text" }, seed: { node: "3", input: "seed" },
  width: { node: "5", input: "width" }, height: { node: "5", input: "height" }, output: { node: "9" },
};
const T2I_PARAMS = [
  { name: "KSampler.steps", node: "3", input: "steps", type: "number" as const, default: 20, min: 1, max: 100 },
  { name: "KSampler.sampler_name", node: "3", input: "sampler_name", type: "string" as const, default: "euler", options: ["euler", "dpmpp_2m"] },
];
const TALK = {
  "1": { class_type: "LoadImage", inputs: { image: "face.png" } },
  "2": { class_type: "LoadAudio", inputs: { audio: "voice.mp3" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "9": { class_type: "SaveVideo", inputs: { video: ["8", 0], filename_prefix: "talk" } },
};
const TALK_BIND = {
  prompt: { node: "6", input: "text" }, output: { node: "9" },
  inputs: [{ role: "source-image" as const, kind: "image" as const, node: "1", input: "image" }, { role: "source-audio" as const, kind: "audio" as const, node: "2", input: "audio" }],
};

async function register(origin: string, id: string, extra: Record<string, unknown> = {}) {
  const record = await putWorkflow({ id, label: "My " + id, origin, graph: T2I, bind: T2I_BIND, params: T2I_PARAMS, ...extra } as never, { allowReplace: true });
  await syncLocalCatalog();
  return record;
}
const ctx = () => ({ apiKey: "", fetch: globalThis.fetch.bind(globalThis) as typeof fetch });

async function runToEnd(job: Awaited<ReturnType<typeof adapter.submit>>) {
  for (let i = 0; i < 40; i += 1) {
    const state = await adapter.poll(ctx(), job);
    if (state.status !== "queued" && state.status !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job did not finish");
}

test("a registered workflow is a model: comfy/<id>, its task read from the files it takes, no price", async () => {
  await register("http://127.0.0.1:8188", "klein");
  await register("http://127.0.0.1:8188", "talk", { graph: TALK, bind: TALK_BIND, params: [], mediaKind: "video" });
  await register("http://127.0.0.1:8188", "song", { mediaKind: "audio", bind: { prompt: T2I_BIND.prompt, output: T2I_BIND.output } });
  assert.deepEqual(listLocalSpecs().map((spec) => [spec.id, spec.kind, spec.tasks, spec.pricing.length]), [
    ["comfy/klein", "image", ["text-to-image"], 0], ["comfy/song", "audio", ["text-to-audio"], 0], ["comfy/talk", "video", ["avatar"], 0],
  ]);
  const klein = listLocalSpecs()[0]!;
  assert.deepEqual(klein.params, { seed: true, negativePrompt: true, options: [{ name: "KSampler.sampler_name", type: "enum", values: ["euler", "dpmpp_2m"] }] });
  assert.deepEqual(listLocalSpecs()[2]!.params.inputs, [{ role: "source-image", min: 1, max: 1 }, { role: "source-audio", min: 1, max: 1 }]);
  // The registry the server routes with sees the same models, without a restart.
  const registry = getMediaRegistry();
  assert.equal(registry.getModel("comfy/klein")?.candidates[0]?.adapter.id, "comfy-local");
  assert.equal(registry.getModel("comfy/gone"), undefined);
  // An older record with only refImage still declares its one file.
  const legacy = { mediaKind: "video" as const, bind: { prompt: T2I_BIND.prompt, output: T2I_BIND.output, refImage: { node: "1", input: "image" } } };
  assert.equal(workflowTask(legacy), "image-to-video");
  assert.deepEqual(workflowSpec({ ...(await register("http://127.0.0.1:8188", "old", { mediaKind: "video", bind: legacy.bind })) }).params.inputs, [{ role: "first-frame", min: 1, max: 1 }]);
});

test("a run binds the request into the graph, never the Comfy account key, and returns the saved image", async () => {
  const fake = await fakeComfy();
  await register(fake.origin, "klein");
  const job = await adapter.submit(ctx(), {
    model: "comfy/klein", task: "text-to-image", prompt: "a red fox", negativePrompt: "blur", seed: 7, resolution: "768x1344",
    vendorOptions: { "KSampler.steps": 8, "KSampler.sampler_name": "dpmpp_2m" }, inputs: [],
  });
  const sent = fake.prompts[0]!.body as { prompt: Record<string, { inputs: Record<string, unknown> }>; extra_data?: unknown };
  assert.deepEqual(
    [sent.prompt["6"]!.inputs.text, sent.prompt["7"]!.inputs.text, sent.prompt["3"]!.inputs.seed, sent.prompt["5"]!.inputs.width, sent.prompt["5"]!.inputs.height, sent.prompt["3"]!.inputs.steps, sent.prompt["3"]!.inputs.sampler_name],
    ["a red fox", "blur", 7, 768, 1344, 8, "dpmpp_2m"],
  );
  assert.equal(sent.extra_data, undefined, "no Comfy account key or token travels with the job");
  assert.deepEqual(job.resume, { origin: fake.origin, workflow: "klein", outputNode: "9" });
  const state = await runToEnd(job);
  assert.equal(state.status, "succeeded");
  const outputs = state.status === "succeeded" ? state.outputs : [];
  assert.deepEqual(outputs.map((out) => [out.kind, out.mimeType, out.bytes?.byteLength]), [["image", "image/png", FAKE_PNG.length]]);
});

test("files are uploaded into the slot of their role and the graph uses the name the server gave", async () => {
  const fake = await fakeComfy({
    outputs: { "9": { images: [{ filename: "talk_00001_.mp4", subfolder: "video", type: "output" }], animated: [true] }, "12": { audio: [{ filename: "talk.mp3", subfolder: "", type: "output" }] } },
    files: { "talk_00001_.mp4": MP4, "talk.mp3": MP3 },
  });
  await register(fake.origin, "talk", { graph: TALK, bind: TALK_BIND, params: [], mediaKind: "video" });
  const job = await adapter.submit(ctx(), { model: "comfy/talk", task: "avatar", prompt: "she smiles", inputs: [
    { role: "source-audio", bytes: new Uint8Array(MP3), mimeType: "audio/mpeg" },
    { role: "source-image", bytes: new Uint8Array(FAKE_PNG), mimeType: "image/png" },
  ] });
  assert.deepEqual(fake.uploads.map((upload) => [upload.type, upload.bytes, /^ima2_\d+_source-(image|audio)\.(png|mp3)$/.test(upload.name)]), [
    ["image/png", FAKE_PNG.length, true], ["audio/mpeg", MP3.length, true],
  ]);
  const graph = (fake.prompts[0]!.body as { prompt: Record<string, { inputs: Record<string, string> }> }).prompt;
  assert.equal(graph["1"]!.inputs.image, "stored_" + fake.uploads[0]!.name);
  assert.equal(graph["2"]!.inputs.audio, "stored_" + fake.uploads[1]!.name);
  const state = await runToEnd(job);
  // The bound node's file is what comes back; a video listed under "images" is still a video.
  assert.deepEqual(state.status === "succeeded" ? state.outputs.map((out) => [out.kind, out.mimeType]) : state, [["video", "video/mp4"]]);
});

test("a workflow with no text input runs as it is, and a prompt sent to it is refused instead of dropped", async () => {
  const fake = await fakeComfy();
  const graph = { "1": { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } }, "9": { class_type: "SaveImage", inputs: { filename_prefix: "ima2", images: ["1", 0] } } };
  await register(fake.origin, "blank", { graph, bind: { output: { node: "9" } }, params: [] });
  assert.deepEqual(listLocalSpecs().map((spec) => [spec.id, spec.tasks]), [["comfy/blank", ["text-to-image"]]]);
  const state = await runToEnd(await adapter.submit(ctx(), { model: "comfy/blank", task: "text-to-image", inputs: [] }));
  assert.equal(state.status, "succeeded");
  assert.deepEqual(fake.prompts[0]!.body.prompt, graph, "the graph is queued unchanged");
  await assert.rejects(() => adapter.submit(ctx(), { model: "comfy/blank", task: "text-to-image", prompt: "a fox", inputs: [] }), (error: unknown) => {
    const failure = error as { code?: string; message?: string };
    return failure.code === "COMFY_OPTION_INVALID" && /comfy\/blank takes no prompt: its workflow has no text input/.test(failure.message ?? "");
  });
  assert.equal(fake.prompts.length, 1, "the refused request queued nothing");
  // An empty prompt is no prompt.
  await runToEnd(await adapter.submit(ctx(), { model: "comfy/blank", task: "text-to-image", prompt: "", inputs: [] }));
  assert.equal(fake.prompts.length, 2);
});

test("a length in seconds reaches every input bound to it, and a workflow with none says its length is fixed", async () => {
  const fake = await fakeComfy();
  const graph = { "1": { class_type: "EmptyAudio", inputs: { duration: 30, sample_rate: 44100, channels: 2 } }, "2": { class_type: "Encoder", inputs: { duration: 30, tags: "stored" } },
    "9": { class_type: "SaveAudioMP3", inputs: { audio: ["1", 0], filename_prefix: "ima2" } } };
  const bind = { prompt: { node: "2", input: "tags" }, output: { node: "9" }, duration: { node: "1", input: "duration", also: [{ node: "2", input: "duration" }] } };
  await register(fake.origin, "song", { graph, bind, params: [], mediaKind: "audio", durationRange: { minSec: 1, maxSec: 600 } });
  await register(fake.origin, "jingle", { graph, bind: { prompt: bind.prompt, output: bind.output }, params: [], mediaKind: "audio" });
  await register(fake.origin, "frames", { graph, bind: { prompt: bind.prompt, output: bind.output, length: { node: "1", input: "duration" } }, params: [], mediaKind: "audio" });
  const specs = Object.fromEntries(listLocalSpecs().map((spec) => [spec.id, spec.params.durationRange]));
  assert.deepEqual(specs, { "comfy/frames": undefined, "comfy/jingle": undefined, "comfy/song": { minSec: 1, maxSec: 600 } });
  await runToEnd(await adapter.submit(ctx(), { model: "comfy/song", task: "text-to-audio", prompt: "soft piano", durationSec: 12, inputs: [] }));
  const queued = fake.prompts[0]!.body.prompt as Record<string, { inputs: Record<string, unknown> }>;
  assert.deepEqual([queued["1"]!.inputs.duration, queued["2"]!.inputs.duration], [12, 12]);
  // Without a length in the request the registered one stays.
  await runToEnd(await adapter.submit(ctx(), { model: "comfy/song", task: "text-to-audio", prompt: "soft piano", inputs: [] }));
  assert.equal((fake.prompts[1]!.body.prompt as typeof queued)["1"]!.inputs.duration, 30);
  for (const [request, pattern] of [
    [{ model: "comfy/song", durationSec: 900 }, /comfy\/song takes a length from 1 to 600 seconds/],
    [{ model: "comfy/jingle", durationSec: 12 }, /comfy\/jingle has a fixed length: its workflow has no length input bound/],
    // A video graph counts its length in frames: seconds are not converted behind the caller's back.
    [{ model: "comfy/frames", durationSec: 5 }, /comfy\/frames sets its length in frames: send vendorOptions\.length/],
  ] as const) {
    await assert.rejects(() => adapter.submit(ctx(), { task: "text-to-audio", prompt: "x", inputs: [], ...request }), (error: unknown) => {
      const failure = error as { code?: string; message?: string };
      return failure.code === "COMFY_OPTION_INVALID" && pattern.test(failure.message ?? "");
    });
  }
  assert.equal(fake.prompts.length, 2, "a refused request queues nothing");
});

test("an audio workflow returns audio", async () => {
  const fake = await fakeComfy({ outputs: { "9": { audio: [{ filename: "song.mp3", subfolder: "audio", type: "output" }] } }, files: { "song.mp3": MP3 } });
  await register(fake.origin, "song", { mediaKind: "audio", bind: { prompt: T2I_BIND.prompt, output: T2I_BIND.output }, params: [] });
  const state = await runToEnd(await adapter.submit(ctx(), { model: "comfy/song", task: "text-to-audio", prompt: "soft piano", inputs: [] }));
  assert.deepEqual(state.status === "succeeded" ? state.outputs.map((out) => [out.kind, out.mimeType]) : state, [["audio", "audio/mpeg"]]);
});

test("what cannot run is refused before anything is queued, with the reason", async () => {
  const fake = await fakeComfy();
  await register(fake.origin, "klein");
  await register(fake.origin, "talk", { graph: TALK, bind: TALK_BIND, params: [], mediaKind: "video" });
  await register(fake.origin, "paid", { paidNodes: ["KlingTextToVideoNode"] });
  const refuse = async (request: Record<string, unknown>, code: string, message: RegExp) => {
    await assert.rejects(() => adapter.submit(ctx(), { task: "text-to-image", inputs: [], ...request } as never), (error: unknown) => {
      const normalized = adapter.normalizeError(error);
      assert.equal(normalized.code, code);
      assert.equal(normalized.category, code === "COMFY_WORKFLOW_NOT_FOUND" ? "not-found" : "invalid-request");
      assert.match(normalized.message, message);
      return true;
    });
  };
  await refuse({ model: "comfy/klein", vendorOptions: { "KSampler.cfg": 3 } }, "COMFY_OPTION_INVALID", /Unknown option 'KSampler.cfg'/);
  await refuse({ model: "comfy/klein", vendorOptions: { "KSampler.steps": 500 } }, "COMFY_OPTION_INVALID", /between 1 and 100/);
  await refuse({ model: "comfy/klein", vendorOptions: { "KSampler.sampler_name": "nope" } }, "COMFY_OPTION_INVALID", /one of the workflow's choices/);
  await refuse({ model: "comfy/klein", resolution: "1080p" }, "COMFY_OPTION_INVALID", /WIDTHxHEIGHT/);
  await refuse({ model: "comfy/klein", vendorOptions: { length: 81 } }, "COMFY_OPTION_INVALID", /no length setting bound/);
  await refuse({ model: "comfy/talk", task: "avatar", inputs: [{ role: "source-image", bytes: new Uint8Array(FAKE_PNG), mimeType: "image/png" }] }, "COMFY_INPUT_INVALID", /takes 1 source-audio input, got 0/);
  await refuse({ model: "comfy/klein", inputs: [{ role: "reference-image", bytes: new Uint8Array(FAKE_PNG), mimeType: "image/png" }] }, "COMFY_INPUT_INVALID", /takes 0 reference-image inputs, got 1/);
  await refuse({ model: "comfy/gone" }, "COMFY_WORKFLOW_NOT_FOUND", /'gone' is not registered/);
  await refuse({ model: "comfy/paid" }, "COMFY_PAID_NODES", /KlingTextToVideoNode.*allowPaidNodes/);
  assert.equal(fake.prompts.length, 0);
  assert.equal(fake.uploads.length, 0);
  // Said outright, a workflow with paid nodes runs: the choice is the user's.
  await adapter.submit(ctx(), { model: "comfy/paid", task: "text-to-image", prompt: "x", vendorOptions: { allowPaidNodes: true }, inputs: [] });
  assert.equal(fake.prompts.length, 1);
});

test("a server taken off the allow list gets no job, and one that vanishes is retried, not failed at once", async () => {
  await writeFile(join(configDir, "config.json"), JSON.stringify({ comfyRemotes: { "https://comfy.example.com": {} } }));
  await register("https://comfy.example.com", "far");
  await writeFile(join(configDir, "config.json"), "{}");
  const calls: string[] = [];
  const spy = (async (input: RequestInfo | URL) => { calls.push(String(input)); throw new Error("must not be called"); }) as typeof fetch;
  await assert.rejects(() => adapter.submit({ apiKey: "", fetch: spy }, { model: "comfy/far", task: "text-to-image", prompt: "x", inputs: [] }),
    (error: unknown) => adapter.normalizeError(error).code === "COMFY_ORIGIN_NOT_ALLOWED");
  assert.deepEqual(calls, []);
  await register("http://127.0.0.1:9", "down");
  await assert.rejects(() => adapter.submit(ctx(), { model: "comfy/down", task: "text-to-image", prompt: "x", inputs: [] }), (error: unknown) => {
    const normalized = adapter.normalizeError(error);
    return normalized.code === "COMFY_OFFLINE" && normalized.retryable === true && normalized.category === "upstream";
  });
});

test("a job in progress polls as running, and a canceled one ends on the server", async () => {
  const fake = await fakeComfy({ hold: true });
  await register(fake.origin, "klein");
  const job = await adapter.submit(ctx(), { model: "comfy/klein", task: "text-to-image", prompt: "x", inputs: [] });
  assert.equal((await adapter.poll(ctx(), job)).status, "running");
  await adapter.cancel!(ctx(), job);
  assert.deepEqual(fake.canceledBy, ["jobs"]);
  assert.deepEqual(await adapter.poll(ctx(), job), { status: "canceled" });
});

test("the estimate is free, with the median of this machine's own runs or no time at all", async () => {
  await register("http://127.0.0.1:8188", "klein");
  assert.deepEqual(estimateLocalRun("klein"), { expectedSec: null, basis: "no runs yet", mayBill: false });
  for (const seconds of [4, 30, 6]) await recordLocalRun("klein", seconds);
  assert.deepEqual(estimateLocalRun("klein"), { expectedSec: 6, basis: "median of 3 runs on this machine", mayBill: false });
  await syncLocalCatalog();
  assert.equal(estimateLocalRun("klein").expectedSec, 6, "run times survive a restart");
  assert.deepEqual(adapter.estimateLocal!(listLocalSpecs()[0]!), estimateLocalRun("klein"));
  await register("http://127.0.0.1:8188", "paid", { paidNodes: ["KlingTextToVideoNode"] });
  assert.equal(estimateLocalRun("paid").mayBill, true);
});

test("through the server: registered, listed, priced as local, run, saved to history with its route", async () => {
  const fake = await fakeComfy();
  (config.comfy as { defaultUrl: string }).defaultUrl = fake.origin;
  const generatedDir = join(configDir, "generated-" + String(Date.now()));
  const ctxApp = { rootDir: configDir, packageVersion: "test", config: { ...config, storage: { ...config.storage, generatedDir }, log: { ...config.log, level: "silent" } } };
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerComfyRoutes(app, ctxApp as never);
  registerMediaToolRoutes(app, ctxApp as never, { deps: { thumbnails: false } });
  registerMediaRoutes(app, ctxApp as never, { thumbnails: false });
  const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = "http://127.0.0.1:" + String((server.address() as AddressInfo).port);
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const registered = await (await post("/api/comfy/workflows", { id: "klein", label: "Klein", graph: T2I, bind: T2I_BIND })).json();
  assert.deepEqual(registered.media, { model: "comfy/klein", task: "text-to-image" });
  const catalog = await (await fetch(base + "/api/media/catalog?kind=image")).json();
  const model = catalog.models.find((entry: { id: string }) => entry.id === "comfy/klein");
  assert.deepEqual([model.label, model.vendor, model.defaultRoute, model.routes[0].route, model.routes[0].keyless, model.routes[0].pricing], ["Klein", "comfy", "comfy-local", "local", true, []]);
  const estimate = await (await post("/api/media/estimate", { model: "comfy/klein", task: "text-to-image" })).json();
  assert.deepEqual([estimate.route, estimate.usd, estimate.local], ["local", 0, { expectedSec: null, basis: "no runs yet", mayBill: false }]);

  const submitted = await post("/api/media", { model: "comfy/klein", task: "text-to-image", prompt: "a red fox", requestId: "comfy-media-1" });
  assert.equal(submitted.status, 202);
  let job: { status?: string; meta?: Record<string, unknown> } | undefined;
  for (let i = 0; i < 100 && job?.status !== "completed" && job?.status !== "error"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const body = await (await fetch(base + "/api/media/jobs/comfy-media-1")).json();
    job = body.job;
  }
  assert.equal(job?.status, "completed", JSON.stringify(job));
  const saved = (await readdir(generatedDir)).filter((name) => name.endsWith(".png"));
  assert.equal(saved.length, 1);
  const sidecar = JSON.parse(await readFile(join(generatedDir, saved[0]! + ".json"), "utf8"));
  assert.deepEqual([sidecar.adapter, sidecar.route, sidecar.model, sidecar.prompt], ["comfy-local", "local", "comfy/klein", "a red fox"]);
  assert.deepEqual(sidecar.estimate, { usd: 0, basis: "exact" }, "a local result is recorded as costing nothing, not as unpriced");
  const after = await (await post("/api/media/estimate", { model: "comfy/klein", task: "text-to-image" })).json();
  assert.equal(typeof after.local.expectedSec, "number", "the run that just finished is the basis of the next estimate");
  assert.equal(after.local.basis, "median of 1 run on this machine");

  await fetch(base + "/api/comfy/workflows/klein", { method: "DELETE" });
  const gone = await (await fetch(base + "/api/media/catalog?kind=image")).json();
  assert.equal(gone.models.some((entry: { id: string }) => entry.id === "comfy/klein"), false, "a removed workflow leaves the catalog at once");
});
