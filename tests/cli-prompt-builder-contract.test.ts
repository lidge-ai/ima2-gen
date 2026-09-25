import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI prompt builder contract", () => {
  it("prompt.ts help includes build subcommand", () => {
    const src = readSource("bin/commands/prompt.ts");
    assert.match(src, /build --message/);
    assert.match(src, /build --messages/);
  });

  it("prompt.ts SUB map includes build handler", () => {
    const src = readSource("bin/commands/prompt.ts");
    assert.match(src, /build:\s*buildSub/);
  });

  it("build handler dynamically imports from prompt-sub/build", () => {
    const src = readSource("bin/commands/prompt.ts");
    assert.match(src, /import\(["']\.\/prompt-sub\/build\.js["']\)/);
  });

  it("prompt-sub/build.ts exists and has default export", () => {
    assert.ok(existsSync("bin/commands/prompt-sub/build.ts"));
    const src = readSource("bin/commands/prompt-sub/build.ts");
    assert.match(src, /export default async function buildSub/);
  });

  it("build command calls /api/prompt-builder/chat", () => {
    const src = readSource("bin/commands/prompt-sub/build.ts");
    assert.match(src, /\/api\/prompt-builder\/chat/);
    assert.match(src, /method:\s*["']POST["']/);
  });

  it("build command requires --message or --messages", () => {
    const src = readSource("bin/commands/prompt-sub/build.ts");
    assert.match(src, /--message or --messages required/);
  });

  it("build command supports --json output", () => {
    const src = readSource("bin/commands/prompt-sub/build.ts");
    assert.match(src, /args\.json/);
    assert.match(src, /json\(result\)/);
  });

  it("build command supports --model flag", () => {
    const src = readSource("bin/commands/prompt-sub/build.ts");
    assert.match(src, /model:\s*\{\s*type:\s*["']string["']/);
    assert.match(src, /body\.model\s*=\s*args\.model/);
  });

  it("capabilities.ts includes promptBuilder block", () => {
    const src = readSource("lib/capabilities.ts");
    assert.match(src, /promptBuilder:\s*\{/);
    assert.match(src, /route:\s*["']\/api\/prompt-builder\/chat["']/);
    assert.match(src, /cliCommand:\s*["']ima2 prompt build["']/);
  });

  it("capabilities guidance includes prompt builder note", () => {
    const src = readSource("lib/capabilities.ts");
    assert.match(src, /guidance[\s\S]*promptBuilder:/);
    assert.match(src, /ima2 prompt build/);
  });

  it("prompt.ts stays under 500 lines", () => {
    const src = readSource("bin/commands/prompt.ts");
    const lines = src.split("\n").length;
    assert.ok(lines < 500, `prompt.ts is ${lines} lines, must be under 500`);
  });
});
