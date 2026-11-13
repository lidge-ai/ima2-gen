import { strict as assert } from "node:assert";
import { test } from "node:test";
import sharp from "sharp";
import {
  VECTOR_PRESETS,
  isRasterPath,
  isVectorPreset,
  vectorizeImageBuffer,
} from "../lib/vectorizeImage.ts";

/**
 * Fixtures are generated at runtime rather than committed: a binary PNG would
 * count against scripts/check-new-blob-budget.mjs for no benefit.
 */
async function flatPng(size = 64): Promise<Buffer> {
  const half = Math.floor(size / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } },
  })
    .composite([{
      input: {
        create: { width: half, height: half, channels: 4, background: { r: 20, g: 120, b: 90, alpha: 1 } },
      },
      left: Math.floor(size / 4),
      top: Math.floor(size / 4),
    }])
    .png()
    .toBuffer();
}

async function transparentPng(size = 64): Promise<Buffer> {
  const half = Math.floor(size / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: {
        create: { width: half, height: half, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
      },
      left: Math.floor(size / 4),
      top: Math.floor(size / 4),
    }])
    .png()
    .toBuffer();
}

async function rejectsWithCode(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

test("traces a flat raster into real vector paths", async () => {
  const result = await vectorizeImageBuffer(await flatPng());
  assert.ok(result.svg.startsWith("<svg"), "output should be an SVG document");
  assert.ok(result.pathCount > 0, "tracing should emit at least one path");
  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
  assert.equal(result.preset, "auto");
  assert.ok(result.bytes > 0);
  assert.ok(result.elapsedMs >= 0);
});

test("detailed tracing differs from auto for a soft-edged logo", async () => {
  const source = await sharp(await flatPng(96)).blur(2).png().toBuffer();
  const auto = await vectorizeImageBuffer(source, { preset: "auto" });
  const detailed = await vectorizeImageBuffer(source, { preset: "detailed" });
  assert.notEqual(detailed.svg, auto.svg);
});

test("auto preserves the square corners of an opaque background", async () => {
  const source = await sharp({
    create: { width: 160, height: 96, channels: 4, background: "#eeeeee" },
  }).composite([{
    input: { create: { width: 60, height: 40, channels: 4, background: "#14785a" } },
    left: 50,
    top: 28,
  }]).blur(1).png().toBuffer();
  const { svg } = await vectorizeImageBuffer(source, { preset: "auto" });
  const firstPath = svg.match(/<path\b[^>]*>/)?.[0] ?? "";
  assert.match(firstPath, /\bd="M0 0h160v96H0Z"/);
});

test("root viewBox matches raster dimensions with and without optimization", async () => {
  const source = await sharp({
    create: { width: 80, height: 48, channels: 3, background: "#348765" },
  }).png().toBuffer();
  for (const optimize of [true, false]) {
    const { svg } = await vectorizeImageBuffer(source, { optimize });
    const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
    assert.match(root, /\bviewBox="0 0 80 48"/);
    assert.equal((root.match(/\bviewBox=/g) ?? []).length, 1);
    assert.match(root, /\bwidth="80"/);
    assert.match(root, /\bheight="48"/);
  }
});

test("preserves alpha instead of painting an opaque background", async () => {
  const result = await vectorizeImageBuffer(await transparentPng());
  assert.ok(result.pathCount > 0);
  // A transparent region must emit no geometry at all. A full-canvas rect would
  // mean the cutout silently gained a background.
  assert.equal(/<rect[^>]*width="64"[^>]*height="64"/.test(result.svg), false);
});

test("mono preset produces fewer paths than the colour default", async () => {
  const source = await flatPng();
  const mono = await vectorizeImageBuffer(source, { preset: "mono" });
  const detailed = await vectorizeImageBuffer(source, { preset: "detailed" });
  assert.equal(mono.preset, "mono");
  assert.ok(
    mono.pathCount <= detailed.pathCount,
    "binary tracing should not emit more paths than colour tracing",
  );
});

test("rejects an empty buffer", async () => {
  await rejectsWithCode(() => vectorizeImageBuffer(Buffer.alloc(0)), "VECTORIZE_INPUT_EMPTY");
});

test("rejects bytes that are not a decodable raster", async () => {
  await rejectsWithCode(
    () => vectorizeImageBuffer(Buffer.from("this is not an image at all")),
    "VECTORIZE_DECODE_FAILED",
  );
});

test("rejects an image beyond the dimension guard", async () => {
  const wide = await sharp({
    create: { width: 8200, height: 8, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  }).png().toBuffer();
  await rejectsWithCode(() => vectorizeImageBuffer(wide), "VECTORIZE_DIMENSIONS_TOO_LARGE");
});

test("never emits active SVG content", async () => {
  const result = await vectorizeImageBuffer(await flatPng());
  assert.equal(/<script/i.test(result.svg), false);
  assert.equal(/<foreignObject/i.test(result.svg), false);
  assert.equal(/\son[a-z]+\s*=/i.test(result.svg), false);
  assert.equal(/javascript:/i.test(result.svg), false);
});

test("optimization shrinks the traced document", async () => {
  const source = await flatPng(128);
  const raw = await vectorizeImageBuffer(source, { optimize: false });
  const optimized = await vectorizeImageBuffer(source, { optimize: true });
  assert.ok(
    optimized.bytes <= raw.bytes,
    "optimize should not grow the document (raw " + raw.bytes + " vs opt " + optimized.bytes + ")",
  );
});

test("exposes preset and raster-path helpers", () => {
  assert.deepEqual([...VECTOR_PRESETS], ["auto", "flat", "detailed", "mono"]);
  assert.equal(isVectorPreset("flat"), true);
  assert.equal(isVectorPreset("vector"), false);
  assert.equal(isRasterPath("a.png"), true);
  assert.equal(isRasterPath("a.WEBP"), true);
  assert.equal(isRasterPath("a.svg"), false);
  assert.equal(isRasterPath("a.mp4"), false);
});
