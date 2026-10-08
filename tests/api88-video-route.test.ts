import test from "node:test";
import assert from "node:assert/strict";
import type { Express, Request, Response } from "express";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ima2-api88-video-"));
const oldConfig = process.env.IMA2_CONFIG_DIR;
const oldDb = process.env.IMA2_DB_PATH;
process.env.IMA2_CONFIG_DIR = root;
process.env.IMA2_DB_PATH = join(root, "sessions.db");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
const { registerVideoRoutes } = await import("../routes/video.ts");
const { registerVideoExtendedRoutes } = await import("../routes/videoExtended.ts");
const { listJobs, listTerminalJobs, _resetForTests, startJob, finishJob, mergeJobMeta,
  mergeStoppedJobMeta, abortJob, purgeStaleJobs } = await import("../lib/inflight.ts");
const { config } = await import("../config.ts");
const { readTerminalJob } = await import("../lib/jobs/terminalStore.ts");
const { prepareApi88Video } = await import("../lib/api88/videoRouteInput.ts");
const { buildApi88VideoBody } = await import("../lib/api88/videoBody.ts");
const { closeDb } = await import("../lib/db.ts");
const { API88_VIDEO_SPECS } = await import("../lib/api88/videoSpecs.ts");
const { api88VideoModelsForContext } = await import("../lib/api88/videoCatalogProjection.ts");
const { api88VideoLedgerPath, findApi88VideoTask, beginApi88VideoTask, recordApi88VideoTask, listApi88VideoTasks } = await import("../lib/api88/videoLedger.ts");
const originalFetch = globalThis.fetch;
const bytes = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex");
const artifact = "https://cdn.example/video.mp4?sig=A%2FB&keep=1";
test.beforeEach(() => {
  _resetForTests();
  globalThis.fetch = (async () => { assert.fail("Unexpected upstream fetch"); }) as typeof fetch;
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => {
  closeDb(); rmSync(root, { recursive: true, force: true });
  if (oldConfig === undefined) delete process.env.IMA2_CONFIG_DIR; else process.env.IMA2_CONFIG_DIR = oldConfig;
  if (oldDb === undefined) delete process.env.IMA2_DB_PATH; else process.env.IMA2_DB_PATH = oldDb;
});
type Handler = (req: Request, res: Response) => unknown;
function app() {
  const handlers = new Map<string, Handler>();
  const express = {
    post(path: string, handler: Handler) { handlers.set(path, handler); return this; },
    get(path: string, handler: Handler) { handlers.set(path, handler); return this; },
  } as unknown as Express;
  return { express, handlers };
}
function response() {
  const state = { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false,
    jsonBody: null as Record<string, unknown> | null, chunks: [] as string[], headers: new Map<string, string>(),
    setHeader(key: string, value: string) { this.headers.set(key, value); },
    status(value: number) { this.statusCode = value; return this; },
    json(value: Record<string, unknown>) { this.jsonBody = value; this.headersSent = true; this.writableEnded = true; return this; },
    write(value: string) { this.chunks.push(value); return true; },
    flushHeaders() { this.headersSent = true; },
    end() { this.writableEnded = true; },
  };
  return { state, res: state as unknown as Response };
}
function context() {
  const ctx = createTestRuntimeContext({ rootDir: root, api88VideoKey: "video-key", api88ImageKey: "image-key" });
  return { ...ctx, config: { ...config, storage: { ...config.storage, generatedDir: join(root, "generated") },
    api88Provider: { ...config.api88Provider, baseUrl: "https://api.example" } } };
}
function fixture() {
  const local = app();
  let time = 0;
  registerVideoRoutes(local.express, context(), { now: () => time,
    sleep: async (ms) => { time += ms; }, thumbnail: async () => undefined });
  return local;
}
function events(chunks: string[]) {
  return chunks.join("").split("\n\n").filter(Boolean).map((block) => {
    const name = /^event: (.+)$/m.exec(block)![1];
    const data = JSON.parse(/^data: (.+)$/m.exec(block)![1]) as Record<string, unknown>;
    return { name, data };
  });
}
function upstream(requestId: string, calls: string[]) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url); calls.push(`${init?.method ?? "GET"} ${target}`);
    assert.ok(!target.includes("/v1/responses"));
    const authorization = new Headers(init?.headers).get("authorization");
    if (target === artifact) { assert.equal(authorization, null); return new Response(bytes); }
    assert.equal(authorization, "Bearer video-key");
    if (init?.method === "POST") {
      assert.equal(target, "https://api.example/v1/videos");
      assert.equal(JSON.parse(String(init.body)).model, "SD2.5 720P");
      return Response.json({ id: "task-id" });
    }
    assert.equal(target, "https://api.example/v1/videos/task-id");
    const active = listJobs({ kind: "video" }).find((job) => job.requestId === requestId)!;
    assert.equal(active.meta.providerTaskId, "task-id", "id must be persisted before first poll");
    assert.equal(active.meta.api88Origin, "https://api.example");
    assert.equal(active.meta.sessionId, "session-1");
    assert.equal(active.meta.clientNodeId, "node-1");
    assert.equal(active.meta.model, "SD2.5 720P");
    assert.equal(active.prompt, "A cube");
    return Response.json({ status: "completed", url: artifact });
  }) as typeof fetch;
}
for (const async of [false, true]) {
  test(`generation ${async ? "202" : "legacy SSE"} persists task/model/url provenance`, async () => {
    const local = fixture();
    const calls: string[] = [];
    const id = `generate-${async}`;
    const res = response(); upstream(id, calls);
    await local.handlers.get("/api/video/generate")!({ id, body: {
      requestId: id, async, provider: "88api", model: "SD2.5 720P", prompt: "A cube",
      duration: 30, resolution: "720p", aspectRatio: "auto", sessionId: "session-1", clientNodeId: "node-1",
    } } as Request, res.res);
    assert.equal(res.state.statusCode, async ? 202 : 200);
    if (async) assert.equal(res.state.jsonBody?.requestId, id);
    else {
      const streamed = events(res.state.chunks);
      assert.deepEqual(streamed.map((event) => event.name), ["submitted", "done"]);
      assert.equal(streamed[0].data.providerTaskId, "task-id");
      assert.equal(streamed[1].data.provider, "88api");
    }
    const terminal = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id)!;
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.meta.providerTaskId, "task-id");
    const filename = String(terminal.meta.filename);
    const sidecar = JSON.parse(readFileSync(join(context().config.storage.generatedDir, `${filename}.json`), "utf8"));
    assert.equal(sidecar.provider, "88api");
    assert.equal(sidecar.model, "SD2.5 720P");
    assert.equal(sidecar.video.duration, 30);
    assert.equal(sidecar.video.providerTaskId, "task-id");
    assert.equal(sidecar.providerUrl, artifact);
    assert.equal(sidecar.video.xaiVideoRequestId, undefined);
    assert.ok(!JSON.stringify(sidecar).includes("video-key"));
    const output = readdirSync(context().config.storage.generatedDir);
    assert.ok(output.includes(filename));
    assert.ok(output.includes(`${filename}.json`));
    assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
  });
}
test("resume route has zero upstream POST and preserves task association", async () => {
  const local = fixture(); const res = response(); const calls: string[] = [];
  upstream("resume", calls);
  await local.handlers.get("/api/video/88api/resume")!({ id: "resume", body: {
    taskId: "task-id", model: "SD2.5 720P", prompt: "A cube", sessionId: "session-1", clientNodeId: "node-1",
  } } as Request, res.res);
  assert.equal(calls.some((call) => call.startsWith("POST")), false);
  assert.deepEqual(events(res.state.chunks).map((event) => event.name), ["submitted", "done"]);
  assert.equal(listTerminalJobs({ kind: "video" }).find((job) => job.requestId === "resume")!.status, "completed");
});
test("missing video key blocks before admission and no credential substitution occurs", async () => {
  const local = app(); const ctx = context(); ctx.api88VideoKey = undefined;
  registerVideoRoutes(local.express, ctx);
  globalThis.fetch = (async () => { assert.fail("Missing video key must never fetch"); }) as typeof fetch;
  const res = response();
  await local.handlers.get("/api/video/generate")!({ id: "missing", body: { async: true, provider: "88api",
    model: "SD2.5 720P", prompt: "A cube" } } as Request, res.res);
  assert.equal(res.state.statusCode, 401);
  assert.equal(res.state.jsonBody?.code, "API88_VIDEO_KEY_MISSING");
  assert.equal(listJobs({ kind: "video" }).length, 0);
});
test("video catalog readiness is media-key-specific after removing wp2 lock", () => {
  const ctx = context(); ctx.api88ImageKey = undefined;
  const ids = new Set(Object.keys(API88_VIDEO_SPECS));
  assert.equal(api88VideoModelsForContext(ctx, ids).every((row) => row.executable), true);
  ctx.api88VideoKey = undefined; ctx.api88ImageKey = "image-only";
  assert.equal(api88VideoModelsForContext(ctx, ids).every((row) => !row.executable && row.lockReason === "API88_VIDEO_KEY_MISSING"), true);
});
test("meta merge preserves admission fields and terminal recovery id", () => {
  startJob({ requestId: "merge", kind: "video", prompt: "Original prompt",
    meta: { sessionId: "session-1", clientNodeId: "node-1", model: "SD2.5 720P", provider: "88api" } });
  assert.equal(mergeJobMeta("merge", { providerTaskId: "saved-id" }), true);
  const job = listJobs({ kind: "video" })[0];
  assert.equal(job.prompt, "Original prompt");
  assert.equal(job.meta.clientNodeId, "node-1");
  finishJob("merge", { status: "error", httpStatus: 504, errorCode: "API88_VIDEO_TIMEOUT" });
  assert.equal(listTerminalJobs({ kind: "video" })[0].meta.providerTaskId, "saved-id");
  assert.equal(mergeJobMeta("merge", { providerTaskId: "replacement" }), false);
});
for (const model of ["gemini-omni-flash", "seedance-2.0-mini-480p", "seedance-2.0-mini-720p"]) {
  for (const sourceKind of ["sourceFilename", "providerUrl"] as const) {
    test(`${model}: reference-only ${sourceKind} infers reference mode`, async () => {
      const ctx = context();
      mkdirSync(ctx.config.storage.generatedDir, { recursive: true });
      const filename = "reference-only.png";
      const url = "https://cdn.example/reference.png?sig=A%2FB&keep=1";
      writeFileSync(join(ctx.config.storage.generatedDir, filename), Buffer.from("89504e470d0a1a0a", "hex"));
      writeFileSync(join(ctx.config.storage.generatedDir, `${filename}.json`), JSON.stringify({ providerUrl: url }));
      globalThis.fetch = (async () => { assert.fail("Reference resolution must not fetch or submit"); }) as typeof fetch;
      const source = sourceKind === "sourceFilename" ? { sourceFilename: filename } : { providerUrl: url };
      const prepared = await prepareApi88Video(ctx, { model, prompt: "A cube", ...source }, false);
      assert.equal(prepared.video.mode, "reference-to-video");
      assert.deepEqual(prepared.input?.images, [url]);
      assert.equal(prepared.input?.firstFrame, undefined);
      assert.deepEqual(buildApi88VideoBody(prepared.input!).images, [url]);
    });
  }
}
for (const outcome of ["canceled", "expired"] as const) {
  test(`known task accepted before ${outcome} retains durable metadata without execution`, async () => {
    const id = `late-${outcome}`;
    const local = fixture();
    const res = response();
    const calls: string[] = [];
    let before: ReturnType<typeof listTerminalJobs>[number] | undefined;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      assert.equal(init?.method, "POST");
      assert.equal(String(url), "https://api.example/v1/videos");
      const accepted = Response.json({ id: "accepted-before-stop" });
      const decode = accepted.json.bind(accepted);
      accepted.json = async () => {
        const decoded: unknown = await decode();
        if (outcome === "canceled") abortJob(id);
        else purgeStaleJobs(Date.now() + config.inflight.ttlMs + 1000);
        before = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id);
        return decoded;
      };
      return accepted;
    }) as typeof fetch;
    await local.handlers.get("/api/video/generate")!({ id, body: {
      requestId: id, provider: "88api", model: "SD2.5 720P", prompt: "A cube",
      sessionId: "session-1", clientNodeId: "node-1",
    } } as Request, res.res);
    assert.ok(before);
    const after = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id)!;
    assert.deepEqual({ ...after, meta: before.meta }, before, "outcome and timestamps must not change");
    assert.equal(after.meta.providerTaskId, "accepted-before-stop");
    assert.equal(after.meta.api88Origin, "https://api.example");
    assert.equal(after.meta.sessionId, "session-1");
    assert.equal(after.meta.clientNodeId, "node-1");
    assert.deepEqual(readTerminalJob(id, 0), after, "late metadata must be persisted, not just kept in memory");
    assert.equal(listJobs({ kind: "video" }).length, 0);
    assert.deepEqual(calls, ["POST https://api.example/v1/videos"], "no poll, download or second submit after stop");
    assert.equal(events(res.state.chunks).some((event) => event.name === "done"), false);
  });
}
test("late metadata never modifies completed or unknown jobs", () => {
  const patch = { providerTaskId: "late-id", api88Origin: "https://api.example" };
  assert.equal(mergeStoppedJobMeta("missing", patch), false);
  startJob({ requestId: "completed", kind: "video" });
  finishJob("completed");
  const before = listTerminalJobs({ kind: "video" })[0];
  assert.equal(mergeStoppedJobMeta("completed", patch), false);
  assert.deepEqual(listTerminalJobs({ kind: "video" })[0], before);
});
test("extended operations reject 88api before any upstream fetch", async () => {
  const local = app(); registerVideoExtendedRoutes(local.express, context());
  globalThis.fetch = (async () => { assert.fail("88API extended operations must not fetch"); }) as typeof fetch;
  for (const path of ["/api/video/edit", "/api/video/extend", "/api/video/extend/native", "/api/video/analyze"]) {
    const res = response();
    await local.handlers.get(path)!({ id: path, body: { provider: "88api", prompt: "A cube" } } as Request, res.res);
    assert.equal(res.state.statusCode, 400);
    assert.equal(res.state.jsonBody?.code, "API88_VIDEO_OPTION_UNSUPPORTED");
  }
});

test("terminal failure followed by the same requestId returns 409 without another upstream call", async () => {
  const local = fixture(); const id = "ledger-terminal-failure";
  const calls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(url)}`);
    if (init?.method === "POST") {
      assert.equal(String(url), "https://api.example/v1/videos");
      assert.equal((await findApi88VideoTask(context(), id))?.phase, "submitting");
      return Response.json({ id: "ledger-failed-task" });
    }
    assert.equal(String(url), "https://api.example/v1/videos/ledger-failed-task");
    return Response.json({ status: "failed" });
  }) as typeof fetch;
  const body = { requestId: id, provider: "88api", model: "SD2.5 720P", prompt: "A cube" };
  await local.handlers.get("/api/video/generate")!({ id, body } as Request, response().res);
  assert.equal(listTerminalJobs()[0].errorCode, "API88_VIDEO_FAILED");
  assert.equal((await findApi88VideoTask(context(), id))?.phase, "failed");
  const count = calls.length;
  for (const async of [true, false]) {
    const res = response();
    await local.handlers.get("/api/video/generate")!({ id, body: { ...body, async } } as Request, res.res);
    assert.equal(res.state.statusCode, 409);
    assert.equal(res.state.jsonBody?.code, "API88_VIDEO_ALREADY_SUBMITTED");
    assert.equal(res.state.jsonBody?.providerTaskId, "ledger-failed-task");
    assert.equal(calls.length, count);
  }
  assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
});

test("uncertain submit is durable and refuses re-entry even after clearing terminal state", async () => {
  const local = fixture(); const id = "ledger-uncertain"; let posts = 0;
  const prompt = `private-ledger-prompt-${"x".repeat(400)}`;
  const reference = "https://cdn.example/private-ledger-reference.png";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), "https://api.example/v1/videos");
    assert.equal(init?.method, "POST"); posts += 1;
    throw new Error("video-key image-key must not enter the ledger");
  }) as typeof fetch;
  const body = { requestId: id, provider: "88api", model: "SD2.5 720P", prompt, referenceImages: [reference] };
  await local.handlers.get("/api/video/generate")!({ id, body } as Request, response().res);
  const entry = await findApi88VideoTask(context(), id);
  assert.equal(entry?.phase, "uncertain");
  assert.equal(entry?.error, "API88_VIDEO_SUBMIT_UNCERTAIN");
  _resetForTests();
  const res = response();
  await local.handlers.get("/api/video/generate")!({ id, body: { ...body, async: true } } as Request, res.res);
  assert.equal(res.state.statusCode, 409);
  assert.equal(res.state.jsonBody?.code, "API88_VIDEO_ALREADY_SUBMITTED");
  assert.equal(posts, 1);
  const file = readFileSync(api88VideoLedgerPath(context()), "utf8");
  for (const secret of ["video-key", "image-key", prompt, reference]) assert.equal(file.includes(secret), false);
});

test("taskId-only resume survives terminal loss and uses the recorded origin after configuration changes", async () => {
  const id = "ledger-recover"; const taskId = "ledger-task/a b";
  const local = fixture(); const calls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url); calls.push(`${init?.method} ${target}`);
    if (init?.method === "POST") {
      assert.equal(target, "https://api.example/v1/videos"); return Response.json({ id: taskId });
    }
    assert.equal(target, `https://api.example/v1/videos/${encodeURIComponent(taskId)}`);
    return Response.json({ status: "unknown" });
  }) as typeof fetch;
  await local.handlers.get("/api/video/generate")!({ id, body: {
    requestId: id, provider: "88api", model: "SD2.5 720P", prompt: "A cube",
  } } as Request, response().res);
  assert.equal(listTerminalJobs()[0].errorCode, "API88_VIDEO_STATUS_UNKNOWN");
  _resetForTests(); // Simulate losing both inflight and TTL-limited terminal history.
  assert.equal(listTerminalJobs().length, 0);
  const resumed = app(); const ctx = context();
  ctx.config.api88Provider.baseUrl = "https://changed.example";
  registerVideoRoutes(resumed.express, ctx, { now: () => 0, sleep: async () => {}, thumbnail: async () => {} });
  const count = calls.length;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url); calls.push(`${init?.method ?? "GET"} ${target}`);
    assert.notEqual(init?.method, "POST");
    if (target === artifact) return new Response(bytes);
    assert.equal(target, `https://api.example/v1/videos/${encodeURIComponent(taskId)}`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer video-key");
    return Response.json({ status: "completed", url: artifact });
  }) as typeof fetch;
  const res = response();
  await resumed.handlers.get("/api/video/88api/resume")!({ id: "ledger-resume", body: { taskId } } as Request, res.res);
  assert.deepEqual(events(res.state.chunks).map((event) => event.name), ["submitted", "done"]);
  const done = events(res.state.chunks).at(-1)!.data;
  assert.equal(done.model, "SD2.5 720P");
  assert.equal(done.providerTaskId, taskId);
  assert.equal(calls.slice(count).every((call) => call.startsWith("GET")), true);
  assert.equal((await findApi88VideoTask(ctx, taskId, true))?.phase, "completed");
  const listing = response();
  await resumed.handlers.get("/api/video/88api/tasks")!({} as Request, listing.res);
  const tasks = listing.state.jsonBody?.tasks as Array<Record<string, unknown>>;
  assert.equal(tasks[0].taskId, taskId);
  assert.equal(tasks[0].requestId, id);
  assert.ok(tasks.length <= 50);
  assert.equal(JSON.stringify(tasks).includes("video-key"), false);
});

test("ledger path respects IMA2_CONFIG_DIR and concurrent reservations allow one durable attempt", async () => {
  const ctx = { config: { ...config, storage: { ...config.storage, configDir: join(root, "ledger-lock") } } };
  assert.equal(api88VideoLedgerPath(context()), join(root, "88api-video-tasks.jsonl"));
  assert.equal(api88VideoLedgerPath(ctx), join(root, "ledger-lock", "88api-video-tasks.jsonl"));
  const attempts = await Promise.allSettled([
    beginApi88VideoTask(ctx, "same", "SD2.5 720P", "https://api.example/v1/"),
    beginApi88VideoTask(ctx, "same", "SD2.5 720P", "https://api.example/v1/"),
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = attempts.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "API88_VIDEO_ALREADY_SUBMITTED");
  const path = api88VideoLedgerPath(ctx);
  const before = readFileSync(path, "utf8");
  assert.equal(before.trim().split("\n").length, 1);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  await recordApi88VideoTask(ctx, { requestId: "same", model: "SD2.5 720P", origin: "https://api.example",
    phase: "submitted", taskId: "task-id" });
  const after = readFileSync(path, "utf8");
  assert.ok(after.startsWith(before), "updating phase must append, never replace earlier records");
  await assert.rejects(beginApi88VideoTask(ctx, "same", "SD2.5 720P", "https://api.example"),
    (error: unknown) => (error as { providerTaskId: string }).providerTaskId === "task-id");
});

test("fresh index lists 50 recent tasks and still refuses IDs older than its 2000-line tail", async () => {
  const ctx = { config: { ...config, storage: { ...config.storage, configDir: join(root, "ledger-history") } } };
  mkdirSync(ctx.config.storage.configDir);
  const rows = Array.from({ length: 2101 }, (_, i) => ({ requestId: `request-${i}`, taskId: `task-${i}`,
    phase: "failed", model: "SD2.5 720P", origin: "https://api.example", createdAt: i, updatedAt: i,
    error: "API88_VIDEO_TIMEOUT" }));
  writeFileSync(api88VideoLedgerPath(ctx), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
  const recent = await listApi88VideoTasks(ctx);
  assert.equal(recent.length, 50);
  assert.equal(recent[0].requestId, "request-2100");
  assert.equal(recent.at(-1)?.requestId, "request-2051");
  assert.equal((await findApi88VideoTask(ctx, "task-0", true))?.model, "SD2.5 720P");
  await assert.rejects(beginApi88VideoTask(ctx, "request-0", "SD2.5 720P", "https://api.example"),
    (error: unknown) => (error as { code: string }).code === "API88_VIDEO_ALREADY_SUBMITTED");
  assert.equal(readFileSync(api88VideoLedgerPath(ctx), "utf8").trim().split("\n").length, 2101);
});
