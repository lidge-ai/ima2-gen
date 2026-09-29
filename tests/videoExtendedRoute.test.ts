import test, { before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { GROK_DIRECT_ORIGIN, openVideoFixture } from "./_videoExecutionFixture.ts";
import { fakeMp4Bytes } from "./_videoStreamFixture.ts";

if (executionTestProcess(import.meta.url)) {
type VideoFixture = Awaited<ReturnType<typeof openVideoFixture>>;
let fixture: VideoFixture;
let config: VideoFixture["config"];
let registerVideoExtendedRoutes: typeof import("../routes/videoExtended.ts").registerVideoExtendedRoutes;
before(async () => {
  fixture = await openVideoFixture({ codec: true });
  config = fixture.config;
  ({ registerVideoExtendedRoutes } = await import("../routes/videoExtended.js"));
});
beforeEach(() => { fixture.beginCase(); });
afterEach(async () => { await fixture?.finishCase(); });
after(async () => { await fixture?.close(); });

type ProxyOptions = {
  operation?: "edit" | "extend"; blocked?: boolean; blockedWithoutUrl?: boolean;
  responseText?: string; capture?: (url: string, body: any) => void;
  downloadCase?: "invalid-mp4" | "declared-too-large";
};
const proxyOptions = new WeakMap<import("node:http").Server, ProxyOptions>();
async function listen(server: import("node:http").Server): Promise<string> {
  const origin = await fixture.listen(server, "proxy");
  fixture.bridgeProxy(server, (call) => {
    const target = new URL(call.url);
    assert.equal(target.search, "");
    assert.equal(call.headers.get("cookie"), null);
    if (target.pathname === "/dl/out.mp4") {
      assert.equal(target.origin, origin, "the artifact stays on the owned mock origin");
      assert.equal(call.method, "GET");
      assert.equal(call.body, "");
      assert.equal(call.headers.get("authorization"), null);
      return;
    }
    assert.equal(target.origin, GROK_DIRECT_ORIGIN, "authenticated video calls leave for xAI directly");
    assert.equal(call.headers.get("authorization"), fixture.grokBearer);
    const opts = proxyOptions.get(server)!;
    const poll = opts.operation === "extend" ? "/v1/videos/extend-1" : "/v1/videos/edit-1";
    if (target.pathname === poll) {
      assert.equal(call.method, "GET");
      assert.equal(call.body, "");
      return;
    }
    const start = opts.operation === "extend" ? "/v1/videos/extensions" : "/v1/videos/edits";
    assert.ok([start, "/v1/responses"].includes(target.pathname));
    assert.equal(call.method, "POST");
    assert.equal(call.headers.get("content-type"), "application/json");
    const body = JSON.parse(call.body);
    assert.ok(body && typeof body === "object" && !Array.isArray(body));
    assert.equal(typeof body.model, "string");
    if (target.pathname === start) {
      assert.equal(typeof body.prompt, "string");
      assert.equal(typeof body.video?.url, "string");
    } else { assert.ok(Array.isArray(body.input)); }
    opts.capture?.(target.pathname, body);
  }, "/dl/out.mp4");
  return origin;
}

function artifactReply(res: import("node:http").ServerResponse, kind?: ProxyOptions["downloadCase"]): void {
  res.writeHead(200, { "Content-Type": "video/mp4",
    ...(kind === "declared-too-large" ? { "Content-Length": "104857601" } : {}) });
  if (kind === "declared-too-large") { res.flushHeaders(); return; }
  res.end(kind === "invalid-mp4" ? Buffer.from("invalid MP4 bytes") : fakeMp4Bytes());
}

function jsonRes(res, body, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function makeProxy(opts: ProxyOptions = {}) {
  let polls = 0;
  const server = createServer((req, res) => {
    const url = req.url || "";
    if (url === "/v1/videos/edits" || url === "/v1/videos/extensions") {
      req.resume();
      req.on("end", () => {
        jsonRes(res, { request_id: opts.operation === "extend" ? "extend-1" : "edit-1" });
      });
      return;
    }
    if (url === "/v1/videos/edit-1" || url === "/v1/videos/extend-1") {
      polls += 1;
      const port = (server.address() as any).port;
      if (!opts.downloadCase && polls < 2) return jsonRes(res, { status: "pending", progress: 50 });
      return jsonRes(res, {
        status: "done",
        progress: 100,
        video: {
          ...(opts.blockedWithoutUrl ? {} : { url: `http://127.0.0.1:${port}/dl/out.mp4` }),
          duration: opts.operation === "extend" ? 9 : 4,
          respect_moderation: opts.blocked ? false : true,
        },
        usage: { cost_in_usd_ticks: 500000000 },
      });
    }
    if (url === "/v1/responses") {
      req.resume();
      req.on("end", () => {
        jsonRes(res, { output: [{ type: "message", content: [{ type: "output_text", text: opts.responseText ?? "structured video prompt" }] }] });
      });
      return;
    }
    if (url === "/dl/out.mp4") {
      return artifactReply(res, opts.downloadCase);
    }
    res.writeHead(404);
    res.end("nope");
  });
  proxyOptions.set(server, opts);
  return server;
}

async function videoApp(generatedDir: string, plannerModel?: string) {
  const app = express();
  fixture.trackApp(app);
  app.use(express.json({ limit: "20mb" }));
  registerVideoExtendedRoutes(app, {
    rootDir: fixture.root,
    packageVersion: "test",
    grokAuthHomeDir: fixture.grokAuthHomeDir,
    config: {
      ...config,
      ids: { ...config.ids, generatedHexBytes: 2 },
      storage: { ...config.storage, generatedDir },
      grokProvider: {
        ...config.grokProvider,
        ...(plannerModel ? { plannerModel } : {}),
        videoPollIntervalMs: 1,
        videoStartTimeoutMs: 5000,
        videoTimeoutMs: 30000,
        videoDownloadTimeoutMs: 5000,
      },
    },
  });
  const server = createServer(app);
  const url = await fixture.listen(server, "app");
  return { server, url };
}

function assertCallCounts(operation: "edit" | "extend", polls: number): void {
  const paths = operation === "edit"
    ? ["/v1/videos/edits", "/v1/videos/edit-1", "/dl/out.mp4"]
    : ["/v1/videos/extensions", "/v1/videos/extend-1", "/dl/out.mp4"];
  paths.forEach((path, index) => assert.equal(
    fixture.calls.filter((call) => new URL(call.url).pathname === path).length,
    index === 1 ? polls : 1, path));
  assert.deepEqual(fixture.violations, [], "no bridge or artifact arrayBuffer violation");
}

for (const operation of ["edit", "extend"] as const) {
  for (const downloadCase of ["invalid-mp4", "declared-too-large"] as const) {
    test(`/api/video/${operation} ${downloadCase}: JSON 502 and no persistence`, async () => {
      const generatedDir = await mkdtemp(join(fixture.root, "extended-rejected-"));
      try {
        await listen(makeProxy({ operation, downloadCase }));
        const { url } = await videoApp(generatedDir);
        const endpoint = operation === "edit" ? "edit" : "extend/native";
        const res = await fixture.fetchApp(`${url}/api/video/${endpoint}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: 5 }),
        });
        assert.equal(res.status, 502);
        assert.match(res.headers.get("content-type") || "", /application\/json/);
        const data = await res.json();
        assert.equal(data.code, "GROK_VIDEO_DOWNLOAD_FAILED");
        assert.equal(data.error, downloadCase === "invalid-mp4"
          ? "Grok video download returned an invalid MP4 container"
          : "Grok video download exceeds the 100MB limit");
        assert.equal(data.filename, undefined);
        assert.equal(data.url, undefined);
        await fixture.drain();
        assertCallCounts(operation, 1);
        assert.deepEqual(await readdir(generatedDir), [], "no MP4, sidecar or thumbnail");
      } finally {
        await fixture.finishCase();
        await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });
  }
}

test("/api/video/extend/native persists real downloaded bytes and sidecar", async () => {
  const generatedDir = await mkdtemp(join(fixture.root, "native-success-"));
  try {
    await listen(makeProxy({ operation: "extend" }));
    const { url } = await videoApp(generatedDir);
    const res = await fixture.fetchApp(`${url}/api/video/extend/native`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: 5 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.requestId, "extend-1");
    assert.match(data.filename, /\.mp4$/);
    assert.equal(data.url, `/generated/${data.filename}`);
    assert.deepEqual(await readFile(join(generatedDir, data.filename)), fakeMp4Bytes());
    const meta = JSON.parse(await readFile(join(generatedDir, `${data.filename}.json`), "utf8"));
    assert.equal(meta.requestId, "extend-1");
    assert.equal(meta.video.operation, "extend");
    assert.equal(meta.video.duration, 9);
    await fixture.drain();
    assertCallCounts("extend", 2);
    assert.deepEqual((await readdir(generatedDir)).sort(), [data.filename, `${data.filename}.json`].sort());
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/edit forwards xAI payload and saves local video artifact", async () => {
  let startBody: any = null;
  const proxy = makeProxy({ operation: "edit", capture: (_url, body) => (startBody = body) });
  const proxyUrl = await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-edit-"));
  const { url } = await videoApp(generatedDir);
  try {
    const res = await fixture.fetchApp(`${url}/api/video/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "make it sunset", videoUrl: "https://vidgen.example/input.mp4" }),
    });
    const data: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(startBody.model, "grok-imagine-video");
    assert.equal(startBody.prompt, "make it sunset");
    assert.deepEqual(startBody.video, { url: "https://vidgen.example/input.mp4" });
    assert.equal(data.requestId, "edit-1");
    assert.match(data.url, /^\/generated\/.+\.mp4$/);
    assert.match(data.filename, /\.mp4$/);
    assert.equal(data.sourceUrl, `http://127.0.0.1:${new URL(proxyUrl).port}/dl/out.mp4`);
    const files = await readdir(generatedDir);
    assert.ok(files.some((f) => f.endsWith(".mp4")), "mp4 written");
    const sidecar = files.find((f) => f.endsWith(".mp4.json"));
    assert.ok(sidecar, "sidecar written");
    const meta = JSON.parse(await readFile(join(generatedDir, sidecar!), "utf8"));
    assert.deepEqual(await readFile(join(generatedDir, data.filename)), fakeMp4Bytes());
    assert.deepEqual(meta.video.source, { kind: "url", origin: "https://vidgen.example", pathname: "input.mp4" });
    assert.deepEqual(meta.video.sourceUrl, { kind: "url", origin: "http://127.0.0.1:" + new URL(proxyUrl).port, pathname: "out.mp4" });
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/edit rejects whitespace prompt and unsafe generated-file inputs", async () => {
  const proxy = makeProxy({ operation: "edit" });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-inputs-"));
  await writeFile(join(generatedDir, "clip.mp4.json"), JSON.stringify({ secret: true }));
  await writeFile(join(fixture.root, "outside-generated.mp4"), "not really a video");
  await symlink(join(fixture.root, "outside-generated.mp4"), join(generatedDir, "linked.mp4"));
  const { url } = await videoApp(generatedDir);
  try {
    const blank = await fixture.fetchApp(`${url}/api/video/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   ", videoUrl: "https://vidgen.example/input.mp4" }),
    });
    assert.equal(blank.status, 400);
    const blankJson = await blank.json();
    assert.equal(blankJson.code, "PROMPT_REQUIRED");
    assert.match(blankJson.guidance, /Active video prompt required/);

    const sidecar = await fixture.fetchApp(`${url}/api/video/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "edit", videoUrl: "clip.mp4.json" }),
    });
    assert.equal(sidecar.status, 400);
    assert.match((await sidecar.json()).error, /\.mp4/);

    const linked = await fixture.fetchApp(`${url}/api/video/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "edit", videoUrl: "linked.mp4" }),
    });
    assert.equal(linked.status, 400);
    assert.equal((await linked.json()).error, "invalid file path", "canonical rejection must precede MP4 decoding");
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(join(fixture.root, "outside-generated.mp4"), { force: true });
  }
});

test("/api/video/extend/native validates duration/model and rejects moderation-blocked result", async () => {
  const proxy = makeProxy({ operation: "extend", blocked: true });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-extend-"));
  const { url } = await videoApp(generatedDir);
  try {
    const badDuration = await fixture.fetchApp(`${url}/api/video/extend/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: "abc" }),
    });
    assert.equal(badDuration.status, 400);
    assert.match((await badDuration.json()).error, /duration must be an integer/);

    const badModel = await fixture.fetchApp(`${url}/api/video/extend/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: 5, model: "grok-imagine-video-1.5-preview" }),
    });
    assert.equal(badModel.status, 400);
    assert.match((await badModel.json()).error, /only supports grok-imagine-video/);

    const blocked = await fixture.fetchApp(`${url}/api/video/extend/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: 5 }),
    });
    assert.equal(blocked.status, 502);
    assert.match((await blocked.json()).error, /moderation/i);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/extend/native reports moderation block even when upstream omits url", async () => {
  const proxy = makeProxy({ operation: "extend", blocked: true, blockedWithoutUrl: true });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-blocked-"));
  const { url } = await videoApp(generatedDir);
  try {
    const blocked = await fixture.fetchApp(`${url}/api/video/extend/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "continue", videoUrl: "https://vidgen.example/input.mp4", duration: 5 }),
    });
    assert.equal(blocked.status, 502);
    assert.match((await blocked.json()).error, /moderation/i);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/frame rejects unsafe, invalid, and undecodable generated inputs", async () => {
  const proxy = makeProxy();
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-frame-invalid-"));
  const { url } = await videoApp(generatedDir);
  try {
    const traversal = await fixture.fetchApp(`${url}/api/video/frame?file=${encodeURIComponent("../clip.mp4")}`);
    assert.equal(traversal.status, 400);

    const notVideo = join(generatedDir, "not-video.mp4");
    await writeFile(notVideo, "not an mp4");
    const invalid = await fixture.fetchApp(`${url}/api/video/frame?file=${encodeURIComponent("not-video.mp4")}`);
    assert.equal(invalid.status, 400);

    await writeFile(join(generatedDir, "fake.mp4"), fakeMp4Bytes());
    const undecodable = await fixture.fetchApp(`${url}/api/video/frame?file=${encodeURIComponent("fake.mp4")}&position=0`);
    assert.equal(undecodable.status, 500);
    assert.match((await undecodable.json()).error, /ffmpeg failed/);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/frame supports generated relative and absolute paths safely", async (t) => {
  if (!fixture.ffmpeg?.available) {
    await fixture.finishCase();
    t.skip("ffmpeg is not installed in this environment");
    return;
  }
  const proxy = makeProxy();
  const firstAttempt = fixture.ffmpeg.attempts.length;
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-frame-"));
  const mp4 = join(generatedDir, "clip.mp4");
  try {
    await fixture.ffmpeg.createClip(mp4, "blue");
    const { url } = await videoApp(generatedDir);
    try {
      for (const file of ["clip.mp4", mp4]) {
        const res = await fixture.fetchApp(`${url}/api/video/frame?file=${encodeURIComponent(file)}&position=0`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type") || "", /image\/png/);
        assert.ok((await res.arrayBuffer()).byteLength > 100);
      }
      await assertCodecReceipts(firstAttempt, 2);
    } finally {
      await fixture.finishCase();
    }
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/analyze rejects remote URLs before frame extraction", async () => {
  const proxy = makeProxy();
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-analyze-remote-"));
  const { url } = await videoApp(generatedDir);
  try {
    const remote = await fixture.fetchApp(`${url}/api/video/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: "https://vidgen.example/clip.mp4" }),
    });
    assert.equal(remote.status, 400);
    assert.match((await remote.json()).error, /generated .mp4/);
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("/api/video/analyze extracts first/last frames and sends input_image payload", async (t) => {
  if (!fixture.ffmpeg?.available) {
    await fixture.finishCase();
    t.skip("ffmpeg is not installed in this environment");
    return;
  }
  let responseBody: any = null;
  const firstAttempt = fixture.ffmpeg.attempts.length;
  const proxy = makeProxy({ responseText: "first and last frame analysis", capture: (url, body) => { if (url === "/v1/responses") responseBody = body; } });
  await listen(proxy);
  const generatedDir = await mkdtemp(join(fixture.root, "ima2-video-ext-analyze-"));
  const mp4 = join(generatedDir, "clip.mp4");
  try {
    await fixture.ffmpeg.createClip(mp4, "blue");
    const { url } = await videoApp(generatedDir, "grok-4.3");
    try {
    const res = await fixture.fetchApp(`${url}/api/video/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: "clip.mp4" }),
    });
    const data: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.analysis, "first and last frame analysis");
    assert.equal(data.method, "first-last-frame");
    assert.equal(data.model, "grok-4.3");
    assert.equal(responseBody.model, "grok-4.3");
    const content = responseBody.input[0].content;
    assert.equal(content.filter((item: any) => item.type === "input_image").length, 2);
    assert.ok(content.every((item: any) => item.type !== "input_file"));
    await assertCodecReceipts(firstAttempt, 2);
    } finally {
      await fixture.finishCase();
    }
  } finally {
    await fixture.finishCase();
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function assertCodecReceipts(firstAttempt: number, frames: number): Promise<void> {
  await fixture.drain();
  const attempts = fixture.ffmpeg!.attempts.slice(firstAttempt);
  assert.equal(attempts.filter((attempt) => attempt.input && attempt.code === 0).length, frames);
  assert.equal(attempts.filter((attempt) => attempt.args.includes("lavfi") && attempt.code === 0).length, 1);
  for (const attempt of attempts) {
    assert.ok(attempt.pid && attempt.closed && attempt.callbackDone);
    assert.equal(attempt.error, null);
    assert.equal(attempt.canceled, false);
  }
}

}
