import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { embedImageMetadata, readEmbeddedImageMetadata } from "../lib/imageMetadataStore.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-element-metadata-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const store = await import("../lib/assetsStore.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function makePng() {
  return sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
}

async function roundTrip(metadata: Record<string, unknown>) {
  const embedded = await embedImageMetadata(await makePng(), "png", metadata);
  return readEmbeddedImageMetadata(embedded.buffer);
}

function metadata() {
  return { elementKind: "character", name: "Hero", refs: ["/hero.png"], notes: "Lead character", defaultStrength: 0.8 };
}

describe("element metadata contracts", () => {
  it("preserves elementIds through PNG XMP embedding and reading", async () => {
    const result = await roundTrip({ prompt: "test", elementIds: ["hero", "scene"] });
    assert.equal(result.source, "xmp");
    assert.deepEqual(result.metadata?.elementIds, ["hero", "scene"]);
  });

  it("leaves elementIds absent when metadata does not provide them", async () => {
    const result = await roundTrip({ prompt: "test" });
    assert.equal("elementIds" in (result.metadata ?? {}), false);
  });

  it("deduplicates elementIds during XMP round-trip", async () => {
    const result = await roundTrip({ prompt: "test", elementIds: ["hero", "scene", "hero"] });
    assert.deepEqual(result.metadata?.elementIds, ["hero", "scene"]);
  });

  it("preserves elementIds selection order through XMP round-trip", async () => {
    const result = await roundTrip({ prompt: "test", elementIds: ["scene", "hero", "product"] });
    assert.deepEqual(result.metadata?.elementIds, ["scene", "hero", "product"]);
  });

  it("preserves both presetIds and elementIds in the same XMP payload", async () => {
    const result = await roundTrip({ prompt: "test", presetIds: ["film"], elementIds: ["hero"] });
    assert.deepEqual(result.metadata?.presetIds, ["film"]);
    assert.deepEqual(result.metadata?.elementIds, ["hero"]);
  });

  it("omits empty elementIds arrays from the XMP payload", async () => {
    const result = await roundTrip({ prompt: "test", elementIds: [] });
    assert.deepEqual(result.metadata?.elementIds, []);
  });

  it("creates and retrieves validated element assets", () => {
    const created = store.createAsset({ kind: "element", name: "Hero asset", metadata: metadata() });
    assert.deepEqual(store.getElementById(created.id)?.metadata, metadata());
    assert.deepEqual(store.listElements().assets.map((asset: { id: string }) => asset.id), [created.id]);
  });

  it("rejects element assets with an invalid elementKind", () => {
    assert.throws(() => store.createAsset({ kind: "element", name: "Bad", metadata: { ...metadata(), elementKind: "animal" } }), (error: unknown) => {
      const actual = error as { code?: string; status?: number };
      return actual.code === "INVALID_ELEMENT_METADATA" && actual.status === 400;
    });
  });
});
