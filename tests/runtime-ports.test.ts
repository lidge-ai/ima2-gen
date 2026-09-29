import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:net";
import {
  findAvailablePort,
  getServerPort,
  listenWithPortFallback,
  parseLocalhostPortFromUrl,
  parseOAuthReadyUrl,
} from "../lib/runtimePorts.ts";
import { shutdownServerAndMcp, startMcpRestoreAfterListen } from "../lib/mcp/shutdown.ts";

function occupy(port) {
  return new Promise<import("node:net").Server>((resolve) => {
    const server = createServer().listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("findAvailablePort skips occupied preferred port", async () => {
  const base = 3900 + Math.floor(Math.random() * 400);
  const blocker = await occupy(base);
  try {
    const port = await findAvailablePort(base, { host: "127.0.0.1", maxAttempts: 2 });
    assert.equal(port, base + 1);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("listenWithPortFallback binds the next available port", async () => {
  const base = 4300 + Math.floor(Math.random() * 400);
  const blocker = await occupy(base);
  const app = express();
  try {
    const server = await listenWithPortFallback(app, base, {
      host: "127.0.0.1",
      maxAttempts: 2,
      label: "test-server",
    }) as import("node:http").Server;
    assert.equal(getServerPort(server), base + 1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("OAuth ready URL parser returns actual fallback port", () => {
  // (see also the strict case below)
  const url = parseOAuthReadyUrl("OpenAI-compatible endpoint ready at http://127.0.0.1:10532/v1");
  assert.equal(url, "http://127.0.0.1:10532");
  assert.equal(parseLocalhostPortFromUrl(url), 10532);
});

test("maxAttempts 0 pins the port: a busy port fails instead of hopping", async () => {
  const base = 4750 + Math.floor(Math.random() * 200);
  const blocker = await occupy(base);
  const app = express();
  try {
    await assert.rejects(
      listenWithPortFallback(app, base, { host: "127.0.0.1", maxAttempts: 0, label: "strict" }),
      (err: { code?: string }) => err.code === "PORT_RANGE_EXHAUSTED",
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("server accept-stop and MCP shutdown start together and both settle", async () => {
  const started: string[] = [];
  let finishServer!: () => void;
  let finishMcp!: () => void;
  const closing = shutdownServerAndMcp({
    closeServer: () => { started.push("server"); return new Promise<void>((resolve) => { finishServer = resolve; }); },
    shutdownMcp: () => { started.push("mcp"); return new Promise<void>((resolve) => { finishMcp = resolve; }); },
  });
  assert.deepEqual(started, ["server", "mcp"]);
  finishMcp();
  let settled = false;
  void closing.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finishServer();
  await closing;
  assert.equal(settled, true);
});

test("MCP restore starts only after the actual server port is published", async () => {
  let calls = 0;
  const ctx = { serverActualPort: undefined as number | undefined, mcpConnectionManager: { async restoreStoredConnections() { calls += 1; } } };
  await startMcpRestoreAfterListen(ctx);
  assert.equal(calls, 0);
  ctx.serverActualPort = 4545;
  await startMcpRestoreAfterListen(ctx);
  assert.equal(calls, 1);
});
