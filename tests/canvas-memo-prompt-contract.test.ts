import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas memo prompt contract", () => {
  it("converts memo annotations into text instructions instead of pixels", () => {
    const source = readSource("ui/src/lib/canvas/memoPrompt.ts");
    assert.match(source, /export function describeMemoPosition\(x: number, y: number\): string/);
    assert.match(source, /export function buildMemoEditInstructions\(memos: CanvasMemo\[\]\): string/);
    assert.match(source, /Math\.round\(x \* 100\)/);
    assert.match(source, /Math\.round\(y \* 100\)/);
    assert.match(source, /Do not render any annotation text, sticky notes, boxes, arrows, or markup/);
    assert.match(source, /memo\.text\.trim\(\)/);
  });

  it("sends clean source pixels to the model while keeping annotated versions for UI", () => {
    const helpers = readSource("ui/src/components/canvas-mode/canvasModeHelpers.ts");
    const session = readSource("ui/src/components/canvas-mode/useCanvasModeSession.ts");
    assert.match(helpers, /export function resolveCleanSourceUrl\(source: GenerateItem\): string/);
    assert.match(helpers, /canvasSourceFilename \?\? source\.filename/);
    assert.match(helpers, /export async function loadCleanSourceDataUrl\(source: GenerateItem\): Promise<string>/);
    assert.match(session, /lastCleanDataUrlRef\.current = cleanDataUrl/);
    assert.match(session, /attachCanvasVersionReference\(savedItem, cleanDataUrl\)/);
    assert.match(session, /const memosForPrompt = annotations\.memos/);
    assert.match(session, /buildMemoEditInstructions\(memosForPrompt\)/);
  });
});
