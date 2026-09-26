import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const root = process.cwd();

function readSource(path) {
  return readSourceTree(path);
}

describe("gallery navigation UX contract", () => {
  it("navigates focused generated images with arrow keys only on the viewer itself", () => {
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const domEvents = readSource("ui/src/lib/domEvents.ts");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");
    const css = readSource("ui/src/index.css");

    assert.match(canvas, /isEditableTarget/);
    assert.match(canvas, /selectHistoryShortcutTarget/);
    assert.doesNotMatch(canvas, /selectImage/);
    assert.match(canvas, /event\.key !== "ArrowLeft"/);
    assert.match(canvas, /event\.key !== "Home"/);
    assert.match(canvas, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
    assert.match(canvas, /event\.shiftKey/);
    assert.match(canvas, /permanentlyDeleteHistoryItemByShortcut\(currentImage\)/);
    assert.match(canvas, /trashHistoryItem\(currentImage\)/);
    assert.match(canvas, /event\.target !== event\.currentTarget/);
    assert.match(canvas, /tabIndex=\{0\}/);
    assert.match(canvas, /onKeyDown=\{handleViewerKeyDown\}/);
    assert.match(canvas, /className="result-container visible"/);
    assert.match(canvas, /aria-label=\{t\("canvas\.imageViewerAria"\)\}/);
    assert.match(domEvents, /HTMLInputElement/);
    assert.match(domEvents, /HTMLTextAreaElement/);
    assert.match(domEvents, /HTMLSelectElement/);
    assert.match(domEvents, /HTMLButtonElement/);
    assert.match(domEvents, /isContentEditable/);
    assert.match(css, /\.result-container:focus-visible/);
    assert.match(ko, /imageViewerAria/);
    assert.match(en, /imageViewerAria/);
  });

  it("restores Gallery position by selected item with scrollTop fallback", () => {
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const imageTile = readSource("ui/src/components/GalleryImageTile.tsx");
    const navigation = readSource("ui/src/lib/galleryNavigation.ts");
    const rawGallery = readFileSync(join(root, "ui/src/components/GalleryModal.tsx"), "utf8");
    const lineCount = rawGallery.split("\n").length;

    assert.ok(lineCount < 620, `GalleryModal.tsx should stay under 620 lines, got ${lineCount}`);
    assert.match(gallery, /useLayoutEffect/);
    assert.match(gallery, /useRef/);
    assert.match(gallery, /scrollRef/);
    assert.match(gallery, /itemRefs/);
    assert.match(gallery, /Record<string, HTMLElement \| null>/);
    assert.match(gallery, /lastScrollTopRef/);
    assert.match(gallery, /getGalleryItemKey/);
    assert.match(gallery, /scrollIntoView\(\{ block: "center" \}\)/);
    assert.match(gallery, /lastScrollTopRef\.current/);
    assert.match(gallery, /totalVisible/);
    assert.match(gallery, /visibleSessionGroups\.length/);
    assert.match(gallery, /visibleLoose\.length/);
    assert.match(gallery, /dateGroups\.length/);
    assert.match(gallery, /GalleryImageTile/);
    assert.match(imageTile, /itemRef: \(node: HTMLElement \| null\) => void/);
    assert.match(imageTile, /onSelect: \(item: GenerateItem\) => void/);
    assert.match(imageTile, /draggable/);
    assert.match(imageTile, /application\/ima2-ref/);
    assert.match(navigation, /export function getGalleryItemKey/);
  });

  it("drops dragged video items as last-frame references instead of raw video references", () => {
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    assert.match(composer, /application\/ima2-ref/);
    assert.match(composer, /continueFromItem/);

    const shared = readSource("ui/src/lib/continueFromItem.ts");
    assert.match(shared, /isVideoItem/);
    assert.match(shared, /extractLastFrame/);
    assert.match(shared, /addReferenceDataUrl/);
    assert.match(shared, /useImageAsReference/);
  });

  it("keeps canvas versions internal instead of showing them in gallery surfaces", () => {
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const historyStrip = readSource("ui/src/components/HistoryStrip.tsx");
    const navigation = readSource("ui/src/lib/galleryNavigation.ts");

    assert.match(navigation, /export function isGalleryVisibleItem/);
    assert.match(navigation, /return !item\.canvasVersion/);
    assert.match(navigation, /export function uniqueGalleryItems/);
    assert.match(gallery, /uniqueGalleryItems\(history\.filter\(isGalleryVisibleItem\)\)/);
    assert.match(gallery, /galleryHistory\.filter/);
    assert.match(gallery, /uniqueGalleryItems\(s\.items\.filter\(isGalleryVisibleItem\)\.map\(toItem\)\)/);
    assert.match(gallery, /uniqueGalleryItems\(page\.loose\.filter\(isGalleryVisibleItem\)\.map\(toItem\)\)/);
    assert.match(gallery, /galleryHistory\.length === 0/);
    assert.match(historyStrip, /getGalleryItemKey/);
    assert.match(historyStrip, /isGalleryVisibleItem/);
    assert.match(historyStrip, /uniqueGalleryItems/);
    assert.match(historyStrip, /uniqueGalleryItems\(history\.filter\(isGalleryVisibleItem\)\)/);
    assert.doesNotMatch(historyStrip, /function getHistoryItemKey/);
    assert.match(historyStrip, /const visibleHistory = useMemo\(/);
    assert.match(historyStrip, /visibleHistory\.map/);
  });

  it("maps vertical wheel input to horizontal thumbnail scrolling safely", () => {
    const wheel = readSource("ui/src/lib/horizontalWheel.ts");
    const historyStrip = readSource("ui/src/components/HistoryStrip.tsx");
    const cardDeck = readSource("ui/src/components/card-news/CardDeckRail.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(wheel, /scrollWidth <= el\.clientWidth/);
    assert.match(wheel, /Math\.abs\(event\.deltaY\) > Math\.abs\(event\.deltaX\)/);
    assert.match(wheel, /atStart/);
    assert.match(wheel, /atEnd/);
    assert.match(wheel, /preventDefault\(\)/);
    assert.match(wheel, /scrollLeft \+= event\.deltaY/);
    assert.match(historyStrip, /onWheel=\{handleHorizontalWheel\}/);
    assert.match(cardDeck, /onWheel=\{handleHorizontalWheel\}/);
    assert.match(css, /\.history-strip[\s\S]*overscroll-behavior-inline: contain/);
    assert.match(css, /\.card-news-deck[\s\S]*overscroll-behavior-inline: contain/);
  });

  it("renders the compact gallery strip with rail and horizontal layout options", () => {
    const app = readSource("ui/src/App.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const historyStrip = readSource("ui/src/components/HistoryStrip.tsx");
    const settings = readSource("ui/src/components/SettingsWorkspace.tsx");
    const toggle = readSource("ui/src/components/HistoryStripLayoutToggle.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const registry = readSource("ui/src/store/persistenceRegistry.ts");
    const types = readSource("ui/src/types.ts");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");
    const css = readSource("ui/src/index.css");
    const appRule = /\.app\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const horizontalAppRule = /\.app--history-horizontal\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const sidebarAppRule = /\.app--history-sidebar\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const rightPanelRule =
      [...css.matchAll(/^\.right-panel\s*\{[^}]*\}/gm)].find((match) =>
        match[0].includes("height: 100dvh"),
      )?.[0] ?? "";
    const historyRule =
      [...css.matchAll(/\.history-strip\s*\{[^}]*\}/gs)].find((match) =>
        match[0].includes("flex-direction: column"),
      )?.[0] ?? "";
    const horizontalRule = /\.history-strip--horizontal\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const sidebarRule = /\.history-strip--sidebar\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const addRule = /\.history-thumb--add\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const responsiveBlock = css;

    assert.match(app, /import \{ HistoryStrip \} from "\.\/components\/HistoryStrip"/);
    assert.match(app, /historyStripLayout/);
    assert.match(app, /app--history-horizontal/);
    assert.match(app, /app--history-sidebar/);
    assert.match(app, /data-history-strip-layout=\{historyStripLayout\}/);
    assert.match(app, /import \{ MobileAppBar \} from "\.\/components\/MobileAppBar"/);
    assert.match(app, /const showHistoryStrip = !promptStudioClassic/);
    assert.match(app, /<NavRail \/>\s*\{isHomeMode \? null : <Sidebar \/>\}\s*<MobileAppBar \/>/);
    assert.doesNotMatch(sidebar, /HistoryStrip/);

    assert.match(appRule, /--gallery-rail-w:\s*clamp\(61px,\s*6vw,\s*95px\)/);
    assert.match(appRule, /grid-template-columns:\s*var\(--nav-rail-w\) 260px var\(--gallery-rail-w\) minmax\(0,\s*1fr\) auto/);
    assert.match(horizontalAppRule, /grid-template-columns:\s*var\(--nav-rail-w\) 260px minmax\(0,\s*1fr\) auto/);
    assert.match(horizontalAppRule, /grid-template-rows:\s*var\(--history-strip-h\) minmax\(0,\s*1fr\)/);
    assert.match(sidebarAppRule, /grid-template-columns:\s*var\(--nav-rail-w\) 260px minmax\(0,\s*1fr\) auto/);
    assert.match(sidebarAppRule, /grid-template-rows:\s*minmax\(0,\s*1fr\) var\(--history-strip-h\)/);
    assert.match(rightPanelRule, /width:\s*266px/);
    assert.match(historyRule, /flex-direction:\s*column/);
    assert.match(historyRule, /overflow-y:\s*auto/);
    assert.match(historyRule, /overflow-x:\s*hidden/);
    assert.match(horizontalRule, /flex-direction:\s*row/);
    assert.match(horizontalRule, /overflow-x:\s*auto/);
    assert.match(horizontalRule, /border-bottom:\s*1px solid var\(--border\)/);
    assert.match(sidebarRule, /flex-direction:\s*row/);
    assert.match(sidebarRule, /border-top:\s*1px solid var\(--border\)/);
    assert.match(sidebarRule, /border-right:\s*1px solid var\(--border\)/);
    assert.match(addRule, /top:\s*0/);

    assert.match(responsiveBlock, /grid-template-rows:\s*auto auto 1fr/);
    assert.match(responsiveBlock, /\.app--history-horizontal \.history-strip/);
    assert.match(responsiveBlock, /\.app--history-sidebar \.history-strip/);
    assert.match(responsiveBlock, /\.history-strip\s*\{[\s\S]*flex-direction:\s*row/);
    assert.match(responsiveBlock, /\.history-strip\s*\{[\s\S]*overflow-x:\s*auto/);
    assert.match(responsiveBlock, /\.history-thumb--add\s*\{[\s\S]*left:\s*0/);

    assert.match(types, /export type HistoryStripLayout = "rail" \| "horizontal" \| "sidebar"/);
    assert.match(store, /historyStripLayout:\s*HistoryStripLayout/);
    assert.match(store, /loadHistoryStripLayout/);
    assert.match(store + registry, /ima2\.historyStripLayout/);
    assert.match(store, /setHistoryStripLayout/);
    assert.match(historyStrip, /useRef<Record<string,\s*HTMLElement \| null>>/);
    assert.match(historyStrip, /historyStripLayout/);
    assert.match(historyStrip, /history-strip--horizontal/);
    assert.match(historyStrip, /history-strip--sidebar/);
    assert.match(historyStrip, /data-layout=\{historyStripLayout\}/);
    assert.match(historyStrip, /getGalleryItemKey\(item\)/);
    assert.match(historyStrip, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
    assert.match(historyStrip, /ref=\{\(node\) => \{/);
    assert.match(settings, /HistoryStripLayoutToggle/);
    assert.match(toggle, /history-layout-toggle/);
    assert.match(toggle, /<Segmented<HistoryStripLayout>/);
    assert.match(toggle, /\["rail", "horizontal", "sidebar"\]/);
    assert.match(en, /historyStripLayoutTitle/);
    assert.match(ko, /historyStripLayoutTitle/);
  });

  it("does not introduce backend coupling for navigation UX", () => {
    const routes = readSource("routes/history.ts");
    const test = readSource("tests/gallery-navigation-ux-contract.test.ts");

    assert.doesNotMatch(routes, /galleryNavigation/);
    assert.match(test, /does not introduce backend coupling/);
  });
});
