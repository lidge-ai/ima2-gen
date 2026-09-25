import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCleanupMask,
  rasterizeBrushStrokeInto,
} from "../ui/src/lib/canvas/backgroundCleanupMasks.ts";

function countMarked(mask) {
  return Array.from<any>(mask.data).filter((value) => value > 0).length;
}

test("cleanup brush rasterizes a single-point disk", () => {
  const mask = createCleanupMask(21, 21);
  rasterizeBrushStrokeInto(mask, { points: [{ x: 0.5, y: 0.5 }], radius: 0.12 });

  assert.ok(countMarked(mask) > 1);
  assert.equal(mask.data[10 * 21 + 10], 255);
});

test("cleanup brush connects two points into a capsule", () => {
  const mask = createCleanupMask(31, 11);
  rasterizeBrushStrokeInto(mask, {
    points: [{ x: 0.15, y: 0.5 }, { x: 0.85, y: 0.5 }],
    radius: 0.06,
  });

  assert.equal(mask.data[5 * 31 + 15], 255);
});

test("cleanup brush radius zero is a no-op", () => {
  const mask = createCleanupMask(10, 10);
  rasterizeBrushStrokeInto(mask, { points: [{ x: 0.5, y: 0.5 }], radius: 0 });

  assert.equal(countMarked(mask), 0);
});

test("cleanup brush repeated strokes accumulate", () => {
  const mask = createCleanupMask(20, 20);
  rasterizeBrushStrokeInto(mask, { points: [{ x: 0.2, y: 0.2 }], radius: 0.08 });
  const firstCount = countMarked(mask);
  rasterizeBrushStrokeInto(mask, { points: [{ x: 0.8, y: 0.8 }], radius: 0.08 });

  assert.ok(countMarked(mask) > firstCount);
});
