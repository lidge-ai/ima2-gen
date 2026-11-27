// A saved result as a ComfyUI graph: the graph ComfyUI itself ran when the result came from ComfyUI,
// otherwise a small graph that makes the same request again through the ima2 node pack.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { ima2NodeGraph, resultGraph } from "../lib/comfy/resultGraph.js";

const RAN = { "6": { class_type: "CLIPTextEncode", inputs: { text: "a paper boat" } }, "9": { class_type: "SaveImage", inputs: { images: ["6", 0] } } };

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
}
/** A PNG that carries text chunks the way ComfyUI's SaveImage writes them. Pixels are irrelevant here. */
function png(text: Record<string, string> = {}): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)),
    ...Object.entries(text).map(([key, value]) => chunk("tEXt", Buffer.from(key + "\0" + value, "latin1"))), chunk("IEND", Buffer.alloc(0))]);
}

async function withResults(run: (dir: string, save: (name: string, bytes: Buffer, meta?: unknown) => Promise<void>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-result-graph-"));
  try {
    await run(dir, async (name, bytes, meta) => {
      await writeFile(join(dir, name), bytes);
      if (meta !== undefined) await writeFile(join(dir, name + ".json"), JSON.stringify(meta));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const TARGET = { origin: "http://127.0.0.1:8188", headers: {}, secrets: [] };
const deps = (dir: string, history: Record<string, unknown> | "down" = {}) => {
  const asked: string[] = [];
  return { asked, input: (filename: string) => ({
    filename, generatedDir: dir, timeoutMs: 1000,
    findWorkflow: async (id: string) => (id === "wan" ? { origin: TARGET.origin } : null),
    resolveTarget: async (origin: string) => (origin === TARGET.origin ? TARGET : null),
    fetchImpl: (async (url: string | URL | Request) => {
      asked.push(String(url));
      if (history === "down") throw new Error("connect ECONNREFUSED");
      return new Response(JSON.stringify(history), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  }) };
};

test("an image ComfyUI made answers with the graph inside it, without asking any server", async () => withResults(async (dir, save) => {
  await save("boat.png", png({ prompt: JSON.stringify(RAN) }), { provider: "media:comfy-local", model: "comfy/klein", mediaType: "image" });
  const { asked, input } = deps(dir);
  const result = await resultGraph(input("boat.png"));
  assert.equal(result.source, "embedded");
  assert.deepEqual(result.graph, RAN);
  assert.deepEqual(asked, []);
}));

test("a video ComfyUI made is looked up in that server's history by its job id", async () => withResults(async (dir, save) => {
  await save("clip.mp4", Buffer.from("not a png"), { provider: "media:comfy-local", model: "comfy/wan", mediaType: "video", providerJobId: "job-1" });
  const { asked, input } = deps(dir, { "job-1": { prompt: [3, "job-1", RAN, {}, ["9"]] } });
  const result = await resultGraph(input("clip.mp4"));
  assert.equal(result.source, "comfy-history");
  assert.deepEqual(result.graph, RAN);
  assert.deepEqual(asked, ["http://127.0.0.1:8188/history/job-1"]);
}));

test("when ComfyUI no longer has the job, or is off, or the workflow is gone, the answer says so instead of inventing a graph", async () => withResults(async (dir, save) => {
  const meta = { provider: "media:comfy-local", model: "comfy/wan", mediaType: "video", providerJobId: "job-1" };
  await save("clip.mp4", Buffer.from("x"), meta);
  await assert.rejects(resultGraph(deps(dir, {}).input("clip.mp4")), (error: Error & { code?: string; status?: number }) =>
    error.code === "COMFY_GRAPH_UNAVAILABLE" && error.status === 409 && /no longer has job job-1 in its history/.test(error.message));
  await assert.rejects(resultGraph(deps(dir, "down").input("clip.mp4")), (error: Error & { code?: string }) =>
    error.code === "COMFY_GRAPH_UNAVAILABLE" && /http:\/\/127\.0\.0\.1:8188 did not answer/.test(error.message));
  await save("gone.mp4", Buffer.from("x"), { ...meta, model: "comfy/removed" });
  await assert.rejects(resultGraph(deps(dir).input("gone.mp4")), (error: Error & { code?: string }) =>
    error.code === "COMFY_GRAPH_UNAVAILABLE" && /workflow 'removed' is no longer registered/.test(error.message));
}));

test("a result from a provider becomes an ima2 node with the same request, set to spend nothing until a person allows it", async () => withResults(async (dir, save) => {
  await save("fox.mp4", Buffer.from("x"), { generator: "media", provider: "media:fal", adapter: "fal", model: "bytedance/seedance-2", mediaType: "video",
    prompt: "a fox runs", media: { task: "image-to-video", durationSec: 5, resolution: "720p", aspectRatio: "16:9", seed: 7, audio: true, inputRoles: ["first-frame"] } });
  const result = await resultGraph(deps(dir).input("fox.mp4"));
  assert.equal(result.source, "ima2-node");
  assert.deepEqual(result.graph, {
    "1": { class_type: "Ima2MediaVideo", _meta: { title: "ima2 Video" }, inputs: {
      model: "bytedance/seedance-2", prompt: "a fox runs", max_usd: 0, seed: 7, send_seed: "yes", route: "fal", task: "image-to-video",
      resolution: "720p", aspect_ratio: "16:9", duration: 5, audio: "on" } },
    "2": { class_type: "SaveVideo", _meta: { title: "Save Video" }, inputs: { video: ["1", 0], filename_prefix: "video/ima2", format: "auto", "format.codec": "auto" } },
  });
  assert.ok(result.notes.some((note) => /ima2 for ComfyUI/.test(note)), "says which node pack it needs");
  assert.ok(result.notes.some((note) => /max_usd is 0/.test(note)), "says why it will not run as it is");
  assert.ok(result.notes.some((note) => /first-frame/.test(note)), "says which input files were not carried over");
}));

test("each kind of result gets its own node and save node, and settings the result did not use are left out", () => {
  const image = ima2NodeGraph({ model: "openai/gpt-image-2", mediaType: "image", prompt: "a cat", adapter: "openai", media: { task: "text-to-image", seed: null, resolution: null } });
  assert.deepEqual(image.graph["1"], { class_type: "Ima2MediaImage", _meta: { title: "ima2 Image" },
    inputs: { model: "openai/gpt-image-2", prompt: "a cat", max_usd: 0, seed: 0, send_seed: "no", route: "openai", task: "text-to-image" } });
  assert.deepEqual(image.graph["2"], { class_type: "SaveImage", _meta: { title: "Save Image" }, inputs: { images: ["1", 0], filename_prefix: "ima2" } });
  const audio = ima2NodeGraph({ model: "elevenlabs/eleven-v3", mediaType: "audio", prompt: "hello", adapter: "elevenlabs", media: { task: "text-to-audio", durationSec: 12 } });
  assert.equal(audio.graph["1"]!.class_type, "Ima2MediaAudio");
  assert.equal(audio.graph["1"]!.inputs.duration, 12);
  assert.deepEqual(audio.graph["2"], { class_type: "SaveAudioMP3", _meta: { title: "Save Audio (MP3)" }, inputs: { audio: ["1", 0], filename_prefix: "audio/ima2", quality: "V0" } });
  assert.equal("audio" in ima2NodeGraph({ model: "x/y", mediaType: "video", prompt: "", media: { task: "text-to-video", audio: null } }).graph["1"]!.inputs, false);
});

test("a result made by ima2's own image lane becomes the original Ima2 Generate node", async () => withResults(async (dir, save) => {
  await save("cat.png", png(), { provider: "oauth", prompt: "a cat", size: "1536x1024", quality: "high" });
  const result = await resultGraph(deps(dir).input("cat.png"));
  assert.equal(result.source, "ima2-node");
  assert.deepEqual(result.graph["1"], { class_type: "Ima2Generate", _meta: { title: "Ima2 Generate" },
    inputs: { prompt: "a cat", server_url: "", quality: "high", size: "1536x1024", moderation: "low", timeout: 180 } });
}));

test("only a file in the results folder is read, and one with no record cannot be rebuilt", async () => withResults(async (dir, save) => {
  for (const name of ["../secret.png", "a/b.png", "C:\\x.png", ""]) {
    await assert.rejects(resultGraph(deps(dir).input(name)), (error: Error & { code?: string; status?: number }) => error.code === "COMFY_IMAGE_INVALID" && error.status === 400);
  }
  await assert.rejects(resultGraph(deps(dir).input("missing.png")), (error: Error & { status?: number }) => error.status === 404);
  await save("bare.mp4", Buffer.from("x"));
  await assert.rejects(resultGraph(deps(dir).input("bare.mp4")), (error: Error & { code?: string }) => error.code === "COMFY_GRAPH_UNAVAILABLE");
}));

