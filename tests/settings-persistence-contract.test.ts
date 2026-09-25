import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readStoreBundle } from "./_storeBundle.mjs";

const reg = readFileSync("ui/src/store/persistenceRegistry.ts", "utf8");
const store = readStoreBundle();

const KEY_RE = /["']ima2[.:][a-zA-Z0-9_.]+["']/g;
const usedInStore = new Set((store.match(KEY_RE) ?? []).map((s) => s.slice(1, -1)));
const declared = new Set((reg.match(KEY_RE) ?? []).map((s) => s.slice(1, -1)));

test("every ima2.* key used in the store is registered", () => {
  const missing = [...usedInStore].filter((k) => !declared.has(k));
  assert.deepEqual(missing, [], `Missing from persistenceRegistry: ${missing.join(", ")}`);
});

test("registry exports a frozen list", () => {
  assert.match(reg, /PERSISTED_KEYS\s*=\s*\[[\s\S]*\]\s*as const/);
  assert.match(reg, /PERSISTED_REGISTRY/);
});

test("known critical keys are present", () => {
  for (const k of [
    "ima2.generationDefaults",
    "ima2.imageModel",
    "ima2.reasoningEffort",
    "ima2.webSearchEnabled",
    "ima2.activeSessionId",
  ]) assert.ok(declared.has(k), `missing ${k}`);
});
