import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

function countTopLevelKey(source, key) {
  const pattern = new RegExp(`^  "${key}":`, "gm");
  return [...source.matchAll(pattern)].length;
}

describe("prompt library UI contract", () => {
  it("keeps gallery i18n keys merged into one section", () => {
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");
    const enJson = JSON.parse(en);
    const koJson = JSON.parse(ko);

    assert.equal(countTopLevelKey(en, "gallery"), 1);
    assert.equal(countTopLevelKey(ko, "gallery"), 1);
    assert.equal(enJson.gallery.sortByDate, "Date");
    assert.equal(enJson.gallery.sortBySession, "Session");
    assert.equal(enJson.gallery.favoriteTitle, "Add to favorites");
    assert.equal(koJson.gallery.sortByDate, "날짜");
    assert.equal(koJson.gallery.sortBySession, "세션");
    assert.equal(koJson.gallery.favoriteTitle, "즐겨찾기 추가");
  });

  it("supports dialog-first prompt import with translated UI", () => {
    const panel = readSource("ui/src/components/PromptLibraryPanel.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(panel, /className="prompt-library-panel__import"/);
    assert.match(panel, /PromptImportDialog/);
    assert.match(panel, /setImportOpen\(true\)/);
    assert.doesNotMatch(panel, /fileInputRef\.current\?\.click\(\)/);
    assert.match(panel, /variant = "overlay"/);
    assert.match(panel, /prompt-library-panel--\$\{variant\}/);
    assert.match(panel, /variant === "overlay"/);
    assert.doesNotMatch(panel, /Drop \.txt or \.md files to import prompts/);

    assert.match(store, /txt\|md\|markdown/);
    assert.match(store, /t\("promptLibrary\.imported"/);
    assert.match(store, /t\("promptLibrary\.importFailed"\)/);
    assert.match(store, /t\("promptLibrary\.importNoValidFiles"\)/);
    assert.doesNotMatch(store, /Imported \$\{result\.promptsImported\}/);

    assert.match(css, /\.prompt-library-panel__import/);
    assert.match(css, /\.prompt-library-panel__file-input/);
    assert.match(css, /\.prompt-library-panel__actions/);

    for (const dict of [en, ko]) {
      assert.equal(typeof dict.promptLibrary.saved, "string");
      assert.equal(typeof dict.promptLibrary.saveFailed, "string");
      assert.equal(typeof dict.promptLibrary.import, "string");
      assert.equal(typeof dict.promptLibrary.importFiles, "string");
      assert.equal(typeof dict.promptLibrary.dropImport, "string");
      assert.equal(typeof dict.promptLibrary.importTitle, "string");
      assert.equal(typeof dict.promptLibrary.importGithubLabel, "string");
      assert.equal(typeof dict.promptLibrary.imported, "string");
      assert.equal(typeof dict.promptLibrary.importFailed, "string");
      assert.equal(typeof dict.promptLibrary.importNoValidFiles, "string");
    }
  });

  it("preserves gallery favorite state from history payloads", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const gallery = readSource("ui/src/components/GalleryModal.tsx");
    const tile = readSource("ui/src/components/GalleryImageTile.tsx");
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(store, /isFavorite:\s*it\.isFavorite \?\? false/);
    assert.match(gallery, /isFavorite:\s*h\.isFavorite \?\? false/);
    assert.match(tile, /item\.isFavorite/);
    assert.match(gallery, /const \[favoritesOnly, setFavoritesOnly\] = useState\(false\)/);
    assert.match(gallery, /favoritesOnly && !h\.isFavorite/);
    assert.match(gallery, /visibleSessionGroups/);
    assert.match(gallery, /visibleLoose/);
    assert.match(gallery, /className="gallery__favorite-filter"/);
    assert.match(gallery, /t\("gallery\.emptyFavorites"\)/);
    assert.match(css, /\.gallery__favorite-filter/);
    assert.equal(en.gallery.filterFavorites, "Favorites");
    assert.equal(typeof en.gallery.emptyFavorites, "string");
    assert.equal(ko.gallery.filterFavorites, "즐겨찾기");
    assert.equal(typeof ko.gallery.emptyFavorites, "string");
  });

  it("keeps prompt library primary button text readable across themes", () => {
    const css = readSource("ui/src/index.css");
    const saveButton = /\.save-prompt-popover__save\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const loadButton = /\.prompt-detail-modal__load\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(saveButton, /background:\s*var\(--accent\)/);
    assert.match(saveButton, /color:\s*var\(--accent-ink\)/);
    assert.match(loadButton, /background:\s*var\(--accent\)/);
    assert.match(loadButton, /color:\s*var\(--accent-ink\)/);
  });

  it("offers prompt insertion from both the list row and detail modal", () => {
    const panel = readSource("ui/src/components/PromptLibraryPanel.tsx");
    const row = readSource("ui/src/components/PromptLibraryRow.tsx");
    const modal = readSource("ui/src/components/PromptDetailModal.tsx");
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const actions = readSource("ui/src/components/ResultActions.tsx");
    const css = readSource("ui/src/index.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(store, /type InsertedPrompt/);
    assert.match(store, /insertedPrompts: InsertedPrompt\[\]/);
    assert.match(store, /function composePrompt\(mainPrompt: string, insertedPrompts: InsertedPrompt\[\]\): string/);
    assert.match(store, /const prompt = composePrompt\(s\.prompt, s\.insertedPrompts\)/);

    assert.match(panel, /insertPromptToComposer/);
    assert.match(panel, /const insertPrompt = useCallback/);
    assert.match(panel, /showToast\(t\("promptLibrary\.inserted"\)\)/);
    assert.match(panel, /onInsert=\{\(\) => insertPrompt\(prompt\)\}/);

    assert.match(row, /onInsert: \(\) => void/);
    assert.match(row, /className="prompt-library-row__insert"/);
    assert.match(row, /aria-label=\{t\("promptLibrary\.insert"\)\}/);
    assert.match(row, /onInsert\(\)/);

    assert.match(modal, /onInsert: \(\) => void/);
    assert.match(modal, /className="prompt-detail-modal__insert"/);
    assert.match(modal, /t\("promptLibrary\.insert"\)/);

    assert.match(composer, /insertedPrompts = useAppStore/);
    assert.match(composer, /className="composer__prompt-chip"/);
    assert.match(composer, /className="composer__prompt-chip-title"/);
    assert.match(composer, /removeInsertedPrompt\(item\.id\)/);
    assert.match(actions, /insertPromptToComposer/);
    assert.match(actions, /id:\s*CANVAS_MODE_PROMPT_ID/);
    assert.match(actions, /name:\s*CANVAS_MODE_PROMPT_NAME/);
    assert.match(actions, /text:\s*CANVAS_MODE_PROMPT_TEXT/);
    assert.match(sidebar, /rightPanelOpen/);
    assert.match(sidebar, /toggleRightPanel/);

    assert.match(css, /\.prompt-library-row__insert/);
    assert.match(css, /\.prompt-detail-modal__insert/);
    assert.match(css, /\.composer__prompt-chip-title[\s\S]*text-overflow:\s*ellipsis/);
    assert.match(css, /\.composer__prompt-chip-title[\s\S]*white-space:\s*nowrap/);

    assert.equal(en.promptLibrary.insert, "Insert");
    assert.equal(typeof en.promptLibrary.inserted, "string");
    assert.equal(typeof en.promptLibrary.removeInserted, "string");
    assert.equal(ko.promptLibrary.insert, "삽입");
    assert.equal(typeof ko.promptLibrary.inserted, "string");
    assert.equal(typeof ko.promptLibrary.removeInserted, "string");
  });

  it("uses an icon button instead of a checkbox for prompt favorites filtering", () => {
    const panel = readSource("ui/src/components/PromptLibraryPanel.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(panel, /className=\{`prompt-library-panel__filter-toggle\$\{favoritesOnly \? " active" : ""\}`\}/);
    assert.match(panel, /aria-pressed=\{favoritesOnly\}/);
    assert.match(panel, /onClick=\{\(\) => setFavoritesOnly\(\(v\) => !v\)\}/);
    assert.doesNotMatch(panel, /type="checkbox"/);
    assert.doesNotMatch(panel, /prompt-library-panel__filter"/);
    assert.match(css, /\.prompt-library-panel__filter-toggle/);
    assert.match(css, /\.prompt-library-panel__filter-toggle\.active/);
  });
});
