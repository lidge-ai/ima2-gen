import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("canvas-mode contract", () => {
  it("has canvas types", () => {
    const types = readSource("ui/src/types/canvas.ts");
    assert.match(types, /export type CanvasTool/);
    assert.match(types, /export interface NormalizedPoint/);
  });

  it("has canvas-mode CSS", () => {
    const css = readSource("ui/src/styles/canvas-mode.css");
    assert.match(css, /\.canvas--mode-open/);
    assert.match(css, /\.canvas-mode-topbar/);
    assert.match(css, /\.canvas-mode-close/);
  });

  it("has CanvasModeWorkspace behind the feature boundary", () => {
    const featureIndex = readSource("ui/src/components/canvas-mode/index.ts");
    const workspace = readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");
    const shortcuts = readSource("ui/src/components/canvas-mode/useCanvasModeShortcuts.ts");
    assert.match(featureIndex, /export \{ CanvasModeWorkspace \} from "\.\/CanvasModeWorkspace";/);
    assert.match(workspace, /export function CanvasModeWorkspace/);
    assert.match(workspace, /canvasOpen/);
    assert.match(workspace, /handleCloseCanvas/);
    assert.match(shortcuts, /Escape/);
  });

  it("has canvas state in store", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    assert.match(store, /canvasOpen: boolean/);
    assert.match(store, /canvasZoom: number/);
    assert.match(store, /openCanvas/);
    assert.match(store, /closeCanvas/);
  });

  it("has double-click handler on image", () => {
    const canvas = readSource("ui/src/components/Canvas.tsx");
    assert.match(canvas, /onDoubleClick/);
    assert.match(canvas, /openCanvas/);
  });

  it("creates a blank canvas through the local import path", () => {
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const hook = readSource("ui/src/hooks/useCreateBlankCanvas.ts");
    const helper = readSource("ui/src/lib/canvas/blankCanvas.ts");
    const css = readSource("ui/src/index.css");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");
    assert.match(canvas, /useCreateBlankCanvas/);
    assert.match(hook, /createBlankCanvasFile/);
    assert.match(hook, /getResolvedSize/);
    assert.match(hook, /resolveBlankCanvasSize\(getResolvedSize\(\)\)/);
    assert.match(hook, /await createBlankCanvasFile\(size\)/);
    assert.match(hook, /await importLocalImageToHistory\(file\)/);
    assert.match(hook, /if \(item\) openCanvas\(\)/);
    assert.match(canvas, /\) : !currentImage \? \(/);
    assert.match(canvas, /canvas__blank-entry/);
    assert.match(canvas, /canvas\.blank\.create/);
    assert.match(helper, /document\.createElement\("canvas"\)/);
    assert.match(helper, /ctx\.fillStyle = "#ffffff"/);
    assert.match(helper, /canvas\.toBlob/);
    assert.match(helper, /new File\(\[blob\], BLANK_CANVAS_FILENAME/);
    assert.match(helper, /createBlankCanvasFile\(size\?: BlankCanvasSize\)/);
    assert.match(helper, /canvas\.width = width/);
    assert.match(helper, /canvas\.height = height/);
    assert.match(css, /\.canvas__blank-entry/);
    assert.match(css, /\.canvas__blank-sheet/);
    assert.match(css, /\.canvas__blank-copy/);
    assert.match(css, /\.canvas__blank-button/);
    assert.match(en, /"blank": \{/);
    assert.match(en, /"title": "Blank canvas"/);
    assert.match(en, /"subtitle": "Sketch on white paper, then continue from it\."/);
    assert.match(en, /"create": "Create blank canvas"/);
    assert.match(en, /"creating": "Creating\.\.\."/);
    assert.match(en, /"failed": "Could not create blank canvas"/);
    assert.match(ko, /"blank": \{/);
    assert.match(ko, /"title": "흰 캔버스"/);
    assert.match(ko, /"subtitle": "흰 종이에 그린 뒤 여기서 이어가세요\."/);
    assert.match(ko, /"create": "흰 캔버스 만들기"/);
    assert.match(ko, /"creating": "만드는 중\.\.\."/);
    assert.match(ko, /"failed": "흰 캔버스를 만들 수 없습니다"/);
  });

  it("exposes Blank Canvas from Canvas Mode topbar and Shift+B", () => {
    const workspace = readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");
    const topbar = readSource("ui/src/components/canvas-mode/CanvasModeTopbar.tsx");
    const shortcuts = readSource("ui/src/components/canvas-mode/useCanvasModeShortcuts.ts");
    const css = readSource("ui/src/styles/canvas-mode.css");
    assert.match(workspace, /useCreateBlankCanvas/);
    assert.match(workspace, /blankCanvasShortcut="Shift\+B"/);
    assert.match(workspace, /onCreateBlankCanvas=\{\(\) => void createBlankCanvas\(\)\}/);
    assert.match(topbar, /canvas-mode-topbar__center/);
    assert.match(topbar, /canvas-mode-blank/);
    assert.match(topbar, /blankCanvasShortcut/);
    assert.match(shortcuts, /event\.shiftKey/);
    assert.match(shortcuts, /event\.key\.toLowerCase\(\) === "b"/);
    assert.match(shortcuts, /isEditableTarget\(event\.target\)/);
    assert.match(shortcuts, /onCreateBlankCanvas/);
    assert.match(css, /\.canvas-mode-topbar__center/);
    assert.match(css, /\.canvas-mode-blank/);
  });

  it("has canvas button in ResultActions", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    assert.match(actions, /canvasOpen/);
    assert.match(actions, /openCanvas/);
    assert.match(actions, /canvas\.open/);
  });

  it("applies canvas mode class to main canvas", () => {
    const canvas = readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");
    assert.match(canvas, /canvas--mode-open/);
  });

  it("imports canvas-mode CSS in main", () => {
    const main = readSource("ui/src/main.tsx");
    assert.match(main, /canvas-mode\.css/);
  });

  it("has i18n keys for canvas", () => {
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");
    assert.match(en, /"open": "Open Canvas"/);
    assert.match(en, /"close": "Close Canvas"/);
    assert.match(ko, /"open": "캔버스 열기"/);
    assert.match(ko, /"close": "캔버스 닫기"/);
  });
});
