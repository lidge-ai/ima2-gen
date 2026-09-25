import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import type * as Persistence from "../ui/src/store/coreSelectionPersistence.ts";
import { reconcileCoreSelection } from "../ui/src/lib/coreSelection.ts";
import { CORE_SELECTION_MEMORY_STORAGE_KEY, PERSISTED_KEYS } from "../ui/src/store/persistenceRegistry.ts";

const key = "ima2.coreSelectionMemory.v1";
const generationKey = "ima2.generationDefaults";
const videoKey = "ima2.videoDefaults";

test("selection memory appends without repointing any historical persisted key", () => {
  assert.deepEqual(PERSISTED_KEYS.slice(0, 20), [
    "ima2.rightPanelOpen", "ima2.uiMode", "ima2.historyStripLayout", "ima2.canvas.exportBackground.v1",
    "ima2.imageModel", "ima2.reasoningEffort", "ima2.webSearchEnabled", "ima2.generationDefaults",
    "ima2.inFlight", "ima2.selectedFilename", "ima2.activeSessionId", "ima2.graphTabId",
    "ima2.galleryScope", "ima2.galleryDefaultScope", "ima2.locale", "ima2.workspaceProfile",
    "ima2.workspaceOverrides", "ima2.videoDefaults", "ima2.agentPanePreference", "ima2.naiOptions",
  ]);
  assert.equal(PERSISTED_KEYS[20], "ima2.coreSelectionMemory.v1");
  assert.equal(CORE_SELECTION_MEMORY_STORAGE_KEY, "ima2.coreSelectionMemory.v1");
});
class MemoryStorage {
  rows = new Map<string, string>();
  writes: string[] = [];
  fail = false;
  getItem(k: string) { return this.rows.get(k) ?? null; }
  setItem(k: string, value: string) { if (this.fail) throw Error("quota"); this.writes.push(k); this.rows.set(k, value); }
  removeItem() { throw Error("must not remove user preferences"); }
  clear() { throw Error("must not clear user preferences"); }
}

let loaded: typeof Persistence | undefined;
async function withStorage(run: (api: typeof Persistence, storage: MemoryStorage) => void) {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = async () => { throw Error("memory test must not fetch"); };
  try {
    if (!loaded) {
      const result = await build({ stdin: {
        contents: 'import "./ui/src/store/useAppStore.ts"; export * from "./ui/src/store/coreSelectionPersistence.ts";',
        resolveDir: process.cwd(),
      }, bundle: true,
        write: false, format: "iife", globalName: "selectionMemory", platform: "browser", define: { "import.meta.env": "{}" } });
      // Real source bundle; a named evaluation frame keeps failures from dumping
      // megabytes of a data-URL module into test logs.
      loaded = new Function(result.outputFiles[0]!.text + "\nreturn selectionMemory;\n//# sourceURL=wp02-memory-bundle.js")();
    }
    // Boot may register the existing browserId. Measure only the explicit
    // storage operation below, not unrelated store initialization writes.
    storage.writes.length = 0;
    run(loaded!, storage);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("memory reads never rewrite malformed or unknown-version data", async () => {
  await withStorage((api, storage) => {
    for (const raw of ["broken", "null", "[]", '{"version":2,"lanes":{"comfy":{"kind":"video","video":"future"}}}']) {
      storage.rows.set(key, raw);
      assert.deepEqual(api.loadCoreSelectionMemory(), {});
      assert.equal(storage.getItem(key), raw);
    }
    assert.deepEqual(storage.writes, []);
  });
});

test("future-version memory survives explicit v1 saves and active legacy writes", async () => {
  await withStorage((api, storage) => {
    const future = '{"version":99,"lanes":{"futureProvider":{}}}';
    storage.rows.set(key, future);
    api.saveCoreSelectionMemory({ comfy: { kind: "image", image: "wf-new" } });
    api.persistCoreSelection(reconcileCoreSelection({ provider: "grok-api", imageModel: "grok-imagine-image-quality" }));
    assert.equal(storage.getItem(key), future);
    assert.equal(JSON.parse(storage.getItem(generationKey)!).provider, "grok-api");
  });
});

test("whole-lane replacement keeps explicit slot deletion while preserving other lanes", async () => {
  await withStorage((api, storage) => {
    storage.rows.set(key, JSON.stringify({ version: 1, lanes: {
      comfy: { kind: "video", image: "wf-a", video: "wf-v" }, api: { kind: "image", image: "gpt-5.6-terra" },
    } }));
    api.saveCoreSelectionMemory({ comfy: { kind: "image", image: "wf-a" } });
    assert.deepEqual(JSON.parse(storage.getItem(key)!), { version: 1, lanes: {
      comfy: { kind: "image", image: "wf-a" }, api: { kind: "image", image: "gpt-5.6-terra" },
    } });
  });
});

test("snapshot honors current legacy keys over memory and preserves raw workflow until reconciliation", async () => {
  await withStorage((api, storage) => {
    storage.rows.set(generationKey, JSON.stringify({ provider: "comfy", comfyVideoWorkflow: "wf-missing" }));
    storage.rows.set("ima2.imageModel", "wf-legacy");
    storage.rows.set(key, JSON.stringify({ version: 1, lanes: { comfy: { kind: "image", image: "wf-old" } } }));
    assert.deepEqual(api.loadCoreSelectionSnapshot(), { provider: "comfy", imageModel: "gpt-6-luna",
      comfyWorkflow: "wf-legacy", comfyVideoWorkflow: "wf-missing", videoModelSelected: false });
    storage.rows.set(generationKey, JSON.stringify({ provider: "grok-api" }));
    storage.rows.set("ima2.imageModel", "grok-imagine-image-quality");
    storage.rows.set(videoKey, JSON.stringify({ model: "grok-imagine-video-1.5-preview" }));
    assert.equal(api.loadCoreSelectionSnapshot().provider, "grok-api");
    assert.equal(api.loadCoreSelectionSnapshot().videoModelSelected, "grok-imagine-video-1.5");
    assert.deepEqual(storage.writes, []);
  });
});

test("selection writes preserve unrelated generation/video preferences and never touch history", async () => {
  await withStorage((api, storage) => {
    storage.rows.set(generationKey, JSON.stringify({ provider: "nai", prompt: "dirty draft", count: 4,
      multimode: true, mcpProvider: "runway", mcpModel: "gen4", negativePrompt: "keep-negative" }));
    storage.rows.set(videoKey, JSON.stringify({ model: false, duration: 8, resolution: "720p", aspectRatio: "16:9" }));
    storage.rows.set("history", "immutable");
    api.persistCoreSelection(reconcileCoreSelection({ provider: "api", imageModel: "gpt-5.6-sol" }));
    const saved = JSON.parse(storage.getItem(generationKey)!);
    assert.equal(saved.provider, "api"); assert.equal(saved.prompt, "dirty draft");
    assert.equal(saved.count, 4); assert.equal(saved.multimode, true); assert.equal(saved.negativePrompt, "keep-negative");
    assert.equal(saved.mcpProvider, "runway"); assert.equal(saved.mcpModel, "gen4");
    assert.deepEqual(JSON.parse(storage.getItem(videoKey)!), { model: false, duration: 8, resolution: "720p", aspectRatio: "16:9", singleRefMode: "image-to-video" });
    assert.equal(storage.getItem("history"), "immutable");
    assert.deepEqual(storage.writes.sort(), [generationKey, "ima2.imageModel", videoKey].sort());
  });
});

test("quota failure neither escapes nor clears stored preferences", async () => {
  await withStorage((api, storage) => {
    storage.rows.set("unrelated", "keep"); storage.fail = true;
    assert.doesNotThrow(() => api.saveCoreSelectionMemory({ comfy: { kind: "image", image: "wf-a" } }));
    assert.doesNotThrow(() => api.persistCoreSelection(reconcileCoreSelection({ provider: "nai" })));
    assert.equal(storage.getItem("unrelated"), "keep");
  });
});
