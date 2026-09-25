import { test } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

test("gallery can load older pages without raising the default history cap", () => {
  const store = readSource("ui/src/store/useAppStore.ts");
  const gallery = readSource("ui/src/components/GalleryModal.tsx");
  const controls = readSource("ui/src/components/gallery/GalleryLoadControls.tsx");
  const api = readSource("ui/src/lib/api.ts");

  assert.match(api, /favoritesOnly\?: boolean/);
  assert.match(api, /qs\.set\("favoritesOnly", "1"\)/);
  assert.match(store, /historyNextCursor:\s*HistoryCursor \| null/);
  assert.match(store, /historyLoadingOlder:\s*boolean/);
  assert.match(store, /loadedHistoryRetainLimit:\s*number/);
  assert.match(store, /loadOlderHistory:\s*async/);
  assert.match(store, /\.\.\.s\.history,\s*\.\.\.appended/);
  assert.match(gallery, /const historyNextCursor = useAppStore/);
  assert.match(gallery, /<GalleryLoadControls/);
  assert.match(controls, /className="gallery__load-more"/);
  assert.match(gallery, /loadOlderHistory/);
});

test("favorites mode supports its own cursor and load older action", () => {
  const routes = readSource("routes/history.ts");
  const store = readSource("ui/src/store/useAppStore.ts");
  const gallery = readSource("ui/src/components/GalleryModal.tsx");
  const controls = readSource("ui/src/components/gallery/GalleryLoadControls.tsx");

  assert.match(routes, /const favoritesOnly =/);
  assert.match(routes, /favoritesOnly:\s*boolean/);
  assert.match(store, /loadFavoriteHistory:\s*async/);
  assert.match(store, /getHistory\(\{ limit: HISTORY_LIMIT, favoritesOnly: true \}\)/);
  assert.match(store, /favoriteHistoryNextCursor:\s*HistoryCursor \| null/);
  assert.match(store, /favoriteHistoryLoadingOlder:\s*boolean/);
  assert.match(store, /loadOlderFavoriteHistory:\s*async/);
  assert.match(store, /getHistory\(\{ limit: HISTORY_LIMIT, cursor, favoritesOnly: true \}\)/);
  assert.match(gallery, /void loadFavoriteHistory\(\)/);
  assert.match(gallery, /loadOlderFavoriteHistory/);
  assert.match(controls, /gallery\.loadOlderFavorites/);
  assert.match(controls, /favoriteHistoryNextCursor/);
});

test("gallery scale plan uses server index and virtualized date rows instead of a manual cap selector", () => {
  const historyIndex = readSource("lib/historyIndex.ts");
  const routes = readSource("routes/history.ts");
  const dateGrid = readSource("ui/src/components/gallery/GalleryDateGrid.tsx");
  const gallery = readSource("ui/src/components/GalleryModal.tsx");

  assert.match(historyIndex, /getHistoryIndex/);
  assert.match(historyIndex, /HISTORY_INDEX_TTL_MS/);
  assert.match(routes, /getHistoryIndex\(ctx\.config\.storage\.generatedDir\)/);
  assert.match(dateGrid, /@tanstack\/react-virtual/);
  assert.match(dateGrid, /useVirtualizer/);
  assert.match(gallery, /<GalleryDateGrid/);
  assert.doesNotMatch(gallery, /5000/);
});
