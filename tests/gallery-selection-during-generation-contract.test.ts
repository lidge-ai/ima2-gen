import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoreBundle } from "./_storeBundle.mjs";

const root = process.cwd();

function readSource(path) {
  if (path === "ui/src/store/useAppStore.ts") return readStoreBundle();
  return readFileSync(join(root, path), "utf8");
}

test("manual gallery selection is tracked separately from generated history insertion", () => {
  const types = readSource("ui/src/store/storeTypes.ts");
  const store = readSource("ui/src/store/useAppStore.ts");
  const history = readSource("ui/src/store/storeHistoryImpl.ts");

  assert.match(types, /lastHistorySelectedAt: number;/);
  assert.match(store, /lastHistorySelectedAt: 0,/);
  assert.match(history, /const selectedAt = Date\.now\(\);/);
  assert.match(history, /lastHistorySelectedAt: selectedAt,/);
});

test("addHistory does not overwrite preview after a user selected another gallery item or sequence", () => {
  const graphSave = readSource("ui/src/store/storeGraphSave.ts");

  assert.match(graphSave, /type AddHistoryOptions = \{[\s\S]*?autoSelectStartedAt\?: number;/);
  assert.match(graphSave, /const userSelectedDuringGeneration =[\s\S]*?state\.lastHistorySelectedAt > options\.autoSelectStartedAt;/);
  assert.match(graphSave, /const shouldAutoSelect =[\s\S]*?!userSelectedDuringGeneration/);
  assert.match(graphSave, /state\.lastHistorySelectedAt <= options\.autoSelectStartedAt/);
  assert.match(graphSave, /if \(shouldAutoSelect\) \{[\s\S]*?saveSelectedFilename\(merged\.filename \?\? null\);[\s\S]*?\}/);
  assert.match(graphSave, /\.\.\.\(shouldAutoSelect \? \{ currentImage: merged \} : \{\}\)/);
  assert.doesNotMatch(graphSave, /saveSelectedFilename\(merged\.filename \?\? null\);\s*set\(\{\s*history,\s*currentImage: merged,/);
});

test("generation flows pass their start time into addHistory auto-select guards", () => {
  const gen = readSource("ui/src/store/storeGenImpl.ts");
  const video = readSource("ui/src/store/storeVideoImpl.ts");

  assert.match(gen, /const autoSelectStartedAt = startedAt;/);
  assert.match(gen, /addHistory\(item, set, get, \{ autoSelectStartedAt \}\)/);
  assert.match(video, /const autoSelectStartedAt = startedAt;/);
  assert.match(video, /addHistory\(videoItem, set, get, \{ autoSelectStartedAt \}\)/);
});
