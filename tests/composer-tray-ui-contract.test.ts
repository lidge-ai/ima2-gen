import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const composer = read("ui/src/components/PromptComposer.tsx");
const tray = read("ui/src/components/composer/ReferenceTray.tsx");
const mirror = read("ui/src/components/composer/DeadTagMirror.tsx");
const composerCss = read("ui/src/styles/progress-composer.css");
const paneCss = read("ui/src/styles/composer-panes.css");
const sidebarCss = read("ui/src/styles/sidebar.css");
const en = JSON.parse(read("ui/src/i18n/en.json"));
const ko = JSON.parse(read("ui/src/i18n/ko.json"));

test("PromptComposer renders one unified reference tray", () => {
  assert.match(composer, /import \{ ReferenceTray \}/);
  assert.match(composer, /<ReferenceTray[\s\S]*?items=\{trayItems\}[\s\S]*?onRemove=\{removeTrayItem\}/);
  assert.match(composer, /refCount", \{ count: trayItems\.length, max: maxRefs \}/);
  assert.doesNotMatch(composer, /composer__chips/);
  assert.doesNotMatch(composer, /Selected elements/);
  assert.match(tray, /item\.source\.dataUrl/);
  assert.match(tray, /item\.source\.thumbnailUrl/);
  assert.match(tray, /generatedThumbnail\(item\.source\.referenceFilenames\[0\]\)/);
  assert.match(tray, /onRemove\(item\.tokenId\)/);
  assert.match(tray, /composer__tray-slot--add/);
  assert.match(tray, /disabled=\{full\}/);
  assert.match(tray, /prompt\.refOverProviderLimit/);
});

test("dead tags join retiredTags behind the native textarea", () => {
  assert.match(composer, /<DeadTagMirror prompt=\{prompt\} retiredTags=\{retiredTags\}/);
  assert.match(composer, /composer__prompt-stack/);
  assert.match(mirror, /findTrayTagTokens\(prompt\)/);
  assert.match(mirror, /hasOwnProperty\.call\(retiredTags, token\.tag\)/);
  assert.match(mirror, /ResizeObserver/);
  assert.match(mirror, /textarea\.addEventListener\("scroll"/);
  assert.match(composerCss, /\.composer__prompt-mirror\s*\{[\s\S]*?z-index:\s*0/);
  assert.match(paneCss, /\.composer__textarea\s*\{[\s\S]*?z-index:\s*1/);
  assert.match(composerCss, /\.dead-tag\s*\{[\s\S]*?background:[\s\S]*?text-decoration-line:\s*line-through/);
  assert.match(mirror, /document\.createRange\(\)/);
  assert.match(mirror, /range\.getClientRects\(\)/);
  assert.match(mirror, /<span ref=\{textRef\}>\{prompt\}<\/span>/);
});

test("desktop layout uses 7:3 flex ratios without changing the bottom variant", () => {
  assert.match(sidebarCss, /@media \(min-width:\s*801px\)/);
  assert.match(sidebarCss, /\.composer--sidebar\s*\{[\s\S]*?flex:\s*7 1 0/);
  assert.match(sidebarCss, /::after\s*\{[\s\S]*?flex:\s*3 1 0/);
  assert.doesNotMatch(sidebarCss, /\.in-flight-list/);
  assert.match(composerCss, /@media \(min-width:\s*801px\)[\s\S]*?\.composer--sidebar/);
  assert.match(paneCss, /\.composer--sidebar \.composer__prompt-stack\s*\{[\s\S]*?display:\s*flex/);
  assert.doesNotMatch(composerCss, /\.composer--bottom[\s\S]*?clamp\(200px, 42vh, 520px\)/);
});

test("attachments preserve their caret owner and mentions insert tray tags in every lane", () => {
  assert.match(composer, /attachmentCaretRef/);
  assert.match(composer, /const insertionPoint = Math\.max\(0, Math\.min\(caret, currentPrompt\.length\)\)/);
  assert.match(composer, /added\.map\(\(item\) => `@\$\{item\.tag\} `\)/);
  assert.match(composer, /addElementId\?\.\(element\.id\)/);
  // 050: the inline replacement moved into the shared insertTagAtMention
  // helper, reused by both element and tray-attachment mention selection.
  assert.match(composer, /const replacement = `@\$\{tag\} `/);
  assert.match(composer, /insertTagAtMention\(trayElement\.tag, mentionQuery\)/);
  assert.doesNotMatch(composer, /mcpProvider/);
});

test("tray and dead-tag copy is localized", () => {
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.prompt.trayAria, "string");
    assert.equal(typeof locale.prompt.deadTagHint, "string");
  }
});
