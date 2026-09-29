import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { registerNodeRoutes } from "../routes/nodes.ts";

const invalidSizeBody = {
  error: {
    message: "Invalid size '512x512'. Requested resolution is below the current minimum pixel budget.",
    type: "invalid_request_error",
    param: "tools[0].size",
    code: "invalid_value",
  },
};

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function withNodeApp(fn) {
  let upstreamHits = 0;
  const oauthServer = createServer((_req, res) => {
    upstreamHits += 1;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(invalidSizeBody));
  });
  const oauthUrl = await listen(oauthServer);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-node-"));
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerNodeRoutes(app, {
    rootDir: process.cwd(),
    oauthUrl,
    config: {
      ...config,
      storage: { ...config.storage, generatedDir },
    },
  });
  const appServer = createServer(app);
  const appUrl = await listen(appServer);
  try {
    await fn({ appUrl, getUpstreamHits: () => upstreamHits });
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => oauthServer.close(resolve));
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("/api/node/generate JSON returns INVALID_REQUEST with status", async () => {
  await withNodeApp(async ({ appUrl, getUpstreamHits }) => {
    const res = await fetch(`${appUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "safe test",
        size: "512x512",
        quality: "medium",
        moderation: "low",
        provider: "oauth",
        requestId: "req_node_json_invalid",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.status, 400);
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.upstreamCode, "invalid_value");
    assert.equal(body.error.message, "OpenAI rejected the image request parameters.");
    assert.doesNotMatch(JSON.stringify(body), /foo\.bar/);
    assert.equal(getUpstreamHits(), 1);
  });
});

test("/api/node/generate SSE emits INVALID_REQUEST error event with status", async () => {
  await withNodeApp(async ({ appUrl, getUpstreamHits }) => {
    const res = await fetch(`${appUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        prompt: "safe test",
        size: "512x512",
        quality: "medium",
        moderation: "low",
        provider: "oauth",
        requestId: "req_node_sse_invalid",
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /event: error/);
    assert.match(text, /"status":400/);
    assert.match(text, /"code":"INVALID_REQUEST"/);
    assert.match(text, /"upstreamCode":"invalid_value"/);
    assert.equal(getUpstreamHits(), 1);
  });
});
