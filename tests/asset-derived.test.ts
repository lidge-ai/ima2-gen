import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-asset-derived-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "src.png"), "png!");

const { registerAssetDerivedRoutes } = await import("../routes/assetDerived.ts");
const db = await import("../lib/db.ts");

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
  "base64",
);

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
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

async function post(base: string, query: string, body: Buffer | string) {
  const res = await fetch(`${base}/api/assets/derived?${query}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/assets/derived", () => {
  it("rejects JSON Buffer impersonation before derived output writes", async () => {
    await withApp(async (base) => {
      const before = readdirSync(GENERATED_DIR).sort();
      for (const body of [{ length: 4096, subarray: "not callable" }, { type: "Buffer", data: [137, 80, 78, 71] }, []]) {
        const response = await fetch(`${base}/api/assets/derived?source=src.png`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "DERIVED_BODY_NOT_PNG");
        assert.deepEqual(readdirSync(GENERATED_DIR).sort(), before);
      }
    });
  });
  it("rejects a body that is not a PNG", async () => {
    await withApp(async (base) => {
      const { status, json } = await post(base, "source=src.png", "not-a-png");
      assert.equal(status, 400);
      assert.equal(json.code, "DERIVED_BODY_NOT_PNG");
    });
  });

  it("rejects a missing source", async () => {
    await withApp(async (base) => {
      const { status, json } = await post(base, "source=nope.png", PNG_1PX);
      assert.equal(status, 400);
      assert.equal(json.code, "DERIVED_SOURCE_MISSING");
    });
  });

  it("rejects a path-escaping source", async () => {
    await withApp(async (base) => {
      const { status } = await post(base, `source=${encodeURIComponent("../escape.png")}`, PNG_1PX);
      assert.equal(status, 400);
    });
  });

  it("rejects an unknown derived kind and oversized/invalid meta", async () => {
    await withApp(async (base) => {
      const badKind = await post(base, "source=src.png&kind=keyed-webm", PNG_1PX);
      assert.equal(badKind.status, 400);
      assert.equal(badKind.json.code, "DERIVED_KIND_INVALID");
      const badMeta = await post(base, `source=src.png&meta=${encodeURIComponent("[1,2]")}`, PNG_1PX);
      assert.equal(badMeta.status, 400);
      assert.equal(badMeta.json.code, "DERIVED_META_INVALID");
    });
  });

  it("saves the keyed PNG, sidecar with derivedFrom, and asset record with folder", async () => {
    await withApp(async (base) => {
      const folderRes = await fetch(`${base}/api/assets/derived`, { method: "OPTIONS" }).catch(() => null);
      void folderRes;
      const meta = encodeURIComponent(JSON.stringify({ keyParams: { tolerance: 40 } }));
      const { status, json } = await post(base, `source=src.png&name=droplet%20(keyed)&meta=${meta}`, PNG_1PX);
      assert.equal(status, 201);
      const filePath = json.filePath as string;
      assert.match(filePath, /^src-keyed-\d+\.png$/);
      const abs = join(GENERATED_DIR, filePath);
      assert.ok(existsSync(abs), "keyed png must exist in generatedDir");
      assert.ok(readFileSync(abs).subarray(0, 8).equals(PNG_1PX.subarray(0, 8)));
      const sidecar = JSON.parse(readFileSync(`${abs}.json`, "utf8"));
      assert.equal(sidecar.derivedFrom, "src.png");
      assert.equal(sidecar.kind, "keyed-png");
      const asset = json.asset as { name: string; metadata: Record<string, unknown> };
      assert.equal(asset.name, "droplet (keyed)");
      assert.equal((asset.metadata as { derivedFrom?: string }).derivedFrom, "src.png");
    });
  });
});
