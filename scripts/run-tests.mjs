#!/usr/bin/env node
// Cross-platform test runner. Avoids shell glob expansion differences
// between bash (linux/macos), pwsh (windows), and cmd.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Fails a test file that exits with the database still in use or opened outside the temp directory.
const guard = pathToFileURL(fileURLToPath(new URL("../tests/helpers/processGuard.mjs", import.meta.url))).href;

const testDir = "tests";
const files = readdirSync(testDir)
  .filter((f) => /\.test\.[cm]?[jt]s$/.test(f))
  .map((f) => join(testDir, f))
  .sort();

if (files.length === 0) {
  console.error(`No test files found in ${testDir}/`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--import", guard, "--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, IMA2_RESET_DISPATCH_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
