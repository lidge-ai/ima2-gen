import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMediaMcpServer } from "../bin/lib/mcpServer.js";
import { buildMediaToolDescriptors } from "../lib/providers/media/toolSchema.js";

type Scenario = { code: string; error: string; category: string; transport: "http" | "sse" };
const scenarios: Scenario[] = [
  { code: "MEDIA_KEY_MISSING", error: "No key saved for this route", category: "auth", transport: "http" },
  { code: "FAL_INSUFFICIENT_CREDIT", error: "Insufficient provider credit", category: "quota", transport: "sse" },
  { code: "BYTEPLUS_REAL_PERSON_BLOCKED", error: "Real person request blocked", category: "moderation", transport: "sse" },
  { code: "MEDIA_ROUTE_UNKNOWN", error: "Unknown route for this model", category: "invalid-request", transport: "http" },
];

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function fixture(scenario: Scenario) {
  const streams = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (url === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders(); streams.add(res); res.on("close", () => streams.delete(res)); return;
    }
    if (url === "/api/health") return json(res, { ok: true });
    if (url === "/api/media/tools") return json(res, { version: 1, tools: buildMediaToolDescriptors([]) });
    if (url.startsWith("/api/media/jobs/")) return json(res, { code: "MEDIA_JOB_UNKNOWN", error: "Unknown job" }, 404);
    if (url.startsWith("/api/history?")) return json(res, { items: [] });
    if (url === "/api/media" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const { requestId } = JSON.parse(Buffer.concat(chunks).toString()) as { requestId: string };
      const { code, error, category } = scenario;
      if (scenario.transport === "http") return json(res, { code, error, category }, 400);
      json(res, { requestId }, 202);
      for (const stream of streams) {
        stream.write(`event: progress\ndata: ${JSON.stringify({ jobId: requestId, status: "running", progress: 42 })}\n\n`);
        stream.write(`event: error\ndata: ${JSON.stringify({ jobId: requestId, code, error, category })}\n\n`);
      }
      return;
    }
    return json(res, { error: `Unexpected request: ${req.method} ${url}` }, 404);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

async function cli(base: string, root: string, flags: string[]) {
  const args = ["--import", "tsx", "bin/ima2.ts", "media", "run", "--model", "test/model", "--task", "text-to-image", "--server", base, ...flags];
  const child = spawn(process.execPath, args, { env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root,
    TMPDIR: root, IMA2_CONFIG_DIR: root, IMA2_GENERATED_DIR: root, IMA2_ADVERTISE_FILE: join(root, "absent"), NO_COLOR: "1" } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 15000);
  try { const [code] = await once(child, "close"); return { code, stdout, stderr }; }
  finally { clearTimeout(timer); }
}

for (const scenario of scenarios) {
  test(`CLI and MCP media_submit preserve ${scenario.code} error parity`, { timeout: 30000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-mcp-error-parity-"));
    const fake = await fixture(scenario);
    const server = createMediaMcpServer({ resolveBase: async () => fake.base, version: "test", log: () => {} });
    const client = new Client({ name: "parity-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      await client.listTools();
      const human = await cli(fake.base, root, ["--quiet"]);
      assert.equal(human.code, 1); assert.equal(human.stdout, "");
      assert.equal(human.stderr, `${scenario.code}: ${scenario.error} (${scenario.category})\n`);
      const machine = await cli(fake.base, root, ["--quiet", "--json"]);
      assert.equal(machine.code, 1); assert.equal(machine.stderr, "");
      const parsed = JSON.parse(machine.stdout) as { ok: boolean; code: string; category: string };
      assert.equal(parsed.ok, false); assert.equal(parsed.code, scenario.code); assert.equal(parsed.category, scenario.category);
      const result = await client.callTool({ name: "media_submit", arguments: {
        model: "test/model", task: "text-to-image", requestId: `mcp-${scenario.code}`, wait: true,
      } });
      assert.equal(result.isError, true);
      assert.ok(Array.isArray(result.content));
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");
      assert.equal((result.content[0] as { text: string }).text, human.stderr.slice(0, -1));
      const structured = result.structuredContent as Record<string, unknown>;
      assert.equal(structured.code, parsed.code);
      assert.equal(structured.category, parsed.category);
      if (scenario.transport === "sse") {
        const verbose = await cli(fake.base, root, []);
        assert.equal(verbose.code, 1); assert.match(verbose.stderr, /running 42%/);
        assert.ok(verbose.stderr.endsWith(human.stderr), "progress precedes the same error without --quiet");
      }
    } finally {
      await client.close(); await server.close(); await fake.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
