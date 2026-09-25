import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas version API contract", () => {
  it("registers raw PNG canvas version routes", () => {
    const index = readSource("routes/index.ts");
    const route = readSource("routes/canvasVersions.ts");
    assert.match(index, /registerCanvasVersionRoutes/);
    assert.match(route, /express\.raw\(\{ type: "image\/png"/);
    assert.match(route, /app\.post\("\/api\/canvas-versions"/);
    assert.match(route, /app\.put\("\/api\/canvas-versions\/:filename"/);
    assert.match(route, /\/annotation-bake/);
    assert.match(route, /\/revert-annotations/);
  });

  it("stores canvas versions under generatedDir with metadata", () => {
    const store = readSource("lib/canvasVersionStore.ts");
    assert.match(store, /createCanvasVersion/);
    assert.match(store, /updateCanvasVersion/);
    assert.match(store, /PNG_SIGNATURE/);
    assert.match(store, /embedImageMetadataBestEffort/);
    assert.match(store, /canvasVersion: true/);
    assert.match(store, /canvasSourceFilename/);
    assert.match(store, /canvasEditableFilename/);
    assert.match(store, /annotationsBaked/);
    assert.match(store, /annotationSnapshot/);
    assert.match(store, /annotationOnly/);
    assert.match(store, /readGeneratedMetadata/);
    assert.match(store, /firstString\(input\.prompt, sourceMeta\?\.userPrompt, sourceMeta\?\.prompt\)/);
  });

  it("rejects traversal and non-canvas update filenames", () => {
    const store = readSource("lib/canvasVersionStore.ts");
    assert.match(store, /filename !== basename\(filename\)/);
    assert.match(store, /filename\.includes\("\.\."\)/);
    assert.match(store, /\^canvas-\[a-zA-Z0-9\._-\]\+\\\.png\$/);
    assert.match(store, /CANVAS_VERSION_NOT_PNG/);
  });

  it("surfaces canvas version metadata in history rows", () => {
    const history = readSource("lib/historyList.ts");
    const metadata = readSource("lib/imageMetadata.ts");
    assert.match(history, /canvasVersion: Boolean\(meta\?\.canvasVersion\)/);
    assert.match(history, /canvasSourceFilename/);
    assert.match(history, /canvasEditableFilename/);
    assert.match(history, /canvasMergedAt: Number\.isFinite\(meta\?\.canvasMergedAt\)/);
    assert.match(metadata, /canvasMergedAt/);
  });
});
