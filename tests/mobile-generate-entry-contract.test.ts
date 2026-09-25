import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSourceTree } from "./_readTree.mjs";

const appBar = readFileSync("ui/src/components/MobileAppBar.tsx", "utf8");
const sheet = readFileSync("ui/src/components/MobileComposeSheet.tsx", "utf8");
const store = readSourceTree("ui/src/store/useAppStore.ts");
const controls = readFileSync("ui/src/components/GenerationControlsPanel.tsx", "utf8");
const rightPanel = readFileSync("ui/src/components/RightPanel.tsx", "utf8");
const css = readSourceTree("ui/src/index.css");
const en = JSON.parse(readFileSync("ui/src/i18n/en.json", "utf8"));
const ko = JSON.parse(readFileSync("ui/src/i18n/ko.json", "utf8"));

test("mobile app bar exposes generation as the primary mobile entry", () => {
  assert.match(appBar, /mobile-app-bar__generate/, "mobile entry should use a generate CTA class");
  assert.match(appBar, /t\("appBar\.generate"\)/, "visible copy should say Generate, not Compose");
  assert.match(appBar, /t\("appBar\.generateAria"\)/, "CTA should describe opening the generate sheet");
  assert.match(appBar, /t\("appBar\.modeImage"\)/, "app bar should explain the active image mode");
  assert.match(appBar, /openComposeSheet\("controls"\)/, "settings icon should open controls inside the mobile sheet");
  assert.match(appBar, /openComposeSheet\("library"\)/, "library icon should open library inside the mobile sheet");
  assert.doesNotMatch(appBar, /appBar\.compose/, "mobile app bar should not expose Compose copy");
  assert.equal(en.appBar.generate, "Generate");
  assert.equal(en.appBar.controls, "Generation controls");
  assert.equal(ko.appBar.generate, "생성");
  assert.equal(ko.appBar.controls, "생성 옵션");
});

test("mobile compose sheet is presented as the generate sheet with mobile-safe layout", () => {
  assert.match(sheet, /aria-label=\{t\("sheet\.generate"\)\}/, "sheet label should match the generate entry");
  assert.match(sheet, /SHEET_TABS: ComposeSheetTab\[\] = \["prompt", "controls", "library"\]/);
  assert.match(sheet, /GenerationControlsPanel/, "controls should be available inside the mobile sheet");
  assert.match(sheet, /LazyPromptLibraryPanel/, "prompt library should be available inside the mobile sheet");
  assert.match(store, /export type ComposeSheetTab = "prompt" \| "controls" \| "library"/);
  assert.match(store, /openComposeSheet: \(tab\?: ComposeSheetTab\) => void/);
  assert.match(store, /composeSheetTab: "prompt"/);
  assert.match(controls, /export function GenerationControlsPanel/);
  assert.match(rightPanel, /<GenerationControlsPanel \/>/, "desktop right panel should reuse the same controls component");
  assert.equal(en.sheet.generate, "Generate image");
  assert.equal(en.sheet.tabs.controls, "Controls");
  assert.equal(ko.sheet.generate, "이미지 생성");
  assert.equal(ko.sheet.tabs.controls, "옵션");
  assert.match(css, /\.mobile-app-bar,\s*\n\.compose-sheet,\s*\n\.compose-sheet-backdrop\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*\.mobile-app-bar\s*\{[\s\S]*display:\s*flex/);
  assert.match(css, /\.mobile-app-bar__generate\s*\{[\s\S]*font-weight:\s*760/);
  assert.match(css, /\.mobile-app-bar__icon-button,\s*\n\s*\.mobile-app-bar__generate\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.mobile-sheet-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*\.right-panel\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.compose-sheet\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /\.compose-sheet\s*\{[\s\S]*env\(safe-area-inset-bottom\)/);
});
