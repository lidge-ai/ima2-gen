// The test inventory (docs/migration/runtime-test-inventory.md) lists every test file. It carries no
// count: two pull requests that each add a test merge their list lines cleanly, while a count line
// regenerated on each branch came out one short after both merged and failed dev's inventory check.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/classify-tests.mjs", import.meta.url));
const inventory = "docs/migration/runtime-test-inventory.md";

function sandbox(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ima2-inventory-"));
  mkdirSync(join(root, "tests"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "tests", name), text);
  const run = (...flags: string[]) => spawnSync(process.execPath, [script, ...flags], { cwd: root, encoding: "utf8" });
  return { root, run, read: () => readFileSync(join(root, inventory), "utf8"), done: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const runtimeTest = 'import x from "../lib/x.ts";\n';

test("the inventory lists the files and states no count", () => {
  const box = sandbox({ "a.test.ts": runtimeTest, "b.test.ts": "" });
  try {
    assert.equal(box.run().status, 0);
    const text = box.read();
    assert.ok(text.includes("- `tests/a.test.ts`") && text.includes("- `tests/b.test.ts`"));
    assert.doesNotMatch(text, /Total|\d+ (?:runtime|contract)/i, "a count line is what two branches cannot both get right");
    const checked = box.run("--check");
    assert.equal(checked.status, 0);
    // The numbers are still reported, where they cannot go stale.
    assert.match(checked.stdout, /2 test files \(1 runtime, 1 contract\)/);
  } finally { box.done(); }
});

test("two branches that each add a test merge into an inventory that still passes the check", () => {
  const base = { "a.test.ts": runtimeTest, "m.test.ts": "" };
  const generate = (files: Record<string, string>) => { const box = sandbox(files); try { box.run(); return box.read().split("\n"); } finally { box.done(); } };
  const one = generate({ ...base, "c.test.ts": runtimeTest });
  const two = generate({ ...base, "z.test.ts": "" });
  const fresh = generate({ ...base, "c.test.ts": runtimeTest, "z.test.ts": "" });
  // A merge keeps every line either branch has. That is the whole regenerated file only when no line
  // depends on how many files there are.
  assert.deepEqual([...new Set([...one, ...two])].sort(), [...new Set(fresh)].sort());
  assert.ok(fresh.includes("- `tests/c.test.ts`") && fresh.includes("- `tests/z.test.ts`"));
});

test("a stale inventory names the files that are missing from it or no longer exist", () => {
  const box = sandbox({ "a.test.ts": runtimeTest });
  try {
    box.run();
    writeFileSync(join(box.root, "tests", "new.test.ts"), "");
    rmSync(join(box.root, "tests", "a.test.ts"));
    const checked = box.run("--check");
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /not listed: tests\/new\.test\.ts/);
    assert.match(checked.stderr, /listed but gone: tests\/a\.test\.ts/);
    assert.match(checked.stderr, /node scripts\/classify-tests\.mjs/);
  } finally { box.done(); }
});

test("the repository's inventory is current and carries no count", () => {
  const text = readFileSync(fileURLToPath(new URL("../" + inventory, import.meta.url)), "utf8");
  assert.doesNotMatch(text, /^Total:/m);
});
