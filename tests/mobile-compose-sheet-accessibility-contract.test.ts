import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const sheet = read("ui/src/components/MobileComposeSheet.tsx");
const appBar = read("ui/src/components/MobileAppBar.tsx");
const focusOwner = read("ui/src/lib/mobileComposeSheetFocus.ts");
const responsiveCss = read("ui/src/styles/responsive-layout.css");
const reactTypes = read("ui/node_modules/@types/react/index.d.ts");

test("closed mobile compose sheet uses React's boolean inert contract", () => {
  assert.match(reactTypes, /inert\?:\s*boolean\s*\|\s*undefined/);
  assert.match(sheet, /inert=\{!open\}/);
});

test("closed and open CSS exclude and restore sheet interaction", () => {
  assert.match(responsiveCss, /\.compose-sheet\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;[\s\S]*?transition:\s*transform 180ms ease, visibility 0s linear 180ms;/);
  assert.match(responsiveCss, /\.compose-sheet\.compose-sheet--open\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;[\s\S]*?transition-delay:\s*0s;/);
  assert.match(responsiveCss, /\.compose-sheet__panel\[hidden\]\s*\{\s*display:\s*none;/);
});

test("backdrop is a reset native close button", () => {
  assert.match(sheet, /<button\s+[\s\S]*?type="button"[\s\S]*?className="compose-sheet-backdrop"[\s\S]*?aria-label=\{t\("sheet\.close"\)\}[\s\S]*?onClick=\{close\}[\s\S]*?\/>/);
  assert.doesNotMatch(sheet, /<div[\s\S]*?className="compose-sheet-backdrop"[\s\S]*?role="button"/);
  assert.match(responsiveCss, /\.compose-sheet-backdrop\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?cursor:\s*pointer;/);
});

test("tabs and persistent panel shells have stable bidirectional aria linkage", () => {
  assert.match(sheet, /const SHEET_TABS: ComposeSheetTab\[\] = \["prompt", "controls", "library"\]/);
  assert.match(sheet, /id=\{tabId\(tab\)\}/);
  assert.match(sheet, /aria-controls=\{panelId\(tab\)\}/);
  assert.match(sheet, /tabIndex=\{activeTab === tab \? 0 : -1\}/);
  for (const tab of ["prompt", "controls", "library"]) {
    assert.match(sheet, new RegExp(`id=\\{panelId\\("${tab}"\\)\\}[\\s\\S]*?aria-labelledby=\\{tabId\\("${tab}"\\)\\}[\\s\\S]*?hidden=\\{activeTab !== "${tab}"\\}`));
  }
});

test("tab keyboard navigation wraps and moves focus for arrows, Home, and End", () => {
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.match(sheet, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(sheet, /\(index \+ 1\) % SHEET_TABS\.length/);
  assert.match(sheet, /\(index - 1 \+ SHEET_TABS\.length\) % SHEET_TABS\.length/);
  assert.match(sheet, /event\.preventDefault\(\);\s*focusTab\(target\);/);
  assert.match(sheet, /requestAnimationFrame\(\(\) => tabRefs\.current\[tab\]\?\.focus\(\)\)/);
});

test("all three app bar openers register with the ephemeral focus owner", () => {
  for (const ref of ["libraryOpenerRef", "controlsOpenerRef", "composeFabRef"]) {
    assert.match(appBar, new RegExp(`ref=\\{${ref}\\}`));
  }
  assert.match(appBar, /if \(ref\.current\) rememberMobileComposeSheetOpener\(ref\.current\)/);
  assert.match(appBar, /openFrom\("library", libraryOpenerRef\)/);
  assert.match(appBar, /openFrom\("controls", controlsOpenerRef\)/);
  assert.match(appBar, /openFrom\("prompt", composeFabRef\)/);
});

test("close edge restores a connected opener once and clears ownership", () => {
  assert.match(sheet, /if \(open\) \{\s*wasOpenRef\.current = true;\s*const frame = requestAnimationFrame\(\(\) => tabRefs\.current\[activeTab\]\?\.focus\(\)\)/);
  assert.match(sheet, /if \(wasOpenRef\.current\) \{\s*wasOpenRef\.current = false;\s*restoreMobileComposeSheetOpener\(\);\s*\}/);
  assert.equal(sheet.match(/restoreMobileComposeSheetOpener\(\)/g)?.length, 1);
  assert.match(focusOwner, /const opener = composeSheetOpener;\s*composeSheetOpener = null;\s*if \(opener\?\.isConnected\) opener\.focus\(\);/);
});

test("Escape, inflight focus restoration, and touch targets remain intact", () => {
  assert.match(sheet, /useModalFocus/);
  assert.match(sheet, /previousInFlightCountRef\.current > 0 && inFlightCount === 0/);
  assert.match(sheet, /inflightHadFocusRef\.current[\s\S]*?querySelector<HTMLButtonElement>\("\.generate-btn"\)\?\.focus\(\)/);
  assert.match(responsiveCss, /\.mobile-sheet-tabs__button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(responsiveCss, /\.compose-sheet__inflight-header\s*\{[\s\S]*?min-height:\s*44px/);
});

test("leaving the rendered mobile classic surface closes and clears without restoring focus", () => {
  assert.match(sheet, /const rendered = isMobile && !settingsOpen && uiMode === "classic"/);
  assert.match(sheet, /if \(!rendered\) \{\s*wasOpenRef\.current = false;\s*if \(useAppStore\.getState\(\)\.composeSheetOpen\) close\(\);\s*clearMobileComposeSheetOpener\(\);\s*\}/);
  assert.match(sheet, /\}, \[rendered\]\);/);
  assert.match(sheet, /useEffect\(\(\) => \(\) => clearMobileComposeSheetOpener\(\), \[\]\)/);
  assert.match(sheet, /if \(!rendered\) return null/);
});

test("reduced motion disables compose sheet transitions", () => {
  assert.match(responsiveCss, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.compose-sheet\s*\{\s*transition:\s*none;/);
});
