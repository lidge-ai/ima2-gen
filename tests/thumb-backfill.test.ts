import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { backfillThumbnails } from "../lib/thumbBackfill.ts";
import { thumbPathForImage } from "../lib/imageThumb.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("thumbnail backfill recursively covers nested media and skips trash", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-thumb-backfill-"));
  try {
    const nested = join(root, "continuous_01");
    const trash = join(root, "trash");
    await mkdir(nested, { recursive: true });
    await mkdir(trash, { recursive: true });

    const imagePath = join(root, "image.png");
    const videoPath = join(nested, "clip.mp4");
    const trashImagePath = join(trash, "trashed.png");
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    }).png().toFile(imagePath);
    await writeFile(videoPath, "fake video");
    await writeFile(`${videoPath}.thumb.jpg`, "existing thumb");
    await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 30, g: 20, b: 10, alpha: 1 },
      },
    }).png().toFile(trashImagePath);

    const result = await backfillThumbnails(root);

    assert.deepEqual(result, { total: 2, created: 1, skipped: 1, failed: 0, failures: [] });
    assert.equal(await exists(thumbPathForImage(imagePath)), true);
    assert.equal(await exists(thumbPathForImage(trashImagePath)), false);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("thumbnail backfill treats a missing generated directory as empty", async () => {
  const missing = join(tmpdir(), `ima2-missing-generated-${Date.now()}`);

  const result = await backfillThumbnails(missing);

  assert.deepEqual(result, { total: 0, created: 0, skipped: 0, failed: 0, failures: [] });
});

test("thumbnail backfill reports files that fail thumbnail generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-thumb-backfill-failure-"));
  try {
    const badImagePath = join(root, "bad.png");
    await writeFile(badImagePath, "not an image");

    const result = await backfillThumbnails(root);

    assert.equal(result.total, 1);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].file, badImagePath);
    assert.equal(result.failures[0].kind, "image");
    assert.match(result.failures[0].reason, /unsupported image format|Input file/i);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
