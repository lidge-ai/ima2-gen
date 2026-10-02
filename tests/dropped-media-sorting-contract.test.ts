import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { composerAcceptAttr, sortDroppedByKind, type DropRejection } from "../ui/src/lib/droppedMedia.ts";

// devlog/_plan/260908_xai_imagine_spec_resync/030_wp35_gui_inputs.md
//
// Three surfaces each filtered dropped files with their own image/* check and discarded
// everything else without a word. A user who dragged an mp3 saw nothing happen and could
// not tell a rejection from a drag that never registered.

function file(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

const png = () => file("a.png", "image/png");
const mp3 = () => file("a.mp3", "audio/mpeg");
const mp4 = () => file("a.mp4", "video/mp4");

test("images are accepted in every mode", () => {
  for (const model of [false as const, "grok-imagine-video", "grok-imagine-video-1.5"]) {
    const sorted = sortDroppedByKind([png()], { videoModelSelected: model });
    assert.equal(sorted.images.length, 1);
    assert.equal(sorted.rejected.length, 0);
  }
});

test("audio uploads are rejected with an actionable explanation", () => {
  // Preset voices and prompt-described sound are supported; uploaded audio clips are not
  // wired into generation because xAI gates them upstream. The picker should not offer
  // audio/* as if it were actionable, and drops should still get an explicit outcome.
  for (const model of [false as const, "grok-imagine-video", "grok-imagine-video-1.5", "grok-imagine-video-1.5-preview"]) {
    const sorted = sortDroppedByKind([mp3()], { videoModelSelected: model });
    assert.equal(sorted.rejected[0]?.reason, "audio-upload-unsupported", String(model));
  }
});

test("video reaches only the base model, one at a time", () => {
  // Editing and extending run on grok-imagine-video; 1.5 answers 400 for both.
  assert.equal(sortDroppedByKind([mp4()], { videoModelSelected: "grok-imagine-video" }).videos.length, 1);
  assert.equal(
    sortDroppedByKind([mp4()], { videoModelSelected: "grok-imagine-video-1.5" }).rejected[0]?.reason,
    "video-needs-base",
  );
  const two = sortDroppedByKind([mp4(), mp4()], { videoModelSelected: "grok-imagine-video" });
  assert.equal(two.videos.length, 1);
  assert.equal(two.rejected[0]?.reason, "video-single-only");
});

test("an mp4 with no reported type is still treated as video", () => {
  // Some platforms hand over an empty type. Calling that "not media" would be a worse
  // answer than trying it, since the route validates the real file anyway.
  const sorted = sortDroppedByKind([file("clip.MP4", "")], { videoModelSelected: "grok-imagine-video" });
  assert.equal(sorted.videos.length, 1);
});

test("anything else is rejected with a reason rather than dropped silently", () => {
  const sorted = sortDroppedByKind([file("a.pdf", "application/pdf")], { videoModelSelected: false });
  assert.equal(sorted.rejected.length, 1);
  assert.equal(sorted.rejected[0]?.reason, "not-media");
});

test("a mixed drop sorts every file and leaves none unaccounted for", () => {
  const files = [png(), mp3(), mp4(), file("a.pdf", "application/pdf")];
  const sorted = sortDroppedByKind(files, { videoModelSelected: "grok-imagine-video-1.5" });
  const total = sorted.images.length + sorted.videos.length + sorted.rejected.length;
  assert.equal(total, files.length, "every dropped file must land in exactly one bucket");
});

test("the file picker offers exactly what the drop handler accepts", () => {
  assert.equal(composerAcceptAttr({ videoModelSelected: false }), "image/*");
  assert.equal(composerAcceptAttr({ videoModelSelected: "grok-imagine-video-1.5" }), "image/*");
  assert.equal(composerAcceptAttr({ videoModelSelected: "grok-imagine-video" }), "image/*,video/mp4");
});

test("every rejection reason has a message in all four locales", () => {
  // The reason is a union so a missing message is a compile error in the component, but
  // the locale files are JSON and cannot be typed. This is that check.
  const reasons: DropRejection[] = [
    "not-media",
    "audio-upload-unsupported",
    "video-needs-base",
    "video-single-only",
  ];
  // The mapping lives in the hook rather than the component: the repo's i18n guard
  // requires literal keys at each t() call, so an exhaustive switch replaced the table.
  const componentSource = readFileSync(new URL("../ui/src/components/composer/useComposerDrop.ts", import.meta.url), "utf8");
  const keys = reasons.map((reason) => {
    const match = componentSource.match(new RegExp('case "' + reason + '":\\s*return t\\("([^"]+)"\\)'));
    assert.ok(match, "no i18n key mapped for " + reason);
    return match![1].replace(/^prompt\./, "");
  });
  for (const locale of ["ko", "en", "zh-Hans", "zh-Hant"]) {
    const bundle = JSON.parse(readFileSync(new URL("../ui/src/i18n/" + locale + ".json", import.meta.url), "utf8"));
    for (const key of keys) {
      assert.ok(bundle.prompt?.[key], locale + " is missing prompt." + key);
    }
    for (const key of ["videoUseCliForEdit"]) {
      assert.ok(bundle.prompt?.[key], locale + " is missing prompt." + key);
    }
  }
});
