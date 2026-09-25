import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(path, "utf8");

test("key config mutations use a process-wide queue and unique temp names", () => {
  // The queue/atomic-write helper moved from routes/keys.ts to the shared owner so the
  // Prompt Builder config route can reuse it (devlog 260902_studio_surfaces/020).
  const keys = source("lib/configFileStore.ts");
  assert.match(keys, /let configMutationQueue: Promise<void>/);
  assert.match(keys, /serializeConfigMutation/);
  assert.match(keys, /randomBytes\(8\)\.toString\("hex"\)/);
  assert.match(keys, /existing = JSON\.parse\(await readFile\(cfgPath/);
});

test("extended video operations combine disconnect and deadline signals", () => {
  const video = source("routes/videoExtended.ts");
  const helpers = source("lib/videoExtendedHelpers.ts");
  assert.match(helpers, /AbortSignal\.any\(\[ac\.signal, AbortSignal\.timeout\(timeoutMs\)\]\)/);
  assert.match(video, /IMA2_VIDEO_EDIT_TIMEOUT_MS/);
  assert.match(video, /IMA2_VIDEO_EXTEND_TIMEOUT_MS/);
  assert.match(video, /IMA2_VIDEO_ANALYZE_TIMEOUT_MS/);
  assert.match(video, /pollVideoUntilDone\(ctx, request_id, \{ signal, credential \}\)/);
  assert.match(video, /\/v1\/responses[\s\S]+?signal,/);
});

test("history scans only publish snapshots from the current generation", () => {
  const history = source("lib/historyIndex.ts");
  assert.match(history, /let generation = 0/);
  assert.match(history, /scanGeneration === generation/);
  assert.match(history, /generation \+= 1/);
});

test("server error middleware hides internal messages and stack details", () => {
  const server = source("server.ts");
  assert.match(server, /message: operational \? info\.message : "Internal server error"/);
  assert.match(server, /code: operational && info\.code \? info\.code : "INTERNAL_ERROR"/);
  assert.doesNotMatch(server, /stack.*json/);
});
