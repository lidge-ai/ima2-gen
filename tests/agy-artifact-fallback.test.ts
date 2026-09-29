import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink, utimes, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { isolateExecution } from "./_executionRouteIsolation.ts";
import { ownedFifo } from "./_agyArtifactFixture.ts";

if (executionTestProcess(import.meta.url)) {
let isolation: Awaited<ReturnType<typeof isolateExecution>>;
let findRecentAgyArtifact: typeof import("../lib/agyImageAdapter.ts").findRecentAgyArtifact;
before(async () => {
  isolation = await isolateExecution();
  ({ findRecentAgyArtifact } = await import("../lib/agyImageAdapter.ts"));
});
after(async () => { await isolation?.close(); });

test("findRecentAgyArtifact returns matching file within time window", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  const artifact = join(root, "ima2_generated_abc.png");
  const now = Date.now();
  await writeFile(artifact, "fake-png");
  await utimes(artifact, now / 1000, now / 1000);

  try {
    const result = await findRecentAgyArtifact(now - 1000, [root]);
    assert.equal(result, artifact);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact ignores files outside time window", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  const artifact = join(root, "ima2_generated_old.png");
  const staleTime = Date.now() - 60_000;
  await writeFile(artifact, "fake-png");
  await utimes(artifact, staleTime / 1000, staleTime / 1000);

  try {
    const result = await findRecentAgyArtifact(Date.now(), [root]);
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact ignores non-matching filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  await writeFile(join(root, "other_file.png"), "data");
  await writeFile(join(root, "ima2_generated.txt"), "data");

  try {
    const result = await findRecentAgyArtifact(Date.now() - 10_000, [root]);
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact finds files in subdirectories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  const sub = join(root, "sub", "deep");
  await mkdir(sub, { recursive: true });
  const artifact = join(sub, "ima2_generated_nested.webp");
  const now = Date.now();
  await writeFile(artifact, "fake-webp");
  await utimes(artifact, now / 1000, now / 1000);

  try {
    const result = await findRecentAgyArtifact(now - 1000, [root]);
    assert.equal(result, artifact);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact respects depth limit of 5", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  let dir = root;
  for (let i = 0; i < 7; i++) {
    dir = join(dir, `d${i}`);
  }
  await mkdir(dir, { recursive: true });
  const artifact = join(dir, "ima2_generated_deep.png");
  const now = Date.now();
  await writeFile(artifact, "fake");
  await utimes(artifact, now / 1000, now / 1000);

  try {
    const result = await findRecentAgyArtifact(now - 1000, [root]);
    assert.equal(result, null, "should not find files beyond depth 5");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact does not follow symlinks into directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  const external = await mkdtemp(join(tmpdir(), "ima2-external-"));
  const artifact = join(external, "ima2_generated_ext.png");
  const now = Date.now();
  await writeFile(artifact, "fake");
  await utimes(artifact, now / 1000, now / 1000);
  await symlink(external, join(root, "symlinked"), "dir");

  try {
    const result = await findRecentAgyArtifact(now - 1000, [root]);
    assert.equal(result, null, "should not follow symlinks");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(external, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact returns newest when multiple candidates exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-test-"));
  const now = Date.now();
  const older = join(root, "ima2_generated_old.png");
  const newer = join(root, "ima2_generated_new.jpg");
  await writeFile(older, "old");
  await utimes(older, (now - 3000) / 1000, (now - 3000) / 1000);
  await writeFile(newer, "new");
  await utimes(newer, now / 1000, now / 1000);

  try {
    const result = await findRecentAgyArtifact(now - 5000, [root]);
    assert.equal(result, newer, "should return the most recent file");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact excludes matching file symlinks without touching targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-leaf-"));
  const outside = await mkdtemp(join(tmpdir(), "ima2-artifact-outside-"));
  const target = join(outside, "sentinel.png"), link = join(root, "ima2_generated_link.png");
  const regular = join(root, "ima2_generated_regular.png");
  const now = Date.now();
  try {
    await writeFile(target, "outside sentinel"); await symlink(target, link, "file");
    assert.equal(await findRecentAgyArtifact(now - 1000, [root]), null);
    await writeFile(regular, "accepted regular");
    await utimes(regular, (now - 2000) / 1000, (now - 2000) / 1000);
    await utimes(target, now / 1000, now / 1000);
    assert.equal(await findRecentAgyArtifact(now - 3000, [root]), regular);
    assert.equal(await readFile(target, "utf8"), "outside sentinel");
    assert.equal(await readFile(regular, "utf8"), "accepted regular");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("findRecentAgyArtifact returns null for empty/missing directories", async () => {
  const result = await findRecentAgyArtifact(Date.now(), [join(isolation.rootDir, "does-not-exist-ima2-test")]);
  assert.equal(result, null);
});

test("findRecentAgyArtifact excludes matching nonregular entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-artifact-nonregular-"));
  try {
    const directory = join(root, "ima2_generated_directory.png"); await mkdir(directory);
    let fifo: string | undefined;
    if (process.platform !== "win32") fifo = await ownedFifo({ root, roots: [root] });
    assert.equal(await findRecentAgyArtifact(Date.now() - 1000, [root]), null);
    assert.equal((await lstat(directory)).isDirectory(), true);
    if (fifo) assert.equal((await lstat(fifo)).isFIFO(), true);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
}
