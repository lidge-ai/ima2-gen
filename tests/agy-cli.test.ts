import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  agyCommandName,
  agyLocalBinCandidates,
  buildAgyPathEnv,
  resolveAgyBin,
} from "../lib/agyCli.ts";

test("agy command name follows platform conventions", () => {
  assert.equal(agyCommandName("linux"), "agy");
  assert.equal(agyCommandName("darwin"), "agy");
  assert.equal(agyCommandName("win32"), "agy.cmd");
});

test("resolveAgyBin honors explicit IMA2_AGY_BIN when file exists", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ima2-agy-bin-explicit-"));
  const customBin = join(tempDir, "agy");
  await writeFile(customBin, "#!/bin/sh\necho ok\n", { mode: 0o755 });

  try {
    assert.equal(
      resolveAgyBin({ IMA2_AGY_BIN: customBin, PATH: "" }, "/tmp/missing-home", "linux"),
      customBin,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("resolveAgyBin falls back to PATH when IMA2_AGY_BIN points to missing file", () => {
  assert.equal(
    resolveAgyBin({ IMA2_AGY_BIN: "/nonexistent/agy", PATH: "/usr/bin" }, "/tmp/missing-home", "linux"),
    "agy",
  );
});

test("resolveAgyBin falls back to ~/.local/bin when server PATH is minimal", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "ima2-agy-bin-test-"));
  const localBin = join(tempHome, ".local", "bin");
  const agyBin = join(localBin, agyCommandName("linux"));

  await mkdir(localBin, { recursive: true });
  await writeFile(agyBin, "#!/bin/sh\nprintf '1.0.10\\n'\n", { mode: 0o755 });
  await chmod(agyBin, 0o755);

  try {
    assert.deepEqual(agyLocalBinCandidates(tempHome, "linux")[0], agyBin);
    assert.equal(resolveAgyBin({ PATH: "/usr/bin" }, tempHome, "linux"), agyBin);
    assert.equal(
      buildAgyPathEnv({ PATH: "/usr/bin" }, agyBin),
      `${localBin}${delimiter}/usr/bin`,
    );
  } finally {
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("resolveAgyBin keeps PATH lookup when no local candidate exists", () => {
  assert.equal(resolveAgyBin({ PATH: "/usr/bin" }, "/tmp/missing-home", "linux"), "agy");
  assert.equal(buildAgyPathEnv({ PATH: "/usr/bin" }, "agy"), "/usr/bin");
});
