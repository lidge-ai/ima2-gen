import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

test("session gallery keeps pagination scoped out with explicit helper text", () => {
  const gallery = readSource("ui/src/components/GalleryModal.tsx");
  const controls = readSource("ui/src/components/gallery/GalleryLoadControls.tsx");
  const en = JSON.parse(readSource("ui/src/i18n/en.json"));
  const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

  assert.match(gallery, /showSessions=\{showSessions\}/);
  assert.match(controls, /gallery\.sessionPaginationHint/);
  assert.match(controls, /if \(showSessions\)/);
  assert.equal(typeof en.gallery.sessionPaginationHint, "string");
  assert.equal(typeof ko.gallery.sessionPaginationHint, "string");
});
