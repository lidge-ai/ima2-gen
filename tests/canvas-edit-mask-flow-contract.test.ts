import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas edit mask flow contract", () => {
  it("saves dirty canvas before masked edit and uses canvas context", () => {
    const canvas = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    assert.match(canvas, /handleEditWithMask/);
    assert.match(canvas, /saveCanvasVersionAndUseReference/);
    assert.match(canvas, /lastMergedDataUrlRef/);
    assert.match(canvas, /renderMaskFromBoxes/);
    assert.match(canvas, /blobToDataUrl/);
    assert.match(canvas, /postEdit/);
    assert.match(canvas, /addGeneratedHistoryItem/);
    assert.match(canvas, /responseToGenerateItem/);
    assert.match(canvas, /EDIT_MASK_NOT_SUPPORTED/);
    assert.match(canvas, /lastCleanDataUrlRef/);
    assert.match(canvas, /loadCleanSourceDataUrl/);
    assert.match(canvas, /buildMemoEditInstructions/);
    assert.doesNotMatch(canvas, /imageElementToPngDataUrl/);
  });

  it("wires toolbar mask edit affordance without changing default viewer policy", () => {
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeResultDetails.tsx",
      "ui/src/components/canvas-mode/CanvasModeFloatingToolbar.tsx",
    ].map(readSource).join("\n");
    const toolbar = readSource("ui/src/components/canvas-mode/CanvasToolbar.tsx");
    assert.match(canvas, /onEditWithMask=\{\(\) => void actions\.handleEditWithMask\(\)\}/);
    assert.match(canvas, /canEditWithMask=\{annotations\.boxes\.length > 0\}/);
    assert.match(canvas, /imageOverride=\{canvasOpen \? canvasDisplayImage : null\}/);
    assert.match(canvas, /onAfterDeleteFocus=\{onAfterDeleteFocus\}/);
    assert.match(toolbar, /onEditWithMask/);
    assert.match(toolbar, /canEditWithMask/);
    assert.match(toolbar, /editMaskDisabled/);
  });
});
