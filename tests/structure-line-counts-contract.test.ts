import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

describe("structure line counts contract", () => {
  it("structure/01-file-function-map.md matches live lib/* and bin/commands/* counts", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/refresh-structure-line-counts.mjs", "--check"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    if (result.status !== 0) {
      assert.fail(
        `Line count drift detected:\n${result.stderr || result.stdout}`,
      );
    }
  });
});
