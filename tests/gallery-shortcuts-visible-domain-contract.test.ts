import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoreBundle } from "./_storeBundle.mjs";

const root = process.cwd();

function readSource(path) {
  if (path === "ui/src/store/useAppStore.ts") return readStoreBundle();
  return readFileSync(join(root, path), "utf8");
}

describe("gallery shortcut visible-domain contract", () => {
  it("keeps keyboard navigation in the same visible domain as Gallery and HistoryStrip", () => {
    const shortcuts = readSource("ui/src/lib/galleryShortcuts.ts");

    assert.match(shortcuts, /export function getVisibleGalleryItems/);
    assert.match(shortcuts, /return history\.filter\(\(item\) => !item\.canvasVersion\)/);
    assert.match(shortcuts, /export function resolveVisibleShortcutCurrent/);
    assert.match(shortcuts, /currentImage\.canvasVersion/);
    assert.match(shortcuts, /canvasSourceFilename/);
    assert.match(shortcuts, /canvasEditableFilename/);
    assert.match(shortcuts, /const visibleHistory = getVisibleGalleryItems\(history\)/);
    assert.match(shortcuts, /if \(action === "first"\) return visibleHistory\[0\] \?\? null/);
    assert.match(shortcuts, /if \(action === "last"\) return visibleHistory\[visibleHistory\.length - 1\] \?\? null/);
    assert.match(shortcuts, /action === "pagePrevious" \|\| action === "pageNext"/);
    assert.match(shortcuts, /GALLERY_PAGE_STEP/);
    assert.match(shortcuts, /Math\.max\(0, Math\.min\(visibleHistory\.length - 1, currentIndex \+ delta\)\)/);
    assert.match(shortcuts, /return visibleHistory\[nextIndex\] \?\? null/);
    assert.doesNotMatch(shortcuts, /return history\[nextIndex\] \?\? null/);
  });

  it("keeps removal replacement candidates out of hidden canvasVersion rows", () => {
    const shortcuts = readSource("ui/src/lib/galleryShortcuts.ts");

    assert.match(shortcuts, /export function getNeighborAfterRemoval/);
    assert.match(shortcuts, /const visibleHistory = getVisibleGalleryItems\(history\)/);
    assert.match(shortcuts, /visibleHistory\.findIndex\(\(item\) => item\.filename === filename\)/);
    assert.match(shortcuts, /return visibleHistory\[removeIndex \+ 1\] \?\? visibleHistory\[removeIndex - 1\] \?\? null/);
    assert.doesNotMatch(shortcuts, /history\.findIndex\(\(item\) => item\.filename === filename\)/);
  });

  it("normalizes stale hidden canvas selection before storing currentImage", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /resolveVisibleShortcutCurrent,/);
    assert.match(store, /getVisibleGalleryItems,/);
    assert.match(store, /selectHistory:\s*\(item\) =>/);
    assert.match(store, /item\.canvasVersion\s*\?/);
    assert.match(store, /saveSelectedFilename\(target\?\.filename \?\? null\)/);
    assert.match(store, /currentImage: target,[\s\S]*?unseenGeneratedCount: 0,[\s\S]*?multimodePreviewFlightId: isWithinGrid \? previewId : null/);
  });

  it("normalizes persisted hidden canvas selections during hydration and storage sync", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /syncFromStorage:\s*\(\) =>/);
    assert.match(store, /const normalized = matched\s*\?\s*resolveVisibleShortcutCurrent\(s\.history, matched\)/);
    assert.match(store, /s\.currentImage\?\.canvasVersion/);
    assert.match(store, /const visibleHistory = getVisibleGalleryItems\(history\)/);
    assert.match(store, /\(matched \? resolveVisibleShortcutCurrent\(history, matched\) : null\)/);
    assert.match(store, /saveSelectedFilename\(currentImage\?\.filename \?\? null\)/);
  });
});
