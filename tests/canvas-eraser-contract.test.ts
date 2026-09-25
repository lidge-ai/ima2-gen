import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();

function readSource(path) {
  const content = readFileSync(join(root, path), "utf8");
  const dir = dirname(path);
  let combined = content;
  const re = /(?:export|import)\s+[\s\S]*?from\s*["']\.\/([\w.\/-]+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    for (const ext of ["", ".ts", ".tsx", ".js"]) {
      try { combined += "\n" + readFileSync(join(root, dir, m[1] + ext), "utf8"); break; } catch {}
    }
  }
  const cssRe = /@import\s+["']\.\/([\w.\/-]+)["']/g;
  while ((m = cssRe.exec(content)) !== null) {
    try { combined += "\n" + readFileSync(join(root, dir, m[1]), "utf8"); } catch {}
  }
  return combined;
}

describe("canvas eraser contract", () => {
  it("exposes one eraser tool with object and brush modes", () => {
    const types = readSource("ui/src/types/canvas.ts");
    const toolbar = readSource("ui/src/components/canvas-mode/CanvasToolbar.tsx");
    assert.match(types, /"eraser"/);
    assert.doesNotMatch(types, /"object-eraser"/);
    assert.match(types, /CanvasEraserMode = "object" \| "brush"/);
    assert.match(toolbar, /canvas-toolbar__split-button/);
    assert.match(toolbar, /canvas\.toolbar\.eraserMenu/);
    assert.match(toolbar, /canvas\.toolbar\.objectEraser/);
    assert.match(toolbar, /canvas\.toolbar\.brushEraser/);
  });

  it("adds pure eraser helpers for splitting path strokes", () => {
    const source = readSource("ui/src/lib/canvas/eraser.ts");
    assert.match(source, /erasePathsByStroke/);
    assert.match(source, /splitPathByEraser/);
    assert.match(source, /MIN_FRAGMENT_POINTS/);
    assert.match(source, /changed/);
    assert.match(source, /getSegmentEraserCut/);
    assert.match(source, /projectPointToSegmentT/);
    assert.match(source, /pointAtSegment/);
    assert.match(source, /leftT/);
    assert.match(source, /rightT/);
    assert.match(source, /tool: path\.tool === "arrow" && index !== arrowIndex \? "pen" : path\.tool/);
  });

  it("makes object and brush eraser gestures undoable without no-op history", () => {
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(hook, /ERASE_OBJECT/);
    assert.match(hook, /START_ERASER_STROKE/);
    assert.match(hook, /UPDATE_ERASER_STROKE/);
    assert.match(hook, /END_ERASER_STROKE/);
    assert.match(hook, /eraserBaseline/);
    assert.match(hook, /if \(!exists\) return state/);
    assert.match(hook, /if \(!result\.changed\)/);
    assert.match(hook, /pushSnapshot\(state, state\.eraserBaseline\)/);
  });

  it("routes shortcut 6 to eraser and keeps shortcut 7 unused", () => {
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/useCanvasModeShortcuts.ts",
      "ui/src/components/canvas-mode/useCanvasModePointerHandlers.ts",
      "ui/src/components/canvas-mode/canvasModeHelpers.ts",
    ].map(readSource).join("\n");
    assert.match(canvas, /\["1", "2", "3", "4", "5", "6"\]/);
    assert.match(canvas, /\["select", "pen", "box", "arrow", "memo", "eraser"\]/);
    assert.doesNotMatch(canvas, /"7"/);
    assert.match(canvas, /annotations\.eraserMode === "object"/);
    assert.match(canvas, /annotations\.eraserMode === "brush"/);
    assert.match(canvas, /OBJECT_ERASER_CURSOR/);
    assert.match(canvas, /BRUSH_ERASER_CURSOR/);
    assert.match(canvas, /annotations\.eraserMode === "object"[\s\S]*OBJECT_ERASER_CURSOR[\s\S]*BRUSH_ERASER_CURSOR/);
    assert.doesNotMatch(canvas, /\? "cell"/);
  });
});
