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

describe("canvas selection contract", () => {
  it("keeps multi-select and delete scoped to canvas annotations", () => {
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/useCanvasModePointerHandlers.ts",
    ].map(readSource).join("\n");
    assert.match(hook, /selectedIds/);
    assert.match(hook, /selectOne/);
    assert.match(hook, /toggleSelected/);
    assert.match(hook, /deleteSelected/);
    assert.match(hook, /moveSelected/);
    assert.match(hook, /objectKeyMatches/);
    assert.match(hook, /parseCanvasObjectKey/);
    assert.match(canvas, /activeTool === "select"/);
    assert.match(canvas, /hitTestAnnotation/);
    assert.match(canvas, /findAnnotationsInBox/);
    assert.doesNotMatch(hook, /trashHistoryItem/);
    assert.doesNotMatch(hook, /deleteHistory/);
  });
});
