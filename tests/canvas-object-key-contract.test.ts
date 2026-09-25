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

describe("canvas object key contract", () => {
  it("defines typed object keys for paths, boxes, and memos", () => {
    const source = readSource("ui/src/lib/canvas/objectKeys.ts");
    assert.match(source, /CanvasObjectKind/);
    assert.match(source, /CanvasObjectKey/);
    assert.match(source, /makeCanvasObjectKey/);
    assert.match(source, /parseCanvasObjectKey/);
    assert.match(source, /path/);
    assert.match(source, /box/);
    assert.match(source, /memo/);
  });

  it("routes hit testing and selection through object keys", () => {
    const hitTest = readSource("ui/src/lib/canvas/hitTest.ts");
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(hitTest, /CanvasObjectKey/);
    assert.match(hitTest, /keyForPath/);
    assert.match(hitTest, /keyForBox/);
    assert.match(hitTest, /keyForMemo/);
    assert.match(hook, /CanvasObjectKey/);
    assert.match(hook, /objectKeyMatches/);
    assert.match(hook, /parseCanvasObjectKey/);
  });
});
