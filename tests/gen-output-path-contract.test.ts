import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("gen output path resolution (#170)", () => {
  it("resolves a relative --out against --out-dir instead of dropping it", () => {
    const src = read("bin/commands/gen.ts");
    // The bug was a ternary that took --out and never consulted --out-dir, so a
    // relative name silently landed in the process cwd.
    assert.match(src, /function resolveOutTarget\(out: string, outDir: string \| null\): string/);
    assert.match(src, /if \(!outDir \|\| isAbsolute\(out\)\) return out;/);
    assert.match(src, /return join\(outDir, out\);/);
    // Both save paths must go through it: the core lane and the MCP lane.
    assert.match(src, /target = resolveOutTarget\(context\.explicitOut, context\.outDir\)/);
    assert.match(src, /resolveOutTarget\(String\(args\.out\), args\["out-dir"\]/);
  });

  it("prints the absolute saved path so a misplaced file is visible", () => {
    const src = read("bin/commands/gen.ts");
    assert.match(src, /function displayPath\(target: string\): string/);
    // The success line is built by savedLine now (#173 added the pixel size and
    // the drift warning), but it still leads with the absolute path.
    assert.match(src, /color\.green\("✓ "\) \+ displayPath\(path\)/);
  });

  it("applies the same rule when recovering outputs after a stream drop", () => {
    const src = read("bin/lib/recover-output.ts");
    assert.match(src, /target\.outDir && !isAbsolute\(target\.explicitOut\)/);
  });
});
