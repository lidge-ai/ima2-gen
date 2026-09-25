import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Run: node --import tsx --test tests/core-selection-transport.test.ts
// Real store entry -> payload -> API serializer -> captured fetch. No server,
// credentials, provider calls, source-function extraction, or API module mocks.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const CAPTURED = "WP02 fixture captured submission";

class MemoryStorage {
  values = new Map();
  writes = [];
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) {
    this.writes.push([String(key), String(value)]);
    this.values.set(String(key), String(value));
  }
  removeItem() { throw new Error("selection transport must not remove storage"); }
  clear() { throw new Error("selection transport must not clear storage"); }
}

// Connection is already open but never emits events or creates a socket. The
// captured POST returns a deterministic terminal error, settling real SSE code.
class FixtureEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FixtureEventSource.OPEN;
  constructor(url) { assert.equal(url, "/api/events"); }
  addEventListener() {}
  close() { this.readyState = FixtureEventSource.CLOSED; }
}

function installBoundary() {
  const requests = [];
  const unexpected = [];
  const storage = new MemoryStorage();
  const replacements = {
    localStorage: storage, sessionStorage: new MemoryStorage(),
    EventSource: FixtureEventSource,
    fetch: async (url, options) => {
      const path = String(url);
      if (options?.method !== "POST"
        || !["/api/generate", "/api/generate/multimode"].includes(path)) {
        unexpected.push({ path, method: options?.method });
        throw new Error(`Unexpected fixture request: ${path}`);
      }
      requests.push({ path, method: options.method, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ error: CAPTURED, code: "INVALID_REQUEST" }), {
        status: 422, headers: { "Content-Type": "application/json" },
      });
    },
  };
  const saved = new Map(Object.keys(replacements).map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return { requests, unexpected, storage, restore() {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

async function loadConsumers() {
  try {
    const result = await build({
      stdin: { resolveDir: repoRoot, contents: `
        export { generateImpl, confirmCustomSizeAdjustmentImpl } from "./ui/src/store/storeGenerateEntryImpl.ts";
        export { runGenerateImpl, generateMultimodeImpl } from "./ui/src/store/storeGenImpl.ts";
        export { useAppStore } from "./ui/src/store/useAppStore.ts";
        export { disconnect } from "./ui/src/lib/eventChannel.ts";
      ` },
      bundle: true, write: false, platform: "browser", format: "iife",
      globalName: "selectionTransport",
      define: { "import.meta.env": "{}" },
    });
    // Keep real bundle failures readable without embedding its source in a URL.
    return new Function(result.outputFiles[0].text
      + "\nreturn selectionTransport;\n//# sourceURL=wp02-transport-bundle.js")();
  } catch (error: any) {
    throw new Error("Could not bundle real WP02 entry and transport consumers", { cause: error });
  }
}

function fixture(consumer, overrides: any = {}) {
  const calls = [];
  const notices = [];
  const state = {
    ...consumer.useAppStore.getInitialState(),
    provider: "oauth", imageModel: "gpt-5.6-sol", videoModelSelected: false,
    comfyWorkflow: null, comfyVideoWorkflow: null,
    prompt: "fixture selection prompt", insertedPrompts: [], selectedPresetIds: [],
    uiMode: "classic", multimode: true, count: 4, multimodeMaxImages: 3,
    sizePreset: "1024x1024", referenceImages: [], providerUrlReference: null,
    naiOptionOverrides: {}, negativePrompt: "", inFlight: [], activeGenerations: 0,
    activeFlightIds: new Set(), multimodeSequences: {}, multimodePreviewFlightId: null,
    customSizeConfirm: null, missingElementIds: [],
    getResolvedSize: () => "1024x1024", startInFlightPolling() {},
    showToast: (message) => notices.push(message),
    showErrorCard: (_code, params) => notices.push(params?.fallbackMessage),
    runGenerate: async (...args) => { calls.push(["classic", ...args]); },
    generateMultimode: async (...args) => { calls.push(["multimode", ...args]); },
    runVideoGenerate: async (...args) => { calls.push(["video", ...args]); },
    ...overrides,
  };
  return { state, calls, notices, get: () => state,
    set: (patch) => Object.assign(state, typeof patch === "function" ? patch(state) : patch) };
}

async function captureTransport(context, kind, overrides, omitted = false) {
  const { consumer, boundary } = context;
  const f = fixture(consumer, overrides);
  if (omitted) delete f.state.comfyWorkflow;
  const before = boundary.requests.length;
  const action = kind === "classic" ? consumer.runGenerateImpl : consumer.generateMultimodeImpl;
  await action(undefined, f.set, f.get);
  assert.equal(boundary.requests.length, before + 1, "real serializer must reach fetch exactly once");
  const request = boundary.requests[before];
  assert.equal(request.path, kind === "classic" ? "/api/generate" : "/api/generate/multimode");
  assert.equal(request.method, "POST");
  assert.equal(request.body.async, true);
  assert.equal(request.body.prompt, "fixture selection prompt");
  assert.equal(typeof request.body.requestId, "string");
  assert.ok(request.body.requestId.length > 0);
  assert.deepEqual(f.notices, [CAPTURED], "only the deliberate transport error may occur");
  assert.equal(f.state.activeGenerations, 0);
  assert.deepEqual(f.state.inFlight, []);
  assert.equal(f.state.multimode, true);
  assert.equal(f.state.count, 4);
  assert.deepEqual(boundary.unexpected, []);
  consumer.disconnect();
  return request.body;
}

async function checkTransport(t, context) {
  for (const kind of ["classic", "multimode"]) {
    await t.test(`${kind}: selected runtime workflow wins over inactive GPT model`, async () => {
      const body = await captureTransport(context, kind, {
        provider: "comfy", imageModel: "gpt-5.6-terra", comfyWorkflow: "wf-selected",
      });
      assert.equal(body.provider, "comfy");
      assert.equal(body.model, "wf-selected");
      assert.equal(kind === "classic" ? body.n : body.maxImages, kind === "classic" ? 4 : 3);
    });
    for (const carrier of ["omitted", "undefined", "null"]) {
      await t.test(`${kind}: ${carrier} workflow omits model rather than substituting GPT`, async () => {
        const body = await captureTransport(context, kind, {
          provider: "comfy", comfyWorkflow: carrier === "null" ? null : undefined,
        }, carrier === "omitted");
        assert.equal(body.provider, "comfy");
        assert.equal(Object.hasOwn(body, "model"), false);
      });
    }
    await t.test(`${kind}: hosted model and explicit Grok API lane survive serialization`, async () => {
      const oauth = await captureTransport(context, kind, { comfyWorkflow: "wf-stray" });
      assert.equal(oauth.provider, "oauth");
      assert.equal(oauth.model, "gpt-5.6-sol");
      const grok = await captureTransport(context, kind, {
        provider: "grok-api", imageModel: "grok-imagine-image-quality", comfyWorkflow: "wf-stray",
      });
      assert.equal(grok.provider, "grok-api");
      assert.equal(grok.model, "grok-imagine-image-quality");
    });
  }
  await t.test("NAI transport forces n=1 without changing count or override semantics", async () => {
    const body = await captureTransport(context, "classic", {
      provider: "nai", imageModel: "nai-diffusion-5-full", negativePrompt: " unwanted ",
      naiOptionOverrides: { steps: 28, seed: null, straightAlpha: true },
    });
    assert.equal(body.provider, "nai");
    assert.equal(body.model, "nai-diffusion-5-full");
    assert.equal(body.n, 1);
    assert.equal(body.steps, 28);
    assert.equal(body.straightAlpha, true);
    assert.equal(body.negativePrompt, "unwanted");
    assert.equal(Object.hasOwn(body, "seed"), false);
  });
}

async function checkDispatch(t, context) {
  const cases: any[] = [
    ["Comfy video", { provider: "comfy", comfyVideoWorkflow: "wf-video" }, "video"],
    ["Comfy image", { provider: "comfy", comfyWorkflow: "wf-image" }, "classic"],
    ["empty Comfy", { provider: "comfy" }, "classic"],
    ["NAI hidden multimode", { provider: "nai", imageModel: "nai-diffusion-5-full" }, "classic"],
    ["Grok API video", { provider: "grok-api", videoModelSelected: "grok-imagine-video-1.5" }, "video"],
    ["OAuth ignores stray video", { videoModelSelected: "grok-imagine-video", comfyVideoWorkflow: "wf-stray" }, "multimode"],
    ["Grok API image", { provider: "grok-api", imageModel: "grok-imagine-image-quality" }, "multimode"],
    ["disabled multimode", { multimode: false }, "classic"],
    ...["auto", "unknown-provider", "constructor", "__proto__", "toString"].map((provider) =>
      [`unknown lane ${provider}`, { provider }, "classic"]),
  ];
  for (const [name, overrides, expected] of cases) {
    await t.test(`dispatch: ${name}`, async () => {
      const f = fixture(context.consumer, overrides);
      const storageBefore = [...context.boundary.storage.values];
      const requestsBefore = context.boundary.requests.length;
      await context.consumer.generateImpl(f.set, f.get);
      assert.deepEqual(f.calls, [[expected]]);
      assert.equal(f.state.multimode, overrides.multimode ?? true);
      assert.equal(f.state.count, 4);
      assert.deepEqual([...context.boundary.storage.values], storageBefore);
      assert.equal(context.boundary.requests.length, requestsBefore);
    });
  }
}

async function checkCustomSize(t, context) {
  for (const [provider, expected] of [["comfy", "classic"], ["oauth", "multimode"]]) {
    await t.test(`custom size: ${provider} continuation retains its original dispatch`, async () => {
      const f = fixture(context.consumer, {
        provider, comfyWorkflow: provider === "comfy" ? "wf-selected" : null,
        sizePreset: "custom", customW: 1025, customH: 1025,
      });
      await context.consumer.generateImpl(f.set, f.get);
      assert.deepEqual(f.calls, []);
      assert.equal(f.state.customSizeConfirm.continuation.kind, expected);
      assert.equal(f.state.customSizeConfirm.adjustedW, 1024);
      assert.equal(f.state.customSizeConfirm.adjustedH, 1024);
      // Changing the toggle while the modal is open must not reroute approval.
      f.state.multimode = false;
      await context.consumer.confirmCustomSizeAdjustmentImpl(f.set, f.get);
      assert.deepEqual(f.calls, [[expected, "1024x1024"]]);
      assert.equal(f.state.customSizeConfirm, null);
    });
  }
  await t.test("custom size: new missing elements still block a pending continuation", async () => {
    const f = fixture(context.consumer, { sizePreset: "custom", customW: 1025, customH: 1025 });
    await context.consumer.generateImpl(f.set, f.get);
    const pending = f.state.customSizeConfirm;
    f.state.missingElementIds = ["missing-element"];
    await context.consumer.confirmCustomSizeAdjustmentImpl(f.set, f.get);
    assert.deepEqual(f.calls, []);
    assert.strictEqual(f.state.customSizeConfirm, pending);
    assert.equal(f.notices.length, 1);
  });
}

test("WP02 actual selection transport and entry dispatch (isolated, no external fetch)", async (t) => {
  const boundary = installBoundary();
  let consumer;
  try {
    consumer = await loadConsumers();
    const initialWriteCount = boundary.storage.writes.length;
    const context = { consumer, boundary };
    await checkTransport(t, context);
    await checkDispatch(t, context);
    await checkCustomSize(t, context);
    assert.deepEqual(boundary.unexpected, []);
    assert.ok(boundary.storage.writes.slice(initialWriteCount).every(([key]) => key === "ima2.inFlight"),
      "transport must not rewrite selection preferences");
  } finally {
    try { consumer?.disconnect(); }
    finally { boundary.restore(); }
  }
});
