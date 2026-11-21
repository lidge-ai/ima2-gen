import test, { before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openVideoFixture } from "./_videoExecutionFixture.ts";
import { createVideoRouteHarness } from "./_videoRouteHarness.ts";
if (executionTestProcess(import.meta.url)) {
type VideoFixture = Awaited<ReturnType<typeof openVideoFixture>>;
let fixture: VideoFixture;
let config: VideoFixture["config"];
let registerVideoRoutes: typeof import("../routes/video.ts").registerVideoRoutes;
before(async () => {
  fixture = await openVideoFixture({ codec: true });
  config = fixture.config;
  ({ registerVideoRoutes } = await import("../routes/video.js"));
});
beforeEach(() => { fixture.beginCase(); });
afterEach(async () => { await fixture?.finishCase(); });
after(async () => { await fixture?.close(); });
const { listen, makeProxy, videoApp, parseSse } = createVideoRouteHarness(() => ({ fixture, config, registerVideoRoutes }));
const post = (url: string, body: Record<string, unknown>) => fixture.fetchApp(`${url}/api/video/generate`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("/api/video/generate pins frames on 1.5 as reference-to-video and refuses pinned 1080p before any start", async () => {
  const starts: any[] = [];
  const proxy = makeProxy({ captureStart: (body) => { starts.push(body); } });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-route-pins-"));
  const { url } = await videoApp(generatedDir);
  const png = Buffer.from("img").toString("base64");
  const body = (resolution: string) => JSON.stringify({ prompt: "walk to the door", provider: "grok", model: "grok-imagine-video-1.5", sourceImage: png, lastFrame: png, keyframes: [{ image: png, timestampS: 1 }], duration: 3, resolution, requestId: `req_video_pins_${resolution}` });
  try {
    const rejected = parseSse(await (await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("1080p") })).text());
    assert.equal(rejected.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
    assert.equal(starts.length, 0);
    const res = await fixture.fetchApp(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("720p") });
    assert.ok(parseSse(await res.text()).some((e) => e.event === "done"), "has done");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].resolution, "720p");
    assert.ok(starts[0].image?.url?.startsWith("data:image/"));
    assert.ok(starts[0].last_frame?.url?.startsWith("data:image/"));
    assert.equal(starts[0].keyframes?.[0]?.timestamp_s, 1);
    assert.equal("reference_images" in starts[0], false);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("planner off sends the composed prompt with zero planner or search calls and one start", async () => {
  const paths: string[] = []; const starts: any[] = [];
  await listen(makeProxy({ onPath: (path) => paths.push(path), captureStart: (body) => starts.push(body) }));
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-planner-off-"));
  const { url } = await videoApp(generatedDir);
  try {
    const events = parseSse(await (await post(url, { prompt: "a red kite over the sea", provider: "grok", model: "grok-imagine-video-1.5", planner: "off", duration: 2, requestId: "req_planner_off" })).text());
    assert.ok(events.some((e) => e.event === "done"), "has done");
    assert.equal(paths.filter((p) => p === "/v1/responses" || p === "/v1/chat/completions").length, 0);
    assert.equal(starts.length, 1);
    assert.match(starts[0].prompt, /a red kite over the sea/);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

for (const [label, extra] of [["continuation lineage", { continuityLineage: { entries: [{ prompt: "earlier shot", revisedPrompt: "earlier shot" }] } }], ["a background constraint", { backgroundPreset: "white" }]] as const) {
  test(`planner off is refused before any upstream call with ${label}`, async () => {
    const paths: string[] = [];
    await listen(makeProxy({ onPath: (path) => paths.push(path) }));
    const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-planner-off-refused-"));
    const { url } = await videoApp(generatedDir);
    try {
      const events = parseSse(await (await post(url, { prompt: "continue", provider: "grok", model: "grok-imagine-video-1.5", planner: "off", duration: 2, requestId: `req_planner_off_${label.length}`, ...extra })).text());
      assert.equal(events.find((e) => e.event === "error")?.data.code, "GROK_VIDEO_PLANNER_OFF_UNSUPPORTED");
      assert.deepEqual(paths, []);
    } finally {
      await fixture.finishCase();
      await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
test("a voice on the base video model is refused before any upstream call", async () => {
  const paths: string[] = [];
  await listen(makeProxy({ onPath: (path) => paths.push(path) }));
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-base-voice-"));
  const { url } = await videoApp(generatedDir);
  try {
    const events = parseSse(await (await post(url, { prompt: "say hello", provider: "grok", model: "grok-imagine-video", referenceAudios: ["eve"], duration: 2, requestId: "req_base_voice" })).text());
    assert.equal(events.find((e) => e.event === "error")?.data.code, "GROK_VIDEO_AUDIO_UNSUPPORTED_MODEL");
    assert.deepEqual(paths, []);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
for (const [label, extra] of [["a voice", { referenceAudios: ["eve"] }], ["a composer reference", { referenceImages: [Buffer.from("ref").toString("base64")] }]] as const) {
  test(`a provider URL with ${label} stays reference-to-video: 1080p refused before planning, 720p pins the URL`, async () => {
    const paths: string[] = []; const starts: any[] = [];
    await listen(makeProxy({ onPath: (path) => paths.push(path), captureStart: (body) => starts.push(body) }));
    const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-provider-url-r2v-"));
    const { url } = await videoApp(generatedDir);
    const source = "https://provider.example/frame.png";
    const body = (resolution: string) => ({ prompt: "say hello", provider: "grok", model: "grok-imagine-video-1.5", providerUrl: source, duration: 2, resolution, requestId: `req_url_r2v_${label.length}_${resolution}`, ...extra });
    try {
      const rejected = parseSse(await (await post(url, body("1080p"))).text());
      assert.equal(rejected.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
      assert.deepEqual(paths, []);
      const events = parseSse(await (await post(url, body("720p"))).text());
      assert.ok(events.some((e) => e.event === "done"), "has done");
      assert.equal(starts.length, 1);
      assert.equal(starts[0].image?.url, source);
      assert.equal(starts[0].resolution, "720p");
      if ("referenceAudios" in extra) assert.deepEqual(starts[0].reference_audios, [{ voice_id: "eve" }]);
      else assert.equal(starts[0].reference_images?.length, 1);
    } finally {
      await fixture.finishCase();
      await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
for (const named of ["text-to-video", "image-to-video"] as const) {
  test(`a voice keeps reference-to-video over an explicit ${named}: 1080p refused before any upstream call`, async () => {
    const paths: string[] = [];
    await listen(makeProxy({ onPath: (path) => paths.push(path) }));
    const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-voice-named-mode-"));
    const { url } = await videoApp(generatedDir);
    try {
      const events = parseSse(await (await post(url, { prompt: "say hello", provider: "grok", model: "grok-imagine-video-1.5", mode: named, referenceAudios: ["eve"], duration: 2, resolution: "1080p", requestId: `req_voice_named_${named}` })).text());
      assert.equal(events.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
      assert.deepEqual(paths, []);
    } finally {
      await fixture.finishCase();
      await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
for (const blank of ["", "   "]) {
  test(`a blank keyframe image (${JSON.stringify(blank)}) is refused before any upstream call`, async () => {
    const paths: string[] = [];
    await listen(makeProxy({ onPath: (path) => paths.push(path) }));
    const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-blank-keyframe-"));
    const { url } = await videoApp(generatedDir);
    try {
      const events = parseSse(await (await post(url, { prompt: "walk to the door", provider: "grok", model: "grok-imagine-video-1.5", keyframes: [{ image: blank, timestampS: 1 }], duration: 3, resolution: "720p", requestId: `req_blank_keyframe_${blank.length}` })).text());
      assert.equal(events.find((e) => e.event === "error")?.data.code, "GROK_VIDEO_KEYFRAMES_INVALID");
      assert.deepEqual(paths, []);
    } finally {
      await fixture.finishCase();
      await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
test("an explicit reference-to-video whose only image becomes the pinned first frame is refused before any upstream call", async () => {
  const paths: string[] = [];
  await listen(makeProxy({ onPath: (path) => paths.push(path) }));
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-r2v-source-only-"));
  const { url } = await videoApp(generatedDir);
  try {
    const events = parseSse(await (await post(url, { prompt: "walk to the door", provider: "grok", model: "grok-imagine-video-1.5", mode: "reference-to-video", sourceImage: Buffer.from("img").toString("base64"), duration: 2, resolution: "720p", requestId: "req_r2v_source_only" })).text());
    assert.equal(events.find((e) => e.event === "error")?.data.code, "GROK_VIDEO_INVALID_MODE");
    assert.deepEqual(paths, []);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test("an explicit image-to-video without any source is refused before any upstream call", async () => {
  const paths: string[] = [];
  await listen(makeProxy({ onPath: (path) => paths.push(path) }));
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-i2v-no-source-"));
  const { url } = await videoApp(generatedDir);
  try {
    const events = parseSse(await (await post(url, { prompt: "walk to the door", provider: "grok", model: "grok-imagine-video-1.5", mode: "image-to-video", duration: 2, resolution: "720p", requestId: "req_i2v_no_source" })).text());
    assert.equal(events.find((e) => e.event === "error")?.data.code, "GROK_VIDEO_INVALID_MODE");
    assert.deepEqual(paths, []);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
}
