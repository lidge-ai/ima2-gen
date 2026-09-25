import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gen = readFileSync("bin/commands/gen.ts", "utf-8");
const edit = readFileSync("bin/commands/edit.ts", "utf-8");

test("CLI generation defaults save into configured generatedDir, not cwd", () => {
  assert.match(gen, /import \{ config \} from "\.\.\/\.\.\/config\.js"/);
  assert.match(gen, /target = `\$\{config\.storage\.generatedDir\}\/\$\{defaultOutName\(i,\s*norm\.images\.length\)\}`/);
  assert.doesNotMatch(gen, /else \{\s*target = defaultOutName\(i,\s*norm\.images\.length\);\s*\}/);
});

test("CLI edit defaults save into configured generatedDir, not cwd", () => {
  assert.match(edit, /import \{ config \} from "\.\.\/\.\.\/config\.js"/);
  assert.match(edit, /const explicitOut = args\.out \? String\(args\.out\) : null/);
  assert.match(edit, /const target = explicitOut \|\| `\$\{config\.storage\.generatedDir\}\/\$\{defaultOutName\(0,\s*1\)\}`/);
  assert.doesNotMatch(edit, /const target = args\.out \|\| defaultOutName\(0,\s*1\)/);
});
