import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const panel = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasBackgroundCleanupPanel.tsx"), "utf8");
const segmented = readFileSync(join(root, "ui/src/components/canvas-mode/SegmentedControl.tsx"), "utf8");
const toolbar = readFileSync(join(root, "ui/src/components/canvas-mode/CanvasToolbar.tsx"), "utf8");
const hook = readFileSync(join(root, "ui/src/components/canvas-mode/useCanvasBackgroundCleanup.ts"), "utf8");
const cleanupState = readFileSync(join(root, "ui/src/components/canvas-mode/backgroundCleanupState.ts"), "utf8");
const shortcuts = readFileSync(join(root, "ui/src/components/canvas-mode/useCanvasModeShortcuts.ts"), "utf8");
const css = readFileSync(join(root, "ui/src/styles/canvas-background-cleanup.css"), "utf8");

test("cleanup panel exposes orthogonal mark and input segmented controls", () => {
  assert.match(panel, /cleanupMark/);
  assert.match(panel, /cleanupRemove/);
  assert.match(panel, /cleanupPreserve/);
  assert.match(panel, /cleanupInput/);
  assert.match(panel, /cleanupClick/);
  assert.match(panel, /cleanupBrush/);
  assert.match(segmented, /aria-pressed=\{value === option\.value\}/);
  assert.match(segmented, /role="group"/);
  assert.match(segmented, /data-value=\{option\.value\}/);
});

test("cleanup brush mode reveals size control and activation wiring", () => {
  assert.match(panel, /tool === "brush"/);
  assert.match(panel, /cleanupBrushSize/);
  assert.match(panel, /onBrushRadiusChange/);
  assert.match(toolbar, /onCleanupToolChange/);
  assert.match(toolbar, /onCleanupBrushRadiusChange/);
  assert.match(hook, /getBrushStrokeSeedPoints\(stroke\)/);
  assert.match(cleanupState, /getBrushStrokeSeedPoints/);
  assert.match(hook, /floodFillMaskInto\(mask, source, getBrushStrokeSeedPoints\(stroke\), tolerance\)/);
});

test("cleanup defaults stay flat flood-fill and preserve wins by composition", () => {
  assert.match(hook, /useState<CanvasBackgroundCleanupClickEngine>\("flat-flood-fill"\)/);
  assert.match(hook, /composeFinalRemoveMask\(removeMaskRef\.current, preserveMaskRef\.current\)/);
  assert.doesNotMatch(hook + toolbar, /@huggingface|onnxruntime|@imgly|api\/segment/);
});

test("cleanup shortcuts prioritize cleanup undo redo and escape", () => {
  assert.match(shortcuts, /handleBackgroundCleanupEscape\(\)/);
  assert.match(shortcuts, /redoBackgroundCleanup\(\)/);
  assert.match(shortcuts, /undoBackgroundCleanup\(\)/);
});

test("cleanup CSS includes active remove and preserve states", () => {
  assert.match(css, /\.canvas-toolbar__segmented/);
  assert.match(css, /data-value="remove"/);
  assert.match(css, /data-value="preserve"/);
  assert.match(css, /\.canvas-cleanup-overlay/);
  assert.match(css, /\.canvas-cleanup-cursor/);
});
