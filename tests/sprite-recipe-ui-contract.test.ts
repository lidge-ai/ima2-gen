import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("sprite recipe API declares encoded CRUD and async generation contracts", async () => {
  const source = await read("ui/src/lib/api-sprite-recipes.ts");
  for (const method of ["listSpriteRecipes", "getSpriteRecipe", "createSpriteRecipe", "updateSpriteRecipe", "deleteSpriteRecipe", "approveSpriteAnchor", "generateSpriteRows"]) assert.match(source, new RegExp(`export const ${method}`));
  assert.match(source, /encodeURIComponent\(id\)/);
  assert.match(source, /async: true/);
  assert.match(source, /anchor\/approve/);
});

test("workspace exposes accessible workflow tabs and lazy sprite loading", async () => {
  const source = await read("ui/src/components/assetgen/AssetGenWorkspace.tsx");
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /lazy\(\(\) => import\("\.\/SpriteRecipeWorkspace"\)/);
});

test("sprite UI covers loading, error, anchor confirmation, and live rows", async () => {
  const [workspace, anchor, rows] = await Promise.all([read("ui/src/components/assetgen/SpriteRecipeWorkspace.tsx"), read("ui/src/components/assetgen/SpriteAnchorGate.tsx"), read("ui/src/components/assetgen/SpriteRowList.tsx")]);
  assert.match(workspace, /role="status"/); assert.match(workspace, /role="alert"/);
  assert.match(anchor, /role="dialog"/); assert.match(anchor, /aria-modal="true"/);
  assert.match(rows, /aria-live="polite"/); assert.match(rows, /<progress/);
});

test("sprite store subscribes before generation POST", async () => {
  const source = await read("ui/src/store/storeSpriteRecipeImpl.ts");
  const watchAt = source.indexOf("watch(requestId, set, get)");
  const postAt = source.indexOf("await generateSpriteRows(id");
  assert.ok(watchAt >= 0 && postAt > watchAt);
  assert.match(source, /finally \{ set\(\{ spriteRecipeSaving: false \}\)/);
});
