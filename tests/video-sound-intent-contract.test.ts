import { test } from "node:test";
import * as assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { VIDEO_SOUND_INTENT_PRESETS, buildVideoSoundIntentPrompt, isVideoSoundIntentPrompt } from "../ui/src/lib/videoSoundIntent.ts";

const TEXTS = [
  "no background music; use only natural scene sound and room tone",
  "soft cinematic background music, gentle ambience, no distracting sound effects",
  "subtle tense background music that builds emotion without overpowering the scene",
  "natural room tone and environmental sound only; keep the audio realistic",
  "emphasize clear synchronized sound effects that match the visible action",
  "no dialogue or spoken words; communicate the moment through motion, music, and sound",
];

test("sound presets distinguish no music from silence and retain canonical instructions", () => {
  assert.deepEqual(VIDEO_SOUND_INTENT_PRESETS.map((p) => p.id),
    ["no-music", "soft-bgm", "tense-music", "room-tone", "sfx", "no-dialogue"]);
  assert.deepEqual(VIDEO_SOUND_INTENT_PRESETS.map((p) => p.text), TEXTS);
});

test("localized names do not change stable chip identity, text or placement", () => {
  const preset = VIDEO_SOUND_INTENT_PRESETS[1];
  assert.deepEqual(buildVideoSoundIntentPrompt(preset, "잔잔한 BGM"), {
    id: "video-sound-intent:soft-bgm", name: "잔잔한 BGM", text: TEXTS[1], placement: "after",
  });
  assert.equal(buildVideoSoundIntentPrompt(preset).name, "Sound: soft-bgm");
  assert.equal(isVideoSoundIntentPrompt("video-sound-intent:soft-bgm"), true);
  assert.equal(isVideoSoundIntentPrompt("video-continuity:abc"), false);
  assert.equal(isVideoSoundIntentPrompt("ordinary"), false);
});

test("actual composer orders ordinary chips, main and sound without duplicating intent", async () => {
  // storePersistence depends on Vite feature flags. Bundle the actual module with
  // production flags, rather than copying its composition implementation into a test.
  const ui = fileURLToPath(new URL("../ui/", import.meta.url));
  const result = await build({ stdin: { contents: 'import "./src/store/useAppStore"; export { composePrompt } from "./src/store/storePersistence";', resolveDir: ui },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "WP3Composer", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"DEV":false,"PROD":true}' } });
  const storage = new Map<string, string>();
  const module = runInNewContext(`${result.outputFiles[0].text}; WP3Composer`, {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    console,
  }, { timeout: 1000 });
  const chips = [
    { id: "before", name: "Before", text: "BEFORE", placement: "before" },
    { id: "after", name: "After", text: "AFTER", placement: "after" },
    buildVideoSoundIntentPrompt(VIDEO_SOUND_INTENT_PRESETS[0]),
  ];
  assert.equal(module.composePrompt(" MAIN ", chips), `BEFORE\n\nMAIN\n\nAFTER\n\n${TEXTS[0]}`);
  assert.equal(module.composePrompt(" ", chips), `BEFORE\n\nAFTER\n\n${TEXTS[0]}`);
});
