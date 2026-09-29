import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { exportImageToComfy, normalizeComfyOrigin } from "../lib/comfyBridge.ts";
import { registerComfyRoutes } from "../routes/comfy.ts";
import { config as baseConfig } from "../config.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const WEBP = Buffer.from("RIFFxxxxWEBP", "ascii");

function makeCtx(generatedDir, overrides: { comfy?: Record<string, unknown> } = {}) {
  return {
    rootDir: process.cwd(),
    config: {
      ...baseConfig,
      storage: { ...baseConfig.storage, generatedDir },
      comfy: {
        defaultUrl: "http://127.0.0.1:8188",
        uploadTimeoutMs: 1000,
        maxUploadBytes: 1024,
        ...overrides.comfy,
      },
      features: { ...baseConfig.features, cardNews: false },
    },
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("normalizes only loopback HTTP origins", () => {
  assert.equal(normalizeComfyOrigin("http://127.0.0.1:8188/"), "http://127.0.0.1:8188");
  assert.equal(normalizeComfyOrigin("http://localhost:8188"), "http://localhost:8188");
  assert.equal(normalizeComfyOrigin("http://[::1]:8188"), "http://[::1]:8188");
  assert.throws(() => normalizeComfyOrigin("https://127.0.0.1:8188"));
  assert.throws(() => normalizeComfyOrigin("http://127.0.0.1"));
  assert.throws(() => normalizeComfyOrigin("http://127.0.0.1:8188/foo"));
  assert.throws(() => normalizeComfyOrigin("http://127.0.0.1:8188/?x=1"));
  assert.throws(() => normalizeComfyOrigin("http://user:pass@127.0.0.1:8188"));
  assert.throws(() => normalizeComfyOrigin("http://192.168.0.2:8188"));
  assert.throws(() => normalizeComfyOrigin("http://0.0.0.0:8188"));
  assert.throws(() => normalizeComfyOrigin("http://localhost.:8188"));
  assert.throws(() => normalizeComfyOrigin("http://2130706433:8188"));
  assert.throws(() => normalizeComfyOrigin("http://127.1:8188"));
  assert.throws(() => normalizeComfyOrigin("http://0177.0.0.1:8188"));
});

test("uploads one image multipart request to local ComfyUI", async () => withTempDir(async (dir) => {
  await writeFile(join(dir, "sample.png"), PNG);
  const seen = [];
  const comfy = await listen((req, res) => {
    seen.push(req.url);
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/upload/image");
    let raw = "";
    req.setEncoding("binary");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      assert.match(raw, /name="image"/);
      assert.match(raw, /filename="ima2_\d+_sample\.png"/);
      assert.match(raw, /name="type"/);
      assert.match(raw, /input/);
      assert.doesNotMatch(raw, /name="subfolder"/);
      assert.doesNotMatch(raw, /name="overwrite"/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "ima2_uploaded.png", subfolder: "", type: "input" }));
    });
  });
  try {
    const result = await exportImageToComfy(makeCtx(dir, {
      comfy: { defaultUrl: comfy.url },
    }), { filename: "sample.png" });
    assert.deepEqual(result, {
      ok: true,
      sourceFilename: "sample.png",
      uploadedFilename: "ima2_uploaded.png",
    });
    assert.deepEqual(seen, ["/upload/image"]);
  } finally {
    await comfy.close();
  }
}));

test("rejects unsafe filenames, symlink escapes, spoofed images, and oversized files", async () => withTempDir(async (dir) => {
  const ctx = makeCtx(dir);
  const smallLimitCtx = makeCtx(dir, { comfy: { maxUploadBytes: 8 } });
  await writeFile(join(dir, "real.jpg"), JPG);
  await writeFile(join(dir, "real.webp"), WEBP);
  await writeFile(join(dir, "fake.png"), Buffer.from("not an image"));
  await writeFile(join(dir, "too-big.png"), Buffer.concat([PNG, Buffer.alloc(32)]));
  await writeFile(join(tmpdir(), "ima2-outside.png"), PNG);
  await symlink(join(tmpdir(), "ima2-outside.png"), join(dir, "escape.png"));
  await mkdir(join(dir, "folder"));

  await assert.rejects(() => exportImageToComfy(ctx, { filename: "../x.png" }), /Generated filename is invalid/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "http://x/y.png" }), /Generated filename is invalid/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "a%2Fb.png" }), /Generated filename is invalid/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "missing.png" }), /not found/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "folder" }), /invalid/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "escape.png" }), /invalid/);
  await assert.rejects(() => exportImageToComfy(ctx, { filename: "fake.png" }), /supported image/);
  await assert.rejects(() => exportImageToComfy(smallLimitCtx, { filename: "too-big.png" }), /too large/);

  for (const filename of ["real.jpg", "real.webp"]) {
    const result = await exportImageToComfy(ctx, { filename }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ name: `uploaded-${filename}` }),
      }),
    });
    assert.equal(result.uploadedFilename, `uploaded-${filename}`);
  }
}));

test("maps ComfyUI upload failures without following redirects", async () => withTempDir(async (dir) => {
  await writeFile(join(dir, "sample.png"), PNG);
  const redirects = await listen((_req, res) => {
    res.writeHead(302, { Location: "https://example.com/nope" });
    res.end();
  });
  try {
    await assert.rejects(
      () => exportImageToComfy(makeCtx(dir, { comfy: { defaultUrl: redirects.url } }), { filename: "sample.png" }),
      /Could not upload image to ComfyUI/,
    );
  } finally {
    await redirects.close();
  }

  await assert.rejects(
    () => exportImageToComfy(makeCtx(dir), { filename: "sample.png" }, {
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    }),
    /Could not upload image to ComfyUI/,
  );
}));

test("public route accepts only filename and returns stable envelopes", async () => withTempDir(async (dir) => {
  const app = express();
  app.use(express.json());
  registerComfyRoutes(app, makeCtx(dir));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    for (const extra of ["comfyUrl", "subfolder", "overwrite", "prompt", "workflow", "client_id", "extra_data", "path"]) {
      const res = await postJson(`${base}/api/comfy/export-image`, {
        filename: "x.png",
        [extra]: extra === "comfyUrl" ? "http://127.0.0.1:8188" : "x",
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, "COMFY_IMAGE_INVALID");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}));

test("configured app registers the Comfy route", () => {
  const routes = readFileSync(join(process.cwd(), "routes/index.ts"), "utf8");
  assert.match(routes, /registerComfyRoutes/);
  assert.equal(existsSync(join(process.cwd(), "routes/comfy.ts")), true);
});
