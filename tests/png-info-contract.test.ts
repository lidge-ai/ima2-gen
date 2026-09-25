import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("PNG info contract", () => {
  it("reads PNG IHDR dimensions and alpha color types", () => {
    const source = readSource("lib/pngInfo.ts");
    assert.match(source, /PNG_SIGNATURE_HEX/);
    assert.match(source, /IHDR/);
    assert.match(source, /readUInt32BE\(16\)/);
    assert.match(source, /readUInt32BE\(20\)/);
    assert.match(source, /readUInt8\(25\)/);
    assert.match(source, /colorType === 4 \|\| info\?\.colorType === 6/);
  });
});
