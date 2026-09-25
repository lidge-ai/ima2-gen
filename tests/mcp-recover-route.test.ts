// 260718: POST /api/mcp/tasks/:taskId/recover — contract + happy path with
// stubbed manager/download, mirroring mcp-media-action.test.ts DI style.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-recover-"));
process.env.IMA2_CONFIG_DIR = dir;
process.env.IMA2_DB_PATH = join(dir, "db.sqlite");
process.env.IMA2_GENERATED_DIR = join(dir, "generated");
mkdirSync(join(dir, "generated"), { recursive: true });

const db = await import("../lib/db.ts");
const { registerMcpRecoverRoutes } = await import("../routes/mcpRecover.ts");
after(() => { db.closeDb(); rmSync(dir, { recursive: true, force: true }); });

const fakeManagerConnected = {
  status: () => ({ provider: "runway", state: "connected" }),
  callTool: async (_provider: string, toolName: string) => {
    assert.equal(toolName, "get_task");
    return {
      content: [{ type: "text", text: "Task t succeeded.\nhttps://cdn.example.com/out.mp4?_jwt=x" }],
      structuredContent: { url: "https://cdn.example.com/out.mp4?_jwt=x" },
    };
  },
};

function makeApp(manager: unknown, media: { fileName?: string; contentType?: string; url?: string } = {}) {
  const app = express();
  app.use(express.json());
  const fileName = media.fileName ?? "recover-result.mp4";
  const contentType = media.contentType ?? "video/mp4";
  const url = media.url ?? "https://cdn.example.com/out.mp4";
  const tempOut = join(dir, fileName);
  const deps = {
    download: async () => {
      writeFileSync(tempOut, Buffer.from(contentType));
      return { tempPath: tempOut, contentType, bytes: 3, sanitizedUrl: url, cleanup: async () => {} };
    },
  };
  registerMcpRecoverRoutes(app as never, {
    config: {
      storage: { generatedDir: join(dir, "generated") },
      ids: { generatedHexBytes: 4 },
    },
    mcpConnectionManager: manager,
  } as never, deps as never);
  return app;
}

async function withServer(app: express.Express, run: (base: string) => Promise<void>) {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  try { await run(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

const TASK = "20fba936-054a-4563-b91b-8fa9b019bb20";

test("recover: 400 on bad task id", async () => {
  await withServer(makeApp(fakeManagerConnected), async (base) => {
    const res = await fetch(`${base}/api/mcp/tasks/bad!/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
  });
});

test("recover: 409 when provider not connected", async () => {
  const manager = { status: () => ({ provider: "runway", state: "disconnected" }) };
  await withServer(makeApp(manager), async (base) => {
    const res = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "MCP_NOT_CONNECTED");
  });
});

test("recover: higgsfield is now executable and accepts recover requests", async () => {
  const manager = { status: () => ({ provider: "higgsfield", state: "connected" }) };
  await withServer(makeApp(manager), async (base) => {
    const res = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "higgsfield" }),
    });
    assert.equal(res.status, 202);
  });
});

test("recover: 202 happy path commits the file", async () => {
  await withServer(makeApp(fakeManagerConnected), async (base) => {
    const res = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(res.status, 202);
    const { requestId } = await res.json();
    assert.ok(requestId.startsWith("mcpr_"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const files = readdirSync(join(dir, "generated")).filter((f) => f.endsWith("_mcp.mp4"));
    assert.equal(files.length, 1, "committed mp4 present");
  });
});

test("recover: same caller requestId dedupes while the job is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = {
    status: () => ({ provider: "runway", state: "connected" }),
    callTool: async () => gate.then(() => ({ content: [{ type: "text", text: "Task t RUNNING" }] })),
  };
  await withServer(makeApp(manager), async (base) => {
    const body = JSON.stringify({ requestId: "mcpr_ui_retry_1" });
    const first = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(first.status, 202);
    const retry = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).error.code, "REQUEST_ID_IN_USE");
    release();
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});

test("recover: image recover commits a webp download under its own extension", async () => {
  const manager = {
    status: () => ({ provider: "runway", state: "connected" }),
    callTool: async () => ({
      content: [{ type: "text", text: "Task t succeeded.\nhttps://cdn.example.com/out.webp" }],
      structuredContent: { url: "https://cdn.example.com/out.webp" },
    }),
  };
  await withServer(makeApp(manager, { fileName: "recover-result.webp", contentType: "image/webp", url: "https://cdn.example.com/out.webp" }), async (base) => {
    const res = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "image" }),
    });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const files = readdirSync(join(dir, "generated")).filter((f) => f.endsWith("_mcp.webp"));
    assert.equal(files.length, 1, "committed webp present");
  });
});

test("recover: not-succeeded task commits nothing", async () => {
  const manager = {
    status: () => ({ provider: "runway", state: "connected" }),
    callTool: async () => ({ content: [{ type: "text", text: "Task t RUNNING" }] }),
  };
  await withServer(makeApp(manager), async (base) => {
    const before = readdirSync(join(dir, "generated")).filter((f) => f.endsWith("_mcp.mp4")).length;
    const res = await fetch(`${base}/api/mcp/tasks/${TASK}/recover`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const files = readdirSync(join(dir, "generated")).filter((f) => f.endsWith("_mcp.mp4"));
    assert.equal(files.length, before, "no commit on running task");
  });
});
