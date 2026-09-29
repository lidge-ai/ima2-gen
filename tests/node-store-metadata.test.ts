import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test, mock } from "node:test";
import { isSupportedMetadataFormat } from "../lib/imageMetadataStore.ts";

test("node metadata stays in the supplied canonical generated directory", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "ima2-node-meta-"));
  const generated = join(root, "generated");
  const sibling = join(root, "generated-sibling");
  const reads: string[] = [];
  const writes: string[] = [];
  const directories: string[] = [];
  let embeds = 0;
  const handles: Array<{ restore(): void }> = [];
  try {
    await fs.mkdir(generated);
    await fs.mkdir(sibling);
    // No real config/history graph may load, even when an explicit directory is used.
    handles.push(mock.module(new URL("../config.ts", import.meta.url).href, {
      namedExports: { config: { get storage() { throw new Error("global config accessed"); } } },
    }));
    handles.push(mock.module(new URL("../lib/historyIndex.ts", import.meta.url).href, {
      namedExports: { invalidateHistoryIndex() {} },
    }));
    handles.push(mock.module(new URL("../lib/imageMetadataStore.ts", import.meta.url).href, {
      namedExports: { isSupportedMetadataFormat, embedImageMetadataBestEffort(buffer: Buffer) {
        embeds += 1;
        return { embedded: true, buffer };
      } },
    }));
    handles.push(mock.module("fs/promises", { namedExports: {
      ...fs,
      readFile: async (path: string, encoding?: "utf-8") => {
        reads.push(path);
        return encoding ? fs.readFile(path, encoding) : fs.readFile(path);
      },
      mkdir: async (path: string, options: { recursive: true }) => {
        directories.push(path);
        return fs.mkdir(path, options);
      },
      writeFile: async (path: string, data: string | Buffer) => {
        writes.push(path);
        return fs.writeFile(path, data);
      },
    } }));
    const { loadNodeMeta, loadNodeB64, loadAssetB64, saveNode } = await import("../lib/nodeStore.ts");
    const metadata = { prompt: "owned fixture", format: "jpeg" };
    await fs.writeFile(join(generated, "legacy id.v1.jpeg.json"), JSON.stringify(metadata));
    await fs.writeFile(join(sibling, "secret.png.json"), '{"outside":true}');

    await t.test("save rejects extension traversal before any directory, embed or write", async () => {
      const victim = join(root, "victim");
      await fs.writeFile(victim, "owned sentinel");
      await fs.writeFile(victim + ".json", "owned sidecar sentinel");
      writes.length = directories.length = embeds = 0;
      for (const ext of ["/../../victim", "\\..\\..\\victim", "png/../../victim", "gif", "", "png\0"]) {
        await assert.rejects(saveNode("unused", { nodeId: "n_fixture", ext,
          b64: Buffer.from("fake successful image").toString("base64"), meta: {}, generatedDir: generated,
        }), { code: "INVALID_FORMAT", status: 400 });
      }
      assert.equal(await fs.readFile(victim, "utf8"), "owned sentinel");
      assert.equal(await fs.readFile(victim + ".json", "utf8"), "owned sidecar sentinel");
      assert.deepEqual(writes, []);
      assert.deepEqual(directories, []);
      assert.equal(embeds, 0);
    });
    await t.test("save rejects escaping output paths before writes", async () => {
      writes.length = directories.length = embeds = 0;
      for (const nodeId of ["../victim", join(sibling, "victim"), "a/../../victim",
        ...(process.platform === "win32" ? ["..\\victim"] : [])]) {
        await assert.rejects(saveNode("unused", { nodeId, ext: "png", b64: "aW1hZ2U=",
          meta: {}, generatedDir: generated,
        }), { code: "NODE_SOURCE_INVALID", status: 400 });
      }
      assert.deepEqual(writes, []);
      assert.deepEqual(directories, []);
      assert.equal(embeds, 0);
    });
    await t.test("save persists supported png/jpeg/jpg/webp image and sidecar", async () => {
      for (const ext of ["png", "jpeg", "jpg", "webp", "JPG"]) {
        writes.length = 0;
        const filename = `n_saved_${ext}.${ext}`;
        const meta = { prompt: "ordinary save", format: ext };
        const result = await saveNode("unused", { nodeId: `n_saved_${ext}`, ext,
          b64: Buffer.from("fake successful image").toString("base64"), meta, generatedDir: generated,
        });
        assert.equal(result.filename, filename);
        assert.deepEqual(writes, [join(generated, filename), join(generated, filename + ".json")]);
        assert.equal(await fs.readFile(join(generated, filename), "utf8"), "fake successful image");
        assert.deepEqual(JSON.parse(await fs.readFile(join(generated, filename + ".json"), "utf8")), meta);
      }
      const legacy = await saveNode("unused", { nodeId: "legacy id.v1", ext: "png", b64: "aW1hZ2U=",
        meta: { legacy: true }, generatedDir: generated });
      assert.equal(legacy.filename, "legacy id.v1.png");
      assert.deepEqual(await loadNodeMeta("unused", "legacy id.v1", "png", generated), { legacy: true });
    });

    await t.test("legacy IDs, custom extension, relative/trailing directory and missing JSON", async () => {
      assert.deepEqual(await loadNodeMeta("unused", "legacy id.v1", "jpeg", generated), metadata);
      assert.deepEqual(await loadNodeMeta("unused", "legacy id.v1", "jpeg", generated + sep), metadata);
      assert.deepEqual(await loadNodeMeta("unused", "legacy id.v1", "jpeg", relative(process.cwd(), generated)), metadata);
      assert.equal(await loadNodeMeta("unused", "missing", "png", generated), null);
      assert.equal(await loadNodeMeta("unused", "legacy id.v1", "jpeg", join(root, "absent")), null);
      await fs.writeFile(join(generated, "bad.png.json"), "{invalid");
      assert.equal(await loadNodeMeta("unused", "bad", "png", generated), null);
    });
    await t.test("traversal, sibling prefix and extension traversal are rejected before reading", async () => {
      reads.length = 0;
      for (const nodeId of ["../generated-sibling/secret", join(sibling, "secret"), "bad\0id"]) {
        assert.equal(await loadNodeMeta("unused", nodeId, "png", generated), null);
      }
      assert.equal(await loadNodeMeta("unused", "x", "/../../generated-sibling/secret.png", generated), null);
      assert.deepEqual(reads, []);
    });
    await t.test("directory symlink escape is rejected before reading", async () => {
      await fs.symlink(sibling, join(generated, "escape"), process.platform === "win32" ? "junction" : "dir");
      reads.length = 0;
      assert.equal(await loadNodeMeta("unused", "escape/secret", "png", generated), null);
      assert.deepEqual(reads, []);
    });
    await t.test("canonical root aliases and contained directory aliases remain readable", async () => {
      const alias = join(root, "alias");
      await fs.symlink(generated, alias, process.platform === "win32" ? "junction" : "dir");
      await fs.symlink(generated, join(generated, "inside"), process.platform === "win32" ? "junction" : "dir");
      assert.deepEqual(await loadNodeMeta("unused", "legacy id.v1", "jpeg", alias), metadata);
      assert.deepEqual(await loadNodeMeta("unused", "inside/legacy id.v1", "jpeg", generated), metadata);
    });
    const outsideImage = join(sibling, "secret.png");
    const image = Buffer.from("owned image bytes");
    await fs.writeFile(outsideImage, "outside image sentinel");
    await fs.writeFile(join(generated, "legacy id.v1.jpeg"), image);
    for (const reader of [loadNodeB64, loadAssetB64]) {
      await t.test(`${reader.name}: normal files and internal aliases remain readable`, async () => {
        for (const directory of [generated, generated + sep, relative(process.cwd(), generated), join(root, "alias")]) {
          assert.equal(await reader("unused", "legacy id.v1.jpeg", directory), image.toString("base64"));
        }
        assert.equal(await reader("unused", "inside/legacy id.v1.jpeg", generated), image.toString("base64"));
        assert.equal(await reader("unused", join(generated, "legacy id.v1.jpeg"), generated), image.toString("base64"));
      });
      await t.test(`${reader.name}: missing files retain NODE_NOT_FOUND 404 without reads`, async () => {
        reads.length = 0;
        for (const directory of [generated, join(root, "absent")]) {
          await assert.rejects(reader("unused", "missing.png", directory), { code: "NODE_NOT_FOUND", status: 404 });
        }
        assert.deepEqual(reads, []);
      });
      await t.test(`${reader.name}: lexical escapes are rejected before reading`, async () => {
        reads.length = 0;
        for (const filename of ["../generated-sibling/secret.png", outsideImage,
          ...(process.platform === "win32" ? ["..\\generated-sibling\\secret.png"] : [])]) {
          await assert.rejects(reader("unused", filename, generated), { code: "NODE_SOURCE_INVALID", status: 400 });
        }
        assert.deepEqual(reads, []);
      });
      await t.test(`${reader.name}: directory links cannot read outside bytes`, async () => {
        reads.length = 0;
        for (const directory of [generated, join(root, "alias")]) {
          await assert.rejects(reader("unused", "escape/secret.png", directory), { code: "NODE_SOURCE_INVALID", status: 400 });
        }
        assert.deepEqual(reads, []);
        assert.equal(await fs.readFile(outsideImage, "utf8"), "outside image sentinel");
      });
    }
    if (process.platform !== "win32") {
      // Windows directory-junction coverage above does not require symlink privileges.
      await t.test("leaf symlink escape is rejected before reading", async () => {
        await fs.symlink(join(sibling, "secret.png.json"), join(generated, "leaf.png.json"));
        reads.length = 0;
        assert.equal(await loadNodeMeta("unused", "leaf", "png", generated), null);
        assert.deepEqual(reads, []);
      });
      await fs.symlink(outsideImage, join(generated, "leaf.png"));
      await fs.symlink(join(generated, "legacy id.v1.jpeg"), join(generated, "safe-leaf.jpeg"));
      await fs.symlink(join(sibling, "absent.png"), join(generated, "dangling.png"));
      for (const reader of [loadNodeB64, loadAssetB64]) {
        await t.test(`${reader.name}: leaf links enforce containment and preserve missing behavior`, async () => {
          reads.length = 0;
          await assert.rejects(reader("unused", "leaf.png", generated), { code: "NODE_SOURCE_INVALID", status: 400 });
          await assert.rejects(reader("unused", "dangling.png", generated), { code: "NODE_NOT_FOUND", status: 404 });
          assert.deepEqual(reads, []);
          assert.equal(await fs.readFile(outsideImage, "utf8"), "outside image sentinel");
          assert.equal(await reader("unused", "safe-leaf.jpeg", generated), image.toString("base64"));
        });
      }
    }
    await t.test("parent without metadata cannot bypass containment through PNG fallback", async () => {
      // Keep the real parent/store chain; unrelated helpers cannot load runtime dependencies.
      for (const [module, names] of [
        ["refs", ["detectImageMimeFromB64"]], ["routeHelpers", ["writeSse"]],
        ["ssePublish", ["publishJobEvent"]], ["errors/envelope", ["errorEnvelopeFields"]],
      ] as const) {
        handles.push(mock.module(new URL(`../lib/${module}.ts`, import.meta.url).href, {
          namedExports: Object.fromEntries(names.map((name) => [name, () => { throw new Error(`unexpected ${name}`); }])),
        }));
      }
      const { loadParentNodeB64 } = await import("../lib/nodeHelpers.ts");
      // The parent reader only consumes rootDir and config.storage.generatedDir.
      const ctx = { rootDir: "unused", config: { storage: { generatedDir: generated } } } as Parameters<typeof loadParentNodeB64>[0];
      await fs.writeFile(join(sibling, "parent.png"), "outside parent sentinel");
      await fs.writeFile(join(generated, "legacy parent.v1.png"), image);
      for (const ext of ["png", "jpeg", "webp"]) {
        assert.equal(await loadNodeMeta("unused", "escape/parent", ext, generated), null);
      }
      reads.length = 0;
      await assert.rejects(loadParentNodeB64(ctx, "escape/parent"), { code: "NODE_SOURCE_INVALID", status: 400 });
      assert.deepEqual(reads, []);
      assert.equal(await fs.readFile(join(sibling, "parent.png"), "utf8"), "outside parent sentinel");
      assert.equal(await loadParentNodeB64(ctx, "legacy parent.v1"), image.toString("base64"));
      await assert.rejects(loadParentNodeB64(ctx, "missing parent"), { code: "NODE_NOT_FOUND", status: 404 });
    });
  } finally {
    for (const handle of handles.reverse()) handle.restore();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
