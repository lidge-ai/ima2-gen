import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIDEO_SOUND_INTENT_PRESETS } from "../ui/src/lib/videoSoundIntent.ts";

test("sound intent labels and guidance exist in all supported locales", () => {
  const keys = VIDEO_SOUND_INTENT_PRESETS.map((preset) => preset.labelKey);
  assert.deepEqual(keys, ["video.soundIntent.noMusic", "video.soundIntent.softBgm", "video.soundIntent.tenseMusic",
    "video.soundIntent.roomTone", "video.soundIntent.sfx", "video.soundIntent.noDialogue"]);
  for (const locale of ["ko", "en", "zh-Hans", "zh-Hant"]) {
    const bundle = JSON.parse(readFileSync(new URL(`../ui/src/i18n/${locale}.json`, import.meta.url), "utf8"));
    for (const key of [...keys, "video.soundIntentTitle", "video.soundIntentHelp", "video.soundIntent.clear"]) {
      const text = key.split(".").reduce((value, part) => value?.[part], bundle);
      assert.equal(typeof text, "string", `${locale} missing ${key}`);
      assert.ok(text.trim().length > 0, `${locale} empty ${key}`);
    }
  }
});
