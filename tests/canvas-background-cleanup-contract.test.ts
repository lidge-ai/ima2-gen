import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const backgroundRemoval = readFileSync(join(root, "ui/src/lib/canvas/backgroundRemoval.ts"), "utf8");
const canvas = [
  "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
  "ui/src/components/canvas-mode/CanvasModeStage.tsx",
  "ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts",
  "ui/src/components/canvas-mode/useCanvasModePointerHandlers.ts",
  "ui/src/components/canvas-mode/useCanvasModeShortcuts.ts",
].map((path) => readFileSync(join(root, path), "utf8")).join("\n");
const toolbar = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasToolbar.tsx"), "utf8");
const panel = readFileSync(
  join(root, "ui/src/components/canvas-mode/CanvasBackgroundCleanupPanel.tsx"),
  "utf8",
);
const main = readFileSync(join(root, "ui/src/main.tsx"), "utf8");
const css = readFileSync(join(root, "ui/src/styles/canvas-background-cleanup.css"), "utf8");
const en = JSON.parse(readFileSync(join(root, "ui/src/i18n/en.json"), "utf8"));
const ko = JSON.parse(readFileSync(join(root, "ui/src/i18n/ko.json"), "utf8"));

function extractBackgroundPickBranch() {
  const match = canvas.match(/if \(isBackgroundCleanupActive\) \{[\s\S]*?return;\r?\n    \}/);
  assert.ok(match, "Canvas should keep an explicit background-pick pointer branch");
  return match[0];
}

test("background cleanup uses contiguous flood fill from seed pixels", () => {
  assert.match(backgroundRemoval, /removeContiguousBackground/);
  assert.match(backgroundRemoval, /getCornerBackgroundRemovalSeeds/);
  assert.match(backgroundRemoval, /sampleSeedColors/);
  assert.match(backgroundRemoval, /pushIfCandidate/);
  assert.match(backgroundRemoval, /Int32Array\(totalPixels\)/);
  assert.match(backgroundRemoval, /Uint8Array\(totalPixels\)/);
  assert.match(backgroundRemoval, /index - 1/);
  assert.match(backgroundRemoval, /index \+ 1/);
  assert.match(backgroundRemoval, /index - width/);
  assert.match(backgroundRemoval, /index \+ width/);
});

test("background cleanup preserves foreground pixels and emits transparent PNG preview", () => {
  assert.match(backgroundRemoval, /applyRemoveMaskToImageData/);
  assert.match(backgroundRemoval, /imageData:\s*\{ width: input\.width, height: input\.height, data: output\.data \}/);
  assert.match(backgroundRemoval, /canvas\.toBlob/);
  assert.match(backgroundRemoval, /"image\/png"/);
  assert.match(backgroundRemoval, /blobToDataUrl/);
  assert.match(backgroundRemoval, /renderBackgroundRemovalMaskOverlay/);
  assert.match(backgroundRemoval, /BACKGROUND_REMOVAL_OVERLAY_MAX_DIMENSION = 1024/);
  assert.match(backgroundRemoval, /maxDimension = BACKGROUND_REMOVAL_OVERLAY_MAX_DIMENSION/);
  assert.match(backgroundRemoval, /overlay\.data\[offset\] = 168/);
  assert.match(backgroundRemoval, /overlay\.data\[offset \+ 3\] = 150/);
});

test("Canvas wires cleanup preview, seed picking, and apply-as-new-version", () => {
  assert.match(canvas, /backgroundCleanupSeeds/);
  assert.match(canvas, /backgroundCleanupTolerance/);
  assert.match(canvas, /backgroundCleanupPreview/);
  assert.match(canvas, /backgroundCleanupMaskOverlay/);
  assert.match(canvas, /historyRef/);
  assert.match(canvas, /renderSeqRef/);
  assert.match(canvas, /toleranceTimerRef/);
  assert.match(canvas, /pushUndo/);
  assert.match(canvas, /undoBackgroundCleanup/);
  assert.match(canvas, /isBackgroundCleanupPickingSeed/);
  assert.match(canvas, /renderBackgroundCleanupPreviewFromMask/);
  assert.match(canvas, /renderBackgroundCleanupOverlayFromMask/);
  assert.match(canvas, /imageSrc = backgroundCleanup\.backgroundCleanupPreview\?\.dataUrl \?\? baseImageSrc/);
  assert.match(canvas, /canvas-background-cleanup-mask/);
  assert.match(canvas, /CanvasBackgroundCleanupLayer/);
  assert.match(canvas, /canvas-annotation-frame--cleanup-picking/);
  assert.match(canvas, /undoBackgroundCleanup\(\)/);
  assert.match(canvas, /handleBackgroundCleanupApply/);
  assert.match(canvas, /createCanvasVersion\(\{/);
  assert.match(canvas, /attachCanvasVersionReference\(savedItem\)/);
});

test("cleanup renders ignore stale async results and debounce tolerance overlays", () => {
  assert.match(canvas, /const renderSeq = renderSeqRef\.current \+ 1/);
  assert.match(canvas, /renderSeqRef\.current !== renderSeq/);
  assert.match(canvas, /window\.clearTimeout\(toleranceTimerRef\.current\)/);
  assert.match(canvas, /window\.setTimeout\(\(\) => \{/);
  assert.match(canvas, /rebuildMasks\(backgroundCleanupSeeds, backgroundCleanupBrushStrokes, value\)/);
});

test("cleanup apply recomputes from the natural image instead of reusing preview blobs", () => {
  const applyMatch = canvas.match(/const handleBackgroundCleanupApply = useCallback\(async \(\): Promise<void> => \{[\s\S]*?finally \{/);
  assert.ok(applyMatch, "Canvas should keep a dedicated background cleanup apply handler");
  const applyBody = applyMatch[0];

  assert.match(applyBody, /renderBackgroundCleanupPreviewFromMask\(\{/);
  assert.match(applyBody, /imageElement: imageElementRef\.current/);
  assert.match(applyBody, /getCornerBackgroundRemovalSeeds\(\)/);
  assert.doesNotMatch(applyBody, /backgroundCleanupPreview \?\?/);
});

test("cleanup mask overlay can downscale preview work without changing final apply", () => {
  assert.match(backgroundRemoval, /const naturalWidth = imageElement\.naturalWidth/);
  assert.match(backgroundRemoval, /const naturalHeight = imageElement\.naturalHeight/);
  assert.match(backgroundRemoval, /Math\.min\(1, maxDimension \/ Math\.max\(naturalWidth, naturalHeight\)\)/);
  assert.match(backgroundRemoval, /context\.drawImage\(imageElement, 0, 0, width, height\)/);
});

test("alpha detection caches per image element and source dimensions", () => {
  const alphaDetect = readFileSync(join(root, "ui/src/lib/canvas/alphaDetect.ts"), "utf8");

  assert.match(alphaDetect, /const alphaCache = new WeakMap<HTMLImageElement, AlphaCacheEntry>\(\)/);
  assert.match(alphaDetect, /cached\.src === image\.currentSrc/);
  assert.match(alphaDetect, /cached\.width === image\.naturalWidth/);
  assert.match(alphaDetect, /cached\.height === image\.naturalHeight/);
  assert.match(alphaDetect, /alphaCache\.set\(image/);
});

test("Background pick mode keeps its cursor active after a click", () => {
  const pickBranch = extractBackgroundPickBranch();
  assert.match(pickBranch, /addBackgroundCleanupClick\(point\)/);
  assert.match(canvas, /setBackgroundCleanupSeeds\(nextSeeds\)/);
  assert.match(canvas, /void rebuildMasks\(nextSeeds, backgroundCleanupBrushStrokes, backgroundCleanupTolerance\)/);
  assert.doesNotMatch(pickBranch, /setIsBackgroundCleanupPickingSeed\(false\)/);
});

test("Toolbar exposes a dedicated cleanup panel without provider coupling", () => {
  assert.match(toolbar, /CanvasBackgroundCleanupPanel/);
  assert.match(toolbar, /onCleanupAutoSample/);
  assert.match(toolbar, /onCleanupPickSeed/);
  assert.match(toolbar, /onCleanupPreview/);
  assert.match(toolbar, /onCleanupApply/);
  assert.match(panel, /type="range"/);
  assert.match(panel, /keepOpen/);
  assert.match(panel, /cleanupPickHint/);
  assert.match(panel, /cleanupMaskHint/);
  assert.match(panel, /cleanupTolerance/);
  assert.match(panel, /cleanupSeedCount/);
  assert.match(panel, /cleanupMark/);
  assert.match(panel, /cleanupInput/);
  assert.doesNotMatch(backgroundRemoval + toolbar + panel, /remove\.bg|SAM3|Roboflow|provider/i);
});

test("Cleanup styles and locale keys are present", () => {
  assert.match(main, /canvas-background-cleanup\.css/);
  assert.match(css, /\.canvas-toolbar__cleanup-panel/);
  assert.match(css, /\.canvas-background-cleanup-mask/);
  assert.doesNotMatch(css, /\.canvas-cleanup-overlay__seed/);
  assert.match(css, /cursor:\s*crosshair !important/);
  assert.doesNotMatch(css, /cursor:\s*cell !important/);
  assert.match(css, /\.canvas-annotation-frame--cleanup-picking/);
  assert.match(css, /\.canvas-toolbar__cleanup-slider/);
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.canvas.toolbar.cleanup, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupTolerance, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupAutoSample, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupMark, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupPreserve, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupBrush, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupPickSeed, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupPreview, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupApply, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupPickHint, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupMaskHint, "string");
    assert.equal(typeof locale.canvas.toolbar.cleanupFailed, "string");
  }
});
