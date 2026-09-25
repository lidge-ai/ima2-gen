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

describe("canvas undo redo contract", () => {
  it("exposes scoped undo and redo state from the annotation hook", () => {
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(hook, /past: AnnotationSnapshot\[]/);
    assert.match(hook, /future: AnnotationSnapshot\[]/);
    assert.match(hook, /HISTORY_LIMIT = 50/);
    assert.match(hook, /canUndo/);
    assert.match(hook, /canRedo/);
    assert.match(hook, /undo/);
    assert.match(hook, /redo/);
    assert.match(hook, /COMMIT_MEMO_EDIT/);
    assert.match(hook, /memoBaseline/);
    assert.match(hook, /pushSnapshot\(state, state\.memoBaseline\)/);
    assert.match(hook, /START_SELECTED_MOVE/);
    assert.match(hook, /moveBaseline/);
    assert.match(hook, /pushSnapshot\(state, state\.moveBaseline\)/);
    assert.match(hook, /COMMIT_SELECTED_MOVE/);
    assert.match(hook, /START_ERASER_STROKE/);
    assert.match(hook, /END_ERASER_STROKE/);
    assert.match(hook, /eraserBaseline/);
    assert.match(hook, /pushSnapshot\(state, state\.eraserBaseline\)/);
  });

  it("handles MacBook Escape and canvas undo through a window listener", () => {
    const canvas = [
      "ui/src/components/canvas-mode/useCanvasModeShortcuts.ts",
      "ui/src/components/canvas-mode/useCanvasModePointerHandlers.ts",
    ].map(readSource).join("\n");
    assert.match(canvas, /window\.addEventListener\("keydown", onKeyDown\)/);
    assert.match(canvas, /event\.key === "Escape"/);
    assert.match(canvas, /if \(event\.defaultPrevented\) return;/);
    assert.match(canvas, /event\.stopPropagation\(\)/);
    assert.match(canvas, /handleCloseCanvas/);
    assert.match(canvas, /event\.key\.toLowerCase\(\) === "z"/);
    assert.match(canvas, /annotations\.undo\(\)/);
    assert.match(canvas, /annotations\.redo\(\)/);
    assert.match(canvas, /isEditableTarget\(event\.target\)/);
    assert.match(canvas, /annotations\.startSelectedMove\(\)/);
    assert.match(canvas, /annotations\.commitSelectedMove\(\)/);
  });
});
