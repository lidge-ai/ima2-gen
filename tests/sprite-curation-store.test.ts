import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readSpriteCuration, resolveSpriteStatePlan, writeSpriteCuration } from "../lib/spriteCurationStore.ts";

test("curation is atomic, round trips, and leaves frame bytes unchanged", async () => { const root = await mkdtemp(join(tmpdir(), "ima2-curation-")); try { const frameDir = join(root, "sprite-runs", "run-1", "frames", "idle"); await mkdir(frameDir, { recursive: true }); const frame = join(frameDir, "frame-0.png"); await writeFile(frame, Buffer.from("original")); const before = createHash("sha256").update(await readFile(frame)).digest("hex"); const input = { version: 1 as const, kind: "sprite-gen-curation" as const, states: { idle: { selected: [], deleted: [1], transforms: { "0": { dx: 2 } } } } }; await writeSpriteCuration(root, "run-1", input); assert.deepEqual(await readSpriteCuration(root, "run-1"), input); assert.equal(createHash("sha256").update(await readFile(frame)).digest("hex"), before); assert.equal((await readdir(join(root, "sprite-runs", "run-1"))).some((name) => name.endsWith(".tmp")), false); assert.deepEqual(resolveSpriteStatePlan(input, "idle", 3).ordered, [0, 2]); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } });
