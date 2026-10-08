import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API88_VIDEO_SPECS as server } from "../lib/api88/videoSpecs.ts";
import { API88_VIDEO_SPECS as ui } from "../ui/src/generated/api88VideoSpecs.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { normalizeVideoModelValue, getVideoModelOptionsForProvider, resolveCoreModelValue } from "../ui/src/lib/imageModels.ts";
import { api88VideoAxes, api88AnimateFields } from "../ui/src/lib/api88Video.ts";
import { reconcileCoreSelection, filterCoreSelectionMemory } from "../ui/src/lib/coreSelection.ts";
import { effectiveCoreGenerationMode } from "../ui/src/lib/coreGenerationMode.ts";
import { effectiveReferenceLimit } from "../ui/src/lib/referenceLimits.ts";
import { coreVideoGroup, canSelectCoreVideo } from "../ui/src/lib/api88VideoSelection.ts";
import type { LaneCatalogSnapshot } from "../ui/src/lib/laneCatalog.ts";

// Node has no Vite import.meta.env; only the unrelated UI feature flags are stubbed.
const flags = mock.module(new URL("../ui/src/lib/devMode.ts", import.meta.url).href, {
  namedExports: { IS_DEV_UI: false, ENABLE_NODE_MODE: true, ENABLE_CARD_NEWS_MODE: false, ENABLE_AGENT_MODE: true },
});
// Persistence's unrelated translation import cycles back into store initialization.
const store = mock.module(new URL("../ui/src/store/useAppStore.ts", import.meta.url).href, {
  namedExports: { useAppStore: () => { assert.fail("Video persistence must not initialize the application store"); } },
});
const { loadVideoDefaults, saveVideoDefaults } = await import("../ui/src/store/storePersistence.ts");
flags.restore();
store.restore();

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async () => { assert.fail("UI contract must not fetch"); }) as typeof fetch;
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test("registry and generated projection are complete and field-exact", () => {
  assert.deepEqual(getProvider("88api").models.filter((row) => row.kind === "video").map((row) => row.id), Object.keys(server));
  assert.deepEqual(Object.keys(ui), Object.keys(server));
  for (const [id, spec] of Object.entries(server)) {
    assert.deepEqual(ui[id as keyof typeof ui], { durations: spec.durations, defaultDuration: spec.defaultDuration,
      ratios: spec.ratios, resolutions: spec.resolutions, imageLimit: spec.refs.images, veoBase64: spec.veoBase64,
      imageMode: spec.family === "grok" ? "source" : spec.firstFrame ? "both" : "reference" });
  }
});
test("all 25 byte-exact selections stay on 88api and render a video-prefixed value", () => {
  for (const id of Object.keys(ui)) {
    assert.equal(normalizeVideoModelValue(id, "88api"), id);
    const selected = reconcileCoreSelection({ provider: "88api", imageModel: "gpt-image-2", videoModelSelected: id });
    assert.equal(selected.provider, "88api");
    assert.equal(selected.videoModelSelected, id);
    assert.equal(resolveCoreModelValue({ provider: "88api", imageModel: "gpt-image-2", videoModel: id,
      comfyVideoWorkflow: "stale-comfy" }), `video:${id}`);
    assert.equal(effectiveCoreGenerationMode({ provider: "88api", uiMode: "classic", multimode: true, videoModelSelected: id }), "video");
  }
  assert.equal(normalizeVideoModelValue("grok-imagine-video-1.5-preview", "88api"), false);
  assert.equal(normalizeVideoModelValue("grok-imagine-video-1.5-preview", "grok"), "grok-imagine-video-1.5");
  assert.equal(normalizeVideoModelValue("SD2.5 720P", "grok"), false);
  assert.equal(normalizeVideoModelValue("SD2.5 720P ", "88api"), false);
});
test("picker options are per provider, with no Grok rows under unrelated lanes", () => {
  assert.equal(getVideoModelOptionsForProvider("88api").length, 25);
  assert.deepEqual(getVideoModelOptionsForProvider("grok").map((row) => row.value),
    ["grok-imagine-video", "grok-imagine-video-1.5"]);
  for (const lane of ["oauth", "api", "gemini-api", "comfy"]) assert.deepEqual(getVideoModelOptionsForProvider(lane), []);
});
test("extracted picker helper retains exact IDs, live intersection and video-key locks", () => {
  const snapshot: LaneCatalogSnapshot = { phase: "ready", observedAt: 1, error: null, catalog: {
    "88api": { status: "ready", models: { image: [], video: [
      { id: "SD2.5 720P", label: "SD2.5 720P", executable: true },
      { id: "Seedance-2.0-720p官方版", label: "Seedance-2.0-720p官方版", executable: false, lockReason: "API88_VIDEO_KEY_MISSING" },
    ] } },
  } };
  const group = coreVideoGroup("88api", snapshot, (key) => key)!;
  assert.deepEqual(group.items.map((row) => row.value), ["video:SD2.5 720P", "video:Seedance-2.0-720p官方版"]);
  assert.equal(group.items[1].disabled, true);
  assert.equal(canSelectCoreVideo("88api", "SD2.5 720P", snapshot), true);
  assert.equal(canSelectCoreVideo("88api", "Seedance-2.0-720p官方版", snapshot), false);
  assert.equal(canSelectCoreVideo("88api", "veo-3.1", snapshot), false);
  assert.equal(coreVideoGroup("oauth", snapshot, (key) => key), null);
});
test("axes expose 30s and fixed 4k, and Veo references require 8s", () => {
  const base = { videoDuration: 30, videoResolution: "4k" as const, videoAspectRatio: "21:9" };
  assert.deepEqual(api88VideoAxes({ ...base, videoModelSelected: "SD2.5 720P" }),
    { duration: 30, resolution: "720p", aspectRatio: "21:9" });
  assert.deepEqual(api88VideoAxes({ ...base, videoModelSelected: "kling-3.0-turbo-4k" }),
    { duration: 5, resolution: "4k", aspectRatio: "16:9" });
  assert.deepEqual(api88VideoAxes({ videoModelSelected: "veo-3.1", videoDuration: 4,
    videoResolution: "1080p", videoAspectRatio: "9:16" }, true),
    { duration: 8, resolution: "1080p", aspectRatio: "9:16" });
});
test("animate payload overrides its legacy mode according to the selected 88API spec", () => {
  for (const model of ["gemini-omni-flash", "seedance-2.0-mini-480p", "seedance-2.0-mini-720p"]) {
    const state = { provider: "88api", videoModelSelected: model, videoDuration: 5,
      videoResolution: "480p" as const, videoAspectRatio: "auto" };
    const payload = { mode: "image-to-video" as const, sourceFilename: "reference-only.png",
      duration: 5, resolution: "480p", aspectRatio: "auto", ...api88AnimateFields(state) };
    assert.equal(payload.mode, "reference-to-video");
    assert.equal(payload.sourceFilename, "reference-only.png");
    assert.equal(payload.resolution, ui[model as keyof typeof ui].resolutions[0]);
  }
  const frameState = { provider: "88api", videoModelSelected: "veo-3.1", videoDuration: 4,
    videoResolution: "720p" as const, videoAspectRatio: "16:9" };
  assert.equal(api88AnimateFields(frameState).mode, "image-to-video");
  assert.equal(api88AnimateFields(frameState).duration, 8);
  assert.deepEqual(api88AnimateFields({ ...frameState, provider: "grok" }), {});
  const source = read("ui/src/store/storeVideoImpl.ts");
  assert.match(source, /mode: "image-to-video" as const,[\s\S]*?\.\.\.api88RequestOverrides\(get\(\), true\),\s*\.\.\.api88AnimateFields\(get\(\)\)/);
});
test("reference cap belongs to the selected provider and model", () => {
  const base = { provider: "88api" as const, serverLimit: 50, mcpProvider: null };
  for (const [id, cap] of [["grok-imagine-video-1.5", 1], ["veo-3.1", 3],
    ["wan3.0-video-480p", 10], ["kling-3.0-turbo-720p", 30]] as const) {
    assert.equal(effectiveReferenceLimit({ ...base, videoModelSelected: id }), cap);
    assert.equal(effectiveReferenceLimit({ ...base, serverLimit: 2, videoModelSelected: id }), Math.min(2, cap));
  }
  assert.equal(effectiveReferenceLimit({ ...base, videoModelSelected: "unknown" }), 0);
});
test("per-lane memory and parameter persistence preserve spaces/CJK and fixed resolution", () => {
  const memory = filterCoreSelectionMemory({ "88api": { kind: "video", image: "gpt-image-2", video: "Seedance-2.0-720p官方版" } });
  assert.equal(memory["88api"]?.video, "Seedance-2.0-720p官方版");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    saveVideoDefaults({ model: "SD2.5 720P", duration: 30, resolution: "720p", aspectRatio: "21:9" });
    assert.deepEqual(loadVideoDefaults(), { model: "SD2.5 720P", duration: 30, resolution: "720p",
      aspectRatio: "21:9", singleRefMode: "image-to-video" });
    saveVideoDefaults({ model: "kling-3.0-turbo-4k", resolution: "4k" });
    assert.equal(loadVideoDefaults().resolution, "4k");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
test("route dispatch and controls isolate 88api from xAI planning and normalize only by its table", () => {
  const route = read("routes/video.ts");
  const guard = route.indexOf('req.body?.provider === "88api"');
  const dispatch = route.indexOf("await handleApi88Video");
  assert.ok(guard >= 0 && dispatch > guard);
  assert.ok(guard < route.indexOf("normalizeGrokVideoModel(rawModel"));
  assert.ok(dispatch < route.indexOf("await resolveGrokCredential"));
  const panel = read("ui/src/components/VideoControlsPanel.tsx");
  assert.match(panel, /provider === "88api" \? <Api88VideoControls \/> : <GrokVideoControlsPanel \/>/);
  const api88Panel = read("ui/src/components/Api88VideoControls.tsx");
  assert.match(api88Panel, /values=\{durations\}/);
  assert.match(api88Panel, /spec\.resolutions\.map/);
  assert.match(api88Panel, /spec\.ratios\.map/);
  assert.doesNotMatch(api88Panel, /VoicePicker|SoundIntentPicker|grok-planner|GROK_VIDEO_MODEL_15/);
  const store = read("ui/src/store/storeVideoImpl.ts");
  assert.match(store, /provider: "88api", model: state\.videoModelSelected \|\| API88_DEFAULT_VIDEO_MODEL/);
  assert.match(store, /providerTaskId/);
  const picker = read("ui/src/components/GenProviderModelSelect.tsx");
  assert.match(picker, /const videoGroup = coreVideoGroup\(provider, laneSnapshot, t\)/);
  assert.match(picker, /if \(videoGroup\) modelGroups\.push\(videoGroup\)/);
  assert.match(picker, /canSelectCoreVideo\(current\.provider, value\.slice\(VIDEO_PREFIX\.length\), currentSnapshot\)/);
});
