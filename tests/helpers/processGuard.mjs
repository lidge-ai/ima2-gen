// Loaded into every test process by scripts/run-tests.mjs (--import). It changes nothing while a
// test runs; when the process exits it fails the file if the database was left in a state that
// breaks cleanup or touches a real profile:
//
//  - the SQLite handle is still open. sessions.db and its -wal/-shm files stay in use, so on
//    Windows removing the config directory fails with EBUSY;
//  - the agent queue worker is still ticking. Its timer calls into the database every 1.5 s and
//    reopens a handle that closeDb() just closed, which is the same EBUSY a moment later;
//  - a database was opened outside the system temp directory, which means the test ran against
//    a real config directory instead of an isolated one.
//
// lib/db.ts and lib/agentQueueWorker.ts publish that state on globalThis; this file only reads it.
//
// Tests that open SQLite files themselves (not through lib/db) are covered too: every handle that is
// used is remembered here, and one that is still open at exit fails the file the same way.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

function inside(root, path) {
  const base = resolve(root).toLowerCase();
  const target = resolve(path).toLowerCase();
  return target === base || target.startsWith(base + sep);
}

// The temp roots are read once, at load: a test may point TEMP elsewhere later. On Windows
// tmpdir() can be the 8.3 short form (C:\Users\RUNNER~1\...) while databases are opened by
// their long path; only the native realpath expands it.
const tempRoots = [tmpdir()];
for (const expand of [realpathSync, realpathSync.native]) {
  try { tempRoots.push(expand(tmpdir())); } catch { /* the plain path is enough */ }
}

/**
 * The path with its nearest existing folder spelled the way the system does (links followed, a Windows
 * short name expanded). The database file itself is usually gone by the time the process exits.
 */
function expanded(path) {
  let folder = resolve(path);
  const rest = [];
  for (;;) {
    try { return join(realpathSync.native(folder), ...rest); } catch { /* try the parent */ }
    const parent = dirname(folder);
    if (parent === folder) return path;
    rest.unshift(basename(folder));
    folder = parent;
  }
}

function isTemp(path) {
  if (path === ":memory:") return true;
  // Either side can be the other spelling: the temp root (handled at load) or the opened path.
  return [path, expanded(path)].some((candidate) => tempRoots.some((root) => inside(root, candidate)));
}

/** Every better-sqlite3 handle this process used, whoever opened it. */
const handles = new Set();
try {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  for (const method of ["prepare", "exec", "pragma", "transaction"]) {
    const original = Database.prototype[method];
    Database.prototype[method] = function tracked(...args) { handles.add(this); return original.apply(this, args); };
  }
} catch { /* without the native module no handle can be open */ }

process.on("exit", () => {
  const handle = globalThis[Symbol.for("ima2.dbHandle")];
  const problems = [];
  if (handle?.open) problems.push("the SQLite handle is still open (" + handle.open + "). Close it in an after() hook before the config directory is removed: await releaseDatabase() from tests/helpers/releaseDatabase.ts");
  if (globalThis[Symbol.for("ima2.agentQueueWorker")]) problems.push("the agent queue worker is still running; its timer reopens the database after closeDb(). Stop it first: await releaseDatabase() from tests/helpers/releaseDatabase.ts");
  for (const database of handles) {
    if (database.open && !database.memory && database.name !== handle?.open) problems.push("a SQLite file opened by the test is still open (" + database.name + "): close it before its directory is removed");
  }
  for (const path of new Set(handle?.opened ?? [])) {
    if (!isTemp(path)) problems.push("a database outside the temp directory was opened (" + path + "). Give the test its own config directory: import \"./helpers/isolatedConfig.ts\" first");
  }
  if (problems.length === 0) return;
  for (const problem of problems) console.error("[test process guard] " + problem);
  process.exitCode = 1;
});
