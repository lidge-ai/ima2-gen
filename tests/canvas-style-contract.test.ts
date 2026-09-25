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

describe("canvas annotation style contract", () => {
  it("hook exports style constants and storage key", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(src, /CANVAS_STYLE_STORAGE_KEY = "ima2\.canvas\.annotationStyle\.v1"/);
    assert.match(src, /export const CANVAS_STYLE_COLORS/);
    assert.match(src, /export const CANVAS_STROKE_WIDTHS/);
  });

  it("hook adds SET_STYLE action and setStyle callback", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(src, /\| \{ type: "SET_STYLE"; style: CanvasAnnotationStyle \}/);
    assert.match(src, /const setStyle = useCallback/);
    assert.match(src, /persistCanvasStyle\(style\)/);
    assert.match(src, /dispatch\(\{ type: "SET_STYLE", style \}\)/);
  });

  it("SET_STYLE reducer does not push history or set isDirty", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    const setStyle = src.match(/case "SET_STYLE":[\s\S]+?\};/);
    assert.ok(setStyle, "SET_STYLE case present");
    assert.doesNotMatch(setStyle[0], /withHistory/);
    assert.doesNotMatch(setStyle[0], /isDirty: true/);
    assert.doesNotMatch(setStyle[0], /past:/);
    assert.doesNotMatch(setStyle[0], /future:/);
  });

  it("RESET_LOCAL preserves toolColor and strokeWidth", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    const resetLocal = src.match(/case "RESET_LOCAL":[\s\S]+?\};/);
    assert.ok(resetLocal, "RESET_LOCAL case present");
    assert.match(resetLocal[0], /toolColor: state\.toolColor/);
    assert.match(resetLocal[0], /strokeWidth: state\.strokeWidth/);
  });

  it("LOAD preserves toolColor and strokeWidth", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    const load = src.match(/case "LOAD":[\s\S]+?\};/);
    assert.ok(load, "LOAD case present");
    assert.match(load[0], /toolColor: state\.toolColor/);
    assert.match(load[0], /strokeWidth: state\.strokeWidth/);
  });

  it("loadCanvasStyle is defensive (typeof window + try/catch)", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(src, /function loadCanvasStyle\(\): CanvasAnnotationStyle/);
    assert.match(src, /typeof window === "undefined"/);
    assert.match(src, /JSON\.parse\(raw\)/);
  });

  it("persistCanvasStyle wraps localStorage writes in try/catch", () => {
    const src = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(src, /function persistCanvasStyle\(style: CanvasAnnotationStyle\)/);
    assert.match(src, /window\.localStorage\.setItem\(CANVAS_STYLE_STORAGE_KEY/);
  });

  it("toolbar wires CanvasStylePopover with style props", () => {
    const src = readSource("ui/src/components/canvas-mode/CanvasToolbar.tsx");
    assert.match(src, /import \{ CanvasStylePopover \}/);
    assert.match(src, /style: CanvasAnnotationStyle;/);
    assert.match(src, /onStyleChange: \(style: CanvasAnnotationStyle\) => void;/);
    assert.match(src, /<CanvasStylePopover style=\{style\} onStyleChange=\{onStyleChange\} \/>/);
  });

  it("Canvas wires style + onStyleChange from hook", () => {
    const src = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeFloatingToolbar.tsx",
    ].map(readSource).join("\n");
    assert.match(src, /style=\{\{ color: annotations\.toolColor, strokeWidth: annotations\.strokeWidth \}\}/);
    assert.match(src, /onStyleChange=\{annotations\.setStyle\}/);
  });

  it("annotation renderer no longer hardcodes #ef4444 for active draft", () => {
    const src = readSource("ui/src/lib/canvas/annotationRenderer.ts");
    assert.doesNotMatch(src, /color: "#ef4444",\s+strokeWidth: 3,/);
  });

  it("CanvasStylePopover sources constants from the hook", () => {
    const src = readSource("ui/src/components/canvas-mode/CanvasStylePopover.tsx");
    assert.match(src, /CANVAS_STROKE_WIDTHS/);
    assert.match(src, /CANVAS_STYLE_COLORS/);
    assert.match(src, /useModalFocus/);
  });

  it("i18n exposes style/color/strokeWidth keys (en + ko)", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));
    assert.equal(typeof en.canvas.toolbar.style, "string");
    assert.equal(typeof en.canvas.toolbar.color, "string");
    assert.equal(typeof en.canvas.toolbar.strokeWidth, "string");
    assert.equal(typeof ko.canvas.toolbar.style, "string");
    assert.equal(typeof ko.canvas.toolbar.color, "string");
    assert.equal(typeof ko.canvas.toolbar.strokeWidth, "string");
  });

  it("type module exposes CanvasAnnotationStyle", () => {
    const src = readSource("ui/src/types/canvas.ts");
    assert.match(src, /export type HexColor/);
    assert.match(src, /export interface CanvasAnnotationStyle \{/);
    assert.match(src, /color: HexColor/);
    assert.match(src, /strokeWidth: number/);
  });
});
