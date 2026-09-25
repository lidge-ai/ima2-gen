import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readStoreBundle } from "./_storeBundle.mjs";

const store = readStoreBundle();

describe("node generation concurrency lock contract", () => {
  it("declares a module-level lock for node generation calls", () => {
    assert.match(store, /const nodeGenerationLocks = new Set<string>\(\)/);
  });

  it("guards runGenerateNodeInPlace entry against concurrent calls", () => {
    const fn = /async function runGenerateNodeInPlaceImpl[\s\S]{0,600}/.exec(store)?.[0] ?? "";
    assert.match(fn, /if \(nodeGenerationLocks\.has\(clientId\)\) return null;/);
    assert.match(fn, /nodeGenerationLocks\.add\(clientId\);/);
  });

  it("releases the lock in finally so retries are still possible", () => {
    assert.match(store, /finally \{[^}]*nodeGenerationLocks\.delete\(clientId\)/s);
  });

  it("releases the lock on early bail paths (missing node, empty prompt, missing parent)", () => {
    // Each early-return path should clean the lock to avoid a stuck node.
    const earlyReleases = store.match(/nodeGenerationLocks\.delete\(clientId\);\s*\n\s*return null;/g) ?? [];
    assert.ok(earlyReleases.length >= 3, `expected >=3 early releases, got ${earlyReleases.length}`);
  });
});
