// Source-level contract test for the startup ghost-video regression.
//
// Two independent causes produced a "data-less video" at ima2 startup:
//
// 1. tests/cli-video-command-contract.test.ts spawned the real CLI without an
//    isolated ima2 home, so default (no --out/--out-dir) video downloads fell
//    back to config.storage.generatedDir and wrote a 3-byte mock `out.mp4`
//    into the REAL ~/.ima2/generated. The history directory scan
//    (lib/historyList.ts) then listed it forever as a metadata-less video.
//
// 2. toPersistedInFlightJob() (ui/src/store/storeHelpers.ts) dropped the
//    server's `kind: "video"` because "video" was missing from its allowlist.
//    The job persisted to localStorage as kind:undefined, was treated as
//    "classic", fell out of the node+video polling scope after a restart, and
//    survived as an unremovable ghost inflight spinner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), "utf8");

test("toPersistedInFlightJob preserves the server-reported video kind", () => {
  const src = readSource("ui/src/store/storeHelpers.ts");
  assert.match(
    src,
    /job\.kind === "classic" \|\| job\.kind === "node" \|\| job\.kind === "multimode" \|\| job\.kind === "video"/,
    'toPersistedInFlightJob must accept job.kind === "video" so video jobs are not demoted to kind:undefined ghosts',
  );
  assert.match(
    src,
    /meta\.kind === "classic" \|\| meta\.kind === "node" \|\| meta\.kind === "multimode" \|\| meta\.kind === "video"/,
    'toPersistedInFlightJob must accept meta.kind === "video" for the meta fallback branch as well',
  );
});

test("loadInFlight keeps accepting persisted video-kind records", () => {
  const src = readSource("ui/src/store/storeHelpers.ts");
  assert.match(
    src,
    /x\.kind === "classic" \|\| x\.kind === "node" \|\| x\.kind === "multimode" \|\| x\.kind === "video"/,
    "loadInFlight must round-trip video kind from localStorage",
  );
});

test("video CLI contract tests pin an isolated ima2 home for spawned CLIs", () => {
  const src = readSource("tests/cli-video-command-contract.test.ts");
  assert.match(
    src,
    /IMA2_CONFIG_DIR:\s*ISOLATED_HOME/,
    "runCLI must pin IMA2_CONFIG_DIR to a temp dir so spawned CLIs never touch the real ~/.ima2",
  );
  assert.match(
    src,
    /IMA2_GENERATED_DIR:\s*ISOLATED_GENERATED/,
    "runCLI must pin IMA2_GENERATED_DIR too — it outranks IMA2_CONFIG_DIR in config.ts, so an inherited value would leak",
  );
});
