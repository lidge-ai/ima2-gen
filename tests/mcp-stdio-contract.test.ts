import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { buildMediaToolDescriptors, MEDIA_TOOL_SCHEMA_VERSION } from "../lib/providers/media/toolSchema.js";
import { WORKFLOWS } from "../lib/workflows/index.js";

const descriptors = buildMediaToolDescriptors(WORKFLOWS);
const catalog = { adapters: [], models: [] };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ima2-mcp-stdio-"));
  const requests: string[] = [];
  const streams = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${req.method} ${path}`);
    if (path === "/api/events") {
      streams.add(res); res.on("close", () => streams.delete(res));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\n\n");
      return;
    }
    res.setHeader("content-type", "application/json");
    if (path === "/api/health") res.end(JSON.stringify({ ok: true, version: "test" }));
    else if (path === "/api/media/tools") res.end(JSON.stringify({ version: MEDIA_TOOL_SCHEMA_VERSION, tools: descriptors }));
    else if (path === "/api/media/catalog") res.end(JSON.stringify(catalog));
    else if (path === "/api/media/jobs/stdio-wait") res.end(JSON.stringify({ job: { requestId: "stdio-wait", status: "running" } }));
    else { res.statusCode = 404; res.end(JSON.stringify({ code: "NOT_FOUND", error: "unexpected request" })); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const advertise = join(root, "server.json");
  await writeFile(advertise, JSON.stringify({ url: base }));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: root, USERPROFILE: root, TMPDIR: root,
    IMA2_CONFIG_DIR: root, IMA2_GENERATED_DIR: root, IMA2_ADVERTISE_FILE: advertise,
    IMA2_SERVER: base, NO_COLOR: "1",
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return { base, env, requests, streams, async close() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(root, { recursive: true, force: true });
  } };
}

function spawnMcp(env: Record<string, string>, args: string[]) {
  return spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "mcp", ...args], { env, stdio: "pipe" });
}

function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function rawPeer(child: ChildProcessWithoutNullStreams) {
  const messages: Record<string, any>[] = [];
  let stdout = "", stderr = "";
  const waiters = new Set<() => void>();
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    for (const wake of waiters) wake();
  });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  function parseLines() {
    const lines = stdout.split("\n");
    for (let i = messages.length; i < lines.length - 1; i++) {
      const message = JSON.parse(lines[i]);
      assert.equal(message.jsonrpc, "2.0", `stdout line ${i + 1}`);
      messages.push(message);
    }
  }
  async function response(id: number) {
    const found = async (): Promise<Record<string, any>> => {
      while (true) {
        parseLines();
        const message = messages.find((entry) => entry.id === id);
        if (message) { assert.equal(message.error, undefined, JSON.stringify(message)); return message; }
        await Promise.race([new Promise<void>((resolve) => { const wake = () => { waiters.delete(wake); resolve(); }; waiters.add(wake); }), closed.then(() => { throw new Error(`child exited: ${stderr}`); })]);
      }
    };
    return deadline(found(), 15000, `response ${id}`);
  }
  return { response, closed, send(message: object) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    checkStdout() { parseLines(); assert.equal(stdout.endsWith("\n"), true, `partial stdout: ${stdout}`); },
    stderr: () => stderr };
}

async function initialize(peer: ReturnType<typeof rawPeer>) {
  peer.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "stdio-test", version: "1" },
  } });
  const init = await peer.response(1);
  assert.equal(init.result.serverInfo.name, "ima2-gen");
  peer.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

async function listRaw(peer: ReturnType<typeof rawPeer>) {
  peer.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const reply = await peer.response(2);
  assert.equal(reply.result.tools.length, 14);
  assert.deepEqual(reply.result.tools.map((tool: { name: string }) => tool.name), descriptors.map((tool) => tool.name));
}

async function stopChild(child: ChildProcessWithoutNullStreams, peer: ReturnType<typeof rawPeer>) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await deadline(peer.closed, 5000, "child cleanup");
}

test("SDK client lists tools and calls media_catalog over stdio", { timeout: 20000 }, async () => {
  const f = await fixture();
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", "bin/ima2.ts", "mcp", "--server", f.base], env: f.env, stderr: "pipe" });
  const client = new Client({ name: "stdio-test", version: "1" });
  let stderr = ""; transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    await deadline((async () => {
      await client.connect(transport);
      const result = await client.listTools();
      assert.equal(result.tools.length, 14);
      assert.deepEqual(result.tools.map((tool) => tool.name), descriptors.map((tool) => tool.name));
      const response = await client.callTool({ name: "media_catalog", arguments: {} });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      assert.deepEqual(response.structuredContent, catalog);
      assert.ok(f.requests.includes("GET /api/media/catalog"));
    })(), 15000, "SDK stdio round trip");
  } finally {
    try { await deadline(client.close(), 5000, `SDK client close (${stderr})`); }
    finally { await f.close(); }
  }
});

test("raw stdio is JSON-RPC only and exits on idle EOF", { timeout: 25000 }, async () => {
  const f = await fixture(); const child = spawnMcp(f.env, ["--server", f.base]); const peer = rawPeer(child);
  try {
    await initialize(peer); await listRaw(peer);
    child.stdin.end();
    const [code, signal] = await deadline(peer.closed, 5000, "idle EOF");
    assert.equal(signal, null); assert.equal(code, 0, peer.stderr()); peer.checkStdout();
  } finally { await stopChild(child, peer); await f.close(); }
});

test("EOF during a running wait closes the stream and exits without cancelling the job", { timeout: 25000 }, async () => {
  const f = await fixture(); const child = spawnMcp(f.env, ["--server", f.base]); const peer = rawPeer(child);
  try {
    await initialize(peer); await listRaw(peer);
    peer.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "media_wait", arguments: { requestId: "stdio-wait", timeoutSec: 60 } } });
    await deadline(new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        if (f.streams.size && f.requests.includes("GET /api/media/jobs/stdio-wait")) { clearInterval(timer); resolve(); }
      }, 10);
      peer.closed.then(() => { clearInterval(timer); reject(new Error("child exited before wait started")); });
      setTimeout(() => { clearInterval(timer); reject(new Error("wait did not start")); }, 14000).unref();
    }), 15000, "in-flight wait");
    child.stdin.end();
    const [code, signal] = await deadline(peer.closed, 5000, "in-flight EOF");
    assert.equal(signal, null); assert.equal(code, 0, peer.stderr()); peer.checkStdout();
    assert.equal(f.requests.filter((entry) => entry.includes("/cancel")).length, 0);
    await deadline(new Promise<void>((resolve) => {
      if (!f.streams.size) return resolve();
      for (const stream of f.streams) stream.once("close", resolve);
    }), 5000, "SSE close");
  } finally { await stopChild(child, peer); await f.close(); }
});

for (const args of [["--help"], ["tools", "--help"]]) {
  test(`mcp ${args.join(" ")} exits without stdin EOF or server access`, { timeout: 12000 }, async () => {
    const f = await fixture(); const child = spawnMcp(f.env, [...args, "--server", f.base]);
    const peer = rawPeer(child); let output = "";
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    try {
      const [code, signal] = await deadline(peer.closed, 5000, "help with stdin open");
      assert.equal(signal, null); assert.equal(code, 0, peer.stderr());
      assert.match(output, /ima2 mcp/i); assert.equal(f.requests.length, 0, f.requests.join(", "));
    } finally { await stopChild(child, peer); await f.close(); }
  });
}
