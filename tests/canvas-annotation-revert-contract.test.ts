import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), "utf8");

describe("canvas baked annotation revert contract", () => {
  it("records annotation provenance and the vector snapshot after Apply", () => {
    const session = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    const store = readSource("lib/canvasVersionStore.ts");
    assert.match(session, /const snapshot = annotations\.toPayload\(\)/);
    assert.match(session, /const annotationOnlyAtBake = !canvasVersionItem \|\| Boolean\(canvasVersionItem\.annotationOnly\)/);
    assert.match(session, /recordCanvasAnnotationBake\([\s\S]*result\.item\.filename![\s\S]*snapshot,[\s\S]*annotationOnlyAtBake/);
    assert.match(store, /annotationsBaked: true/);
    assert.match(store, /annotationSnapshot: snapshot/);
    assert.match(store, /annotationOnly,/);
  });

  it("marks a baked version mixed when a later pixel edit lands in its slot", () => {
    const cleanup = readSource("ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts");
    const store = readSource("lib/canvasVersionStore.ts");
    assert.match(cleanup, /updateCanvasVersion\(canvasDisplayImage\.filename/);
    assert.match(cleanup, /pixelEdited: true/);
    assert.match(store, /annotationOnly: Boolean\(previousMeta\?\.annotationOnly\) && !input\.pixelEdited/);
  });

  it("rebuilds the clean version and restores annotation-only vectors as a draft", () => {
    const session = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    const store = readSource("lib/canvasVersionStore.ts");
    assert.match(store, /sharp\(await readFile\(sourceFull\)\)\.png\(\)\.toBuffer\(\)/);
    assert.match(store, /return \{ item: toGenerateItem\(filename, meta\), snapshot, annotationOnly \}/);
    assert.match(session, /result\.annotationOnly && result\.snapshot/);
    assert.match(session, /annotations\.load\(result\.snapshot\)/);
    assert.match(session, /saveCanvasAnnotations\(sourceFilename, result\.snapshot\)/);
  });

  it("requires confirmation before a mixed version loses pixel edits", () => {
    const session = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    const toolbar = readSource("ui/src/components/canvas-mode/CanvasToolbar.tsx");
    assert.match(session, /!canvasVersionItem\.annotationOnly && !window\.confirm\(t\("canvas\.revert\.mixedConfirm"\)\)/);
    assert.match(session, /revertCanvasAnnotations\(canvasVersionItem\.filename\)/);
    assert.match(toolbar, /onRevertAnnotations/);
    assert.match(toolbar, /canvas\.revert\.action/);
  });
});
