import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const installerPaths = [
  join(process.cwd(), "scripts", "install-windows.ps1"),
  join(process.cwd(), "site", "public", "install-windows.ps1"),
];

test("Windows installers use PowerShell 5.1-safe npm handling", () => {
  for (const installerPath of installerPaths) {
    const script = readFileSync(installerPath, "utf8");

    assert.doesNotMatch(script, /\.package-lock\.json|Remove-Item/, `${installerPath} must not delete npm lockfiles`);
    assert.doesNotMatch(script, /Stop-Process|npm cache clean|sudo/, `${installerPath} must not perform collateral cleanup or privilege retries`);
    assert.match(script, /function Invoke-Npm/, `${installerPath} should isolate native npm invocation`);
    assert.match(
      script,
      /\$ErrorActionPreference = 'Continue'/,
      `${installerPath} should allow npm warnings to be captured without aborting the installer`,
    );
    assert.match(script, /\$installResult\.ExitCode -ne 0/, `${installerPath} should check npm's exit code`);
    assert.match(script, /doctor --installation --json/, `${installerPath} should run the offline doctor before launch`);
    assert.match(script, /runtime-contract:generated:start/);
    const engine = JSON.parse(readFileSync("package.json", "utf8")).engines.node;
    assert.match(script, new RegExp(`\\$MIN_NODE = ${engine.match(/\d+/)[0]}`));
  }
});

test("published and source Windows installers stay in sync", () => {
  const [source, published] = installerPaths.map((path) => readFileSync(path, "utf8"));
  assert.equal(published, source);
});
