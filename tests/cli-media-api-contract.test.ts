import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { normalizeMediaBody, filterCatalog, publicCatalog, uploadInputs, submitMedia, waitJob, result, history, workflowRun } from "../bin/lib/mediaApi.js";
import { buildMediaToolDescriptors } from "../lib/providers/media/toolSchema.js";
import { parseMediaJobBody } from "../lib/providers/media/validate.js";

async function fake(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return { base: `http://127.0.0.1:${address.port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
const json = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };

test("normalization and catalog filtering remove private values", () => {
  assert.deepEqual(normalizeMediaBody({ model: "m", prompt: null, inputs: [{ role: "source", ref: "", url: "HTTPS://example.test", mimeType: null }] }), { model: "m", inputs: [{ role: "source", url: "HTTPS://example.test" }] });
  const data = { adapters: [{ maskedKey: "sentinel", extraFields: [{ value: "secret" }] }], models: [{ id: "m", vendor: "v", tasks: ["text-to-image"], routes: [{ adapter: "a", hasKey: true, pricing: [{ usd: 0.1 }] }, { adapter: "b", hasKey: false, pricing: [{ usd: 1 }] }] }] };
  assert.equal(filterCatalog(data, { adapter: "a", keyed: true, maxUsd: 0.2 }).models[0]?.routes.length, 1);
  assert.doesNotMatch(JSON.stringify(publicCatalog(data)), /sentinel|secret/);
});

test("missing inputs fail before uploading", async () => {
  let calls = 0;
  const server = await fake((_req, res) => { calls++; json(res, {}); });
  try { await assert.rejects(uploadInputs(server.base, [{ role: "source", path: "/no-such-l8-file.png" }]), { code: "MEDIA_INPUT_NOT_FOUND" }); assert.equal(calls, 0); } finally { server.close(); }
});

test("duplicate request IDs and server failures never submit", async () => {
  let mode = "history", posts = 0;
  const server = await fake((req, res) => {
    if (req.method === "POST") { posts++; json(res, {}); return; }
    if (req.url?.startsWith("/api/media/jobs/")) return json(res, { code: mode === "failure" ? "BROKEN" : "MEDIA_JOB_UNKNOWN", error: "no" }, mode === "failure" ? 500 : 404);
    if (req.url?.startsWith("/api/history")) return json(res, { items: mode === "history" ? [{ filename: "audio.mp3" }] : [] });
    json(res, {});
  });
  try {
    await assert.rejects(submitMedia(server.base, { model: "m" }, { requestId: "a", wait: false, timeoutMs: 100 }), { code: "REQUEST_ID_IN_USE" });
    mode = "failure";
    await assert.rejects(submitMedia(server.base, { model: "m" }, { requestId: "a", wait: false, timeoutMs: 100 }), { code: "BROKEN" });
    assert.equal(posts, 0);
  } finally { server.close(); }
});

test("wait timeout returns the job status and result status is reported", async () => {
  let status = "running";
  const server = await fake((req, res) => {
    if (req.url === "/api/events") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": connected\n\n"); return; }
    if (req.url?.startsWith("/api/history")) return json(res, { items: [] });
    json(res, { requestId: "a", status });
  });
  try {
    const waited = await waitJob(server.base, "a", { timeoutMs: 30 });
    assert.equal(waited.timedOut, true);
    assert.equal(waited.pollAfterSeconds, 5);
    await assert.rejects(result(server.base, "a"), { code: "MEDIA_RESULT_PENDING" });
    status = "done";
    await assert.rejects(result(server.base, "a"), { code: "MEDIA_RESULT_MISSING" });
  } finally { server.close(); }
});

test("wait returns the job status when the job fails", async () => {
  let stream: ServerResponse | undefined;
  let status = "running";
  const server = await fake((req, res) => {
    if (req.url === "/api/events") {
      stream = res; res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ready\n\n");
      setTimeout(() => { status = "error"; stream?.write('event: error\ndata: {"jobId":"a","code":"BYTEPLUS_REAL_PERSON_BLOCKED","error":"blocked","category":"moderation"}\n\n'); }, 20);
      return;
    }
    json(res, { job: { requestId: "a", status } });
  });
  try {
    const waited = await waitJob(server.base, "a", { timeoutMs: 2000 });
    assert.equal(waited.pollAfterSeconds, 0);
    assert.equal(waited.timedOut, undefined);
  } finally { server.close(); }
});

test("a recently finished request ID is refused without posting", async () => {
  let posts = 0;
  const server = await fake((req, res) => {
    if (req.method === "POST") { posts++; json(res, {}); return; }
    if (req.url?.startsWith("/api/media/jobs/")) return json(res, { job: { requestId: "done-1", status: "completed" } });
    json(res, { items: [] });
  });
  try {
    await assert.rejects(submitMedia(server.base, { model: "m", task: "text-to-image" }, { requestId: "done-1", wait: false, timeoutMs: 100 }), { code: "REQUEST_ID_IN_USE" });
    assert.equal(posts, 0);
  } finally { server.close(); }
});

test("every parser-accepted body passes the published schema after client normalization", () => {
  const estimate = buildMediaToolDescriptors([]).find((tool) => tool.name === "media_estimate");
  assert.ok(estimate);
  const check = new AjvJsonSchemaValidator(new Ajv({ strict: false })).getValidator(estimate.inputSchema as never);
  const base = { model: "m", task: "text-to-image" };
  const accepted: Record<string, unknown>[] = [
    { ...base, seed: "", count: "", durationSec: "", prompt: null, adapter: "", audio: null, vendorOptions: null, inputs: null },
    { ...base, durationSec: -1, prompt: "x".repeat(20000) },
    { ...base, inputs: [{ role: "source-image", ref: "", url: "HTTPS://example.test/a.png" }] },
    { ...base, inputs: [{ role: "reference-image", url: "asset://abc_1", mimeType: "" }] },
    { ...base, inputs: [{ role: "source-image", dataUrl: "data:image/png;base64,YQ==", filename: "" }] },
    { ...base, inputs: Array.from({ length: 16 }, () => ({ role: "reference-image", filename: "a.png" })) },
  ];
  for (const body of accepted) {
    assert.doesNotThrow(() => parseMediaJobBody(body), JSON.stringify(body).slice(0, 80));
    const normalized = normalizeMediaBody(body);
    assert.equal(check(normalized).valid, true, JSON.stringify(normalized).slice(0, 120));
    const withoutInputs = (value: Record<string, unknown>) => { const { inputs: _inputs, ...rest } = value; return rest; };
    assert.deepEqual(withoutInputs({ ...parseMediaJobBody(normalized) }), withoutInputs({ ...parseMediaJobBody(body) }));
  }
  assert.deepEqual(normalizeMediaBody({ ...base, inputs: [{ role: "source-image", dataUrl: "", ref: "input:a.png" }] }).inputs, [{ role: "source-image", ref: "input:a.png" }]);
});

test("history follows cursors through non-media pages", async () => {
  const server = await fake((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.searchParams.has("before")) return json(res, { items: [{ provider: "other" }], nextCursor: { before: "1", beforeFilename: "a" } });
    json(res, { items: [{ provider: "media:x", mediaType: "audio", filename: "a.mp3" }] });
  });
  try { assert.equal((await history(server.base, { limit: 1, kind: "audio" })).items.length, 1); } finally { server.close(); }
});


test("submit opens events before posting and ignores other jobs", async () => {
  let stream: ServerResponse | undefined;
  const server = await fake((req, res) => {
    if (req.url === "/api/events") { stream = res; res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ready\n\n"); return; }
    if (req.url?.startsWith("/api/media/jobs/")) return json(res, { code: "MEDIA_JOB_UNKNOWN", error: "unknown" }, 404);
    if (req.url?.startsWith("/api/history")) return json(res, { items: [] });
    assert.ok(stream, "SSE opened before submission");
    json(res, { requestId: "fresh" }, 202);
    stream.write('event: done\ndata: {"jobId":"other"}\n\nevent: done\ndata: {"jobId":"fresh","outputs":[]}\n\n');
  });
  try { assert.equal((await submitMedia(server.base, { model: "m" }, { requestId: "fresh", wait: true, timeoutMs: 1000 })).jobId, "fresh"); } finally { server.close(); }
});

test("workflow paths are uploaded before submission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "l8-client-"));
  const path = join(dir, "sample.png");
  await writeFile(path, "fake image");
  let payload: Record<string, unknown> = {};
  const server = await fake((req, res) => {
    if (req.url === "/api/media/inputs") { req.resume(); return json(res, { ref: "asset://uploaded" }); }
    if (req.url?.startsWith("/api/media/jobs/")) return json(res, { code: "MEDIA_JOB_UNKNOWN", error: "unknown" }, 404);
    if (req.url?.startsWith("/api/history")) return json(res, { items: [] });
    const chunks: Buffer[] = []; req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => { payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>; json(res, { requestId: "w" }, 202); });
  });
  try {
    await workflowRun(server.base, "wf", { images: [{ path }] }, {}, { requestId: "w", wait: false, timeoutMs: 1000 });
    assert.deepEqual(payload.values, { images: [{ ref: "asset://uploaded" }] });
  } finally { server.close(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("history resumes after ten pages with both cursor fields", async () => {
  const seen: string[] = [];
  const server = await fake((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const index = Number(url.searchParams.get("beforeFilename") ?? "0");
    seen.push(`${url.searchParams.get("before")}:${index}`);
    json(res, index === 10 ? { items: [{ provider: "workflow:x", mediaType: "image", filename: "last" }] } :
      { items: [{ provider: "other" }], nextCursor: { before: "same-time", beforeFilename: String(index + 1) } });
  });
  try {
    const first = await history(server.base, { limit: 1 });
    assert.equal(first.truncated, true);
    assert.deepEqual(first.cursor, { before: "same-time", beforeFilename: "10" });
    const second = await history(server.base, { limit: 1, cursor: first.cursor });
    assert.equal(second.items[0]?.filename, "last");
    assert.equal(seen[10], "same-time:10");
  } finally { server.close(); }
});

test("normalization retains parser boundary samples", () => {
  for (const input of [
    { role: "source", url: "HTTPS://example.test/a", ref: null, mimeType: "" },
    { role: "source", ref: "asset://abc_1", url: "" },
    { role: "source", dataUrl: "data:image/png;base64,YQ==" },
  ]) assert.deepEqual(normalizeMediaBody({ model: "m", task: "t", prompt: null, inputs: [input] }).inputs, [Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== ""))]);
  assert.deepEqual(normalizeMediaBody({ model: "", task: "", inputs: null }), { model: "", task: "" });
  assert.equal((normalizeMediaBody({ model: "m", prompt: "x".repeat(20000), inputs: Array(16).fill({ role: "source", ref: "asset://abc_1" }), durationSec: -1 }).inputs as unknown[]).length, 16);
});
