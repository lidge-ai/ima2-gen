import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "ima2-sprite-store-"));
process.env.IMA2_CONFIG_DIR = dir; process.env.IMA2_DB_PATH = join(dir, "db.sqlite");
const { closeDb, getDb } = await import("../lib/db.ts");
const { spriteRecipeStore } = await import("../lib/spriteRecipeStore.ts");
const { normalizeSpriteRecipe } = await import("../lib/spriteRecipeSchema.ts");
after(() => { closeDb(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
const definition = { version: 1, character: { id: "hero", description: "blue knight", baseAssetId: null }, cell: { width: 64, height: 64, safeMarginX: 4, safeMarginY: 4 }, chromaKey: { name: "green", hex: "#00FF00", rgb: [0, 255, 0] }, states: [{ key: "idle", frames: 4, fps: 12, loop: true, action: "breathe" }], style: "pixel art" };
describe("sprite recipe schema and store", () => {
  it("normalizes defaults and rejects duplicate states and chroma mismatch", () => { assert.equal(normalizeSpriteRecipe(definition).version, 1); assert.throws(() => normalizeSpriteRecipe({ ...definition, states: [...definition.states, definition.states[0]] }), (error: any) => error.code === "INVALID_SPRITE_RECIPE"); assert.throws(() => normalizeSpriteRecipe({ ...definition, chromaKey: { ...definition.chromaKey, hex: "#FFFFFF" } }), /hex and rgb/); });
  it("creates, updates state rows transactionally, lists, and cascades delete", async () => { const created = await spriteRecipeStore.create({ name: "Hero", recipe: definition }); assert.deepEqual(created.rows.map((row) => row.stateKey), ["idle"]); const updated = await spriteRecipeStore.update(created.id, { recipe: { ...definition, states: [{ ...definition.states[0], key: "walk" }] } }); assert.deepEqual(updated.rows.map((row) => row.stateKey), ["walk"]); assert.equal((await spriteRecipeStore.list())[0].id, created.id); await spriteRecipeStore.remove(created.id); const count = getDb().prepare("SELECT count(*) count FROM sprite_recipe_rows").get() as { count: number }; assert.equal(count.count, 0); });
  it("isolates malformed stored JSON", async () => { const created = await spriteRecipeStore.create({ name: "Bad later", recipe: definition }); getDb().prepare("UPDATE sprite_recipes SET recipe='{' WHERE id=?").run(created.id); await assert.rejects(spriteRecipeStore.get(created.id), (error: any) => error.code === "SPRITE_RECIPE_STORE_ERROR"); });
  // The superRefine guards below had no coverage, so a zod major could have
  // silently stopped firing them. Each one asserts the message, not just the
  // throw, because a schema that rejects for the wrong reason is still broken.
  it("rejects a safe margin that meets or passes half the cell", () => {
    assert.throws(() => normalizeSpriteRecipe({ ...definition, cell: { width: 64, height: 64, safeMarginX: 32, safeMarginY: 4 } }), /safeMarginX must be less than half the cell width/);
    assert.throws(() => normalizeSpriteRecipe({ ...definition, cell: { width: 64, height: 64, safeMarginX: 4, safeMarginY: 32 } }), /safeMarginY must be less than half the cell height/);
  });
  it("caps the guide sheet below the 100MP guard by construction", () => {
    // The schema's 100MP superRefine cannot fire: frames maxes at 12 and each
    // cell edge at 2048, so the largest legal sheet is 12*2048*2048 = 50331648,
    // half the threshold. The guard is dead weight in this schema - the live
    // one is assertSpriteGuideGeometry, which takes an unclamped frame count
    // (see sprite-layout-guide.test.ts driving it with 25). Assert the bound
    // instead of the branch, so shrinking the limits here fails loudly.
    const maxSheet = normalizeSpriteRecipe({ ...definition, cell: { width: 2048, height: 2048, safeMarginX: 4, safeMarginY: 4 }, states: [{ ...definition.states[0], frames: 12 }] });
    const pixels = maxSheet.states[0]!.frames * maxSheet.cell.width * maxSheet.cell.height;
    assert.equal(pixels, 50_331_648);
    assert.ok(pixels < 100_000_000, "schema limits must stay under the 100MP guard");
    // And the input bounds that make that true.
    assert.throws(() => normalizeSpriteRecipe({ ...definition, states: [{ ...definition.states[0], frames: 13 }] }));
    assert.throws(() => normalizeSpriteRecipe({ ...definition, cell: { width: 2049, height: 64, safeMarginX: 4, safeMarginY: 4 } }));
  });
  it("keeps the chroma hex and rgb pair in agreement", () => {
    assert.throws(() => normalizeSpriteRecipe({ ...definition, chromaKey: { name: "green", hex: "#00FF01", rgb: [0, 255, 0] } }), /hex and rgb chroma values must match/);
    assert.equal(normalizeSpriteRecipe({ ...definition, chromaKey: { name: "green", hex: "#00ff00", rgb: [0, 255, 0] } }).chromaKey.hex, "#00FF00");
  });
});
