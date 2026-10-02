import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("VideoControlsPanel exposes sound intent presets beside the voice controls", () => {
  const panel = read("ui/src/components/VideoControlsPanel.tsx");
  assert.match(panel, /import \{ SoundIntentPicker \} from "\.\/SoundIntentPicker"/);
  assert.ok(panel.indexOf("<VoicePicker />") < panel.indexOf("<SoundIntentPicker />"));
});

test("SoundIntentPicker inserts one replaceable after-prompt chip and can clear it", () => {
  const picker = read("ui/src/components/SoundIntentPicker.tsx");
  assert.match(picker, /VIDEO_SOUND_INTENT_PRESETS/);
  assert.match(picker, /insertPromptToComposer/);
  assert.match(picker, /removeInsertedPromptFromComposer/);
  assert.match(picker, /isVideoSoundIntentPrompt/);
  assert.match(picker, /buildVideoSoundIntentPrompt/);
  assert.match(picker, /aria-pressed=\{active\}/);
  assert.match(picker, /video\.soundIntent\.clear/);
  assert.match(picker, /aria-label=\{t\("video\.soundIntent\.clear"\)\}/);
});

test("all sound intent i18n keys exist in supported locales", () => {
  const presets = read("ui/src/lib/videoSoundIntent.ts");
  const keys = Array.from(presets.matchAll(/labelKey: "video\.soundIntent\.([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(keys, ["noMusic", "softBgm", "tenseMusic", "roomTone", "sfx", "noDialogue"]);
  for (const locale of ["ko", "en", "zh-Hans", "zh-Hant"]) {
    const bundle = JSON.parse(read(`ui/src/i18n/${locale}.json`));
    assert.ok(bundle.video?.soundIntentTitle, locale);
    assert.ok(bundle.video?.soundIntentHelp, locale);
    assert.ok(bundle.video?.soundIntent?.clear, locale);
    for (const key of keys) assert.ok(bundle.video?.soundIntent?.[key], `${locale} missing ${key}`);
  }
});
