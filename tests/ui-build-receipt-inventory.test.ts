import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inventoryUiOutputs, inventoryUiSourceInputs, readUiSourceSnapshot } from "../scripts/lib/uiBuildReceipt.mjs";
import { receiptFixture } from "./_uiBuildReceiptFixture.mjs";

test("output inventory includes hidden/public files and excludes only root receipt", async () => {
  const f = await receiptFixture();
  try {
    await f.put("ui/dist/.ima2-ui-build-receipt.json", "not part of inventory");
    const files = await inventoryUiOutputs(f.dist);
    assert.deepEqual(files.map((file) => file.path), [".vite/manifest.json", "assets/entry.js", "fonts/fixture.woff2", "index.html"]);
    const font = files.find((file) => file.path === "fonts/fixture.woff2");
    assert.equal(font.bytes, 9); assert.equal(font.sha256, createHash("sha256").update("fontbytes").digest("hex"));
    await f.put("ui/dist/.extra", "visible to receipt");
    assert.equal((await inventoryUiOutputs(f.dist)).length, 5);
    await unlink(join(f.dist, "index.html"));
    await assert.rejects(inventoryUiOutputs(f.dist), { code: "UI_RECEIPT_OUTPUT" });
  } finally { await f.close(); }
});

test("input inventory sees new files and split receipt modules but refuses dotenv and links", async () => {
  const f = await receiptFixture();
  try {
    const first = await readUiSourceSnapshot(f.root);
    assert.equal(first.headSha, null);
    assert.ok((await inventoryUiSourceInputs(f.root)).some((row) => row.path === "scripts/lib/uiBuildReceiptTransaction.mjs"));
    await f.put("ui/src/new.ts", "new input");
    assert.notEqual((await readUiSourceSnapshot(f.root)).sourceInputDigest, first.sourceInputDigest);
    await f.put("ui/.env.production", "synthetic-only");
    await assert.rejects(inventoryUiSourceInputs(f.root), { code: "UI_RECEIPT_ENV" });
    await unlink(join(f.root, "ui/.env.production"));
    await symlink(join(f.root, "ui/src/entry.ts"), join(f.root, "ui/src/link.ts"));
    await assert.rejects(inventoryUiSourceInputs(f.root), { code: "UI_RECEIPT_PATH" });
  } finally { await f.close(); }
});

test("output inventory rejects symlinks and case-colliding enumerated paths", async (t) => {
  const f = await receiptFixture();
  try {
    await symlink(join(f.dist, "index.html"), join(f.dist, "linked.html"));
    await assert.rejects(inventoryUiOutputs(f.dist), { code: "UI_RECEIPT_PATH" });
    await unlink(join(f.dist, "linked.html"));
    // Simulate a case-sensitive directory on a host that cannot create both names.
    await f.put("ui/dist/duplicate", "x");
    const canonicalDist = await fs.realpath(f.dist);
    let injected = 0;
    const nativeReadDir = fs.readdir;
    t.mock.method(fs, "readdir", async (...args) => {
      const names = await (nativeReadDir as any)(...args);
      if (args[0] !== canonicalDist) return names;
      injected++; return [...names, "DUPLICATE"];
    });
    const nativeLstat = fs.lstat;
    t.mock.method(fs, "lstat", (...args) => nativeLstat(args[0] === join(canonicalDist, "DUPLICATE") ? join(canonicalDist, "duplicate") : args[0], ...args.slice(1)));
    const { syncBuiltinESMExports } = await import("node:module"); syncBuiltinESMExports();
    await assert.rejects(inventoryUiOutputs(f.dist), { code: "UI_RECEIPT_PATH" });
    assert.equal(injected, 1, "case-sensitive inventory branch actually fired");
  } finally {
    t.mock.restoreAll();
    const { syncBuiltinESMExports } = await import("node:module"); syncBuiltinESMExports();
    await f.close();
  }
});
