import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executionChildEnv } from "./_executionTestProcess.ts";

type Reply = { status?: number; body: unknown };
type RequestRecord = { method: string; url: string; ifMatch?: string; body: unknown };
type Route = (request: RequestRecord) => Reply;
const NODES = [
  { id: "node-a", x: 15, y: 25, data: { prompt: "synthetic graph", serverNodeId: "n_fixture" } },
  { id: "node-b", x: 30, y: 40, data: { prompt: "synthetic child", serverNodeId: "n_child" } },
];
const EDGES = [{ id: "edge-z", source: "node-a", target: "node-b", data: { sourceHandle: "source-right" } }];

async function requestRecord(req: IncomingMessage): Promise<RequestRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return { method: req.method ?? "GET", url: req.url ?? "/", ifMatch: req.headers["if-match"],
    body: raw ? JSON.parse(raw) : null };
}

async function fixture(route: Route) {
  const root = await mkdtemp(join(tmpdir(), "ima2-cli-graph-"));
  const requests: RequestRecord[] = [];
  const server = createServer((req, res: ServerResponse) => {
    void requestRecord(req).then((request) => {
      requests.push(request);
      const reply = request.url === "/api/health" ? { body: { ok: true } } : route(request);
      res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    }).catch(() => { res.writeHead(500); res.end("fixture request failed"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return { root, requests, async cli(...args: string[]) {
    const child = spawn(process.execPath, ["bin/ima2.js", "session", "graph", ...args, "--server", base], {
      env: { ...executionChildEnv(), NO_COLOR: "1", IMA2_CONFIG_DIR: join(root, "config") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      return { code, stdout, stderr };
    } finally { clearTimeout(timer); }
  }, async close() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  } };
}

for (const nested of [false, true]) test(`emitted graph load/save roundtrip accepts ${nested ? "legacy nested" : "current flat"} session`, async (t) => {
  const graph = { version: 7, nodes: NODES, edges: EDGES };
  const f = await fixture((req) => req.method === "PUT" ? { body: { graphVersion: 8 } }
    : { body: { session: nested ? { graph } : { graphVersion: 7, nodes: NODES, edges: EDGES } } });
  t.after(() => f.close());
  const file = join(f.root, "portable graph.json");
  const load = await f.cli("load", "fixture", "--out", file);
  assert.equal(load.code, 0, load.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), graph);
  const save = await f.cli("save", "fixture", file, "--json");
  assert.equal(save.code, 0, save.stderr);
  assert.deepEqual(JSON.parse(save.stdout), { graphVersion: 8 });
  const puts = f.requests.filter((req) => req.method === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0]!.ifMatch, '"7"');
  assert.deepEqual(puts[0]!.body, { nodes: NODES, edges: EDGES });
});

test("new session first save uses version zero and empty graph loads to stdout", async (t) => {
  const f = await fixture((req) => req.method === "PUT" ? { body: { graphVersion: 1 } }
    : { body: { session: { id: "fixture", nodes: [], edges: [] } } });
  t.after(() => f.close());
  const file = join(f.root, "empty.json");
  await writeFile(file, JSON.stringify({ nodes: [], edges: [] }));
  assert.equal((await f.cli("save", "fixture", file)).code, 0);
  assert.equal(f.requests.find((req) => req.method === "PUT")!.ifMatch, '"0"');
  const result = await f.cli("load", "fixture");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { version: 0, nodes: [], edges: [] });
});

test("missing session fails without a save or output file", async (t) => {
  const f = await fixture(() => ({ body: { session: null } }));
  t.after(() => f.close());
  const input = join(f.root, "input.json");
  const output = join(f.root, "absent-output.json");
  await writeFile(input, JSON.stringify({ nodes: [], edges: [] }));
  for (const args of [["load", "absent", "--out", output], ["save", "absent", input]]) {
    const result = await f.cli(...args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /session not found/);
  }
  await assert.rejects(readFile(output), { code: "ENOENT" });
  assert.equal(f.requests.some((req) => req.method === "PUT"), false);
});

test("graph version conflict is a failure and is never retried", async (t) => {
  const f = await fixture((req) => req.method === "PUT"
    ? { status: 409, body: { error: { code: "GRAPH_VERSION_CONFLICT", message: "fixture conflict" } } }
    : { body: { session: { graphVersion: 3, nodes: [], edges: [] } } });
  t.after(() => f.close());
  const file = join(f.root, "graph.json");
  await writeFile(file, JSON.stringify({ nodes: [], edges: [] }));
  const result = await f.cli("save", "fixture", file);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /graph version conflict/);
  assert.equal(f.requests.filter((req) => req.method === "PUT").length, 1);
});

test("malformed graph file is rejected before contacting the server", async (t) => {
  const f = await fixture(() => ({ body: {} }));
  t.after(() => f.close());
  const file = join(f.root, "invalid.json");
  for (const raw of ["{", "null", "[]", '{"nodes":{},"edges":[]}']) {
    await writeFile(file, raw);
    const result = await f.cli("save", "fixture", file);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /graph file/);
  }
  assert.deepEqual(f.requests, []);
});
