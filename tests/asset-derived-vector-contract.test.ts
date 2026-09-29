import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-vector-derived-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });

const flat = await sharp({
  create: { width: 48, height: 48, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } },
})
  .composite([{
    input: { create: { width: 24, height: 24, channels: 4, background: { r: 30, g: 110, b: 200, alpha: 1 } } },
    left: 12,
    top: 12,
  }])
  .png()
  .toBuffer();
writeFileSync(join(GENERATED_DIR, "src.png"), flat);
writeFileSync(join(GENERATED_DIR, "already.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");

const { registerAssetDerivedRoutes } = await import("../routes/assetDerived.ts");
const { thumbPathForImage, thumbUrlForImage } = await import("../lib/imageThumb.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  registerAssetDerivedRoutes(app, {});
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postVector(base: string, query: string) {
  const res = await fetch(`${base}/api/assets/derived?${query}`, { method: "POST" });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/assets/derived?kind=vector-svg", () => {
  it("traces a generated raster into a registered SVG asset", async () => {
    await withApp(async (base) => {
      const { status, json } = await postVector(base, "kind=vector-svg&source=src.png");
      assert.equal(status, 201);
      const filePath = json.filePath as string;
      assert.match(filePath, /^src-vector-\d+\.svg$/);
      assert.ok(existsSync(join(GENERATED_DIR, filePath)), "svg should exist on disk");

      const svg = readFileSync(join(GENERATED_DIR, filePath), "utf8");
      assert.ok(svg.startsWith("<svg"));
      assert.equal(/<script/i.test(svg), false);
      assert.ok((json.pathCount as number) > 0);

      const asset = json.asset as { metadata?: Record<string, unknown> };
      assert.equal(asset.metadata?.derivedKind, "vector-svg");
      assert.equal(asset.metadata?.derivedFrom, "src.png");
      assert.equal(asset.metadata?.vector, true);

      const sidecar = JSON.parse(readFileSync(join(GENERATED_DIR, `${filePath}.json`), "utf8"));
      assert.equal(sidecar.kind, "vector-svg");
      assert.equal(sidecar.derivedFrom, "src.png");
    });
  });

  it("honours an explicit preset", async () => {
    await withApp(async (base) => {
      const { status, json } = await postVector(base, "kind=vector-svg&source=src.png&preset=mono");
      assert.equal(status, 201);
      assert.equal(json.preset, "mono");
    });
  });

  it("refuses to vectorize a source that is already vector", async () => {
    await withApp(async (base) => {
      const { status, json } = await postVector(base, "kind=vector-svg&source=already.svg");
      assert.equal(status, 400);
      assert.equal(json.code, "DERIVED_SOURCE_NOT_RASTER");
    });
  });

  it("rejects an unknown preset", async () => {
    await withApp(async (base) => {
      const { status, json } = await postVector(base, "kind=vector-svg&source=src.png&preset=fancy");
      assert.equal(status, 400);
      assert.equal(json.code, "DERIVED_PRESET_INVALID");
    });
  });

  it("rejects a missing source", async () => {
    await withApp(async (base) => {
      const { status, json } = await postVector(base, "kind=vector-svg&source=nope.png");
      assert.equal(status, 400);
      assert.equal(json.code, "DERIVED_SOURCE_MISSING");
    });
  });
});

describe("thumbnail paths stay total for non-raster assets", () => {
  it("never maps a vector path onto itself", () => {
    // Identity here would make a caller treat the SVG as its own thumbnail and
    // overwrite the vector with JPEG bytes.
    assert.equal(thumbPathForImage("/tmp/a.svg"), "/tmp/a.svg.thumb.jpg");
    assert.equal(thumbUrlForImage("/generated/a.svg"), "/generated/a.svg.thumb.jpg");
    assert.equal(thumbPathForImage("/tmp/a.png"), "/tmp/a.thumb.jpg");
    assert.equal(thumbUrlForImage("/generated/a.webp"), "/generated/a.thumb.jpg");
  });
});
