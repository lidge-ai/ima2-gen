import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI config key discovery contract", () => {
  it("shares writable keys and env override names with capabilities", () => {
    const shared = readSource("lib/configKeys.ts");
    const caps = readSource("lib/capabilities.ts");

    assert.match(shared, /WRITABLE_CONFIG_KEYS/);
    assert.match(shared, /KEY_TO_ENV/);
    assert.match(caps, /configKeys:/);
    assert.match(caps, /writable:\s*toArray\(WRITABLE_CONFIG_KEYS\)/);
    assert.match(caps, /envOverrides:\s*\{\s*\.\.\.KEY_TO_ENV\s*\}/);
  });

  it("adds ima2 config keys for agents", () => {
    const src = readSource("bin/commands/config.ts");

    assert.match(src, /keys \[--json\]/);
    assert.match(src, /keysSub/);
    assert.match(src, /WRITABLE_CONFIG_KEYS/);
    assert.match(src, /KEY_TO_ENV/);
  });
});
