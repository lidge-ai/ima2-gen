import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { registerGenerateRoutes } from "../routes/generate.ts";

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

test("/api/generate returns upstream validation as INVALID_REQUEST without retrying", async () => {
  let upstreamHits = 0;
  const oauthServer = createServer((_req, res) => {
    upstreamHits += 1;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(invalidSizeBody));
  });
  const oauthUrl = await listen(oauthServer);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-route-"));
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerGenerateRoutes(app, {
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
    const res = await fetch(`${appUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "safe test",
        size: "512x512",
        quality: "medium",
        moderation: "low",
        provider: "oauth",
        n: 1,
        requestId: "req_route_invalid",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(body.upstreamCode, "invalid_value");
    assert.equal(body.upstreamType, "invalid_request_error");
    assert.equal(body.upstreamParam, "tools[0].size");
    assert.equal(body.error, "OpenAI rejected the image request parameters.");
    assert.doesNotMatch(JSON.stringify(body), /512x512/);
    assert.equal(upstreamHits, 1);
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => oauthServer.close(resolve));
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
