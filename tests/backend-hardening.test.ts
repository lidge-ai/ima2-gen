import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";
import { registerCardNewsRoutes } from "../routes/cardNews.js";
import { deleteAssetPermanent } from "../lib/assetLifecycle.js";
import { downloadGrokImageUrl } from "../lib/grokImageCore.js";
import { buildApp } from "../server.js";

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
  }));
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("Card News traversal setId is rejected with 400 before any filesystem write", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-cardnews-traversal-"));
  const app = express();
  app.use(express.json());
  registerCardNewsRoutes(app, createTestRuntimeContext({
    config: { ...config, storage: { ...config.storage, generatedDir } },
  }));
  const server = createServer(app);
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/cardnews/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ setId: "../outside", cards: [{ id: "one", visualPrompt: "test" }] }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_CARD_NEWS_SET_ID");
    assert.deepEqual(await readdir(generatedDir), []);
  } finally {
    await close(server);
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Card News rejects excessive cards and concurrency", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-cardnews-limits-"));
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerCardNewsRoutes(app, createTestRuntimeContext({ config: { ...config, storage: { ...config.storage, generatedDir } } }));
  const server = createServer(app);
  const base = await listen(server);
  try {
    for (const body of [
      { cards: Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, visualPrompt: "x" })) },
      { cards: [{ id: "c1", visualPrompt: "x" }], concurrency: 5 },
    ]) {
      const response = await fetch(`${base}/api/cardnews/generate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    assert.deepEqual(await readdir(generatedDir), []);
  } finally {
    await close(server);
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("asset deletion rejects symlinks that resolve outside generated storage", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-assets-generated-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "ima2-assets-outside-"));
  const oldGeneratedDir = config.storage.generatedDir;
  config.storage.generatedDir = generatedDir;
  try {
    const outside = join(outsideDir, "secret.png");
    await writeFile(outside, "secret");
    await symlink(outside, join(generatedDir, "linked.png"));
    await assert.rejects(() => deleteAssetPermanent(process.cwd(), "linked.png"), (error: any) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "INVALID_FILENAME");
      return true;
    });
    assert.equal(await import("node:fs/promises").then((fs) => fs.readFile(outside, "utf8")), "secret");
  } finally {
    config.storage.generatedDir = oldGeneratedDir;
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(outsideDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Grok image download enforces byte limit for chunked responses", async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 51; i += 1) res.write(chunk);
    res.end();
  });
  const base = await listen(upstream);
  try {
    await assert.rejects(() => downloadGrokImageUrl(`${base}/oversize`, undefined, 10_000, {
      trustedProxyOrigin: base,
    }), (error: any) => {
      assert.equal(error.code, "GROK_IMAGE_DOWNLOAD_FAILED");
      assert.match(error.message, /50MB limit/);
      return true;
    });
  } finally {
    await close(upstream);
  }
});

test("server returns a final JSON 404", async () => {
  const app = buildApp(createTestRuntimeContext({ config }));
  const server = createServer(app);
  const base = await listen(server);
  try {
    const missing = await fetch(`${base}/__missing`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") || "", /application\/json/);
    assert.equal((await missing.json()).error.code, "NOT_FOUND");
  } finally {
    await close(server);
  }
});
