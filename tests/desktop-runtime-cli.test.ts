import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatus, parseStop, runBundledCli } from "../desktop/lib/runtime-cli.mjs";
import { desktopRuntimeEnv } from "../desktop/lib/runtime-env.mjs";

const FULL = { manager: { state: "absent" }, serviceOwnership: "unmanaged", stoppable: false };
const status = (liveness: string, extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "ima2-status/1", liveness, runtime: liveness === "live" ? { pid: 5, url: "http://127.0.0.1:1" } : null, ...FULL, ...extra });

describe("bundled CLI answers", () => {
  it("accepts a status only when its exit code matches its liveness", () => {
    assert.equal(parseStatus({ code: 0, stdout: status("live"), stderr: "" }).ok, true);
    assert.equal(parseStatus({ code: 3, stdout: status("absent-proven"), stderr: "" }).ok, true);
    assert.equal(parseStatus({ code: 1, stdout: status("unknown"), stderr: "" }).ok, true);
    assert.equal(parseStatus({ code: 0, stdout: status("absent-proven"), stderr: "" }).ok, false);
    assert.equal(parseStatus({ code: 0, stdout: "garbage", stderr: "" }).ok, false);
    assert.equal(parseStatus({ code: 0, stdout: JSON.stringify({ schema: "ima2-status/2", liveness: "live" }), stderr: "" }).ok, false);
    assert.match(parseStatus({ code: null, stdout: "", stderr: "", error: "timed out" }).reason, /timed out/);
  });

  it("rejects an incomplete answer instead of deciding from it", () => {
    // Review finding: exit 3 with only schema + liveness must not authorise a spawn.
    assert.equal(parseStatus({ code: 3, stdout: JSON.stringify({ schema: "ima2-status/1", liveness: "absent-proven" }), stderr: "" }).ok, false);
    assert.equal(parseStatus({ code: 0, stdout: status("live", { runtime: { url: "x" } }), stderr: "" }).ok, false);
    assert.equal(parseStatus({ code: 3, stdout: status("absent-proven", { manager: { state: "bound" } }), stderr: "" }).ok, false);
  });

  it("accepts a stop only when the report and exit code agree", () => {
    const doc = (ok: boolean) => JSON.stringify({ schema: "ima2-stop/1", ok, runtimeDown: ok });
    assert.equal(parseStop({ code: 0, stdout: doc(true), stderr: "" }).ok, true);
    assert.equal(parseStop({ code: 1, stdout: doc(false), stderr: "" }).ok, true);
    assert.equal(parseStop({ code: 0, stdout: doc(false), stderr: "" }).ok, false);
  });
});

describe("runBundledCli", () => {
  it("runs bin/ima2.js with the desktop's port and config dir, and honours the timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "ima2-bundled-cli-"));
    try {
      mkdirSync(join(root, "bin"));
      writeFileSync(join(root, "bin", "ima2.js"), "if (process.argv.includes('hang')) setInterval(() => {}, 1000); else console.log(JSON.stringify({ port: process.env.IMA2_PORT, dir: process.env.IMA2_CONFIG_DIR, desktop: process.env.IMA2_DESKTOP ?? null }));");
      const env = desktopRuntimeEnv({ port: 4555, configDir: "/tmp/ima2-custom" }, { base: { PATH: process.env.PATH, IMA2_DESKTOP: "1" } });
      const command = { bin: process.execPath, env: {} };
      const ok = await runBundledCli({ rootDir: root, args: ["status"], env, command });
      assert.equal(ok.code, 0);
      assert.deepEqual(JSON.parse(ok.stdout), { port: "4555", dir: "/tmp/ima2-custom", desktop: null });
      const slow = await runBundledCli({ rootDir: root, args: ["hang"], env, command, timeoutMs: 300 });
      assert.equal(slow.code, null);
      assert.match(slow.error, /timed out/);
    } finally {
      // On Windows the killed "hang" child can hold the directory for a moment.
      rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
    }
  });

  it("gives the server child the desktop marker and a fresh boot id", () => {
    const a = desktopRuntimeEnv({ port: 1 }, { forServer: true, base: {} }) as Record<string, string>;
    const b = desktopRuntimeEnv({ port: 1 }, { forServer: true, base: {} }) as Record<string, string>;
    assert.equal(a.IMA2_DESKTOP, "1");
    assert.equal(a.IMA2_STRICT_PORT, "1");
    assert.match(a.IMA2_BOOT_ID, /^[0-9a-f-]{36}$/);
    assert.notEqual(a.IMA2_BOOT_ID, b.IMA2_BOOT_ID);
  });

  it("reports a synchronous spawn failure instead of hanging", async () => {
    const result = await runBundledCli({ rootDir: "/nowhere", args: [], env: {}, command: { bin: "x", env: {} }, spawnFn: (() => { throw new Error("EACCES"); }) as never });
    assert.equal(result.code, null);
    assert.match(result.error, /EACCES/);
  });
});
