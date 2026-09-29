import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Wp2 review finding 1: 'ima2 start --json' may rebuild ui/dist first; that
// build must not write to stdout, which carries exactly one JSON document.

test("a UI rebuild in JSON mode writes to stderr only", () => {
  const root = mkdtempSync(join(tmpdir(), "ima2-ui-json-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"console.log('BUILD-OUT')\"" } }));
    mkdirSync(join(root, "ui"));
    writeFileSync(join(root, "ui", "package.json"), "{}");
    // A file:// URL: a bare "D:\\..." path is not an ESM specifier on Windows.
    const script = `import { ensureFreshUiDist } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "bin/lib/ui-build.ts")).href)};
const r = ensureFreshUiDist(${JSON.stringify(root)}, { toStderr: true });
process.stderr.write("RESULT " + JSON.stringify(r) + "\\n");`;
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.stdout.trim(), "", "stdout stays empty");
    assert.match(run.stderr, /BUILD-OUT/);
    assert.match(run.stderr, /RESULT \{"ok":true,"built":true/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
