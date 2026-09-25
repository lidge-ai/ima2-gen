import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeFinalRemoveMask,
  createCleanupMask,
} from "../ui/src/lib/canvas/backgroundCleanupMasks.ts";

function markedIndexes(mask) {
  return Array.from<any>(mask.data.entries())
    .filter(([, value]) => value > 0)
    .map(([index]) => index);
}

test("cleanup mask composition keeps remove-only pixels", () => {
  const remove = createCleanupMask(3, 1);
  remove.data[0] = 255;
  remove.data[2] = 255;
  const finalMask = composeFinalRemoveMask(remove, null);

  assert.deepEqual(markedIndexes(finalMask), [0, 2]);
});

test("cleanup mask composition lets preserve fully override remove", () => {
  const remove = createCleanupMask(2, 2);
  const preserve = createCleanupMask(2, 2);
  remove.data.fill(255);
  preserve.data.fill(255);
  const finalMask = composeFinalRemoveMask(remove, preserve);

  assert.deepEqual(markedIndexes(finalMask), []);
});

test("cleanup mask composition removes only non-preserved overlap", () => {
  const remove = createCleanupMask(4, 1);
  const preserve = createCleanupMask(4, 1);
  remove.data.set([255, 255, 255, 0]);
  preserve.data.set([0, 255, 0, 0]);
  const finalMask = composeFinalRemoveMask(remove, preserve);

  assert.deepEqual(markedIndexes(finalMask), [0, 2]);
});

test("cleanup mask composition rejects mismatched mask sizes", () => {
  const remove = createCleanupMask(2, 2);
  const preserve = createCleanupMask(3, 1);

  assert.throws(() => composeFinalRemoveMask(remove, preserve), /cleanup_mask_size_mismatch/);
});
