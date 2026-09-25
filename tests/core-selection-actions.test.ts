import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { AppState, StoreGet, StoreSet } from "../ui/src/store/storeTypes.ts";

type Runtime = typeof import("../ui/src/store/useAppStore.ts")
  & typeof import("../ui/src/store/storeCoreSelectionImpl.ts")
  & typeof import("../ui/src/store/coreSelectionPersistence.ts")
  & typeof import("../ui/src/store/storeSettingsImpl.ts")
  & typeof import("../ui/src/store/storeUIImpl.ts")
  & typeof import("../ui/src/store/storeHistoryImpl.ts");
const GENERATION = "ima2.generationDefaults";
const IMAGE = "ima2.imageModel";
const VIDEO = "ima2.videoDefaults";
const MEMORY = "ima2.coreSelectionMemory.v1";
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
let bundle: Promise<string> | undefined;
let importId = 0;

async function loadRuntime(): Promise<Runtime> {
  try {
    bundle ??= build({
      stdin: {
        contents: ["useAppStore", "storeCoreSelectionImpl", "coreSelectionPersistence",
          "storeSettingsImpl", "storeUIImpl", "storeHistoryImpl"]
          .map((name) => `export * from './ui/src/store/${name}.ts';`).join("\n"),
        resolveDir: repoRoot,
      },
      bundle: true, write: false, platform: "browser", format: "esm",
      define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
    }).then((result) => result.outputFiles[0].text);
    const source = await bundle;
    return await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${importId++}`);
  } catch (error) {
    // Data-URL stacks contain the entire bundle; retain the useful failure only.
    throw new Error(`Actual store initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

class MapStorage implements Storage {
  readonly values = new Map<string, string>([["ima2.browserId", "wp02-fixture"]]);
  readonly writes: Array<[string, string]> = [];
  readonly removals: string[] = [];
  clears = 0;
  quota = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push([key, value]);
    if (this.quota) throw new Error("fixture quota");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.clears++; this.values.clear(); }
  seed(key: string, value: unknown) { this.values.set(key, JSON.stringify(value)); }
  json(key: string) { return JSON.parse(this.getItem(key) ?? "null"); }
}

async function isolated(run: (storage: MapStorage) => Promise<void>): Promise<void> {
  const storage = new MapStorage();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = () => { requests++; throw new Error("WP02 network forbidden"); };
  try {
    await run(storage);
    assert.equal(requests, 0, "selection must not make any request");
    assert.deepEqual(storage.removals, []);
    assert.equal(storage.clears, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function fixture(runtime: Runtime, patch: Partial<AppState> = {}) {
  let state: AppState = { ...runtime.useAppStore.getState(), ...patch };
  const patches: Partial<AppState>[] = [];
  const set: StoreSet = (input) => {
    const next = typeof input === "function" ? input(state) : input;
    patches.push(next);
    state = { ...state, ...next };
  };
  const get: StoreGet = () => state;
  return { set, get, patches };
}

function selection(state: AppState) {
  const { provider, imageModel, videoModelSelected, comfyWorkflow, comfyVideoWorkflow } = state;
  return { provider, imageModel, videoModelSelected, comfyWorkflow, comfyVideoWorkflow };
}

test("actual app hydration keeps Grok API image/video lanes and video parameters without writes", async () => {
  await isolated(async (storage) => {
    storage.seed(GENERATION, { provider: "grok-api", prompt: "saved", count: 4, multimode: true });
    storage.values.set(IMAGE, "grok-imagine-image-quality");
    storage.seed(VIDEO, { model: "grok-imagine-video-1.5-preview", duration: 9, resolution: "720p", aspectRatio: "16:9" });
    const { useAppStore } = await loadRuntime();
    const state = useAppStore.getState();
    assert.deepEqual(selection(state), {
      provider: "grok-api", imageModel: "grok-imagine-image-quality",
      videoModelSelected: "grok-imagine-video-1.5", comfyWorkflow: null, comfyVideoWorkflow: null,
    });
    assert.equal(state.assetGenProvider, "grok-api");
    assert.deepEqual([state.videoDuration, state.videoResolution, state.videoAspectRatio], [9, "720p", "16:9"]);
    assert.deepEqual([state.prompt, state.count, state.multimode], ["saved", 4, true]);
    assert.deepEqual(storage.writes, []);
  });
});

test("Grok API image click commits one legal selection, persists false video, then genuinely reloads", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const f = fixture(runtime, { provider: "grok-api", imageModel: "grok-imagine-image-2.0", videoModelSelected: "grok-imagine-video-1.5" });
    runtime.setCoreImageSelection("grok-imagine-image-quality", f.set, f.get);
    assert.equal(f.patches.length, 1);
    assert.deepEqual(selection(f.get()), {
      provider: "grok-api", imageModel: "grok-imagine-image-quality", videoModelSelected: false,
      comfyWorkflow: null, comfyVideoWorkflow: null,
    });
    assert.equal(storage.json(GENERATION).provider, "grok-api");
    assert.equal(storage.getItem(IMAGE), "grok-imagine-image-quality");
    assert.equal(storage.json(VIDEO).model, false);
    assert.deepEqual(selection((await loadRuntime()).useAppStore.getState()), selection(f.get()));
  });
});

test("malformed saved providers and JSON hydrate safely without repairing storage or clearing MCP", async () => {
  await isolated(async (storage) => {
    storage.values.set(IMAGE, "grok-imagine-image-quality");
    storage.values.set(MEMORY, '{"version":1,"lanes":{"constructor":{"image":"bad","kind":"image"}}}');
    for (const provider of ["auto", "constructor", "__proto__", "toString"]) {
      storage.seed(GENERATION, { provider, mcpProvider: "fixture-mcp", mcpModel: "fixture-model", prompt: "saved" });
      const before = storage.getItem(GENERATION);
      const runtime = await loadRuntime();
      assert.equal(runtime.useAppStore.getState().provider, "grok");
      assert.equal(runtime.useAppStore.getState().imageModel, "grok-imagine-image-quality");
      assert.equal(storage.getItem(GENERATION), before);
      assert.deepEqual(storage.writes, []);
    }
    storage.values.set(GENERATION, "{");
    storage.values.set(VIDEO, "{");
    storage.values.set(MEMORY, "{");
    const runtime = await loadRuntime();
    assert.equal(runtime.useAppStore.getState().provider, "grok");
    assert.equal(runtime.useAppStore.getState().videoModelSelected, false);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(GENERATION), "{");
    assert.equal(storage.getItem(VIDEO), "{");
    assert.equal(storage.getItem(MEMORY), "{");
  });
});

test("image clicks preserve compatible auth lanes and leave incompatible lanes", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const cases = [
      ["grok-api", "gpt-5.6-sol", "oauth", "gpt-6-sol"], ["api", "gpt-5.6-sol", "api", "gpt-5.6-sol"],
      ["gemini-api", "nano-banana-2", "gemini-api", "nano-banana-2"],
      ["grok-api", "nai-diffusion-5-curated", "nai", "nai-diffusion-5-curated"],
    ] as const;
    // GPT OAuth keeps only GPT-6: a legacy id lands on its GPT-6 tier; the API-key lane keeps it.
    for (const [provider, model, expected, stored] of cases) {
      const f = fixture(runtime, { provider });
      runtime.setImageModelImpl(model, f.set, f.get);
      assert.equal(f.get().provider, expected);
      assert.equal(f.get().imageModel, stored);
      assert.equal(storage.json(GENERATION).provider, expected);
      assert.equal(storage.getItem(IMAGE), stored);
    }
  });
});

test("NovelAI provider fallback and model action preserve count/multimode preferences", async () => {
  await isolated(async (storage) => {
    storage.seed(GENERATION, { count: 4, multimode: true });
    const runtime = await loadRuntime();
    const f = fixture(runtime, { provider: "grok-api", imageModel: "grok-imagine-image-quality" });
    runtime.setProviderImpl("nai", f.set, f.get);
    assert.equal(f.get().imageModel, "nai-diffusion-5-full");
    runtime.setImageModelImpl("nai-diffusion-5-curated", f.set, f.get);
    assert.equal(f.get().provider, "nai");
    assert.equal(f.get().imageModel, "nai-diffusion-5-curated");
    runtime.setProviderImpl("oauth", f.set, f.get);
    assert.equal(f.get().imageModel, "gpt-6-luna");
    assert.deepEqual([f.get().count, f.get().multimode], [4, true]);
    assert.deepEqual([storage.json(GENERATION).count, storage.json(GENERATION).multimode], [4, true]);
  });
});

test("video actions preserve Grok API or target Grok and clear only active Comfy carriers", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    for (const provider of ["grok-api", "oauth", "comfy"] as const) {
      const f = fixture(runtime, { provider, comfyWorkflow: "image-A", comfyVideoWorkflow: "video-V" });
      runtime.selectVideoModelImpl("grok-imagine-video-1.5-preview", f.set, f.get);
      assert.equal(f.get().provider, provider === "grok-api" ? "grok-api" : "grok");
      assert.equal(f.get().videoModelSelected, "grok-imagine-video-1.5");
      assert.equal(f.get().comfyVideoWorkflow, null);
      assert.equal(f.get().comfyWorkflow, null);
      assert.equal(storage.json(VIDEO).model, "grok-imagine-video-1.5");
    }
    assert.deepEqual(storage.json(MEMORY).lanes.comfy, { image: "image-A", video: "video-V", kind: "video" });
  });
});

test("legacy Comfy workflow hydrates without rewrite; first visit never auto-selects a workflow", async () => {
  await isolated(async (storage) => {
    storage.seed(GENERATION, { provider: "comfy" });
    storage.values.set(IMAGE, "wf-missing-from-catalog");
    const runtime = await loadRuntime();
    assert.deepEqual(selection(runtime.useAppStore.getState()), {
      provider: "comfy", imageModel: "gpt-6-luna", videoModelSelected: false,
      comfyWorkflow: "wf-missing-from-catalog", comfyVideoWorkflow: null,
    });
    assert.deepEqual(storage.writes, []);
    const f = fixture(runtime, { provider: "oauth", imageModel: "gpt-5.6-sol", comfyWorkflow: null });
    runtime.setProviderImpl("comfy", f.set, f.get);
    assert.equal(f.get().comfyWorkflow, null);
    assert.equal(f.get().comfyVideoWorkflow, null);
  });
});

test("Comfy image/video actions persist through real store reload, same-lane reselect, and leave/return", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const f = fixture(runtime);
    runtime.setComfyWorkflowImpl("wf-selected-image", f.set, f.get);
    runtime.setComfyVideoWorkflowImpl("wf-selected-video", f.set, f.get);
    const expected = { provider: "comfy", imageModel: "gpt-6-luna", videoModelSelected: false,
      comfyWorkflow: "wf-selected-image", comfyVideoWorkflow: "wf-selected-video" };
    assert.deepEqual(selection(f.get()), expected);
    assert.equal(storage.json(GENERATION).comfyVideoWorkflow, "wf-selected-video");
    const reloaded = await loadRuntime();
    assert.deepEqual(selection(reloaded.useAppStore.getState()), expected);
    reloaded.useAppStore.getState().setProvider("comfy");
    assert.deepEqual(selection(reloaded.useAppStore.getState()), expected);
    reloaded.useAppStore.getState().setProvider("oauth");
    assert.equal(reloaded.useAppStore.getState().comfyWorkflow, null);
    assert.equal(reloaded.useAppStore.getState().comfyVideoWorkflow, null);
    assert.equal(storage.json(GENERATION).comfyVideoWorkflow, null);
    reloaded.useAppStore.getState().setProvider("comfy");
    assert.deepEqual(selection(reloaded.useAppStore.getState()), expected);
  });
});

test("identical Comfy states distinguish image-kind switch from explicit video null", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    for (const clearVideo of [false, true]) {
      storage.seed(MEMORY, { version: 1, lanes: { comfy: { image: "image-A", video: "video-V", kind: "video" } } });
      const f = fixture(runtime, { provider: "comfy", comfyWorkflow: "image-A", comfyVideoWorkflow: "video-V" });
      if (clearVideo) runtime.setComfyVideoWorkflowImpl(null, f.set, f.get);
      else runtime.setComfyWorkflowImpl("image-A", f.set, f.get);
      assert.equal(f.get().comfyWorkflow, "image-A");
      assert.equal(f.get().comfyVideoWorkflow, null);
      const expected = { image: "image-A", kind: "image", ...(clearVideo ? {} : { video: "video-V" }) };
      assert.deepEqual(storage.json(MEMORY).lanes.comfy, expected);
      runtime.setProviderImpl("oauth", f.set, f.get);
      runtime.setProviderImpl("comfy", f.set, f.get);
      assert.equal(f.get().comfyWorkflow, "image-A");
      assert.equal(f.get().comfyVideoWorkflow, null);
      assert.deepEqual(storage.json(MEMORY).lanes.comfy, expected);
    }
  });
});

test("explicit image null deletes only remembered image and retains inactive video across lane return", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const f = fixture(runtime, { provider: "comfy", comfyWorkflow: "image-A", comfyVideoWorkflow: "video-V" });
    runtime.setComfyWorkflowImpl(null, f.set, f.get);
    assert.equal(f.get().comfyWorkflow, null);
    assert.equal(f.get().comfyVideoWorkflow, null);
    assert.deepEqual(storage.json(MEMORY).lanes.comfy, { kind: "image", video: "video-V" });
    runtime.setProviderImpl("oauth", f.set, f.get);
    runtime.setProviderImpl("comfy", f.set, f.get);
    assert.equal(f.get().comfyWorkflow, null);
    assert.equal(f.get().comfyVideoWorkflow, null);
    assert.deepEqual(storage.json(MEMORY).lanes.comfy, { kind: "image", video: "video-V" });
  });
});

test("API tool choice and quality survive reload and reset with default/provider/storage changes", async () => {
  await isolated(async (storage) => {
    storage.seed(GENERATION, { provider: "api", quality: "high" });
    const runtime = await loadRuntime();
    const f = fixture(runtime);
    runtime.setImageToolModelImpl("gpt-image-2.5-flare", f.set, f.get);
    runtime.setQualityImpl("max", f.set, f.get);
    const reloaded = (await loadRuntime()).useAppStore.getState();
    assert.equal(reloaded.provider, "api");
    assert.equal(reloaded.imageToolModel, "gpt-image-2.5-flare");
    assert.equal(reloaded.quality, "max");
    runtime.setImageToolModelImpl(null, f.set, f.get);
    assert.equal(f.get().quality, "medium");
    runtime.setImageToolModelImpl("gpt-image-2.5-sunburst", f.set, f.get);
    runtime.setQualityImpl("xhigh", f.set, f.get);
    runtime.setCoreProviderSelection("oauth", f.set, f.get);
    assert.equal(f.get().imageToolModel, null);
    assert.equal(f.get().quality, "medium");
    assert.equal(storage.json(GENERATION).imageToolModel, null);
    runtime.setCoreProviderSelection("api", f.set, f.get);
    runtime.setImageToolModelImpl("gpt-image-2.5-flare", f.set, f.get);
    runtime.setQualityImpl("max", f.set, f.get);
    storage.seed(GENERATION, { provider: "oauth", imageToolModel: "gpt-image-2.5-flare", quality: "max" });
    runtime.syncFromStorageImpl(f.set, f.get);
    assert.equal(f.get().provider, "oauth");
    assert.equal(f.get().imageToolModel, null);
    assert.equal(f.get().quality, "medium");
  });
});

test("all interactive wrappers clear MCP while making exactly one complete core selection patch", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const actions = [
      (f: ReturnType<typeof fixture>) => runtime.setProviderImpl("nai", f.set, f.get),
      (f: ReturnType<typeof fixture>) => runtime.setImageModelImpl("gpt-5.6-sol", f.set, f.get),
      (f: ReturnType<typeof fixture>) => runtime.selectVideoModelImpl(undefined, f.set, f.get),
      (f: ReturnType<typeof fixture>) => runtime.setComfyWorkflowImpl("image-A", f.set, f.get),
      (f: ReturnType<typeof fixture>) => runtime.setComfyVideoWorkflowImpl("video-V", f.set, f.get),
    ];
    for (const action of actions) {
      const f = fixture(runtime, { mcpProvider: "fixture-mcp", mcpModel: "fixture-model", mcpRatio: "16:9",
        mcpParameters: { duration: 6 }, mcpCharacterElementId: "fixture-character", prompt: "dirty" });
      action(f);
      assert.deepEqual([f.get().mcpProvider, f.get().mcpModel, f.get().mcpRatio, f.get().mcpCharacterElementId], [null, null, null, null]);
      assert.deepEqual(f.get().mcpParameters, {});
      assert.equal(f.get().prompt, "dirty");
      assert.equal(storage.json(GENERATION).mcpProvider, null);
      const corePatches = f.patches.filter((patch) => "provider" in patch || "imageModel" in patch || "videoModelSelected" in patch);
      assert.equal(corePatches.length, 1);
      assert.deepEqual(Object.keys(corePatches[0]).sort(), ["comfyVideoWorkflow", "comfyWorkflow", "imageModel", "imageToolModel", "provider", "quality", "videoModelSelected"]);
      assert.equal(corePatches[0].imageToolModel, null);
      assert.equal(corePatches[0].quality, "medium");
    }
  });
});

test("storage sync reconciles in one patch without changing MCP, history metadata or dirty composer", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const item = { image: "/fixture.png", filename: "fixture.png", model: "custom-history-model", composerPrompt: "old" };
    const f = fixture(runtime, { history: [item], currentImage: item, prompt: "dirty", mcpProvider: "fixture-mcp",
      mcpModel: "fixture-model", mcpRatio: "16:9", mcpParameters: { duration: 6 }, mcpCharacterElementId: "fixture-character" });
    storage.values.set("ima2.selectedFilename", "fixture.png");
    storage.seed(GENERATION, { provider: "gemini-api", prompt: "other-tab" });
    storage.values.set(IMAGE, "nano-banana-pro");
    storage.seed(VIDEO, { model: "grok-imagine-video-1.5", duration: 11, resolution: "1080p", aspectRatio: "9:16" });
    const before = f.get();
    runtime.syncFromStorageImpl(f.set, f.get);
    assert.equal(f.patches.length, 1);
    assert.deepEqual(selection(f.get()), { provider: "gemini-api", imageModel: "nano-banana-pro", videoModelSelected: false,
      comfyWorkflow: null, comfyVideoWorkflow: null });
    for (const key of ["history", "currentImage", "prompt", "insertedPrompts", "mcpProvider", "mcpModel", "mcpRatio",
      "mcpParameters", "mcpInputRoles", "mcpReferenceSelection", "mcpCharacterElementId"] as const) assert.equal(f.get()[key], before[key]);
    assert.deepEqual([f.get().videoDuration, f.get().videoResolution, f.get().videoAspectRatio], [11, "1080p", "9:16"]);
    assert.equal(storage.getItem("ima2.selectedFilename"), "fixture.png");
    assert.deepEqual(storage.writes, []);
    runtime.selectHistoryImpl(item, f.set, f.get);
    assert.equal(f.get().prompt, "dirty");
    assert.equal(f.get().imageModel, "nano-banana-pro");
    assert.equal(item.model, "custom-history-model");
  });
});

test("quota failure retains legal in-memory action; future memory version is never overwritten", async () => {
  await isolated(async (storage) => {
    const runtime = await loadRuntime();
    const future = JSON.stringify({ version: 2, lanes: { comfy: { opaque: "future" } } });
    storage.values.set(MEMORY, future);
    const f = fixture(runtime);
    runtime.setComfyWorkflowImpl("wf-first", f.set, f.get);
    assert.equal(storage.getItem(MEMORY), future);
    assert.equal(storage.json(GENERATION).comfyWorkflow, "wf-first");
    storage.quota = true;
    runtime.setComfyWorkflowImpl("wf-second", f.set, f.get);
    assert.equal(f.get().provider, "comfy");
    assert.equal(f.get().comfyWorkflow, "wf-second");
    assert.equal(storage.getItem(MEMORY), future);
    assert.equal(storage.json(GENERATION).comfyWorkflow, "wf-first");
    assert.equal(f.get().videoModelSelected, false);
  });
});

test("reload fixture distinguishes unsaved version0 from an already-saved empty graph", async () => {
  const storage = new MapStorage();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldFetch = globalThis.fetch;
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response("{}", { status: 200 });
  };
  try {
    const runtime = await loadRuntime();
    const f = fixture(runtime, { activeSessionId: "wp02-session", activeSessionGraphVersion: 0,
      sessionLoading: false, graphNodes: [], graphEdges: [] });
    runtime.flushGraphSaveBeacon(f.get);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/sessions/wp02-session/graph");
    assert.equal(requests[0].options?.method, "PUT");
    assert.equal(requests[0].options?.keepalive, true);
    assert.equal(new Headers(requests[0].options?.headers).get("If-Match"), "0");
    assert.equal(new Headers(requests[0].options?.headers).get("X-Ima2-Graph-Save-Reason"), "beforeunload");
    assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { nodes: [], edges: [] });
    f.set({ activeSessionGraphVersion: 1 });
    runtime.flushGraphSaveBeacon(f.get);
    assert.equal(requests.length, 1, "saved empty fixture must not send a second PUT");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
