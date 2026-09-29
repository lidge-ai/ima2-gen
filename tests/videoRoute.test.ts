import test, { before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { GROK_DIRECT_ORIGIN, openVideoFixture } from "./_videoExecutionFixture.ts";
import { fakeMp4Bytes } from "./_videoStreamFixture.ts";
if (executionTestProcess(import.meta.url)) {
type VideoFixture = Awaited<ReturnType<typeof openVideoFixture>>;
let fixture: VideoFixture;
let config: VideoFixture["config"];
let registerVideoRoutes: typeof import("../routes/video.ts").registerVideoRoutes;
let saveGeneratedVideoArtifact: typeof import("../routes/video.ts").saveGeneratedVideoArtifact;
let replaySince: typeof import("../lib/eventBus.ts").replaySince;
before(async () => {
  fixture = await openVideoFixture({ codec: true });
  config = fixture.config;
  ({ registerVideoRoutes, saveGeneratedVideoArtifact } = await import("../routes/video.js"));
  ({ replaySince } = await import("../lib/eventBus.js"));
});
beforeEach(() => { fixture.beginCase(); });
afterEach(async () => { await fixture?.finishCase(); });
after(async () => { await fixture?.close(); });
const proxyOptions = new WeakMap<import("node:http").Server, ProxyOptions>();
type ProxyOptions = {
  failFirstGeneration?: boolean; captureStart?: (body: any) => void;
  downloadCase?: "invalid-mp4" | "declared-too-large";
};
async function listen(server: import("node:http").Server): Promise<string> {
  const origin = await fixture.listen(server, "proxy");
  fixture.bridgeProxy(server, (call) => {
    const target = new URL(call.url);
    assert.equal(target.search, "");
    assert.equal(call.headers.get("cookie"), null);
    if (target.pathname === "/dl/v.mp4") {
      assert.equal(target.origin, origin, "the artifact stays on the owned mock origin");
      assert.equal(call.method, "GET");
      assert.equal(call.body, "");
      assert.equal(call.headers.get("authorization"), null);
      return;
    }
    assert.equal(target.origin, GROK_DIRECT_ORIGIN, "authenticated video calls leave for xAI directly");
    assert.equal(call.headers.get("authorization"), fixture.grokBearer);
    if (target.pathname === "/v1/videos/vid-xyz") {
      assert.equal(call.method, "GET");
      assert.equal(call.body, "");
      return;
    }
    assert.ok(["/v1/responses", "/v1/chat/completions", "/v1/videos/generations"].includes(target.pathname));
    assert.equal(call.method, "POST");
    assert.equal(call.headers.get("content-type"), "application/json");
    const body = JSON.parse(call.body);
    assert.ok(body && typeof body === "object" && !Array.isArray(body));
    assert.equal(typeof body.model, "string");
    if (target.pathname === "/v1/videos/generations") {
      assert.equal(typeof body.prompt, "string");
      proxyOptions.get(server)?.captureStart?.(body);
    } else {
      assert.ok(Array.isArray(target.pathname === "/v1/responses" ? body.input : body.messages));
    }
  }, "/dl/v.mp4");
  return origin;
}

function artifactReply(res: import("node:http").ServerResponse, kind?: ProxyOptions["downloadCase"]): void {
  res.writeHead(200, { "Content-Type": "video/mp4",
    ...(kind === "declared-too-large" ? { "Content-Length": "104857601" } : {}) });
  if (kind === "declared-too-large") { res.flushHeaders(); return; }
  res.end(kind === "invalid-mp4" ? Buffer.from("invalid MP4 bytes") : fakeMp4Bytes());
}
// Mock xAI upstream: search -> planner -> start -> poll(done) -> download.
function makeProxy(options: ProxyOptions = {}) {
  let polls = 0;
  let starts = 0;
  const server = createServer((req, res) => {
    const url = req.url || "";
    if (url === "/v1/responses") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "text", text: "brief" }] }] }));
    }
    if (url === "/v1/chat/completions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "english clip" }) } }] } }] }));
    }
    if (url === "/v1/videos/generations") {
      req.resume();
      req.on("end", () => {
        starts += 1;
        if (options.failFirstGeneration && starts === 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "`reference_images` is not supported for this model." }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ request_id: "vid-xyz" }));
      });
      return;
    }
    if (url === "/v1/videos/vid-xyz") {
      polls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      const port = (server.address() as any).port;
      if (!options.downloadCase && polls < 2) return res.end(JSON.stringify({ status: "pending", progress: 50 }));
      return res.end(JSON.stringify({ status: "done", progress: 100, video: { url: `http://127.0.0.1:${port}/dl/v.mp4`, duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 500000000 } }));
    }
    if (url === "/dl/v.mp4") {
      return artifactReply(res, options.downloadCase);
    }
    res.writeHead(404);
    res.end("nope");
  });
  proxyOptions.set(server, options);
  return server;
}

async function videoApp(generatedDir) {
  const app = express();
  fixture.trackApp(app);
  app.use(express.json({ limit: "8mb" }));
  registerVideoRoutes(app, {
    rootDir: fixture.root,
    packageVersion: "test",
    grokAuthHomeDir: fixture.grokAuthHomeDir,
    config: {
      ...config,
      storage: { ...config.storage, generatedDir },
      grokProvider: { ...config.grokProvider, videoPollIntervalMs: 1, videoStartTimeoutMs: 5000, videoTimeoutMs: 30000, videoDownloadTimeoutMs: 5000, plannerTimeoutMs: 5000 },
    },
  });
  const server = createServer(app);
  const url = await fixture.listen(server, "app");
  return { server, url };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    const ev = /event: (.+)/.exec(block);
    const data = /data: (.+)/.exec(block);
    if (ev && data) events.push({ event: ev[1].trim(), data: JSON.parse(data[1]) });
  }
  return events;
}

for (const downloadCase of ["invalid-mp4", "declared-too-large"] as const) {
  test(`/api/video/generate ${downloadCase}: error on both channels, no persistence or retry`, async () => {
    const generatedDir = await mkdtemp(join(fixture.root, "generate-rejected-"));
    try {
      await listen(makeProxy({ downloadCase }));
      const { url } = await videoApp(generatedDir);
      const requestId = `rejected-${downloadCase}`;
      const res = await fixture.fetchApp(`${url}/api/video/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "animate a cube", provider: "grok",
          model: "grok-imagine-video", duration: 1, resolution: "480p", requestId }),
      });
      assert.equal(res.status, 200, "legacy SSE keeps HTTP 200; error carries status");
      assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
      const streamed = parseSse(await res.text());
      await fixture.drain();
      const bus = replaySince(0).filter((event) => event.jobId === requestId);
      for (const events of [streamed, bus]) {
        assert.equal(events.filter((event) => event.event === "done").length, 0);
        const errors = events.filter((event) => event.event === "error");
        assert.equal(errors.length, 1);
        assert.equal(errors[0].data.status, 502);
        assert.equal(errors[0].data.code, "GROK_VIDEO_DOWNLOAD_FAILED");
        assert.equal(errors[0].data.requestId, requestId);
        assert.equal(errors[0].data.error, downloadCase === "invalid-mp4"
          ? "Grok video download returned an invalid MP4 container"
          : "Grok video download exceeds the 100MB limit");
      }
      for (const path of ["/v1/videos/generations", "/v1/videos/vid-xyz", "/dl/v.mp4"])
        assert.equal(fixture.calls.filter((call) => new URL(call.url).pathname === path).length, 1, path);
      assert.deepEqual(await readdir(generatedDir), [], "no video, sidecar or thumbnail");
      assert.deepEqual(fixture.violations, [], "artifact arrayBuffer and bridge validation remain clean");
    } finally {
      await fixture.finishCase();
      await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

test("/api/video/generate streams progress and saves mp4 + sidecar", async () => {
  const proxy = makeProxy();
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "animate a cube", provider: "grok", model: "grok-imagine-video", duration: 1, resolution: "480p", requestId: "req_video_ok" }),
    });
    const events = parseSse(await res.text());
    const kinds = events.map((e) => e.event);
    assert.ok(kinds.includes("planning"), "has planning");
    assert.ok(kinds.includes("submitted"), "has submitted");
    assert.ok(kinds.includes("progress"), "has progress");
    const done = events.find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.match(done.data.filename, /\.mp4$/);
    assert.equal(done.data.mediaType, "video");
    assert.equal(done.data.video.xaiVideoRequestId, "vid-xyz");
    assert.equal(done.data.videoContinuity.entries.length, 1);
    assert.equal(done.data.videoContinuity.entries[0].revisedPrompt, "english clip");
    assert.equal(done.data.requestedModel, "grok-imagine-video");
    assert.equal(done.data.effectiveModel, "grok-imagine-video");
    assert.equal(done.data.modelFallback, null);
    const files = await readdir(generatedDir);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    assert.ok(mp4, "mp4 written");
    assert.ok(files.includes(`${mp4}.json`), "sidecar written");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${mp4}.json`), "utf8"));
    assert.equal(sidecar.model, "grok-imagine-video");
    assert.equal(sidecar.requestedModel, "grok-imagine-video");
    assert.equal(sidecar.effectiveModel, "grok-imagine-video");
    assert.equal(sidecar.modelFallback, null);
    assert.equal(sidecar.video.requestedModel, "grok-imagine-video");
    assert.equal(sidecar.video.effectiveModel, "grok-imagine-video");
    assert.equal(sidecar.video.modelFallback, null);
    // Persist resolved mode after the inflight job disappears (#172).
    assert.equal(sidecar.video.mode, "text-to-video");
    assert.equal(sidecar.video.refsCount, 0);
    assert.equal(sidecar.videoContinuity.entries[0].revisedPrompt, "english clip");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate records image-to-video mode when a reference is given", async () => {
  const proxy = makeProxy({});
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-i2v-"));
  const { url } = await videoApp(generatedDir);
  try {
    // A single opening-frame reference selects image-to-video.
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "animate this still", provider: "grok", model: "grok-imagine-video", duration: 1, resolution: "480p", sourceImage: png, requestId: "req_video_i2v" }),
    });
    const events = parseSse(await res.text());
    const done = events.find((e) => e.event === "done");
    assert.ok(done, "has done");
    const files = await readdir(generatedDir);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    assert.ok(mp4, "mp4 written");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${mp4}.json`), "utf8"));
    // The whole point of #172: this is what tells i2v from t2v after the fact.
    assert.equal(sidecar.video.mode, "image-to-video");
    assert.equal(sidecar.video.refsCount, 1);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate uses configured Grok Video 1.5 default when model is omitted", async () => {
  let startBody: any = null;
  const proxy = makeProxy({ captureStart: (body) => { startBody = body; } });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-default-model-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "animate the source image", provider: "grok", sourceImage: Buffer.from("img").toString("base64"), duration: 1, resolution: "480p", }),
    });
    const events = parseSse(await res.text());
    assert.ok(events.some((event) => event.event === "done"), "has done");
    assert.equal(startBody?.model, "grok-imagine-video-1.5");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate exposes fallback model metadata for 1.5 Ref2V", async () => {
  const proxy = makeProxy({ failFirstGeneration: true });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-fallback-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue the character motion", provider: "grok", model: "grok-imagine-video-1.5-preview", referenceImages: ["A", "B"], duration: 10, resolution: "720p", requestId: "req_video_fallback", }),
    });
    const events = parseSse(await res.text());
    const fallback = { from: "grok-imagine-video-1.5", to: "grok-imagine-video" };
    const submitted = events.find((e) => e.event === "submitted");
    const done = events.find((e) => e.event === "done");
    assert.ok(submitted, "has submitted");
    assert.ok(done, "has done");
    assert.equal(submitted.data.requestedModel, "grok-imagine-video-1.5");
    assert.equal(submitted.data.effectiveModel, "grok-imagine-video");
    assert.deepEqual(submitted.data.modelFallback, fallback);
    assert.equal(done.data.requestedModel, "grok-imagine-video-1.5");
    assert.equal(done.data.effectiveModel, "grok-imagine-video");
    assert.deepEqual(done.data.modelFallback, fallback);
    assert.equal(done.data.video.requestedModel, "grok-imagine-video-1.5");
    assert.equal(done.data.video.effectiveModel, "grok-imagine-video");
    assert.deepEqual(done.data.video.modelFallback, fallback);
    const files = await readdir(generatedDir);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    assert.ok(mp4, "mp4 written");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${mp4}.json`), "utf8"));
    assert.equal(sidecar.model, "grok-imagine-video");
    assert.equal(sidecar.requestedModel, "grok-imagine-video-1.5");
    assert.equal(sidecar.effectiveModel, "grok-imagine-video");
    assert.deepEqual(sidecar.modelFallback, fallback);
    assert.equal(sidecar.video.requestedModel, "grok-imagine-video-1.5");
    assert.equal(sidecar.video.effectiveModel, "grok-imagine-video");
    assert.deepEqual(sidecar.video.modelFallback, fallback);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate accepts Grok Video 1.5 image-to-video 1080p", async () => {
  let startBody: any = null;
  const proxy = makeProxy({ captureStart: (body) => { startBody = body; } });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-1080-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "animate the source image", provider: "grok", model: "grok-imagine-video-1.5-preview", sourceImage: Buffer.from("img").toString("base64"), duration: 5, resolution: "1080p", requestId: "req_video_1080p_i2v", }),
    });
    const done = parseSse(await res.text()).find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.equal(startBody.model, "grok-imagine-video-1.5");
    assert.equal(startBody.resolution, "1080p");
    assert.ok(startBody.image?.url?.startsWith("data:image/"));
    assert.equal(done.data.requestedModel, "grok-imagine-video-1.5");
    assert.equal(done.data.video.resolution, "1080p");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate accepts Grok Video 1.5 prompt-only 1080p via canvas shim", async () => {
  let startBody: any = null;
  const proxy = makeProxy({ captureStart: (body) => { startBody = body; } });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-1080-t2v-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "make a freeform clip", provider: "grok", model: "grok-imagine-video-1.5-preview", duration: 5, resolution: "1080p", requestId: "req_video_1080p_t2v", }),
    });
    const done = parseSse(await res.text()).find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.equal(startBody.model, "grok-imagine-video-1.5");
    assert.equal(startBody.resolution, "1080p");
    assert.ok(startBody.image?.url?.startsWith("data:image/png;base64,"));
    assert.match(startBody.prompt, /blank white canvas.*technical placeholder/);
    assert.equal(done.data.video.resolution, "1080p");
    assert.equal(done.data.video.requestedModel, "grok-imagine-video-1.5");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("saveGeneratedVideoArtifact removes mp4 when sidecar write fails", async () => {
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-sidecar-fail-"));
  const filename = "broken.mp4";
  try {
    await mkdir(join(generatedDir, `${filename}.json`));
    await assert.rejects(
      saveGeneratedVideoArtifact(
        { config: { ...config, storage: { ...config.storage, generatedDir } } } as any,
        filename,
        fakeMp4Bytes(),
        { kind: "video", mediaType: "video" },
      ),
    );
    await assert.rejects(access(join(generatedDir, filename)), (err: any) => err?.code === "ENOENT");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate continueFromVideo extracts parent frame and stores branch lineage", async (t) => {
  if (!fixture.ffmpeg?.available) { await fixture.finishCase(); t.skip("ffmpeg is not installed in this environment"); return; }
  const firstAttempt = fixture.ffmpeg.attempts.length;
  const proxy = makeProxy();
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-continue-"));
  const parent = "parent.mp4";
  await fixture.ffmpeg.createClip(join(generatedDir, parent), "green");
  await writeFile(join(generatedDir, `${parent}.json`), JSON.stringify({
    kind: "video",
    mediaType: "video",
    prompt: "first user prompt",
    userPrompt: "first user prompt",
    revisedPrompt: "First revised video prompt with rain ending.",
    createdAt: 1,
  }));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue from the last frame, footsteps only, no dialogue, end on closed door", provider: "grok", continueFromVideo: parent, duration: 1, resolution: "480p", requestId: "req_video_continue", }),
    });
    const done = parseSse(await res.text()).find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.equal(done.data.videoContinuity.entries.length, 2);
    assert.equal(done.data.videoContinuity.entries[0].revisedPrompt, "First revised video prompt with rain ending.");
    assert.equal(done.data.videoContinuity.entries[1].revisedPrompt, "english clip");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${done.data.filename}.json`), "utf8"));
    assert.equal(sidecar.videoContinuity.entries.length, 2);
    await fixture.drain();
    const attempts = fixture.ffmpeg.attempts.slice(firstAttempt).filter((attempt) => attempt.code === 0);
    assert.equal(attempts.filter((attempt) => attempt.args.includes("lavfi")).length, 1);
    assert.equal(attempts.filter((attempt) => attempt.input).length, 1);
    assert.ok(attempts.every((attempt) => attempt.pid && attempt.closed && attempt.callbackDone));
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate accepts the comfy lane and refuses grok-only options", async () => {
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-comfy-"));
  const { url } = await videoApp(generatedDir);
  try {
    // Comfy-specific rejection proves the lane remains reachable.
    const unknown = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a clip", provider: "comfy", model: "not-registered" }),
    })).text());
    const unknownError = unknown.find((e) => e.event === "error")?.data;
    assert.notEqual(unknownError.code, "VIDEO_PROVIDER_UNSUPPORTED");
    assert.equal(unknownError.code, "COMFY_WORKFLOW_NOT_FOUND");
    const noModel = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a clip", provider: "comfy" }),
    })).text());
    assert.equal(noModel.find((e) => e.event === "error")?.data.code, "COMFY_WORKFLOW_REQUIRED");
    // Grok-only axes must not silently disappear in the Comfy lane.
    const storyboard = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a clip", provider: "comfy", model: "wf", storyboard: true }),
    })).text());
    const sbError = storyboard.find((e) => e.event === "error")?.data;
    assert.equal(sbError.code, "COMFY_VIDEO_OPTION_UNSUPPORTED");
    assert.match(sbError.error, /storyboard/);
    const oauth = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", provider: "oauth" }),
    })).text());
    assert.equal(oauth.find((e) => e.event === "error")?.data.code, "VIDEO_PROVIDER_UNSUPPORTED");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/generate rejects non-grok provider and bad params", async () => {
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-"));
  const { url } = await videoApp(generatedDir);
  try {
    const badProvider = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "oauth" }) })).text());
    assert.equal(badProvider.find((e) => e.event === "error")?.data.code, "VIDEO_PROVIDER_UNSUPPORTED");
    const noPrompt = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "grok" }) })).text());
    const promptError = noPrompt.find((e) => e.event === "error")?.data;
    assert.equal(promptError.code, "PROMPT_REQUIRED");
    assert.match(promptError.guidance, /Active video prompt required/);
    const badRes = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "grok", resolution: "8k" }) })).text());
    assert.equal(badRes.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
    const badBase1080 = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "grok", model: "grok-imagine-video", sourceImage: Buffer.from("img").toString("base64"), resolution: "1080p" }) })).text());
    assert.equal(badBase1080.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
    const badRef1080 = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "grok", model: "grok-imagine-video-1.5", referenceImages: ["A", "B"], resolution: "1080p" }) })).text());
    assert.equal(badRef1080.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

}
