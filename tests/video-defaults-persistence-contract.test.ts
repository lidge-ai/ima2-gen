import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Contract: video defaults (model/duration/resolution/aspectRatio) persist
// across reloads and tabs, video mode survives refresh, and continue-from-video
// switches into video mode. Closes devlog lanes 260531_video-settings-persistence
// and 260601_video-mode-persistence-refresh.

const registry = readFileSync("ui/src/store/persistenceRegistry.ts", "utf8");
const persistence = readFileSync("ui/src/store/storePersistence.ts", "utf8");
const appStore = readFileSync("ui/src/store/useAppStore.ts", "utf8");
const uiImpl = readFileSync("ui/src/store/storeUIImpl.ts", "utf8");
const continueFrom = readFileSync("ui/src/lib/continueFromItem.ts", "utf8");

test("ima2.videoDefaults is a registered persisted key with the full shape", () => {
  assert.match(registry, /"ima2\.videoDefaults"/);
  assert.match(registry, /"ima2\.videoDefaults":\s*\{[^}]*json:\{model,duration,resolution,aspectRatio\}/);
});

test("storePersistence exposes load/save with a safe fallback", () => {
  assert.match(persistence, /export const VIDEO_DEFAULTS_FALLBACK: VideoDefaults/);
  assert.match(persistence, /export function loadVideoDefaults\(\): VideoDefaults/);
  assert.match(persistence, /export function saveVideoDefaults\(patch: Partial<VideoDefaults>\)/);
});

test("app store restores video parameters on init", () => {
  assert.match(appStore, /const storedVideoDefaults = loadVideoDefaults\(\)/);
  assert.match(appStore, /videoDuration:\s*storedVideoDefaults\.duration/);
  assert.match(appStore, /videoResolution:\s*storedVideoDefaults\.resolution/);
  assert.match(appStore, /videoAspectRatio:\s*storedVideoDefaults\.aspectRatio/);
});

test("video param setters persist their patch", () => {
  assert.match(appStore, /setVideoDuration:.*saveVideoDefaults\(\{ duration: videoDuration \}\)/);
  assert.match(appStore, /setVideoResolution:.*saveVideoDefaults\(\{ resolution: videoResolution \}\)/);
  assert.match(appStore, /setVideoAspectRatio:.*saveVideoDefaults\(\{ aspectRatio: videoAspectRatio \}\)/);
});

// Mode hydration and video/image action writes are exercised against real storage
// and store reloads in core-selection-actions.test.ts; parameter contracts stay here.

test("cross-tab storage sync includes video defaults", () => {
  assert.match(uiImpl, /syncFromStorageImpl[\s\S]*?loadVideoDefaults\(\)/);
});

test("continue-from-video enters video mode", () => {
  assert.match(continueFrom, /if \(!store\.videoModelSelected\)\s*\{\s*store\.selectVideoModel\(/);
});
