import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { importSpriteAtlas } from "../lib/spriteAtlasImport.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/sprite-gen/manifest.json", import.meta.url), "utf8"));
test("import validates atlas and unpacks explicit manifest rects", async () => { const root = await mkdtemp(join(tmpdir(), "ima2-import-")); try { const atlas = await sharp({ create: { width: 32, height: 16, channels: 4, background: "transparent" } }).composite([{ input: await sharp({ create: { width: 16, height: 16, channels: 4, background: "red" } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer(); const result = await importSpriteAtlas({ generatedDir: root, manifest: fixture, atlas, runId: "fixture-run" }); assert.equal(result.frameCount, 2); assert.equal((await stat(join(result.runDir, "frames", "idle", "frame-1.png"))).isFile(), true); assert.deepEqual(JSON.parse(await readFile(result.manifestPath, "utf8")).future_top_level, { preserved: true }); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
test("import rejects missing manifest before creating output", async () => { const root = await mkdtemp(join(tmpdir(), "ima2-import-")); try { await assert.rejects(importSpriteAtlas({ generatedDir: root, manifest: null, atlas: Buffer.alloc(0), runId: "bad" }), (error: any) => error.code === "SPRITE_MANIFEST_REQUIRED"); await assert.rejects(stat(join(root, "sprite-runs", "bad"))); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
