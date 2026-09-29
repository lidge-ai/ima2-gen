import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const CLI = ["--import", "tsx", "bin/ima2.ts", "vectorize"];

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [...CLI, ...args], { cwd: process.cwd() });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const typed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typed.code ?? 1, stdout: typed.stdout ?? "", stderr: typed.stderr ?? "" };
  }
}

test("traces a local file and reports machine-readable results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-vec-cli-"));
  try {
    const input = join(dir, "flat.png");
    const output = join(dir, "out.svg");
    await writeFile(input, await sharp({
      create: { width: 48, height: 48, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } },
    }).png().toBuffer());

    const { code, stdout } = await cli([input, "-o", output, "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.output, output);
    assert.equal(parsed.preset, "auto");
    assert.equal(parsed.width, 48);
    const svg = await readFile(output, "utf8");
    assert.ok(svg.startsWith("<svg"));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("validation errors exit 2 and runtime failures exit 1", async () => {
  // The repo convention (bin/lib/output.ts): die() for bad usage is 2, an
  // explicit runtime fail() is 1. A CLI that collapses both to 1 hides the
  // difference between 'you typed it wrong' and 'it broke'.
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(["/tmp/x.png", "--preset", "fancy"])).code, 2);
  assert.equal((await cli(["/tmp/x.png", "--color-precision", "99"])).code, 2);
  assert.equal((await cli(["/tmp/ima2-definitely-missing.png", "--json"])).code, 1);
});
