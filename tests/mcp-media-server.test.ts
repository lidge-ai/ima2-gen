import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMediaMcpServer } from "../bin/lib/mcpServer.js";
import { buildMediaToolDescriptors, workflowValuesSchema } from "../lib/providers/media/toolSchema.js";
import { WORKFLOWS } from "../lib/workflows/index.js";

const descriptors = buildMediaToolDescriptors(WORKFLOWS);
const workflow = WORKFLOWS.find((item) => item.id === "remix-restyle")!;
const secrets = ["0123456789abcdef0123456789abcdef", "s3cr3t", "redact"];
const filename = "a #한글.png";
const media = { model: "fake/image", task: "text-to-image", requestId: "req-1" };
const wf = { id: workflow.id, values: { video: [{ ref: "asset://source" }] }, requestId: "wf-1" };
const closeAll: Array<() => Promise<void>> = [];
afterEach(async () => { while (closeAll.length) await closeAll.pop()!(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
type Gate = { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
function gate(): Gate { return { entered: deferred(), release: deferred() }; }
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  const raw = Buffer.concat(parts).toString();
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
function projectJob(kind: "media" | "workflow", terminal = false) {
  return { requestId: "running", kind, ...(terminal ? { status: "completed", finishedAt: 123 } : {}),
    startedAt: 100, phase: "render", phaseAt: 110, progress: 42,
    meta: { adapter: "fake", model: "fake/image", workflow: workflow.id, sessionId: "session", kind, filename,
      apiKey: secrets[0], extra: secrets[1], unknown: secrets[2] }, secret: secrets[0] };
}
function historyItem() {
  return { filename, url: `/generated/${encodeURIComponent(filename)}`, mediaType: "image", mimeType: "image/png",
    provider: "media:fake", model: "fake/image", requestId: "req-1", prompt: "hello", createdAt: 12,
    secret: secrets[0], metadata: { apiKey: secrets[1], extra: secrets[2] } };
}

type FixtureState = {
  calls: Array<{ method: string; path: string; data: Record<string, unknown> }>;
  streams: Set<ServerResponse>;
  streamOpened: ReturnType<typeof deferred>;
  streamClosed: ReturnType<typeof deferred>;
  hold?: { path: string; gate: Gate };
  failure?: { path: string; status: number };
  failToolsNetwork: boolean;
  historyPages: boolean;
  existing: boolean;
  autoDone: boolean;
  emptyDone: boolean;
  redirectTools: boolean;
  event: (name: string, data: object) => void;
};

function fixtureState(): FixtureState {
  const streams = new Set<ServerResponse>();
  return { calls: [], streams, streamOpened: deferred(), streamClosed: deferred(),
    failToolsNetwork: false, historyPages: false, existing: false, autoDone: true, emptyDone: false, redirectTools: false,
    event: (name, data) => { for (const stream of streams) stream.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } };
}

function respondWorkflow(state: FixtureState, path: string, data: Record<string, unknown>, res: ServerResponse) {
  if (path === "/api/workflows") return json(res, { workflows: [{ id: workflow.id, label: workflow.label }] });
  if (path === `/api/workflows/${workflow.id}/schema`) return json(res, { id: workflow.id, label: workflow.label, schema: workflowValuesSchema(workflow.fields) });
  if (path.endsWith("/estimate")) return json(res, { estimate: { usd: 1 }, steps: [] });
  if (path === "/api/media" || path === `/api/workflows/${workflow.id}`) {
    const requestId = String(data.requestId);
    json(res, path === "/api/media" ? { requestId, model: "fake/image", adapter: "fake" } : { requestId, workflow: workflow.id, estimate: {}, steps: [] }, 202);
    if (state.autoDone) queueMicrotask(() => {
      state.event("progress", { jobId: requestId, progress: 20, phase: "working" });
      state.event("step", { jobId: requestId, progress: 60, phase: "render" });
      state.event("done", { jobId: requestId, requestId, model: "fake/image", adapter: "fake", outputs: state.emptyDone ? [] : [{ filename, url: `/generated/${encodeURIComponent(filename)}`, mediaType: "image", mimeType: "image/png" }], ...(state.emptyDone ? { filename: null, url: null, mediaType: null } : {}) });
    });
    return;
  }
  json(res, { code: "FAKE_NOT_FOUND", error: path }, 404);
}

function respondFixture(state: FixtureState, path: string, url: URL, data: Record<string, unknown>, res: ServerResponse) {
  if (path === "/api/media/tools") return json(res, { version: 1, tools: descriptors });
  if (path === "/api/media/catalog") return json(res, { models: [], adapters: [{ id: "fake", maskedKey: secrets[0], extraFields: [{ name: "extra", value: secrets[1] }], status: { maskedKey: secrets[2] } }] });
  if (path === "/api/keys/vocabulary") return json(res, { vocabularies: [{ vocabulary: "fake", extraFields: [{ name: "x", value: secrets[0] }] }] });
  if (path === "/api/keys/status") return json(res, { fake: { configured: true, source: "config", maskedKey: secrets[1], value: secrets[2] } });
  if (path === "/api/media/estimate") return json(res, { model: "fake/image", adapter: "fake", usd: 1, prices: [] });
  if (path === "/api/media/inputs") return json(res, { ref: "asset://uploaded" });
  if (path === "/api/media/jobs") return json(res, { jobs: [projectJob("media"), projectJob("workflow")], terminalJobs: [projectJob("media", true), projectJob("workflow", true)] });
  if (path.startsWith("/api/media/jobs/")) {
    if (path.endsWith("running")) return json(res, { job: projectJob("media") });
    if (state.existing) return json(res, { job: projectJob("media") });
    return json(res, { code: "MEDIA_JOB_UNKNOWN", error: "unknown", status: 404 }, 404);
  }
  if (path.endsWith("/cancel")) return json(res, { ok: true, requestId: "running", active: true, aborted: true });
  if (path === "/api/history") {
    const page = Number(url.searchParams.get("before") ?? "0");
    const items = url.searchParams.has("requestId") ? (state.existing ? [historyItem()] : []) : [historyItem()];
    return json(res, { items, ...(state.historyPages ? { nextCursor: { before: page + 1, beforeFilename: `page-${page}` } } : {}) });
  }
  if (path.startsWith("/generated/")) { res.writeHead(200, { "content-type": "image/png" }); res.end("fake image"); return; }
  return respondWorkflow(state, path, data, res);
}

async function handleFixtureRequest(state: FixtureState, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, "http://localhost");
  const path = url.pathname;
  const data = req.method === "POST" ? await body(req) : {};
  state.calls.push({ method: req.method!, path: path + url.search, data });
  if (state.hold?.path === path) { const barrier = state.hold.gate; barrier.entered.resolve(); await barrier.release.promise; }
  if (state.failure?.path === path) { json(res, { ok: false, code: "FAKE_ERROR", error: "fake error", category: "invalid-request", extra: secrets[0] }, state.failure.status); return; }
  if (path === "/api/media/tools" && state.failToolsNetwork) { req.socket.destroy(); return; }
  if (path === "/api/media/tools" && state.redirectTools) { res.writeHead(302, { location: "/elsewhere" }); res.end(); return; }
  if (path === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(": connected\n\n"); state.streams.add(res); state.streamOpened.resolve();
    res.on("close", () => { state.streams.delete(res); state.streamClosed.resolve(); }); return;
  }
  return respondFixture(state, path, url, data, res);
}

async function fixture() {
  const state = fixtureState();
  const logs: string[] = [];
  const server = createServer((req, res) => handleFixtureRequest(state, req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closeAll.push(async () => { for (const stream of state.streams) stream.destroy(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls: state.calls, logs, event: state.event, streamOpened: state.streamOpened, streamClosed: state.streamClosed,
    setHold: (path: string, value: Gate) => { state.hold = { path, gate: value }; },
    setFailure: (path: string, status: number) => { state.failure = { path, status }; },
    setNetworkFailure: () => { state.failToolsNetwork = true; }, setHistoryPages: () => { state.historyPages = true; },
    setRedirect: () => { state.redirectTools = true; },
    setExisting: () => { state.existing = true; }, setEmptyDone: () => { state.emptyDone = true; }, setAutoDone: (value: boolean) => { state.autoDone = value; } };
}
async function connect(base: () => Promise<string>, logs: string[] = []) {
  const server = createMediaMcpServer({ resolveBase: base, version: "test", log: (message: string) => logs.push(message) });
  const client = new Client({ name: "fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeAll.push(async () => { await client.close(); await server.close(); });
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}
function content(result: unknown) { return JSON.stringify(result); }
function posts(calls: Array<{ method: string }>) { return calls.filter((item) => item.method === "POST"); }

const cases: Array<[string, Record<string, unknown>]> = [
  ["media_catalog", {}], ["media_keys_status", {}], ["media_estimate", { model: media.model, task: media.task }],
  ["media_submit", media], ["media_job_status", { requestId: "running" }], ["media_wait", { requestId: "running", timeoutSec: 1 }],
  ["media_jobs", { all: true }], ["media_cancel", { requestId: "running" }], ["media_result", { requestId: "req-1" }],
  ["media_history", {}], ["workflow_list", {}], ["workflow_schema", { id: workflow.id }],
  ["workflow_estimate", { id: workflow.id, values: wf.values }], ["workflow_run", wf],
];

test("listTools preserves all 14 server schemas, ordering and annotations", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base);
  const list = await client.listTools();
  assert.equal(list.tools.length, 14);
  assert.deepEqual(list.tools, descriptors.map(({ name, title, description, inputSchema, outputSchema, annotations }) =>
    ({ name, title, description, inputSchema, outputSchema, annotations: { title, ...annotations } })));
});

test("SDK validates each successful output and each structured error", async () => {
  const fake = await fixture(); fake.setExisting(); const client = await connect(async () => fake.base);
  await client.listTools();
  for (const [name, args] of cases) {
    const actualArgs = name === "media_submit" || name === "workflow_run" ? { ...args, requestId: "fresh" } : args;
    if (name === "media_submit" || name === "workflow_run") continue; // exercised with fresh fixture below
    const result = await call(client, name, actualArgs);
    assert.equal(result.isError, undefined, `${name}: ${content(result)}`);
    assert.equal(typeof result.structuredContent, "object");
  }
  for (const [name] of cases) {
    const invalid = await call(client, name, { unexpected: true });
    assert.equal(invalid.isError, true, name);
    assert.equal((invalid.structuredContent as Record<string, unknown>).code, "MCP_ARGUMENT_INVALID", name);
  }
});

test("submit and workflow run accept asynchronous and empty synchronous output variants", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
  for (const [name, args] of [["media_submit", media], ["workflow_run", wf]] as const) {
    const asyncResult = await call(client, name, { ...args, wait: false });
    assert.equal(asyncResult.isError, undefined, content(asyncResult));
    assert.equal((asyncResult.structuredContent as Record<string, unknown>).requestId, args.requestId);
    const syncResult = await call(client, name, { ...args, requestId: `${args.requestId}-sync`, wait: true });
    assert.equal(syncResult.isError, undefined, content(syncResult));
    assert.ok(syncResult.content && content(syncResult).includes("resource_link"));
  }
});


test("SDK accepts empty outputs and nullable output properties for both billed tools", async () => {
  const fake = await fixture(); fake.setEmptyDone(); const client = await connect(async () => fake.base); await client.listTools();
  for (const [name, args] of [["media_submit", media], ["workflow_run", wf]] as const) {
    const result = await call(client, name, { ...args, wait: true });
    assert.equal(result.isError, undefined, content(result));
    const data = result.structuredContent as Record<string, unknown>;
    assert.deepEqual(data.outputs, []);
    assert.equal(data.filename, null); assert.equal(data.url, null); assert.equal(data.mediaType, null);
  }
});

test("invalid arguments do not perform HTTP requests after descriptor cache is warm", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
  assert.equal(fake.calls.filter((item) => item.path === "/api/media/tools").length, 1);
  fake.calls.length = 0;
  for (const [name, args] of [["media_submit", { ...media, inputs: [{ role: "source-image", path: "/a.png", ref: "asset://x" }] }],
    ["workflow_run", { ...wf, values: { video: [{ path: "/a.png", ref: "asset://x" }] } }],
    ["workflow_estimate", { id: workflow.id, values: { video: "invalid" } }]] as const) {
    const result = await call(client, name, args); assert.equal(result.isError, true, name);
  }
  assert.equal(fake.calls.length, 0);
  const unknown = await call(client, "not_a_tool", {});
  assert.equal((unknown.structuredContent as Record<string, unknown>).code, "MCP_TOOL_UNKNOWN");
});

test("offline catalog is used only for unreachable resolution or descriptor network failure", async () => {
  const disconnected = await connect(async () => { throw Object.assign(new Error("offline"), { code: "SERVER_UNREACHABLE" }); });
  assert.deepEqual((await disconnected.listTools()).tools.map((tool) => tool.name), buildMediaToolDescriptors([]).map((tool) => tool.name));
  const fake = await fixture(); fake.setNetworkFailure(); const network = await connect(async () => fake.base);
  assert.equal((await network.listTools()).tools.length, 14);
  const denied = await fixture(); denied.setFailure("/api/media/tools", 401); const client = await connect(async () => denied.base);
  await assert.rejects(client.listTools());
  const redirect = await fixture(); redirect.setRedirect(); const redirected = await connect(async () => redirect.base);
  await assert.rejects(redirected.listTools());
  const invalid = await connect(async () => "not-a-server-url");
  await assert.rejects(invalid.listTools());
});

test("catalog, keys, job and history projections exclude secret fields", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base, fake.logs); await client.listTools();
  for (const [name, args] of [["media_catalog", {}], ["media_keys_status", {}], ["media_job_status", { requestId: "running" }],
    ["media_jobs", { all: true }], ["media_history", {}]] as const) {
    const result = await call(client, name, args);
    assert.equal(result.isError, undefined, content(result));
    for (const secret of secrets) assert.ok(!content(result).includes(secret), `${name} exposed ${secret}`);
    if (name === "media_jobs" || name === "media_job_status") {
      assert.match(content(result), /phaseAt/); assert.match(content(result), /sessionId/); assert.doesNotMatch(content(result), /unknown|apiKey/);
    }
  }
  for (const secret of secrets) assert.ok(!fake.logs.join("\n").includes(secret));
});

test("reused request IDs are refused before upload or submission", async () => {
  const fake = await fixture(); fake.setExisting(); const client = await connect(async () => fake.base); await client.listTools(); fake.calls.length = 0;
  for (const [name, args] of [["media_submit", media], ["workflow_run", wf]] as const) {
    const result = await call(client, name, args);
    assert.equal((result.structuredContent as Record<string, unknown>).code, "REQUEST_ID_IN_USE");
  }
  assert.equal(posts(fake.calls).length, 0);
});

test("history cursor truncation and result saving expose encoded and local resource links", async () => {
  const fake = await fixture(); fake.setExisting(); fake.setHistoryPages(); const client = await connect(async () => fake.base); await client.listTools();
  const history = await call(client, "media_history", { limit: 50 });
  assert.equal((history.structuredContent as Record<string, unknown>).truncated, true);
  assert.deepEqual((history.structuredContent as Record<string, unknown>).cursor, { before: 10, beforeFilename: "page-9" });
  const root = await mkdtemp(join(tmpdir(), "ima2-mcp-test-")); closeAll.push(() => rm(root, { recursive: true, force: true }));
  const result = await call(client, "media_result", { requestId: "req-1", saveDir: root });
  assert.equal(await readFile(join(root, filename), "utf8"), "fake image");
  assert.ok(content(result).includes(`${fake.base}/generated/${encodeURIComponent(filename)}`));
  assert.ok(content(result).includes(pathToFileURL(join(root, filename)).href));
  for (const secret of secrets) assert.ok(!content(result).includes(secret));
});

test("workflow values accept client paths, upload before estimate and reject ambiguous sources", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
  const root = await mkdtemp(join(tmpdir(), "ima2-mcp-input-")); closeAll.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.png"); await writeFile(path, "fake");
  const args = { id: workflow.id, values: { video: [{ path }] } };
  const valid = await call(client, "workflow_estimate", args); assert.equal(valid.isError, undefined, content(valid));
  const uploaded = fake.calls.findIndex((item) => item.path === "/api/media/inputs");
  const estimated = fake.calls.findIndex((item) => item.path.endsWith("/estimate"));
  assert.ok(uploaded >= 0 && estimated > uploaded);
  fake.calls.length = 0;
  const invalid = await call(client, "workflow_estimate", { ...args, values: { video: [{ path, ref: "asset://x" }] } });
  assert.equal(invalid.isError, true); assert.equal(posts(fake.calls).length, 0);
});

test("client cancellation closes the SSE wait without cancelling the billed job", async () => {
  const fake = await fixture(); fake.setAutoDone(false); const client = await connect(async () => fake.base); await client.listTools();
  const controller = new AbortController();
  const submit = gate(); fake.setHold("/api/media", submit);
  const pending = client.callTool({ name: "media_submit", arguments: { ...media, wait: true } }, undefined, { signal: controller.signal });
  await fake.streamOpened.promise; await submit.entered.promise;
  submit.release.resolve(); controller.abort(); await assert.rejects(pending); await fake.streamClosed.promise;
  assert.equal(fake.calls.filter((item) => item.path.endsWith("/cancel")).length, 0);
  const status = await call(client, "media_job_status", { requestId: "running" });
  assert.equal(status.isError, undefined); assert.match(content(status), /running/);
});

test("cancellation during request ID check or upload prevents media and workflow submission", async () => {
  for (const [name, atUpload] of [["media_submit", false], ["media_submit", true], ["workflow_run", false], ["workflow_run", true]] as const) {
    const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
    const root = await mkdtemp(join(tmpdir(), "ima2-mcp-cancel-")); closeAll.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "source.png"); await writeFile(path, "fake");
    const args = name === "media_submit" ? { ...media, inputs: [{ role: "source-image", path }] } : { ...wf, values: { video: [{ path }] } };
    const barrier = gate(); fake.setHold(atUpload ? "/api/media/inputs" : `/api/media/jobs/${args.requestId}`, barrier);
    const controller = new AbortController();
    const pending = client.callTool({ name, arguments: args }, undefined, { signal: controller.signal });
    await barrier.entered.promise; controller.abort(); await assert.rejects(pending); barrier.release.resolve();
    await call(client, "media_job_status", { requestId: "running" });
    assert.equal(fake.calls.filter((item) => item.path === "/api/media" || item.path === `/api/workflows/${workflow.id}`).length, 0, name);
    assert.equal(fake.calls.filter((item) => item.path.endsWith("/cancel")).length, 0);
  }
});

test("cancellation while opening events prevents either billed POST", async () => {
  for (const [name, args] of [["media_submit", media], ["workflow_run", wf]] as const) {
    const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
    const barrier = gate(); fake.setHold("/api/events", barrier);
    const controller = new AbortController();
    const pending = client.callTool({ name, arguments: { ...args, wait: true } }, undefined, { signal: controller.signal });
    await barrier.entered.promise; controller.abort(); await assert.rejects(pending); barrier.release.resolve();
    await call(client, "media_job_status", { requestId: "running" });
    assert.equal(fake.calls.filter((item) => item.path === "/api/media" || item.path === `/api/workflows/${workflow.id}`).length, 0);
    assert.equal(fake.calls.filter((item) => item.path.endsWith("/cancel")).length, 0);
  }
});

test("events without a progress token emit no progress notifications", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
  const received: unknown[] = [];
  client.setNotificationHandler(ProgressNotificationSchema, (notification) => { received.push(notification); });
  const result = await call(client, "media_submit", { ...media, wait: true });
  assert.equal(result.isError, undefined, content(result));
  assert.deepEqual(received, []);
});

test("SSE errors do not project unrelated secret fields", async () => {
  const fake = await fixture(); fake.setAutoDone(false);
  const client = await connect(async () => fake.base, fake.logs); await client.listTools();
  const pending = call(client, "media_submit", { ...media, wait: true });
  await fake.streamOpened.promise;
  while (!fake.calls.some((item) => item.path === "/api/media")) await new Promise((resolve) => setTimeout(resolve, 5));
  fake.event("error", { jobId: media.requestId, code: "FAKE_ERROR", error: "blocked", category: "moderation", secret: secrets[0], extra: secrets[1], unknown: secrets[2] });
  const result = await pending;
  assert.equal(result.isError, true);
  for (const secret of secrets) assert.ok(!content(result).includes(secret) && !fake.logs.join("\n").includes(secret));
});

test("media_wait returns a timeout with the still-running job", async () => {
  const fake = await fixture(); const client = await connect(async () => fake.base); await client.listTools();
  const result = await call(client, "media_wait", { requestId: "running", timeoutSec: 1 });
  assert.equal(result.isError, undefined, content(result));
  assert.equal((result.structuredContent as Record<string, unknown>).timedOut, true);
  assert.match(content(result), /running/);
});

test("progress is opt-in, bounded and monotonic for a held submission", async () => {
  const fake = await fixture(); fake.setAutoDone(false); const client = await connect(async () => fake.base); await client.listTools();
  const submission = gate(); fake.setHold("/api/media", submission);
  const progress: Array<{ progress: number; total?: number; message?: string }> = [];
  const pending = client.callTool({ name: "media_submit", arguments: { ...media, wait: true } }, undefined, {
    onprogress: (value) => { progress.push(value); },
  });
  await submission.entered.promise; submission.release.resolve();
  fake.event("progress", { jobId: media.requestId, progress: 20, phase: "working" });
  fake.event("step", { jobId: media.requestId, progress: 60, phase: "render" });
  fake.event("done", { jobId: media.requestId, requestId: media.requestId, model: media.model, adapter: "fake", outputs: [] });
  const result = await pending; assert.equal(result.isError, undefined, content(result));
  assert.ok(progress.length > 0);
  for (const [i, item] of progress.entries()) {
    assert.ok(item.progress >= 0 && item.progress <= 100); assert.equal(item.total, 100);
    if (i) assert.ok(item.progress >= progress[i - 1]!.progress);
  }
  for (const secret of secrets) assert.ok(!content(progress).includes(secret));
});

test("offline descriptors revalidate online workflow schema before uploading", async () => {
  const fake = await fixture(); let offline = true;
  const client = await connect(async () => {
    if (offline) throw Object.assign(new Error("offline"), { code: "SERVER_UNREACHABLE" });
    return fake.base;
  });
  assert.equal((await client.listTools()).tools.length, 14); offline = false;
  const root = await mkdtemp(join(tmpdir(), "ima2-mcp-offline-")); closeAll.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "source.png"); await writeFile(path, "fake");
  const invalid = await call(client, "workflow_estimate", { id: workflow.id, values: { video: [{ path, ref: "asset://other" }] } });
  assert.equal(invalid.isError, true, content(invalid));
  assert.ok(fake.calls.some((item) => item.path.endsWith("/schema")));
  assert.equal(posts(fake.calls).length, 0);
  const valid = await call(client, "workflow_estimate", { id: workflow.id, values: { video: [{ path }] } });
  assert.equal(valid.isError, undefined, content(valid));
  assert.ok(fake.calls.some((item) => item.path === "/api/media/inputs"));
});

test("HTTP error projection and logs omit untrusted secret fields", async () => {
  const fake = await fixture(); fake.setFailure("/api/media/estimate", 400);
  const client = await connect(async () => fake.base, fake.logs); await client.listTools();
  const result = await call(client, "media_estimate", { model: media.model, task: media.task });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as Record<string, unknown>).code, "FAKE_ERROR");
  for (const secret of secrets) assert.ok(!content(result).includes(secret) && !fake.logs.join("\n").includes(secret));
});
