import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas export contract", () => {
  it("renders merged canvas output with annotations and memos", () => {
    const source = readSource("ui/src/lib/canvas/mergeRenderer.ts");
    assert.match(source, /renderMergedCanvasImage/);
    assert.match(source, /drawImage/);
    assert.match(source, /renderAnnotationPath/);
    assert.match(source, /renderBoundingBox/);
    assert.match(source, /renderCanvasMemo/);
    assert.match(source, /canvasToBlob/);
    assert.match(source, /canvas_blob_unavailable/);
  });

  it("exports a blob without mutating canvas state", () => {
    const source = readSource("ui/src/lib/canvas/exportRenderer.ts");
    assert.match(source, /exportCanvasImage/);
    assert.match(source, /renderMergedCanvasImage/);
    assert.match(source, /makeCanvasExportFilename/);
    // Extension is a parameter since SVG/PPTX export landed (WP5); PNG remains default.
    assert.match(source, /canvas-export-\$\{stamp\}\$\{suffix\}\.\$\{options\.format \?\? "png"\}/);
  });

  it("downloads blobs through object URLs with cleanup", () => {
    const source = readSource("ui/src/lib/canvas/exportRenderer.ts");
    assert.match(source, /downloadCanvasBlob/);
    assert.match(source, /URL\.createObjectURL/);
    assert.match(source, /anchor\.download = filename/);
    assert.match(source, /URL\.revokeObjectURL/);
    assert.match(source, /finally/);
  });
});
