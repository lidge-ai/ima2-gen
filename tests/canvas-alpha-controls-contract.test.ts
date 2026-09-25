import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const types = readFileSync(join(root, "ui/src/types/canvas.ts"), "utf8");
const store = readSourceTree("ui/src/store/useAppStore.ts");
const merge = readFileSync(join(root, "ui/src/lib/canvas/mergeRenderer.ts"), "utf8");
const exportR = readFileSync(join(root, "ui/src/lib/canvas/exportRenderer.ts"), "utf8");
const canvas = [
  "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
  "ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts",
  "ui/src/components/canvas-mode/useCanvasModeSession.ts",
].map((path) => readFileSync(join(root, path), "utf8")).join("\n");
const toolbar = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasToolbar.tsx"), "utf8");
const bgControl = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasBackgroundControl.tsx"), "utf8");
const css = readSourceTree("ui/src/styles/canvas-annotations.css");
const en = JSON.parse(readFileSync(join(root, "ui/src/i18n/en.json"), "utf8"));
const ko = JSON.parse(readFileSync(join(root, "ui/src/i18n/ko.json"), "utf8"));

test("CanvasExportBackground union exists", () => {
  assert.match(types, /CanvasExportBackground\s*=\s*"alpha"\s*\|\s*"matte"/);
});

test("Store carries exportBackground state with setters", () => {
  assert.match(store, /canvasExportBackground:\s*CanvasExportBackground/);
  assert.match(store, /canvasExportMatteColor:\s*HexColor/);
  assert.match(store, /setCanvasExportBackground:\s*\(mode:\s*CanvasExportBackground\)\s*=>\s*void/);
  assert.match(store, /setCanvasExportMatteColor:\s*\(color:\s*HexColor\)\s*=>\s*void/);
  assert.match(store, /CANVAS_EXPORT_BG_KEY/);
});

test("Merge renderer accepts background option", () => {
  assert.match(merge, /background\?:\s*\{\s*mode:\s*"alpha"\s*\}\s*\|\s*\{\s*mode:\s*"matte";\s*color:\s*string\s*\}/);
  assert.match(merge, /input\.background\?\.mode === "matte"/);
  assert.match(merge, /ctx\.fillRect\(0, 0, canvas\.width, canvas\.height\)/);
});

test("Export filename appends -flat for matte mode", () => {
  // The extension became a parameter when SVG/PPTX export landed (WP5); the matte
  // suffix contract is unchanged and PNG stays the default.
  assert.match(exportR, /canvas-export-\$\{stamp\}\$\{suffix\}\.\$\{options\.format \?\? "png"\}/);
  assert.match(exportR, /options\.matte\s*\?\s*"-flat"\s*:\s*""/);
});

test("Canvas detects image alpha and toggles modifier class", () => {
  assert.match(canvas, /imageUsesAlpha/);
  assert.match(canvas, /canvas-annotation-frame--alpha/);
});

test("Canvas wires export background option into export call", () => {
  assert.match(canvas, /exportBackground === "matte"/);
  assert.match(canvas, /background:\s*matte/);
  assert.match(canvas, /makeCanvasExportFilename\(\{ matte, format \}\)/);
});

test("Toolbar BackgroundControl rendered before Export", () => {
  assert.match(toolbar, /CanvasBackgroundControl/);
  assert.match(bgControl, /canvas-toolbar__bg/);
  assert.match(bgControl, /onMatteColorChange/);
});

test("CSS adds alpha checkerboard and toolbar bg group", () => {
  assert.match(css, /\.canvas-annotation-frame--alpha\s*\{/);
  assert.match(css, /background-size:\s*16px 16px/);
  assert.match(css, /linear-gradient\([^)]*45deg/);
  assert.match(css, /\.canvas-toolbar__bg-tab/);
});

test("i18n carries bg keys in both locales", () => {
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.canvas.toolbar.bgGroup, "string");
    assert.equal(typeof locale.canvas.toolbar.bgAlpha, "string");
    assert.equal(typeof locale.canvas.toolbar.bgMatte, "string");
    assert.equal(typeof locale.canvas.toolbar.bgMatteColor, "string");
  }
});
