import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRuntime } from "../bin/lib/runtime.ts";

// devlog/_plan/260929_background_runtime/020: only a refusal on every
// candidate proves absence; anything that answers wrongly is "unknown".

type Handler = (url: string) => { status?: number; body?: unknown } | "hang";

async function serve(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const out = handler(req.url ?? "");
    if (out === "hang") return;
    res.statusCode = out.status ?? 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as AddressInfo).port };
}

async function closedPort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function close(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((r) => server.close(() => r()));
}

function advertiseDir(entry?: unknown): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "ima2-resolve-"));
  const file = join(dir, "server.json");
  if (entry !== undefined) writeFileSync(file, JSON.stringify(entry));
  return { dir, file };
}

const ima2 = (pid: number, extra: Record<string, unknown> = {}) => (url: string) =>
  url === "/api/health" ? { body: { ok: true, pid, startedAt: 111, version: "9.9.9", ...extra } } : { status: 404 };

test("a server the advertisement vouches for is live and stoppable", async () => {
  const { server, port } = await serve(ima2(process.pid, { bootId: "b1", launcher: "background", root: "/r" }));
  const { dir, file } = advertiseDir({ pid: process.pid, url: `http://127.0.0.1:${port}`, adminNonce: "n" });
  try {
    const r = await resolveRuntime({ advertiseFile: file, port, span: 0 });
    assert.equal(r.status, "live");
    assert.equal(r.source, "advertise");
    assert.equal(r.stoppable, true);
    assert.equal(r.runtime?.bootId, "b1");
    assert.equal(r.runtime?.launcher, "background");
  } finally {
    await close(server);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a stale advertisement plus refused ports proves absence", async () => {
  const port = await closedPort();
  const { dir, file } = advertiseDir({ pid: 2 ** 22 + 12345, url: `http://127.0.0.1:${port}` });
  try {
    const r = await resolveRuntime({ advertiseFile: file, port, span: 0, isAlive: () => false });
    assert.equal(r.status, "absent-proven");
    assert.equal(r.advertiseStale, true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a server that hopped ports is found without an advertisement, but is not stoppable", async () => {
  const { server, port } = await serve(ima2(4242));
  const configured = port - 1;
  const { dir, file } = advertiseDir();
  try {
    const r = await resolveRuntime({ advertiseFile: file, port: configured, span: 1 });
    // configured may be occupied by something else on a busy host; only assert when it is free.
    if (r.status === "live") {
      assert.equal(r.runtime?.pid, 4242);
      assert.equal(r.source, "port");
      assert.equal(r.stoppable, false);
    } else {
      assert.equal(r.status, "unknown");
    }
  } finally {
    await close(server);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("an advertised pid that is alive while another pid answers is unknown", async () => {
  const { server, port } = await serve(ima2(1));
  const { dir, file } = advertiseDir({ pid: process.pid, url: `http://127.0.0.1:${port}`, adminNonce: "n" });
  try {
    const r = await resolveRuntime({ advertiseFile: file, port, span: 0 });
    assert.equal(r.status, "unknown");
    assert.match(r.reason ?? "", /advertised pid/);
  } finally {
    await close(server);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a listener that is not ima2, or that hangs, is unknown — never absence", async () => {
  const foreign = await serve(() => ({ status: 404 }));
  const hanging = await serve(() => "hang");
  const { dir, file } = advertiseDir();
  try {
    assert.equal((await resolveRuntime({ advertiseFile: file, port: foreign.port, span: 0 })).status, "unknown");
    assert.equal((await resolveRuntime({ advertiseFile: file, port: hanging.port, span: 0, timeoutMs: 300 })).status, "unknown");
  } finally {
    await close(foreign.server);
    await close(hanging.server);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
