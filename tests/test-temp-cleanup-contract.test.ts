import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(?:[cm]?[jt]s)$/.test(name) ? [path] : [];
  });
}

// Windows keeps a just-closed SQLite file or a scanned temp file locked for a moment, and a
// bare recursive rm then fails a hook with EBUSY (main CI 36567549865, attempts 1 and 2).
// Node's rm retries only on EBUSY, EMFILE, ENFILE, ENOTEMPTY and EPERM, so maxRetries changes
// nothing for a passing run.
describe("test temp cleanup survives transient Windows locks", () => {
  // Built from pieces so this file does not match its own needle.
  const bare = ["{ recursive: true, ", "force: true }"].join("");

  it("never removes a temp tree without retries", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(testsDir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/\brm(?:Sync)?\(/.test(line) && line.includes(bare)) {
          offenders.push(relative(testsDir, file) + ":" + (index + 1));
        }
      });
    }
    assert.deepEqual(offenders, [], "add maxRetries/retryDelay to these rm calls");
  });

  it("keeps the hand-tuned retry sites tuned", () => {
    const tuned = [
      ["desktop-runtime-cli.test.ts", /maxRetries: 50, retryDelay: 200/],
      ["install-runtime-contract.test.ts", /maxRetries: 3, retryDelay: 50/],
      ["structured-filename-pipelines.test.ts", /maxRetries: 10, retryDelay: 100/],
      ["_executionRouteIsolation.ts", /maxRetries: 10, retryDelay: 100/],
    ] as const;
    for (const [file, pattern] of tuned) {
      assert.match(readFileSync(join(testsDir, file), "utf8"), pattern, file);
    }
  });
});
