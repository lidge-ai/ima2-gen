import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const composer = read("ui/src/components/PromptComposer.tsx");
const paste = read("ui/src/components/composer/usePromptPaste.ts");
const mentionChip = read("ui/src/components/ElementMentionChip.tsx");
const mentionChips = read("ui/src/components/composer/ElementMentionChips.tsx");
const en = JSON.parse(read("ui/src/i18n/en.json"));
const ko = JSON.parse(read("ui/src/i18n/ko.json"));

test("tray attachments lead the mention options with reference metadata", () => {
  assert.match(composer, /const TRAY_MENTION_PREFIX = "tray:"/);

  const trayOptions = composer.indexOf("...trayItems");
  const elementOptions = composer.indexOf("...elements.map", trayOptions);
  assert.ok(trayOptions >= 0, "tray mention options should be present");
  assert.ok(elementOptions > trayOptions, "tray mention options should precede element asset options");

  const optionsBlock = composer.slice(trayOptions, elementOptions);
  assert.match(optionsBlock, /id: `\$\{TRAY_MENTION_PREFIX\}\$\{item\.tokenId\}`/);
  assert.match(optionsBlock, /name: item\.tag/);
  assert.match(optionsBlock, /kind: "reference" as ElementMentionKind/);
  assert.match(optionsBlock, /thumbnail: item\.source\.dataUrl/);
});

test("selecting a tray mention only reinserts its tag before returning", () => {
  const branchMatch = composer.match(
    /if \(element\.id\.startsWith\(TRAY_MENTION_PREFIX\)\) \{([\s\S]*?)\n\s*\}\n\s*addElementId\?\.\(element\.id\);/,
  );
  assert.ok(branchMatch, "tray mention select branch should return before element handling");

  const branch = branchMatch[1];
  assert.match(branch, /insertTagAtMention\(trayItem\.tag, mentionQuery\)/);
  assert.match(branch, /setMentionQuery\(null\);\s*return;/);
  assert.doesNotMatch(branch, /addTrayElement|addElementId|removeTrayItem/);
});

test("both image paste paths use the shared tray-full guard", () => {
  const composerPaste = paste.match(
    /const onPaste = \(e: ClipboardEvent<HTMLDivElement>\) => \{([\s\S]*?)\n\s*\};\n\n\s*useEffect/,
  )?.[1];
  const windowPaste = paste.match(
    /const handler = \(e: globalThis\.ClipboardEvent\) => \{([\s\S]*?)\n\s*\};\n\s*window\.addEventListener\("paste", handler\)/,
  )?.[1];

  for (const [name, pastePath] of [["composer", composerPaste], ["window", windowPaste]]) {
    assert.ok(pastePath, `${name} image paste path should exist`);
    assert.match(pastePath, /const files = extractClipboardImages/);
    assert.match(pastePath, /void addPastedFiles\(files,/);
  }
  assert.match(
    paste,
    /showToast\(t\("toast\.refLimitTrayFull", \{ max: maxRefs \}\), true\)/,
  );
  assert.doesNotMatch(paste, /if \(!canAddMore\) return;/);
});

test("tray-full toast copy keeps max interpolation in English and Korean", () => {
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.toast.refLimitTrayFull, "string");
    assert.match(locale.toast.refLimitTrayFull, /\{max\}/);
  }
});

test("mention chip supports the reference kind label and icon", () => {
  assert.match(
    mentionChip,
    /export type ElementMentionKind = [^;]*\| "reference";/,
  );
  assert.match(
    mentionChip,
    /ariaLabel: string;/,
  );
  assert.match(
    mentionChip,
    /unavailableLabel: string;/,
  );
  assert.match(
    mentionChips,
    /kindLabel\(kind: ElementMentionKind\): string;/,
  );
  assert.match(
    mentionChip,
    /const paths: Record<ElementMentionKind, string> = \{[\s\S]*?reference: "[^"]+"/,
  );
});
