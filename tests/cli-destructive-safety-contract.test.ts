import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI destructive safety contract", () => {
  it("centralizes destructive confirmation for reset and config rm", () => {
    const helper = readSource("bin/lib/destructive-confirm.ts");
    const ima2 = readSource("bin/ima2.ts");
    const config = readSource("bin/commands/config.ts");

    assert.match(helper, /confirmDestructiveAction/);
    assert.match(helper, /requires --yes in non-interactive mode/);
    assert.match(ima2, /Reset all ima2 config/);
    assert.match(ima2, /confirmDestructiveAction/);
    assert.match(config, /Remove config key/);
    assert.match(config, /confirmDestructiveAction/);
  });
});
