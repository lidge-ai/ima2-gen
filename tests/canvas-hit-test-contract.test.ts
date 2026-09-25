import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas hit test contract", () => {
  it("supports hit testing and selection boxes for all annotation types", () => {
    const source = readSource("ui/src/lib/canvas/hitTest.ts");
    assert.match(source, /export function hitTestAnnotation/);
    assert.match(source, /export function findAnnotationsInBox/);
    assert.match(source, /export function normalizeSelectionBox/);
    assert.match(source, /memos/);
    assert.match(source, /boxes/);
    assert.match(source, /paths/);
    assert.match(source, /reverse\(\)/);
    assert.match(source, /distanceToSegment/);
    assert.match(source, /CanvasObjectKey/);
    assert.match(source, /keyForPath/);
    assert.match(source, /keyForBox/);
    assert.match(source, /keyForMemo/);
  });
});
