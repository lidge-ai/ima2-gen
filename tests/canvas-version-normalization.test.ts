import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test, mock } from "node:test";
import type { RuntimeContext } from "../lib/runtimeContext.ts";

test("canvas filename suffix normalization preserves output and directory forms", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "ima2-canvas-normalize-"));
  const generated = join(root, "generated");
  // These replace every runtime edge to global configuration and image processing.
  const handles = [
    mock.module(new URL("../lib/historyIndex.ts", import.meta.url).href, {
      namedExports: { invalidateHistoryIndex() {} },
    }),
    mock.module(new URL("../lib/imageMetadataStore.ts", import.meta.url).href, {
      namedExports: { embedImageMetadataBestEffort: async (buffer: Buffer) => ({ buffer, embedded: true }) },
    }),
    mock.module("sharp", { defaultExport() { throw new Error("unexpected image processing"); } }),
  ];
  try {
    const { createCanvasVersion } = await import("../lib/canvasVersionStore.ts");
    const buffer = Buffer.from("89504e470d0a1a0a", "hex");
    const cases = [
      ["--hello__world--.png", "hello__world"],
      ["!!!hello world!!!.png", "hello-world"],
      ["----.png", "image"],
      ["a".repeat(100) + "---.png", "a".repeat(80)],
      ["a" + "-".repeat(64000) + "z.png", "a" + "-".repeat(79)],
      ["a" + "-".repeat(64000) + ".png", "a"],
    ];
    for (const generatedDir of [generated, generated + sep, relative(process.cwd(), generated)]) {
      // Only the three fields this store consumes; no runtimeContext/config import.
      const ctx = { config: { storage: { generatedDir } }, packageVersion: "fixture" } as RuntimeContext;
      for (const [sourceFilename, expected] of cases) {
        const item = await createCanvasVersion(ctx, { buffer, sourceFilename, prompt: "fixture prompt" });
        assert.equal(item.filename.slice(0, -26), `canvas-${expected}`);
        assert.match(item.filename.slice(-26), /^-\d{14}-[a-f0-9]{6}\.png$/);
        assert.deepEqual(await fs.readFile(join(generated, item.filename)), buffer);
        const meta = JSON.parse(await fs.readFile(join(generated, item.filename + ".json"), "utf8"));
        assert.equal(meta.canvasSourceFilename, sourceFilename);
        assert.equal(meta.prompt, "fixture prompt");
      }
    }
  } finally {
    for (const handle of handles.reverse()) handle.restore();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("canvas reads and writes stay inside generated storage", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "ima2-canvas-path-")));
  const generated = join(root, "generated");
  await fs.mkdir(generated);
  const buffer = Buffer.from("89504e470d0a1a0a", "hex");
  const outside = join(root, "outside.png"), outsideMeta = join(root, "outside.json");
  await fs.writeFile(outside, "outside image sentinel");
  await fs.writeFile(outsideMeta, '{"prompt":"outside metadata sentinel"}');
  await fs.writeFile(`${generated}.json`, '{"prompt":"root sibling sentinel"}');
  const reads: string[] = [], writes: string[] = [], outsideAttempts: string[] = [];
  let sharpCalls = 0;
  async function allow(path: string) {
    let canonical: string;
    try { canonical = await fs.realpath(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      canonical = resolve(await fs.realpath(dirname(path)), path.split(sep).at(-1)!);
    }
    if (!canonical.startsWith(generated + sep)) {
      outsideAttempts.push(path);
      throw Object.assign(Error("Owned fixture refused outside I/O"), { code: "OUTSIDE_IO" });
    }
  }
  const handles = [
    mock.module(new URL("../lib/historyIndex.ts", import.meta.url).href, { namedExports: { invalidateHistoryIndex() {} } }),
    mock.module(new URL("../lib/imageMetadataStore.ts", import.meta.url).href, {
      namedExports: { embedImageMetadataBestEffort: async (bytes: Buffer) => ({ buffer: bytes, embedded: true }) },
    }),
    mock.module("sharp", { defaultExport(bytes: Buffer) {
      sharpCalls++; assert.deepEqual(bytes, buffer);
      return { png() { return this; }, async toBuffer() { return bytes; } };
    } }),
    mock.module("fs/promises", { namedExports: { ...fs,
      async readFile(path: string, encoding?: BufferEncoding) {
        reads.push(path); await allow(path); return fs.readFile(path, encoding);
      },
      async writeFile(path: string, bytes: string | Buffer) {
        writes.push(path); await allow(path); return fs.writeFile(path, bytes);
      },
    } }),
  ];
  try {
    const store = await import(new URL("../lib/canvasVersionStore.ts?path-boundary", import.meta.url).href) as typeof import("../lib/canvasVersionStore.ts");
    const ctx = { config: { storage: { generatedDir: generated } }, packageVersion: "fixture" } as RuntimeContext;
    const snapshot = { paths: [], boxes: [], memos: [] };
    const ordinary = await store.createCanvasVersion(ctx, { buffer, sourceFilename: "source.png", prompt: "ordinary" });
    await t.test("missing annotation-bake asset retains typed404", async () => {
      await assert.rejects(store.recordCanvasAnnotationBake(ctx, "canvas-absent.png", snapshot, false), {
        status: 404, code: "CANVAS_VERSION_NOT_FOUND",
      });
    });
    await t.test("dot source metadata never reads the root sibling JSON", async () => {
      reads.length = outsideAttempts.length = 0;
      const result = await store.createCanvasVersion(ctx, { buffer, sourceFilename: "." });
      assert.notEqual(result.prompt, "root sibling sentinel");
      assert.equal(reads.includes(`${generated}.json`), false);
      assert.deepEqual(outsideAttempts, []);
    });
    await fs.symlink(outside, join(generated, "canvas-linked.png"));
    await fs.writeFile(join(generated, "canvas-linked.png.json"), '{"prompt":"valid metadata"}');
    await t.test("update and bake reject linked media before outside reads or writes", async () => {
      for (const invoke of [
        () => store.updateCanvasVersion(ctx, "canvas-linked.png", { buffer }),
        () => store.recordCanvasAnnotationBake(ctx, "canvas-linked.png", snapshot, false),
      ]) {
        reads.length = writes.length = outsideAttempts.length = 0;
        await assert.rejects(invoke, { code: "CANVAS_VERSION_PATH_ESCAPE" });
        assert.deepEqual(writes, []); assert.deepEqual(outsideAttempts, []);
      }
      assert.equal(await fs.readFile(outside, "utf8"), "outside image sentinel");
    });
    await t.test("sidecar links and dangling links are rejected before the image is overwritten", async () => {
      for (const [name, target] of [["canvas-sidecar.png", outsideMeta], ["canvas-dangling.png", join(root, "missing.json")]]) {
        await fs.writeFile(join(generated, name!), buffer);
        await fs.symlink(target!, join(generated, `${name}.json`));
        reads.length = writes.length = outsideAttempts.length = 0;
        await assert.rejects(store.updateCanvasVersion(ctx, name!, { buffer }), { code: "CANVAS_VERSION_PATH_ESCAPE" });
        assert.deepEqual(writes, []); assert.deepEqual(outsideAttempts, []);
      }
      assert.equal(await fs.readFile(outsideMeta, "utf8"), '{"prompt":"outside metadata sentinel"}');
    });
    await t.test("revert rejects a linked original image after valid baked metadata", async () => {
      await fs.symlink(outside, join(generated, "original.png"));
      await fs.writeFile(join(generated, `${ordinary.filename}.json`), JSON.stringify({
        prompt: "baked", annotationsBaked: true, canvasSourceFilename: "original.png", annotationSnapshot: snapshot,
      }));
      writes.length = outsideAttempts.length = 0;
      await assert.rejects(store.revertCanvasAnnotations(ctx, ordinary.filename), { code: "CANVAS_VERSION_PATH_ESCAPE" });
      assert.deepEqual(writes, []); assert.deepEqual(outsideAttempts, []);
      assert.equal(sharpCalls, 0);
    });
    await t.test("ordinary update, bake and revert remain usable", async () => {
      await fs.writeFile(join(generated, "original-solid.png"), buffer);
      await store.updateCanvasVersion(ctx, ordinary.filename, { buffer, sourceFilename: "original-solid.png", prompt: "safe" });
      await store.recordCanvasAnnotationBake(ctx, ordinary.filename, snapshot, false);
      const reverted = await store.revertCanvasAnnotations(ctx, ordinary.filename);
      assert.equal(reverted.item.filename, ordinary.filename);
      assert.deepEqual(reverted.snapshot, snapshot);
      assert.equal(sharpCalls, 1);
      assert.deepEqual(await fs.readFile(join(generated, ordinary.filename)), buffer);
    });
  } finally {
    for (const handle of handles.reverse()) handle.restore();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
