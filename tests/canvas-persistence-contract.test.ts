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

describe("canvas annotation persistence contract", () => {
  it("exposes annotation API client helpers with browser identity", () => {
    const api = readSource("ui/src/lib/api.ts");
    assert.match(api, /fetchCanvasAnnotations/);
    assert.match(api, /saveCanvasAnnotations/);
    assert.match(api, /deleteCanvasAnnotations/);
    assert.match(api, /jsonFetchWithBrowserId\(`\/api\/annotations/);
  });

  it("separates user clear from local reset in the hook", () => {
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(hook, /isDirty/);
    assert.match(hook, /LOAD/);
    assert.match(hook, /MARK_SAVED/);
    assert.match(hook, /RESET_LOCAL/);
    assert.match(hook, /resetLocal/);
    assert.match(hook, /toPayload/);
  });

  it("loads source drafts and deletes them after baked save", () => {
    const canvas = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/useCanvasModeSession.ts",
    ].map(readSource).join("\n");
    assert.match(canvas, /fetchCanvasAnnotations/);
    assert.match(canvas, /saveCanvasAnnotations/);
    assert.match(canvas, /deleteCanvasAnnotations/);
    assert.match(canvas, /annotations\.load/);
    assert.match(canvas, /annotations\.markSaved/);
    assert.match(canvas, /deleteCanvasAnnotations\(source\.filename\)/);
  });

  it("has backend annotation routes and db upsert", () => {
    const routes = readSource("routes/annotations.ts");
    const db = readSource("lib/db.ts");
    assert.match(routes, /app\.get\("\/api\/annotations\/:filename"/);
    assert.match(routes, /app\.put\("\/api\/annotations\/:filename"/);
    assert.match(routes, /app\.delete\("\/api\/annotations\/:filename"/);
    assert.match(routes, /ON CONFLICT\(browser_id, filename\) DO UPDATE/);
    assert.match(db, /CREATE TABLE IF NOT EXISTS image_annotations/);
  });
});
