import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";

/**
 * The store resolves its path from config.storage.configDir at call time, so
 * each test points that at a scratch directory instead of the user's ~/.ima2.
 */
const originalConfigDir = config.storage.configDir;
const scratchDirs: string[] = [];

async function withScratchStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-store-"));
  scratchDirs.push(dir);
  (config.storage as { configDir: string }).configDir = dir;
  try {
    return await fn();
  } finally {
    (config.storage as { configDir: string }).configDir = originalConfigDir;
  }
}

afterEach(async () => {
  (config.storage as { configDir: string }).configDir = originalConfigDir;
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop()!;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const BIND = {
  prompt: { node: "6", input: "text" },
  output: { node: "9" },
};

const GRAPH = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "hello" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
};

function record(over: Record<string, unknown> = {}) {
  return {
    id: "sdxl-base",
    label: "SDXL base",
    origin: "http://127.0.0.1:8188",
    graph: GRAPH,
    bind: BIND,
    params: [],
    ...over,
  } as never;
}

describe("comfy workflow store", () => {
  it("round-trips a record and reports no workflows on a fresh install", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      assert.deepEqual(await store.listWorkflows(), [], "a missing file is an empty list, not an error");

      const saved = await store.putWorkflow(record());
      assert.equal(saved.id, "sdxl-base");
      assert.equal(saved.origin, "http://127.0.0.1:8188");
      assert.equal(saved.mediaKind, "image");
      assert.ok(saved.createdAt > 0 && saved.updatedAt > 0);

      const all = await store.listWorkflows();
      assert.equal(all.length, 1);
      assert.equal((await store.getWorkflow("sdxl-base"))?.label, "SDXL base");
      assert.equal(await store.getWorkflow("nope"), null);
    });
  });

  it("round-trips video kind and preserves it when replacement omits the field", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      const video = await store.putWorkflow(record({ mediaKind: "video" }));
      assert.equal(video.mediaKind, "video");
      const replaced = await store.putWorkflow(record({ label: "renamed" }), { allowReplace: true });
      assert.equal(replaced.mediaKind, "video");
      assert.equal((await store.getWorkflow("sdxl-base"))?.mediaKind, "video");
    });
  });

  it("rejects invalid media kind and defaults a legacy stored record to image", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      await assert.rejects(
        () => store.putWorkflow(record({ mediaKind: "audio" })),
        (error: any) => error?.code === "COMFY_WORKFLOW_MEDIA_KIND_INVALID",
      );
      const dir = join(config.storage.configDir, "comfy");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "workflows.json"), JSON.stringify([record()]), "utf8");
      assert.equal((await store.listWorkflows())[0]?.mediaKind, "image");
    });
  });

  it("rejects ids outside the closed alphabet", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      // A workflow id reaches URLs, filenames, and the selector.
      for (const bad of ["", "-leading", "UPPER", "has space", "has/slash", "..", "a".repeat(65)]) {
        assert.throws(() => store.validateWorkflowId(bad), (e: any) => e?.code === "COMFY_WORKFLOW_ID_INVALID", `accepted ${JSON.stringify(bad)}`);
      }
      assert.equal(store.validateWorkflowId("sdxl-base_2"), "sdxl-base_2");
    });
  });

  it("refuses a duplicate id unless replacement is explicit", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      await store.putWorkflow(record());
      await assert.rejects(
        () => store.putWorkflow(record({ label: "second" })),
        (e: any) => e?.code === "COMFY_WORKFLOW_ID_TAKEN" && e?.status === 409,
      );
      const replaced = await store.putWorkflow(record({ label: "second" }), { allowReplace: true });
      assert.equal(replaced.label, "second");
      assert.equal((await store.listWorkflows()).length, 1);
    });
  });

  it("enforces the loopback origin rule at the boundary", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      // Reuses normalizeComfyOrigin, so http + loopback + explicit port is
      // inherited rather than re-implemented per call site.
      for (const bad of ["https://127.0.0.1:8188", "http://127.0.0.1", "http://example.com:8188", "http://127.0.0.1:8188/foo"]) {
        await assert.rejects(() => store.putWorkflow(record({ origin: bad })), `accepted ${bad}`);
      }
      const saved = await store.putWorkflow(record({ origin: "http://localhost:8189/" }));
      assert.equal(saved.origin, "http://localhost:8189", "trailing slash is normalized away");
    });
  });

  it("deduplicates origins for parallel health probing", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      await store.putWorkflow(record({ id: "a", origin: "http://127.0.0.1:8188" }));
      await store.putWorkflow(record({ id: "b", origin: "http://127.0.0.1:8188" }));
      await store.putWorkflow(record({ id: "c", origin: "http://127.0.0.1:8189" }));
      const origins = await store.listOrigins();
      assert.deepEqual([...origins].sort(), ["http://127.0.0.1:8188", "http://127.0.0.1:8189"]);
    });
  });

  it("deletes and reports whether anything was removed", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      await store.putWorkflow(record());
      assert.equal(await store.deleteWorkflow("sdxl-base"), true);
      assert.equal(await store.deleteWorkflow("sdxl-base"), false);
      assert.deepEqual(await store.listWorkflows(), []);
    });
  });

  it("survives a corrupt or half-written store file", async () => {
    await withScratchStore(async () => {
      const store = await import("../lib/comfyWorkflowStore.ts");
      const dir = join(config.storage.configDir, "comfy");
      await mkdir(dir, { recursive: true });

      // One bad byte must not make the settings surface unreachable.
      await writeFile(join(dir, "workflows.json"), "{not json", "utf8");
      assert.deepEqual(await store.listWorkflows(), []);

      // A record missing its bindings would otherwise appear in the selector
      // and fail only once a generation was already running.
      await writeFile(join(dir, "workflows.json"), JSON.stringify([
        { id: "ok", origin: "http://127.0.0.1:8188", graph: GRAPH, bind: BIND },
        { id: "missing-bind", origin: "http://127.0.0.1:8188", graph: GRAPH },
        { id: "UPPER", origin: "http://127.0.0.1:8188", graph: GRAPH, bind: BIND },
      ]), "utf8");
      const kept = await store.listWorkflows();
      assert.deepEqual(kept.map((r) => r.id), ["ok"]);
    });
  });
});
