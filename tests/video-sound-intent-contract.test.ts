import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  SOUND_INTENT_PROMPT_ID_PREFIX,
  VIDEO_SOUND_INTENT_PRESETS,
  buildVideoSoundIntentPrompt,
  isVideoSoundIntentPrompt,
} from "../ui/src/lib/videoSoundIntent.ts";

// Sound intent presets make the existing video requirement (sound/music/no-music,
// dialogue/no-dialogue) selectable without pretending uploaded audio files are supported.

test("video sound intent presets cover silence, bgm, ambience, effects, and no-dialogue cases", () => {
  const ids = VIDEO_SOUND_INTENT_PRESETS.map((preset) => preset.id);
  assert.deepEqual(ids, ["no-music", "soft-bgm", "tense-music", "room-tone", "sfx", "no-dialogue"]);
  for (const preset of VIDEO_SOUND_INTENT_PRESETS) {
    assert.ok(preset.labelKey.startsWith("video.soundIntent."), preset.id);
    assert.ok(preset.text.includes("music") || preset.text.includes("sound") || preset.text.includes("dialogue"), preset.id);
  }
});

test("sound intent prompt chips are stable, after-main-prompt, and replaceable by prefix", () => {
  const chip = buildVideoSoundIntentPrompt(VIDEO_SOUND_INTENT_PRESETS[1]);
  assert.equal(chip.id, `${SOUND_INTENT_PROMPT_ID_PREFIX}soft-bgm`);
  assert.equal(chip.placement, "after");
  assert.match(chip.name, /Sound/);
  assert.match(chip.text, /background music/);
  assert.equal(isVideoSoundIntentPrompt(chip.id), true);
  assert.equal(isVideoSoundIntentPrompt("video-continuity:abc"), false);
});
