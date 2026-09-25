import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("history permanent delete contract", () => {
  it("keeps permanent delete route before the OS-trash route", () => {
    const routes = readSource("routes/history.ts");
    const permanentIndex = routes.indexOf('app.delete("/api/history/:filename/permanent"');
    const trashIndex = routes.indexOf('app.delete("/api/history/:filename"');

    assert.ok(permanentIndex >= 0, "permanent delete route missing");
    assert.ok(trashIndex >= 0, "OS-trash delete route missing");
    assert.ok(permanentIndex < trashIndex, "permanent route should be registered before generic OS-trash route");
    assert.match(routes, /trashAsset\(ctx\.rootDir,\s*filename\)/);
    assert.match(routes, /deleteAssetPermanent\(ctx\.rootDir,\s*filename\)/);
    assert.match(routes, /res\.status\(err\.status \|\| 500\)\.json\(\{ error: err\.message, code: err\.code \}\)/);
  });

  it("soft delete moves existing asset to OS trash with internal fallback", () => {
    const lifecycle = readSource("lib/assetLifecycle.ts");
    const systemTrash = readSource("lib/systemTrash.ts");
    const fn = /export async function trashAsset[\s\S]*?(?=\nexport async function )/.exec(lifecycle)?.[0] ?? "";

    assert.match(fn, /resolveInGenerated\(rootDir,\s*filename\)/);
    assert.match(fn, /await assertRegularGeneratedPath\(src\)/);
    assert.match(fn, /err\.status = 404/);
    assert.match(fn, /err\.code = "ASSET_NOT_FOUND"/);
    assert.match(fn, /const sidecar = `\$\{src\}\.json`/);
    assert.match(fn, /paths\.push\(sidecar\)/);
    assert.match(fn, /await moveToSystemTrash\(paths\)/);
    // Fallback: internal trash via rename when system trash fails
    assert.match(fn, /trashMethod/);
    assert.match(fn, /await rename\(p, dest\)/);
    assert.match(fn, /markNodesAssetMissing\(filename\)/);
    assert.match(fn, /trash:\s*trashMethod/);
    assert.match(fn, /undoableInApp:\s*false/);
    assert.doesNotMatch(fn, /setTimeout/);

    assert.match(systemTrash, /import trash from "trash"/);
    assert.match(systemTrash, /IMA2_TEST_SYSTEM_TRASH_FAIL/);
    assert.match(systemTrash, /trash\(paths,\s*\{\s*glob:\s*false\s*\}\)/);
  });

  it("permanent delete helper preserves path safety, 404 codes, sidecar cleanup, and node marking", () => {
    const lifecycle = readSource("lib/assetLifecycle.ts");
    const fn = /export async function deleteAssetPermanent[\s\S]*?(?=\nexport async function )/.exec(lifecycle)?.[0] ?? "";

    assert.match(fn, /resolveInGenerated\(rootDir,\s*filename\)/);
    assert.match(fn, /await assertRegularGeneratedPath\(src\)/);
    assert.match(fn, /err\.status = 404/);
    assert.match(fn, /err\.code = "ASSET_NOT_FOUND"/);
    assert.match(fn, /await unlink\(src\)/);
    assert.match(fn, /await assertRegularGeneratedPath\(sidecar\)/);
    assert.match(fn, /await unlink\(sidecar\)/);
    assert.match(fn, /markNodesAssetMissing\(filename\)/);
    assert.match(fn, /sessionsTouched/);
    assert.match(fn, /nodesTouched/);
  });

  it("client API exposes permanent delete separately from trash delete", () => {
    const api = readSource("ui/src/lib/api.ts");

    assert.match(api, /export function deleteHistoryItem/);
    assert.match(api, /export function permanentlyDeleteHistoryItem/);
    assert.match(api, /`\/api\/history\/\$\{encodeURIComponent\(filename\)\}\/permanent`/);
    assert.match(api, /method:\s*"DELETE"/);
  });

  it("client delete refuses orphan hidden canvas versions instead of deleting their hidden files", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const trashFn = /export async function trashHistoryItemImpl[\s\S]*?\n\}/.exec(store)?.[0] ?? "";
    const permanentFn =
      /export async function permanentlyDeleteHistoryItemImpl[\s\S]*?\n\}/.exec(store)?.[0] ?? "";

    assert.match(trashFn, /const target = item\.canvasVersion \? resolveVisibleShortcutCurrent\(get\(\)\.history,\s*item\) : item/);
    assert.match(trashFn, /if \(!target \|\| target\.canvasVersion \|\| !target\.filename\)/);
    assert.match(trashFn, /gallery\.deleteFailed/);
    assert.doesNotMatch(trashFn, /\?\? item/);

    assert.match(permanentFn, /const target = item\.canvasVersion \? resolveVisibleShortcutCurrent\(get\(\)\.history,\s*item\) : item/);
    assert.match(permanentFn, /if \(!target \|\| target\.canvasVersion \|\| !target\.filename\)/);
    assert.match(permanentFn, /gallery\.deleteFailed/);
    assert.doesNotMatch(permanentFn, /\?\? item/);
  });
});
