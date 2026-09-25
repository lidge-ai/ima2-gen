import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const types = readFileSync(join(root, "ui/src/types/canvas.ts"), "utf8");
const hook = readSourceTree("ui/src/hooks/useCanvasAnnotations.ts");
const canvas = [
  "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
  "ui/src/components/canvas-mode/CanvasModeTopbar.tsx",
  "ui/src/components/canvas-mode/useCanvasModePointerHandlers.ts",
  "ui/src/components/canvas-mode/useCanvasModeShortcuts.ts",
].map((path) => readFileSync(join(root, path), "utf8")).join("\n");
const store = readSourceTree("ui/src/store/useAppStore.ts");
const coords = readFileSync(join(root, "ui/src/lib/canvas/coordinates.ts"), "utf8");
const toolbar = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasToolbar.tsx"), "utf8");
const zoomControl = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasZoomControl.tsx"), "utf8");
const miniMap = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasViewportMiniMap.tsx"), "utf8");
const canvasModeCss = readSourceTree("ui/src/styles/canvas-annotations.css");
const css = readFileSync(join(root, "ui/src/styles/canvas-background-cleanup.css"), "utf8");
const en = JSON.parse(readFileSync(join(root, "ui/src/i18n/en.json"), "utf8"));
const ko = JSON.parse(readFileSync(join(root, "ui/src/i18n/ko.json"), "utf8"));

test("canvas tool 'pan' renamed to 'select'", () => {
  assert.match(types, /CanvasTool\s*=\s*"select"\s*\|/);
  assert.match(hook, /activeTool:\s*"select"/);
  assert.match(canvas, /activeTool === "select"/);
});

test("store carries canvasPanX/Y with setters and reset", () => {
  assert.match(store, /canvasPanX:\s*number/);
  assert.match(store, /canvasPanY:\s*number/);
  assert.match(store, /setCanvasPan:\s*\(x:\s*number,\s*y:\s*number\)\s*=>\s*void/);
  assert.match(store, /resetCanvasPan:\s*\(\)\s*=>\s*void/);
});

test("Canvas applies translate+scale transform when canvas is open", () => {
  assert.match(
    canvas,
    /transform:\s*canvasOpen[\s\S]{0,160}translate\(\$\{canvasPanX\}px,\s*\$\{canvasPanY\}px\)\s*scale\(\$\{canvasZoom\}\)/,
  );
});

test("Canvas reacts to Space, middle-mouse, and zoomed select-drag for viewport pan", () => {
  assert.match(canvas, /viewportPanRef/);
  assert.match(canvas, /spaceHeld/);
  assert.match(canvas, /event\.button === 1/);
  assert.match(canvas, /canDragViewportWithSelect/);
  assert.match(canvas, /canvasZoom > 1\.01/);
  assert.match(canvas, /startViewportPan\(event\)/);
  assert.match(canvas, /canvas--zoom-hand/);
  assert.match(canvasModeCss, /\.canvas--zoom-hand \.canvas-annotation-frame/);
});

test("openCanvas / resetCanvasZoom reset pan", () => {
  assert.match(store, /openCanvas:[\s\S]{0,200}canvasPanX:\s*0[\s\S]{0,40}canvasPanY:\s*0/);
  assert.match(store, /resetCanvasZoom:[\s\S]{0,160}canvasPanX:\s*0/);
});

test("Canvas exposes zoom controls, wheel zoom, and keyboard zoom shortcuts", () => {
  assert.match(canvas, /setCanvasZoom\(canvasZoom \+ 0\.1\)/);
  assert.match(canvas, /setCanvasZoom\(canvasZoom - 0\.1\)/);
  assert.match(canvas, /resetCanvasZoom\(\)/);
  assert.match(canvas, /onWheel=\{handleViewerWheel\}/);
  assert.match(canvas, /event\.ctrlKey/);
  assert.match(canvas, /setCanvasZoom\(canvasZoom - event\.deltaY \* 0\.01\)/);
  assert.match(canvas, /setCanvasPan\(canvasPanX - event\.deltaX,\s*canvasPanY - event\.deltaY\)/);
  assert.match(canvas, /event\.key === "\]"/);
  assert.match(canvas, /event\.key === "\["/);
  assert.match(canvas, /event\.key === "0"/);
  assert.match(canvas, /CanvasZoomControl/);
  assert.match(canvas, /canvas-mode-topbar__shortcuts/);
  assert.doesNotMatch(toolbar, /CanvasZoomControl/);
  assert.match(zoomControl, /canvas-toolbar__zoom/);
  assert.match(css, /\.canvas-toolbar__zoom/);
  assert.match(css, /\.canvas-mode-topbar__stack/);
  for (const locale of [en, ko]) {
    assert.equal(typeof locale.canvas.toolbar.zoomGroup, "string");
    assert.equal(typeof locale.canvas.toolbar.zoomIn, "string");
    assert.equal(typeof locale.canvas.toolbar.zoomOut, "string");
    assert.equal(typeof locale.canvas.toolbar.zoomReset, "string");
    assert.equal(typeof locale.canvas.toolbar.zoomShortcutHint, "string");
  }
});

test("Canvas Mode blocks browser pinch zoom while preserving canvas wheel gestures", () => {
  assert.match(canvas, /preventCtrlWheelDefault/);
  assert.match(canvas, /window\.addEventListener\("wheel",\s*preventCtrlWheelDefault,\s*wheelOptions\)/);
  assert.match(canvas, /passive:\s*false,\s*capture:\s*true/);
  assert.match(canvas, /if \(event\.ctrlKey\) event\.preventDefault\(\)/);
  assert.match(canvas, /window\.addEventListener\("gesturestart",\s*preventCanvasPinchDefault,\s*gestureOptions\)/);
  assert.match(canvas, /window\.addEventListener\("gesturechange",\s*preventCanvasPinchDefault,\s*gestureOptions\)/);
  assert.match(canvas, /window\.addEventListener\("gestureend",\s*preventCanvasPinchDefault,\s*gestureOptions\)/);
  assert.match(canvas, /window\.removeEventListener\("wheel",\s*preventCtrlWheelDefault,\s*wheelOptions\)/);
  assert.match(canvas, /window\.removeEventListener\("gesturechange",\s*preventCanvasPinchDefault,\s*gestureOptions\)/);
});

test("Canvas exposes a node-style viewport minimap for zoomed navigation", () => {
  assert.match(canvas, /CanvasViewportMiniMap/);
  assert.match(canvas, /imageSrc=\{imageSrc\}/);
  assert.match(canvas, /panX=\{canvasPanX\}/);
  assert.match(canvas, /panY=\{canvasPanY\}/);
  assert.match(miniMap, /getCanvasMiniMapViewportStyle/);
  assert.match(miniMap, /className="canvas-viewport-minimap"/);
  assert.match(miniMap, /className="canvas-viewport-minimap__window"/);
  assert.match(css, /\.canvas-viewport-minimap/);
  assert.match(css, /var\(--minimap-mask/);
});

test("screenToNormalized still uses getBoundingClientRect (post-transform safe)", () => {
  assert.match(coords, /getBoundingClientRect\(\)/);
  assert.match(coords, /rect\.width/);
  assert.match(coords, /rect\.height/);
});
