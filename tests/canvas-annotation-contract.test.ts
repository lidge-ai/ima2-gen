import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas annotation contract", () => {
  it("has toolbar component with core tools", () => {
    const source = readSource("ui/src/components/canvas-mode/CanvasToolbar.tsx");
    assert.match(source, /CanvasToolbar/);
    assert.match(source, /select/);
    assert.match(source, /pen/);
    assert.match(source, /box/);
    assert.match(source, /arrow/);
    assert.match(source, /memo/);
    assert.match(source, /canvas-toolbar__shortcut/);
    assert.doesNotMatch(source, /<span>\{tool\.label\}<\/span>/);
    assert.doesNotMatch(source, />\s*Apply\s*</);
    assert.doesNotMatch(source, />\s*Export\s*</);
  });

  it("has annotation canvas layer", () => {
    const source = readSource("ui/src/components/canvas-mode/CanvasAnnotationLayer.tsx");
    assert.match(source, /CanvasAnnotationLayer/);
    assert.match(source, /renderAnnotationPath/);
    assert.match(source, /renderBoundingBox/);
  });

  it("has annotation renderer", () => {
    const source = readSource("ui/src/lib/canvas/annotationRenderer.ts");
    assert.match(source, /renderAnnotationPath/);
    assert.match(source, /renderBoundingBox/);
    assert.match(source, /renderCanvasMemo/);
    assert.match(source, /drawArrowHead/);
  });

  it("has normalized coordinate mapper", () => {
    const source = readSource("ui/src/lib/canvas/coordinates.ts");
    assert.match(source, /screenToNormalized/);
    assert.match(source, /getBoundingClientRect/);
  });

  it("wires annotation tools inside Canvas", () => {
    const source = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeResultDetails.tsx",
      "ui/src/components/canvas-mode/CanvasModeStage.tsx",
      "ui/src/components/canvas-mode/CanvasModeFloatingToolbar.tsx",
    ].map(readSource).join("\n");
    assert.match(source, /CanvasToolbar/);
    assert.match(source, /CanvasAnnotationLayer/);
    assert.match(source, /onPointerDown/);
  });

  it("keeps annotation integration inside Canvas instead of the app shell", () => {
    const app = readSource("ui/src/App.tsx");
    assert.doesNotMatch(app, /CanvasModeShell/);
  });

  it("scales the image annotation frame instead of the image element", () => {
    const source = [
      "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx",
      "ui/src/components/canvas-mode/CanvasModeResultDetails.tsx",
      "ui/src/components/canvas-mode/CanvasModeStage.tsx",
      "ui/src/components/canvas-mode/CanvasModeFloatingToolbar.tsx",
    ].map(readSource).join("\n");
    const frameIndex = source.indexOf("canvas-annotation-frame");
    const layerIndex = source.indexOf("<CanvasAnnotationLayer", frameIndex);
    const toolbarIndex = source.indexOf("<CanvasToolbar", frameIndex);
    const metaIndex = source.indexOf("result-meta");
    const actionsIndex = source.indexOf("<ResultActions");
    const promptSummaryIndex = source.indexOf("<ResultPromptSummary");
    const promptSource = readSource("ui/src/components/ResultPromptSummary.tsx");

    assert.ok(frameIndex > -1);
    assert.ok(layerIndex > frameIndex);
    assert.ok(toolbarIndex > frameIndex);
    assert.ok(metaIndex > frameIndex);
    assert.ok(actionsIndex > frameIndex);
    assert.ok(promptSummaryIndex > frameIndex);
    assert.ok(metaIndex < actionsIndex);
    assert.ok(actionsIndex < promptSummaryIndex);
    assert.match(promptSource, /className="result-prompt"/);
    assert.match(source, /canvas-annotation-frame[\s\S]*transform: canvasOpen[\s\S]{0,200}translate\(\$\{canvasPanX\}px, \$\{canvasPanY\}px\) scale\(\$\{canvasZoom\}\)/);
    assert.doesNotMatch(source, /<img[\s\S]{0,500}transform: canvasOpen[\s\S]{0,40}scale\(\$\{canvasZoom\}\)/);
  });

  it("resets temporary annotations when the current image changes", () => {
    const source = readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");
    assert.match(source, /previousImageKeyRef/);
    assert.match(source, /currentImage\?\.filename \?\? currentImage\?\.url \?\? currentImage\?\.image/);
    assert.match(source, /annotations\.resetLocal\(\)/);
  });

  it("has annotation state contracts", () => {
    const types = readSource("ui/src/types/canvas.ts");
    const hook = readSource("ui/src/hooks/useCanvasAnnotations.ts");
    assert.match(types, /interface BoundingBox[\s\S]*strokeWidth: number/);
    assert.match(hook, /hasAnnotations/);
  });

  it("has localized toolbar keys", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));
    for (const locale of [en, ko]) {
      assert.equal(typeof locale.canvas.toolbar.label, "string");
      assert.equal(typeof locale.canvas.toolbar.select, "string");
    assert.equal(typeof locale.canvas.toolbar.pen, "string");
    assert.equal(typeof locale.canvas.toolbar.box, "string");
    assert.equal(typeof locale.canvas.toolbar.arrow, "string");
    assert.equal(typeof locale.canvas.toolbar.memo, "string");
    assert.equal(typeof locale.canvas.toolbar.apply, "string");
    assert.equal(typeof locale.canvas.toolbar.applyDone, "string");
    assert.equal(typeof locale.canvas.toolbar.applyFailed, "string");
    assert.equal(typeof locale.canvas.toolbar.export, "string");
    assert.equal(typeof locale.canvas.toolbar.exportFailed, "string");
    assert.equal(typeof locale.canvas.toolbar.clear, "string");
  }
});
});
