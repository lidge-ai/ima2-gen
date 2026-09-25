import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSourceTree } from "./_readTree.mjs";

const read = (path) => readFileSync(path, "utf8");

const sheet = read("ui/src/components/MobileComposeSheet.tsx");
const mobileAppBar = read("ui/src/components/MobileAppBar.tsx");
const mobileSettingsToggle = read("ui/src/components/MobileSettingsToggle.tsx");
const inflightBadge = read("ui/src/components/composer/InFlightBadge.tsx");
const homeComposer = read("ui/src/components/home/HomePromptComposer.tsx");
const homeHero = read("ui/src/components/home/HomeHero.tsx");
const homeWorkspace = read("ui/src/components/home/HomeWorkspace.tsx");
const homeRecent = read("ui/src/components/home/HomeRecentRow.tsx");
const responsiveCss = read("ui/src/styles/responsive-layout.css");
const paneCss = read("ui/src/styles/composer-panes.css");
const homeCss = read("ui/src/styles/home-workspace.css");
const navRailCss = read("ui/src/styles/nav-rail.css");
const composerCss = readSourceTree("ui/src/styles/progress-composer.css");
const en = JSON.parse(read("ui/src/i18n/en.json"));
const ko = JSON.parse(read("ui/src/i18n/ko.json"));

test("mobile prompt sheet uses the shared tray and an inline inflight disclosure", () => {
  assert.match(sheet, /<PromptComposer \/>/, "the mobile sheet should reuse the tray-owning composer");
  assert.match(sheet, /const MOBILE_INFLIGHT_PANEL_ID = "mobile-inflight-panel"/);
  assert.match(sheet, /useState\(false\)/);
  assert.match(sheet, /!open \|\| activeTab !== "prompt" \|\| !isMobile \|\| settingsOpen \|\| uiMode !== "classic"/);
  assert.match(sheet, /<InFlightBadge[\s\S]*?variant="inline"[\s\S]*?panelId=\{MOBILE_INFLIGHT_PANEL_ID\}[\s\S]*?expanded=\{inflightExpanded\}[\s\S]*?onToggle=\{setInflightExpanded\}/);
  assert.match(sheet, /aria-controls=\{MOBILE_INFLIGHT_PANEL_ID\}/);
  assert.match(sheet, /<InFlightList variant="inline" panelId=\{MOBILE_INFLIGHT_PANEL_ID\} \/>/);
  assert.doesNotMatch(sheet, /<InFlightList \/>/, "the legacy compact list must not remain in the sheet");
  assert.match(sheet, /previousInFlightCountRef\.current > 0 && inFlightCount === 0/);
  assert.match(sheet, /inflightHadFocusRef\.current[\s\S]*?querySelector<HTMLButtonElement>\("\.generate-btn"\)\?\.focus\(\)/);
  assert.match(sheet, /panel\?\.contains\(event\.target as Node\)/);
  assert.match(sheet, /querySelector<HTMLButtonElement>\("\.inflight-badge"\)\?\.focus\(\)[\s\S]*?setInflightExpanded\(false\)/);
  assert.match(inflightBadge, /activeElement\.closest\("\.inflight-popup"\)/);
});

test("home never mounts classic-only mobile chrome", () => {
  assert.match(mobileAppBar, /uiModeRaw === "home" \? "home"/);
  assert.match(mobileAppBar, /uiMode !== "classic"/);
  assert.match(sheet, /uiModeRaw === "home" \? "home"/);
  assert.match(sheet, /uiMode === "classic"/);
  assert.match(mobileSettingsToggle, /uiMode === "home"/);
  assert.match(mobileAppBar, /:\s*"classic";/, "Create must keep the classic fallback");
});

test("mobile layout grows the textarea and keeps tray, actions, and targets touch-safe", () => {
  assert.match(responsiveCss, /\.app\[data-mobile="1"\] > \.sidebar\s*\{[\s\S]*?display:\s*none/);
  assert.match(navRailCss, /\.nav-rail--mobile\s*\{[\s\S]*?z-index:\s*160/);
  assert.match(navRailCss, /\.nav-rail--mobile\s*\{[^}]*background:\s*var\(--bg\);/);
  assert.match(responsiveCss, /\.compose-sheet-backdrop\s*\{[\s\S]*?z-index:\s*170/);
  assert.match(responsiveCss, /\.compose-sheet\s*\{[\s\S]*?z-index:\s*180/);
  assert.match(responsiveCss, /\.compose-sheet__panel--prompt\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/);
  assert.match(paneCss, /\.compose-sheet__panel--prompt \.composer__prompt-stack\s*\{[\s\S]*?flex:\s*1 1 160px[\s\S]*?min-height:\s*160px/);
  assert.match(responsiveCss, /\.compose-sheet__actions\s*\{[\s\S]*?position:\s*sticky[\s\S]*?bottom:\s*0/);
  assert.match(responsiveCss, /\.compose-sheet__panel--prompt \.composer__tray-thumbnail\s*\{[\s\S]*?width:\s*64px[\s\S]*?height:\s*64px/);
  assert.match(responsiveCss, /\.compose-sheet__panel--prompt \.composer__tray-remove\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(responsiveCss, /\.compose-sheet__inflight-header\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(responsiveCss, /\.mobile-sheet-tabs__button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(responsiveCss, /\.compose-sheet__panel--prompt \.composer__tool,[\s\S]*?min-height:\s*44px/);
  const inflightRule = responsiveCss.match(/\.compose-sheet__inflight\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.doesNotMatch(inflightRule, /overflow-y/, "the sheet body must remain the only vertical scroll owner");
  assert.match(composerCss, /@media \(min-width:\s*801px\)[\s\S]*?\.composer--sidebar/, "the 70% desktop rule must stay desktop-only");
  const deadTagRule = composerCss.match(/\.composer__prompt-mirror \.dead-tag\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(deadTagRule, /var\(--text-muted\)/, "dead tags should be neutral and de-emphasized");
  assert.doesNotMatch(deadTagRule, /var\(--red\)/, "dead tags must not read as destructive errors");
});

test("home exposes a compact read-only reference strip", () => {
  assert.match(homeComposer, /useAppStore\(\(state\) => state\.trayItems\)/);
  assert.match(homeComposer, /home-prompt__reference-strip/);
  assert.match(homeComposer, /trayItems\.map/);
  assert.doesNotMatch(homeComposer, /removeTrayItem/, "home must not edit shared tray references");
  assert.match(homeCss, /\.home-prompt__reference-strip\s*\{/);
  assert.match(homeCss, /\.home-prompt__reference-thumb\s*\{[\s\S]*?width:\s*32px[\s\S]*?height:\s*32px/);
});

test("home keeps the recent region visible for empty and populated histories", () => {
  assert.match(homeWorkspace, /<HomeHero \/>/);
  assert.match(homeHero, /<section className="home-workspace__recent"/);
  assert.doesNotMatch(homeWorkspace, /hasHistory/);
  assert.match(homeRecent, /recent\.length === 0/);
  assert.match(homeRecent, /className="home-recent-empty" role="status">\{t\("history\.emptyRecent"\)\}/);
  assert.match(homeRecent, /className="home-recent-row" role="list"/);
  assert.match(homeCss, /\.home-recent-empty\s*\{[^}]*var\(--surface\)[^}]*var\(--text-muted\)/s);
});

test("home hero shares readiness and keeps mode navigation contract-safe", () => {
  assert.match(homeHero, /<HomePromptComposer providerAvailability=\{availability\} \/>/);
  assert.match(homeComposer, /providerAvailability: Record<Provider, ProviderAvailability>/);
  assert.doesNotMatch(homeComposer, /useProviderAvailability\(\)/);
  assert.match(homeHero, /mode: "classic"/);
  assert.doesNotMatch(homeHero, /mode: "create"/);
  assert.match(homeHero, /enabled: ENABLE_NODE_MODE/);
  assert.match(homeHero, /enabled: ENABLE_AGENT_MODE/);
  assert.match(homeHero, /MODE_TO_HASH\[mode\]/);
});

test("home recent media is bounded and fails closed for video and image previews", () => {
  assert.match(homeRecent, /history\.slice\(0, 5\)/);
  assert.match(homeRecent, /if \(isVideo\) return item\.thumb/);
  assert.match(homeRecent, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(homeRecent, /home-recent-card__fallback/);
  assert.match(homeCss, /\.home-recent-card\.is-featured\s*\{[^}]*grid-row:\s*span 2/);
  assert.doesNotMatch(homeCss, /grid-template-rows:\s*minmax\(220px/);
});

test("new tray visibility and mobile disclosure copy stays localized", () => {
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.home.referenceTrayCount, "string");
    assert.equal(typeof locale.home.referenceTrayAria, "string");
    assert.equal(typeof locale.home.recentResultAlt, "string");
    assert.equal(typeof locale.home.mediaUnavailable, "string");
    assert.equal(typeof locale.inflight.inlineCollapse, "string");
  }
});
