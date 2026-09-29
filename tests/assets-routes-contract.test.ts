import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-assets-routes-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "a.png"), "png!");
writeFileSync(join(GENERATED_DIR, "b.mp4"), "mp4!");
mkdirSync(join(GENERATED_DIR, "subdir"), { recursive: true });

const { registerAssetsRoutes } = await import("../routes/assets.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  registerAssetsRoutes(app, {});
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

async function request(base: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

describe("assets routes contract", () => {
  it("promotes image and video files and round-trips metadata through list", async () => withApp(async (base) => {
    const image = await request(base, "/api/assets", "POST", { filePath: "a.png", kind: "image", metadata: { width: 8 } });
    const video = await request(base, "/api/assets", "POST", { filePath: "b.mp4", kind: "video", metadata: { seconds: 2 } });
    assert.equal(image.response.status, 201);
    assert.equal(video.response.status, 201);
    assert.equal(image.body.asset.kind, "image");
    assert.equal(video.body.asset.kind, "video");
    const listed = await request(base, "/api/assets");
    assert.deepEqual(listed.body.assets.find((a: any) => a.id === image.body.asset.id).metadata, { width: 8 });
    assert.deepEqual(listed.body.assets.find((a: any) => a.id === video.body.asset.id).metadata, { seconds: 2 });
  }));

  it("quick-registers one idempotent Element linked to its source asset", async () => withApp(async (base) => {
    const source = await request(base, "/api/assets", "POST", { filePath: "a.png", kind: "image", name: "Hero source", tags: ["starred"] });
    const payload = {
      result: { filePath: "a.png" },
      sourceAssetId: source.body.asset.id,
      elementKind: "character",
      name: "Hero element",
      tags: ["portrait"],
    };
    const first = await request(base, "/api/assets/promote-element", "POST", payload);
    const second = await request(base, "/api/assets/promote-element", "POST", payload);

    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 200);
    assert.equal(second.body.asset.id, first.body.asset.id);
    assert.equal(first.body.asset.kind, "element");
    assert.deepEqual(first.body.asset.metadata, {
      elementKind: "character",
      name: "Hero element",
      refs: ["a.png"],
      sourceAssetId: source.body.asset.id,
    });
    assert.deepEqual(first.body.asset.tags, [`element-source:${source.body.asset.id}`, "portrait"]);

    const listed = await request(base, `/api/assets?kind=element&tag=${encodeURIComponent(`element-source:${source.body.asset.id}`)}`);
    assert.equal(listed.body.assets.length, 1);
    await request(base, `/api/assets/${first.body.asset.id}`, "DELETE");
    const sourceAfterDelete = await request(base, `/api/assets/${source.body.asset.id}`);
    assert.equal(sourceAfterDelete.response.status, 200);
    assert.equal(existsSync(join(GENERATED_DIR, "a.png")), true);
  }));

  it("rejects unknown and mismatched quick-register sources", async () => withApp(async (base) => {
    const missing = await request(base, "/api/assets/promote-element", "POST", {
      result: { filePath: "a.png" }, sourceAssetId: "a_missing", elementKind: "character",
    });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, "SOURCE_ASSET_NOT_FOUND");

    const video = await request(base, "/api/assets", "POST", { filePath: "b.mp4", kind: "video" });
    const mismatch = await request(base, "/api/assets/promote-element", "POST", {
      result: { filePath: "a.png" }, sourceAssetId: video.body.asset.id, elementKind: "character",
    });
    assert.equal(mismatch.response.status, 400);
    assert.equal(mismatch.body.error.code, "INVALID_ELEMENT_SOURCE");
  }));

  it("returns validation envelopes for escaped, missing, and invalid-kind promotions", async () => withApp(async (base) => {
    for (const payload of [
      { filePath: "../x", kind: "image", code: "INVALID_FILENAME" },
      { filePath: "missing.png", kind: "image", code: "INVALID_FILENAME" },
      { filePath: "subdir", kind: "image", code: "INVALID_FILENAME" },
      { filePath: "a.png", kind: "audio", code: "INVALID_ASSET_KIND" },
    ]) {
      const result = await request(base, "/api/assets", "POST", payload);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error.code, payload.code);
      assert.equal(typeof result.body.error.message, "string");
    }
  }));

  it("returns 404 envelopes for unknown assets and folders", async () => withApp(async (base) => {
    const cases: Array<[string, string, unknown?]> = [
      ["PATCH", "/api/assets/a_missing", { name: "x" }], ["DELETE", "/api/assets/a_missing"],
      ["PATCH", "/api/assets/folders/af_missing", { name: "x" }], ["DELETE", "/api/assets/folders/af_missing"],
    ];
    for (const [method, path, body] of cases) {
      const result = await request(base, path, method, body);
      assert.equal(result.response.status, 404);
      assert.match(result.body.error.code, /^(ASSET|FOLDER)_NOT_FOUND$/);
    }
  }));

  it("blocks non-empty folder deletion and validates unknown parents", async () => withApp(async (base) => {
    const invalid = await request(base, "/api/assets/folders", "POST", { name: "bad", parentId: "af_missing" });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_PARENT");
    const folder = await request(base, "/api/assets/folders", "POST", { name: "filled" });
    const asset = await request(base, "/api/assets", "POST", { filePath: "a.png", kind: "image", folderId: folder.body.folder.id });
    assert.equal(asset.response.status, 201);
    const removed = await request(base, `/api/assets/folders/${folder.body.folder.id}`, "DELETE");
    assert.equal(removed.response.status, 409);
    assert.equal(removed.body.error.code, "FOLDER_NOT_EMPTY");
  }));

  it("deletes only the asset record and leaves the promoted file intact", async () => withApp(async (base) => {
    const created = await request(base, "/api/assets", "POST", { filePath: "a.png", kind: "image" });
    const removed = await request(base, `/api/assets/${created.body.asset.id}`, "DELETE");
    assert.equal(removed.response.status, 200);
    assert.deepEqual(removed.body, { ok: true });
    assert.equal(existsSync(join(GENERATED_DIR, "a.png")), true);
  }));

  it("paginates through the query cursor without duplicates", async () => withApp(async (base) => {
    for (let i = 0; i < 3; i += 1) {
      const made = await request(base, "/api/assets", "POST", { kind: "preset", name: `route-page-${i}` });
      assert.equal(made.response.status, 201);
    }
    const first = await request(base, "/api/assets?q=route-page-&limit=2");
    assert.equal(first.body.assets.length, 2);
    assert.equal(typeof first.body.nextCursor, "string");
    const second = await request(base, `/api/assets?q=route-page-&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    assert.equal(second.body.assets.length, 1);
    assert.equal(second.body.nextCursor, null);
    assert.equal(new Set([...first.body.assets, ...second.body.assets].map((a: any) => a.id)).size, 3);
  }));
});
