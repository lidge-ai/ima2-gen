// The guard scripts/run-tests.mjs loads into every test process (tests/helpers/processGuard.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const guard = pathToFileURL(fileURLToPath(new URL("./helpers/processGuard.mjs", import.meta.url))).href;

function run(script: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", guard, "--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000, env: { ...process.env, ...env } });
  return { code: result.status, stderr: result.stderr };
}

const state = 'const state = (globalThis[Symbol.for("ima2.dbHandle")] ??= { open: null, opened: [] });';
const inTemp = JSON.stringify(join(tmpdir(), "ima2-guard-probe", "sessions.db"));

test("a process that leaves nothing behind exits cleanly", () => {
  assert.deepEqual(run(state + " state.opened.push(" + inTemp + ");"), { code: 0, stderr: "" });
  assert.deepEqual(run(""), { code: 0, stderr: "" });
});

test("an open SQLite handle at exit fails the file and says how to close it", () => {
  const result = run(state + " state.open = " + inTemp + "; state.opened.push(" + inTemp + ");");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[test process guard\] the SQLite handle is still open/);
  assert.match(result.stderr, /releaseDatabase/);
});

test("a running agent queue worker at exit fails the file: its timer reopens a closed database", () => {
  const result = run('globalThis[Symbol.for("ima2.agentQueueWorker")] = true;');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /agent queue worker is still running/);
});

test("a database opened outside the temp directory fails the file even when it was closed", () => {
  const real = JSON.stringify(join(fileURLToPath(new URL("..", import.meta.url)), "not-temp", "sessions.db"));
  const result = run(state + " state.opened.push(" + real + ");");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside the temp directory/);
});

test("a SQLite file the test opened itself and left open fails the file; closed or in-memory ones do not", () => {
  const open = (path: string, after: string) => 'import { createRequire } from "node:module"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";'
    + ' const Database = createRequire(' + JSON.stringify(import.meta.url) + ')("better-sqlite3"); const dir = mkdtempSync(join(tmpdir(), "ima2-guard-own-"));'
    + ' const db = new Database(' + path + '); db.exec("CREATE TABLE t (a)");' + after;
  const left = run(open('join(dir, "own.sqlite")', ""));
  assert.equal(left.code, 1);
  assert.match(left.stderr, /a SQLite file opened by the test is still open/);
  assert.deepEqual(run(open('join(dir, "own.sqlite")', ' db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });')), { code: 0, stderr: "" });
  assert.deepEqual(run(open('":memory:"', "")), { code: 0, stderr: "" });
});

test("the temp directory is recognised under either of its names: a link and its target, a Windows short path and its long one", () => {
  const opened = (path: string) => state + " state.opened.push(" + JSON.stringify(path) + ");";
  const real = realpathSync.native(mkdtempSync(join(tmpdir(), "ima2-guard-root-")));
  try {
    const db = (root: string) => join(root, "ima2-probe", "sessions.db");
    let other: string;
    if (process.platform === "win32") {
      // The 8.3 form GitHub's Windows runners use for TEMP (C:\Users\RUNNER~1\...).
      other = spawnSync("cmd", ["/d", "/c", "for %I in ("" + real + "") do @echo %~sI"], { encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
      assert.ok(other.length > 0, "the short path of the temp root");
    } else {
      other = real + "-link";
      symlinkSync(real, other, "dir");
    }
    const temp = (root: string) => ({ TMPDIR: root, TEMP: root, TMP: root });
    // TEMP names the directory one way and the database path the other, in both directions.
    assert.deepEqual(run(opened(db(real)), temp(other)), { code: 0, stderr: "" });
    assert.deepEqual(run(opened(db(other)), temp(real)), { code: 0, stderr: "" });
    // A path that is in neither is still refused.
    assert.equal(run(opened(join(fileURLToPath(new URL("..", import.meta.url)), "not-temp", "sessions.db")), temp(other)).code, 1);
    if (process.platform !== "win32") rmSync(other, { force: true, maxRetries: 10, retryDelay: 100 });
  } finally {
    rmSync(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a failing test keeps its own exit code", () => {
  assert.equal(run("process.exitCode = 3;").code, 3);
});

test("the runner loads the guard, and the code it watches publishes its state", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  assert.match(read("../scripts/run-tests.mjs"), /"--import", guard,/);
  assert.match(read("../lib/db.ts"), /Symbol\.for\("ima2\.dbHandle"\)/);
  assert.match(read("../lib/agentQueueWorker.ts"), /Symbol\.for\("ima2\.agentQueueWorker"\)/);
});

test("the handle state follows open and close, and the worker flag follows start and stop", async () => {
  await import("./helpers/isolatedConfig.ts");
  const { getDb, closeDb, getDbPath } = await import("../lib/db.ts");
  const handle = () => (globalThis as Record<symbol, unknown>)[Symbol.for("ima2.dbHandle")] as { open: string | null; opened: string[] };
  getDb();
  assert.equal(handle().open, getDbPath());
  assert.ok(handle().opened.includes(getDbPath()));
  closeDb();
  assert.equal(handle().open, null);
  const { ensureAgentQueueWorker, stopAgentQueueWorker } = await import("../lib/agentQueueWorker.ts");
  const running = () => (globalThis as Record<symbol, unknown>)[Symbol.for("ima2.agentQueueWorker")];
  ensureAgentQueueWorker({} as never);
  assert.equal(running(), true);
  // The worker's first tick already went to the database: this is what reopens a closed handle.
  assert.equal(handle().open, getDbPath());
  stopAgentQueueWorker();
  assert.equal(running(), undefined);
});
