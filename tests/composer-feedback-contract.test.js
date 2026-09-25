import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const composer = read("ui/src/components/PromptComposer.tsx");
const paste = read("ui/src/components/composer/usePromptPaste.ts");
const toolbar = read("ui/src/components/composer/PromptComposerToolbar.tsx");
const mirror = read("ui/src/components/composer/DeadTagMirror.tsx");
const composerCss = read("ui/src/styles/composer-panes.css");
const en = JSON.parse(read("ui/src/i18n/en.json"));
const ko = JSON.parse(read("ui/src/i18n/ko.json"));

test("local and window image paste share partial feedback handling", () => {
  assert.match(paste, /const addPastedFiles = async/);
  assert.match(paste, /void addPastedFiles\(files, captureAttachmentCaret\(\)\)/);
  assert.match(
    paste,
    /void addPastedFiles\(files, useAppStore\.getState\(\)\.prompt\.length\)/,
  );
  assert.match(paste, /const room = Math\.max\(0, maxRefs - trayItemCount\)/);
  assert.match(
    paste,
    /showToast\(t\("toast\.refLimitTrayFull", \{ max: maxRefs \}\), true\)/,
  );
  assert.match(paste, /const accepted = files\.slice\(0, room\)/);
  assert.match(paste, /const added = await addFilesAtCaret\(accepted, caret, false\)/);
  assert.match(paste, /if \(files\.length > accepted\.length\)/);
  assert.match(
    paste,
    /t\("toast\.refLimitPartial", \{ added, total: files\.length, max: maxRefs \}\),\s*false/,
  );
});

test("attachment insertion reports the actual new token count", () => {
  assert.match(
    composer,
    /const insertAttachmentTags = \(knownTokenIds: ReadonlySet<string>, caret: number\): number =>/,
  );
  assert.match(composer, /if \(added\.length === 0\) return 0/);
  assert.match(composer, /return added\.length/);
  assert.match(
    composer,
    /const addFilesAtCaret = async \(files: File\[\], caret: number, inspectMetadata: boolean\): Promise<number> =>/,
  );
  assert.match(composer, /return insertAttachmentTags\(knownTokenIds, caret\)/);
  assert.match(composer, /catch \{\s*return 0;/);
});

test("partial paste and dead-tag status copy keep required interpolation", () => {
  for (const locale of [en, ko]) {
    assert.match(locale.toast.refLimitPartial, /\{added\}/);
    assert.match(locale.toast.refLimitPartial, /\{total\}/);
    assert.match(locale.toast.refLimitPartial, /\{max\}/);
    assert.match(locale.prompt.deadTagStatus, /\{tags\}/);
  }
});

test("dead-tag mirror keeps visuals hidden and announces unique unavailable tags", () => {
  assert.match(mirror, /aria-hidden="true"/);
  assert.match(mirror, /new Set\(deadTokens\.map\(\(token\) => `@\$\{token\.tag\}`\)\)/);
  assert.match(mirror, /role="status"/);
  assert.match(mirror, /aria-live="polite"/);
  assert.match(mirror, /aria-atomic="true"/);
  assert.match(
    mirror,
    /t\("prompt\.deadTagStatus", \{ tags: deadTagNames\.join\(", "\) \}\)/,
  );
});

test("composer textarea distinguishes mouse focus from keyboard focus", () => {
  const focusRule = composerCss.match(/\.composer__textarea:focus\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const focusVisibleRule = composerCss.match(/\.composer__textarea:focus-visible\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(focusRule, /box-shadow:\s*none/);
  assert.match(focusVisibleRule, /box-shadow:\s*0 0 0 2px var\(--focus-ring\)/);
  assert.ok(
    composerCss.indexOf(".composer__textarea:focus-visible") > composerCss.indexOf(".composer__textarea:focus"),
    "the keyboard focus rule should follow the generic focus reset",
  );
});

test("PromptComposer delegates paste and toolbar behavior within the line budget", () => {
  assert.match(composer, /import \{ usePromptPaste \}/);
  assert.match(composer, /import \{ PromptComposerToolbar \}/);
  assert.match(composer, /const onPaste = usePromptPaste\(\{/);
  assert.match(
    composer,
    /<PromptComposerToolbar canAddMore=\{canAddMore\} onAttach=\{openFilePicker\} \/>/,
  );
  assert.ok(composer.split("\n").length <= 500, "PromptComposer.tsx must stay at or below 500 lines");
});

test("extracted toolbar preserves controls, state, and storyboard contracts", () => {
  for (const className of ["composer__hint-row", "composer__toolbar", "composer__storyboard-row"]) {
    assert.match(toolbar, new RegExp(className));
  }
  for (const key of [
    "prompt.hint",
    "prompt.attachTitle",
    "prompt.continueTitle",
    "prompt.videoToggleTitle",
    "prompt.directModeTitle",
    "promptLibrary.saveTitle",
    "prompt.storyboardTitle",
  ]) {
    assert.match(toolbar, new RegExp(`t\\("${key.replaceAll(".", "\\.")}"`));
  }
  assert.match(toolbar, /aria-pressed=\{!!videoModelSelected\}/);
  assert.match(toolbar, /aria-pressed=\{isDirectMode\}/);
  assert.match(toolbar, /aria-pressed=\{storyboardActive\}/);
  assert.match(toolbar, /<WebSearchToggle variant="compact" \/>/);
  assert.match(toolbar, /<SavePromptPopover/);
  assert.match(toolbar, /continueFromItem\(currentImage\)/);
  assert.match(toolbar, /setImageModel\(DEFAULT_IMAGE_MODEL\)/);
});

test("mention ownership remains in PromptComposer", () => {
  assert.match(composer, /const TRAY_MENTION_PREFIX = "tray:"/);
  assert.ok(composer.indexOf("...trayItems") < composer.indexOf("...elements.map"));
  assert.match(composer, /setMentionQuery\(null\);\s*return;/);
  assert.match(composer, /addElementId\?\.\(element\.id\)/);
});
