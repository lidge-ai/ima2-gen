import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas mask renderer contract", () => {
  it("renders PNG masks from natural image dimensions and box alpha", () => {
    const source = readSource("ui/src/lib/canvas/maskRenderer.ts");
    assert.match(source, /export async function renderMaskFromBoxes/);
    assert.match(source, /naturalWidth/);
    assert.match(source, /naturalHeight/);
    assert.match(source, /mask_boxes_required/);
    assert.match(source, /"image\/png"/);
    assert.match(source, /destination-out/);
    assert.doesNotMatch(source, /getBoundingClientRect/);
  });

  it("can convert the displayed canvas image into a dimension-preserving PNG data URL", () => {
    const source = readSource("ui/src/lib/canvas/maskRenderer.ts");
    assert.match(source, /export async function imageElementToPngDataUrl/);
    assert.match(source, /canvas\.width = width/);
    assert.match(source, /canvas\.height = height/);
    assert.match(source, /toDataURL\("image\/png"\)/);
  });
});
