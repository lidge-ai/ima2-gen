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

describe("canvas apply merged contract", () => {
  it("wires apply and export actions from Canvas", () => {
    const source = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeStage.tsx",
      "ui/src/components/canvas-mode/useCanvasModeSession.ts",
    ].map(readSource).join("\n");
    assert.match(source, /handleApplyCanvas/);
    assert.match(source, /saveCanvasVersionAndUseReference/);
    assert.match(source, /renderMergedCanvasImage/);
    assert.match(source, /applyMergedCanvasImage/);
    assert.match(source, /attachCanvasVersionReference/);
    assert.match(source, /handleExportCanvas/);
    assert.match(source, /downloadCanvasBlob/);
    assert.match(source, /CanvasMemoOverlay/);
  });

  it("saves merged blobs through the canvas version API", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    assert.match(store, /applyMergedCanvasImage/);
    assert.doesNotMatch(store, /applyMergedCanvasImage: \(item\) => \{\s*saveSelectedFilename/);
    assert.doesNotMatch(store, /applyMergedCanvasImage[\s\S]{0,250}currentImage: item/);
    assert.match(store, /s\.history\.some\(\(h\) => h\.filename === item\.filename\)/);
    assert.match(store, /\[item, \.\.\.s\.history\]/);

    const canvas = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    assert.match(canvas, /createCanvasVersion/);
    assert.match(canvas, /updateCanvasVersion/);
    assert.match(canvas, /image: merged\.blob/);
    assert.match(canvas, /annotations\.resetLocal\(\)/);
    assert.doesNotMatch(canvas, /image: merged\.dataUrl/);
  });

  it("forces the canvas image element to show the saved version immediately", () => {
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/canvasModeHelpers.ts",
    ].map(readSource).join("\n");
    assert.match(canvas, /getCanvasDisplaySrc/);
    assert.match(canvas, /findCanvasVersionForSource/);
    assert.match(canvas, /canvasDisplayImage = canvasOpen \? \(canvasVersionItem \?\? latestCanvasVersion \?\? currentImage\) : currentImage/);
    assert.match(canvas, /image\.canvasVersion/);
    assert.match(canvas, /image\.canvasMergedAt/);
    assert.match(canvas, /src\.startsWith\("data:"\)/);
    assert.match(canvas, /canvasMergedAt=/);
  });

  it("keeps Continue Here on a compressed canvas reference path", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    const store = readSource("ui/src/store/useAppStore.ts");
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeResultDetails.tsx",
    ].map(readSource).join("\n");
    assert.match(actions, /imageOverride\?: GenerateItem \| null/);
    assert.match(actions, /const actionImage = imageOverride \?\? currentImage/);
    assert.match(actions, /continueFromItem\(actionImage\)/);
    assert.match(actions, /CANVAS_MODE_PROMPT_ID/);
    assert.match(actions, /canvas-mode-context/);
    assert.match(actions, /CANVAS_MODE_PROMPT_NAME/);
    assert.match(actions, /Canvas Mode/);
    assert.match(actions, /insertPromptToComposer/);
    assert.match(actions, /canvasOpen && imageOverride/);
    assert.match(actions, /blank white canvas or paper/);
    assert.match(actions, /user-drawn strokes/);
    assert.match(actions, /source content and preserve\/complete/);
    assert.match(actions, /edit instructions/);
    assert.match(canvas, /imageOverride=\{canvasOpen \? canvasDisplayImage : null\}/);
    assert.match(canvas, /onAfterDeleteFocus=\{onAfterDeleteFocus\}/);
    assert.match(store, /compressReferenceSource\(\s*resolveModelReferenceSrc\(cur\)/);
    assert.match(store, /useImageAsReference.*useImageAsReferenceImpl/);
    assert.match(store, /compressReferenceSource\(\s*resolveModelReferenceSrc\(item\)/);
    assert.match(store, /attachCanvasVersionReference/);
    assert.match(store, /item\.canvasVersion && item\.canvasSourceFilename/);
    assert.doesNotMatch(store, /referenceImages:\s*\[\s*item\.image/);
  });

  it("routes all output through memo-capable merge rendering", () => {
    const merge = readSource("ui/src/lib/canvas/mergeRenderer.ts");
    const renderer = readSource("ui/src/lib/canvas/annotationRenderer.ts");
    assert.match(merge, /renderCanvasMemo/);
    assert.match(merge, /for \(const memo of input\.memos\)/);
    assert.match(renderer, /export function renderCanvasMemo/);
  });
});
