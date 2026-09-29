import test, { before, beforeEach, after, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoExtendedDependencies } from "../routes/videoExtended.js";
import type { BusEvent } from "../lib/eventBus.js";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { GROK_DIRECT_ORIGIN, openVideoFixture } from "./_videoExecutionFixture.ts";
import { fakeMp4Bytes as fakeMp4, makeVideoStreamFixture } from "./_videoStreamFixture.ts";
import { bounded, SettlementTimeout } from "./_executionTrackedWrites.ts";

if (executionTestProcess(import.meta.url)) {
type VideoFixture = Awaited<ReturnType<typeof openVideoFixture>>;
let fixture: VideoFixture;
let registerVideoExtendedRoutes: typeof import("../routes/videoExtended.js").registerVideoExtendedRoutes;
let subscribe: typeof import("../lib/eventBus.js").subscribe;
let abortJob: typeof import("../lib/inflight.js").abortJob;
let listJobs: typeof import("../lib/inflight.js").listJobs;
before(async () => {
  fixture = await openVideoFixture({ codec: true });
  ({ registerVideoExtendedRoutes } = await import("../routes/videoExtended.js"));
  ({ subscribe } = await import("../lib/eventBus.js"));
  ({ abortJob, listJobs } = await import("../lib/inflight.js"));
});
beforeEach(() => fixture.beginCase());
afterEach(async () => { await fixture?.finishCase(); });
after(async () => { await fixture?.close(); });

function close(_server: Server): Promise<void> { return fixture.finishCase(); }

async function makeParent(dir: string, filename = "root.mp4", metadata: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(dir, filename), fakeMp4());
  await writeFile(join(dir, `${filename}.json`), JSON.stringify({
    kind: "video", mediaType: "video", provider: "grok", model: "grok-imagine-video",
    userPrompt: "parent user prompt", prompt: "parent prompt", revisedPrompt: "parent revised prompt",
    video: { duration: 5, resolution: "480p", aspectRatio: "auto" }, createdAt: 1, ...metadata,
  }));
}

function result(overrides: Record<string, unknown> = {}): any {
  return {
    videoBuffer: fakeMp4(), contentType: "video/mp4", url: "https://provider.example/child.mp4",
    duration: 5, resolution: "480p", aspectRatio: "auto", mode: "image-to-video", usage: { grok_cost_usd_ticks: 1 },
    revisedPrompt: "planned continuation", xaiVideoRequestId: "xai-child", webSearchCalls: 1,
    requestedModel: "grok-imagine-video", effectiveModel: "grok-imagine-video", modelFallback: null, ...overrides,
  };
}

function successfulGenerator(capture?: (prompt: string, options: any) => void) {
  return async (prompt: string, _ctx: any, options: any) => {
    capture?.(prompt, options);
    options.onEvent?.({ phase: "planning" });
    options.onEvent?.({ phase: "submitted", xaiVideoRequestId: "xai-child", requestedModel: "grok-imagine-video", effectiveModel: "grok-imagine-video", modelFallback: null });
    options.onEvent?.({ phase: "progress", progress: 50 });
    return result();
  };
}

async function makeApp(dir: string, dependencies: VideoExtendedDependencies = {}) {
  const config = fixture.config;
  const app = express();
  fixture.trackApp(app);
  app.use(express.json());
  registerVideoExtendedRoutes(app, {
    rootDir: fixture.root, packageVersion: "test",
    grokAuthHomeDir: fixture.grokAuthHomeDir,
    config: {
      ...config, ids: { ...config.ids, generatedHexBytes: 2 }, storage: { ...config.storage, generatedDir: dir },
      grokProvider: { ...config.grokProvider, videoPollIntervalMs: 1, videoStartTimeoutMs: 5000, videoTimeoutMs: 30000, videoDownloadTimeoutMs: 5000, plannerTimeoutMs: 5000 },
    },
  }, dependencies);
  const server = createServer(app);
  return { server, url: await fixture.listen(server, "app") };
}

function watchTerminal(requestId: string) {
  const events: BusEvent[] = [];
  let stop = () => {};
  const terminal = new Promise<BusEvent>((resolve) => {
    stop = subscribe((event) => {
      if (event.jobId !== requestId) return;
      events.push(event);
      if (event.event === "done" || event.event === "error") resolve(event);
    });
  });
  return { events, terminal, stop: () => stop() };
}

async function postExtend(url: string, body: Record<string, unknown>) {
  return fixture.fetchApp(`${url}/api/video/extend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("extend returns 202, injects the extracted frame, and emits the ordered terminal contract", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-contract-"));
  const requestId = "i2v-contract";
  let sourceImage = "";
  await makeParent(dir);
  const watcher = watchTerminal(requestId);
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => "png-base64",
    generateVideo: successfulGenerator((_prompt, options) => { sourceImage = options.sourceImage; }),
    createFilename: () => "child.mp4",
  });
  try {
    const response = await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, requestId, sourceVideoId: "root.mp4", workflow: "last-frame-i2v" });
    const terminal = await watcher.terminal;
    assert.equal(terminal.event, "done");
    assert.equal(sourceImage, "png-base64");
    const order = watcher.events.map((event) => event.event === "phase" ? `phase:${event.data.phase}` : event.event);
    assert.deepEqual(order, ["phase:queued", "phase:extracting-frame", "planning", "submitted", "progress", "phase:persisting", "done"]);
    const sidecar = JSON.parse(await readFile(join(dir, "child.mp4.json"), "utf8"));
    assert.deepEqual(sidecar.videoLineage, { id: "child.mp4", parentId: "root.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 1 });
  } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("duplicate active requestId returns 409 and starts the provider once", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-duplicate-"));
  await makeParent(dir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let providerCalls = 0;
  const requestId = "i2v-duplicate";
  const generate = successfulGenerator();
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => { await gate; return "png"; },
    generateVideo: async (prompt, ctx, options) => { providerCalls += 1; return generate(prompt, ctx, options); },
  });
  try {
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
    const duplicate = await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, "REQUEST_ID_IN_USE");
    const done = new Promise<void>((resolve) => {
      const stop = subscribe((event) => { if (event.jobId === requestId && event.event === "done") { stop(); resolve(); } });
    });
    release();
    await done;
    assert.equal(providerCalls, 1);
  } finally {
    release();
    await close(server);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("duplicate 409 publishes no error on the active job channel (terminal uniqueness)", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-dup-stream-"));
  await makeParent(dir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestId = "i2v-dup-stream";
  const seen: string[] = [];
  const stopWatch = subscribe((event) => { if (event.jobId === requestId) seen.push(event.event); });
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => { await gate; return "png"; },
    generateVideo: successfulGenerator(),
  });
  try {
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 409);
    release();
    await new Promise<void>((resolve) => {
      const stop = subscribe((event) => { if (event.jobId === requestId && event.event === "done") { stop(); resolve(); } });
    });
    assert.ok(!seen.includes("error"), `duplicate must not publish error, saw: ${seen.join(",")}`);
    assert.equal(seen.filter((e) => e === "done").length, 1);
  } finally {
    release();
    stopWatch();
    await close(server);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("cancel during extraction ends with exactly one terminal event and zero provider calls", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-cancel-"));
  await makeParent(dir);
  const requestId = "i2v-cancel-one";
  let providerCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen: BusEvent[] = [];
  const stopWatch = subscribe((event) => { if (event.jobId === requestId && (event.event === "done" || event.event === "error")) seen.push(event); });
  const generate = successfulGenerator();
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => { await gate; return "png"; },
    generateVideo: async (prompt, ctx, options) => { providerCalls += 1; return generate(prompt, ctx, options); },
  });
  try {
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
    abortJob(requestId);
    release();
    await fixture.drain();
    assert.equal(providerCalls, 0, "provider must not run after cancel");
    assert.equal(seen.filter((e) => e.event === "done").length, 0, "no done after cancel");
    assert.deepEqual(seen.map((e) => e.data?.code), ["GENERATION_CANCELED"], "exactly one canceled terminal event");
  } finally {
    release();
    stopWatch();
    await close(server);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("cancel during preflight (sidecar await) stops before 202 and provider work", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-preflight-cancel-"));
  await makeParent(dir);
  const requestId = "i2v-preflight-cancel";
  let providerCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const seen: BusEvent[] = [];
  const stopWatch = subscribe((event) => { if (event.jobId === requestId && (event.event === "done" || event.event === "error")) seen.push(event); });
  const generate = successfulGenerator();
  const { server, url } = await makeApp(dir, {
    readSidecar: async (d: string, f: string) => { markEntered(); await gate; return readFile(join(d, `${f}.json`), "utf8").then(JSON.parse); },
    extractFrame: async () => "png",
    generateVideo: async (prompt, ctx, options) => { providerCalls += 1; return generate(prompt, ctx, options); },
  });
  try {
    const pending = postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" });
    // Wait until the handler is actually parked inside the gated preflight
    // await, so the cancel lands mid-preflight (not before admission).
    await entered;
    abortJob(requestId);
    release();
    const response = await pending;
    assert.equal(response.status, 499);
    await fixture.drain();
    assert.equal(providerCalls, 0, "provider must not run after preflight cancel");
    // Deterministic ordering: abort lands after admission but before preflight
    // completes, so abortJob publishes exactly one canceled error.
    assert.equal(seen.filter((e) => e.event === "done").length, 0, "no done after preflight cancel");
    assert.deepEqual(seen.map((e) => e.data?.code), ["GENERATION_CANCELED"], "exactly one canceled terminal event from abortJob");
  } finally {
    release();
    stopWatch();
    await close(server);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("unreadable parent sidecar fails closed with VIDEO_PARENT_METADATA_INVALID and zero provider calls", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-corrupt-"));
  await writeFile(join(dir, "root.mp4"), fakeMp4());
  await writeFile(join(dir, "root.mp4.json"), "{ not valid json");
  let providerCalls = 0;
  const requestId = "i2v-corrupt-parent";
  const generate = successfulGenerator();
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => "png",
    generateVideo: async (prompt, ctx, options) => { providerCalls += 1; return generate(prompt, ctx, options); },
  });
  try {
    const response = await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.code, "VIDEO_PARENT_METADATA_INVALID");
    await fixture.drain();
    assert.equal(providerCalls, 0);
  } finally { await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

describe("extraction failures are typed and never call the provider", () => {
  const cases = [
    { name: "decode", error: new Error("decode failed"), code: "VIDEO_FRAME_EXTRACT_FAILED", retryable: undefined },
    { name: "unavailable", error: Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }), code: "VIDEO_FRAME_EXTRACT_UNAVAILABLE", retryable: undefined },
    { name: "timeout", error: Object.assign(new Error("timed out"), { killed: true, signal: "SIGKILL" }), code: "VIDEO_FRAME_EXTRACT_TIMEOUT", retryable: true },
  ];
  for (const item of cases) test(item.name, async () => {
    const dir = await mkdtemp(join(fixture.root, `ima2-extend-${item.name}-`));
    await makeParent(dir);
    const requestId = `i2v-${item.name}`;
    let providerCalls = 0;
    const watcher = watchTerminal(requestId);
    const { server, url } = await makeApp(dir, {
      extractFrame: async () => { throw item.error; },
      generateVideo: async () => { providerCalls += 1; return result(); },
    });
    try {
      assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
      const terminal = await watcher.terminal;
      assert.equal(terminal.data.code, item.code);
      assert.equal(terminal.data.retryable, item.retryable);
      assert.equal(providerCalls, 0);
    } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
});

test("child-of-child and siblings preserve durable branches and inherit prompt and motion", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-lineage-"));
  await makeParent(dir, "root.mp4", { motionPresetIds: ["motion-handheld"] });
  const filenames = ["child.mp4", "grandchild.mp4", "sibling.mp4"];
  const prompts: string[] = [];
  const { server, url } = await makeApp(dir, {
    extractFrame: async () => "png",
    generateVideo: successfulGenerator((prompt) => prompts.push(prompt)),
    createFilename: () => filenames.shift()!,
  });
  async function extend(sourceVideoId: string, requestId: string) {
    const watcher = watchTerminal(requestId);
    const response = await postExtend(url, { sourceVideoId, requestId });
    assert.equal(response.status, 202);
    const terminal = await watcher.terminal;
    watcher.stop();
    return terminal.data;
  }
  try {
    const child = await extend("root.mp4", "i2v-child");
    const grandchild = await extend("child.mp4", "i2v-grandchild");
    const sibling = await extend("root.mp4", "i2v-sibling");
    const childLineage = child.videoLineage as Record<string, unknown>;
    const grandchildLineage = grandchild.videoLineage as Record<string, unknown>;
    const siblingLineage = sibling.videoLineage as Record<string, unknown>;
    assert.deepEqual(grandchildLineage, { id: "grandchild.mp4", parentId: "child.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 2 });
    assert.notEqual(childLineage.id, siblingLineage.id);
    assert.deepEqual({ ...siblingLineage, id: childLineage.id }, childLineage);
    assert.equal(child.prompt, "parent user prompt");
    assert.match(prompts[0], /Camera motion: natural handheld/);
  } finally { await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

describe("sidecar failure rolls back the MP4 and cancel suppresses done", () => {
  test("rollback", async () => {
    const dir = await mkdtemp(join(fixture.root, "ima2-extend-rollback-"));
    await makeParent(dir);
    await mkdir(join(dir, "broken.mp4.json"));
    const requestId = "i2v-rollback";
    const watcher = watchTerminal(requestId);
    const { server, url } = await makeApp(dir, { extractFrame: async () => "png", generateVideo: successfulGenerator(), createFilename: () => "broken.mp4" });
    try {
      assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
      assert.equal((await watcher.terminal).data.code, "VIDEO_PERSIST_FAILED");
      assert.equal(watcher.events.filter((event) => event.event === "done").length, 0);
      await assert.rejects(access(join(dir, "broken.mp4")), (error: any) => error?.code === "ENOENT");
    } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
  test("cancel", async () => {
    const dir = await mkdtemp(join(fixture.root, "ima2-extend-cancel-"));
    await makeParent(dir);
    const requestId = "i2v-cancel";
    const watcher = watchTerminal(requestId);
    const { server, url } = await makeApp(dir, {
      extractFrame: async (_dir, _file, _position, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })),
      generateVideo: successfulGenerator(),
    });
    try {
      assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId, prompt: "continue" })).status, 202);
      abortJob(requestId);
      assert.equal((await watcher.terminal).data.code, "GENERATION_CANCELED");
      assert.equal(watcher.events.filter((event) => event.event === "done").length, 0);
    } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
});

test("remote sourceVideoId fails before extraction", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-remote-"));
  let extracts = 0;
  const { server, url } = await makeApp(dir, { extractFrame: async () => { extracts += 1; return "png"; } });
  try {
    const response = await postExtend(url, { sourceVideoId: "https://example.com/root.mp4", requestId: "i2v-remote", prompt: "continue" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "VIDEO_SOURCE_LOCAL_ONLY");
    assert.equal(extracts, 0);
  } finally { await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

function defaultUpstream(stream: ReturnType<typeof makeVideoStreamFixture>) {
  fixture.addStream(stream);
  const paths: string[] = [];
  let generationBody: { image?: { url?: string } } | null = null;
  fixture.respond((call) => {
    const url = new URL(call.url);
    paths.push(url.pathname);
    assert.equal(url.search, "");
    assert.equal(call.headers.get("cookie"), null);
    if (url.href === "https://artifact.fixture.invalid/child.mp4") {
      assert.equal(call.method, "GET"); assert.equal(call.body, "");
      assert.equal(call.headers.get("authorization"), null);
      return stream.response;
    }
    assert.equal(url.origin, GROK_DIRECT_ORIGIN);
    assert.equal(call.headers.get("authorization"), fixture.grokBearer);
    if (url.pathname === "/v1/videos/real-child") {
      assert.equal(call.method, "GET"); assert.equal(call.body, "");
      return Response.json({ status: "done", video: { url: "https://artifact.fixture.invalid/child.mp4", duration: 1, respect_moderation: true } });
    }
    assert.equal(call.method, "POST");
    assert.equal(call.headers.get("content-type"), "application/json");
    const body = JSON.parse(call.body);
    assert.equal(typeof body.model, "string");
    if (url.pathname === "/v1/responses") {
      assert.ok(Array.isArray(body.input));
      return Response.json({ output: [{ type: "message", content: [{ type: "text", text: "brief" }] }] });
    }
    if (url.pathname === "/v1/chat/completions") {
      assert.ok(Array.isArray(body.messages));
      return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "planned" }) } }] } }] });
    }
    assert.equal(url.pathname, "/v1/videos/generations");
    assert.equal(typeof body.prompt, "string");
    assert.match(body.image?.url ?? "", /^data:image\/png;base64,/);
    generationBody = body;
    return Response.json({ request_id: "real-child" });
  });
  return { paths, get generationBody() { return generationBody; } };
}

for (const kind of ["invalid-mp4", "declared-too-large"] as const) {
  test(`default last-frame generator rejects ${kind} without child persistence and preserves parent`, async () => {
    const dir = await mkdtemp(join(fixture.root, "ima2-extend-download-"));
    await makeParent(dir);
    const beforeParent = await Promise.all(["root.mp4", "root.mp4.json"].map((file) => readFile(join(dir, file))));
    const stream = makeVideoStreamFixture(kind === "invalid-mp4" ? [Buffer.from("invalid MP4 bytes")] : [], {
      headers: { "content-type": "video/mp4", ...(kind === "declared-too-large" ? { "content-length": "104857601" } : {}) },
      holdOpen: kind === "declared-too-large",
    });
    const upstream = defaultUpstream(stream);
    const requestId = `i2v-download-${kind}`;
    const watcher = watchTerminal(requestId);
    const { server, url } = await makeApp(dir, { extractFrame: async () => "png" });
    try {
      assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId })).status, 202);
      const terminal = await watcher.terminal;
      assert.equal(terminal.event, "error"); assert.equal(terminal.data.status, 502);
      assert.equal(terminal.data.code, "GROK_VIDEO_DOWNLOAD_FAILED");
      assert.match(String(terminal.data.error), kind === "invalid-mp4" ? /invalid MP4 container/ : /100MB limit/);
      await fixture.finishCase();
      assert.equal(watcher.events.filter((event) => event.event === "done").length, 0);
      assert.deepEqual(upstream.paths, ["/v1/responses", "/v1/chat/completions", "/v1/videos/generations", "/v1/videos/real-child", "/child.mp4"]);
      assert.deepEqual((await readdir(dir)).sort(), ["root.mp4", "root.mp4.json"]);
      assert.deepEqual(await Promise.all(["root.mp4", "root.mp4.json"].map((file) => readFile(join(dir, file)))), beforeParent);
      assert.equal(stream.stats.arrayBufferCalls, 0);
      if (kind === "declared-too-large") { assert.equal(stream.stats.pulls, 0); assert.equal(stream.stats.sourceCancelCalls, 1); }
      stream.assertDrained();
    } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
}

test("finishCase waits for whole last-frame work after cancel removes inflight", async () => {
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-drain-"));
  await makeParent(dir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const extracting = new Promise<void>((resolve) => { entered = resolve; });
  const requestId = "i2v-full-drain";
  const watcher = watchTerminal(requestId);
  const { server, url } = await makeApp(dir, { extractFrame: async () => { entered(); await gate; return "png"; } });
  let finishing: Promise<void> | undefined;
  try {
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId })).status, 202);
    await extracting;
    abortJob(requestId);
    assert.equal((await watcher.terminal).data.code, "GENERATION_CANCELED");
    assert.deepEqual(listJobs(), []);
    finishing = fixture.finishCase();
    // The gate is already entered and stays held: this is a bounded negative
    // settlement oracle, not a delay used to guess when asynchronous work finished.
    await assert.rejects(bounded(finishing, 100), SettlementTimeout);
    release();
    await finishing;
    assert.equal(fixture.calls.length, 0, "canceled extraction never reaches the default provider");
    assert.deepEqual(watcher.events.filter((event) => event.event === "error" || event.event === "done").map((event) => event.data.code), ["GENERATION_CANCELED"]);
    assert.deepEqual((await readdir(dir)).sort(), ["root.mp4", "root.mp4.json"]);
  } finally { release(); await finishing; watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("real last-frame path sends PNG image.url to generations and never calls extensions", async (t) => {
  if (!fixture.ffmpeg?.available) { await fixture.finishCase(); return t.skip("ffmpeg is not installed"); }
  const dir = await mkdtemp(join(fixture.root, "ima2-extend-real-"));
  await fixture.ffmpeg.createClip(join(dir, "root.mp4"));
  await writeFile(join(dir, "root.mp4.json"), JSON.stringify({ userPrompt: "continue", provider: "grok", model: "grok-imagine-video", video: { duration: 1, resolution: "480p", aspectRatio: "auto" } }));
  const upstream = defaultUpstream(makeVideoStreamFixture([fakeMp4()], { headers: { "content-type": "video/mp4" } }));
  const requestId = "i2v-real";
  const watcher = watchTerminal(requestId);
  const { server, url } = await makeApp(dir);
  try {
    assert.equal((await postExtend(url, { sourceVideoId: "root.mp4", requestId })).status, 202);
    assert.equal((await watcher.terminal).event, "done");
    assert.match(upstream.generationBody?.image?.url ?? "", /^data:image\/png;base64,/);
    assert.equal(upstream.paths.some((path) => path.includes("/v1/videos/extensions")), false);
    await fixture.drain();
    assert.equal(upstream.paths.filter((path) => path === "/v1/videos/generations").length, 1);
    assert.equal((await readdir(dir)).filter((file) => file.endsWith(".mp4")).length, 2);
    const parentPath = await realpath(join(dir, "root.mp4"));
    const extraction = fixture.ffmpeg.attempts.filter((attempt) => attempt.input === parentPath && attempt.args.includes("-sseof"));
    assert.equal(extraction.length, 1);
    assert.ok(extraction[0].closed && extraction[0].callbackDone && extraction[0].code === 0);
    t.diagnostic(JSON.stringify({ ffmpegExtraction: extraction[0] }));
  } finally { watcher.stop(); await close(server); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
}
