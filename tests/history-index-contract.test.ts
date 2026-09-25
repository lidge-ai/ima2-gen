import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

test("history index invalidates after every generated asset writer finalizes metadata", () => {
  const writers = [
    "lib/generatePipeline.ts",
    "lib/multimodePipeline.ts",
    "routes/edit.ts",
    "lib/nodeStore.ts",
    "lib/localImportStore.ts",
    "lib/canvasVersionStore.ts",
  ];
  for (const path of writers) {
    const source = readSource(path);
    assert.match(source, /invalidateHistoryIndex/);
    assert.match(source, /writeFile[\s\S]+?invalidateHistoryIndex\(\)/);
  }
});

test("card news invalidates after card sidecars and final manifest writes", () => {
  const source = readSource("lib/cardNewsGenerator.ts");
  assert.match(source, /await writeCardSidecar\([^)]+\);\s*invalidateHistoryIndex\(\);/s);
  assert.match(source, /await writeCardNewsManifest\([^)]+\);\s*invalidateHistoryIndex\(\);/s);
});

test("favorite toggles stay browser-scoped and do not rebuild the global history index", () => {
  const source = readSource("routes/history.ts");
  const favoriteRoute = source.slice(source.indexOf('app.post("/api/history/favorite"'));
  assert.match(favoriteRoute, /WHERE browser_id = \?/);
  assert.match(favoriteRoute, /invalidateFavoriteOverlay\(\)/);
  assert.doesNotMatch(favoriteRoute, /invalidateHistoryIndex\(\)/);
});

