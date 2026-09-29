import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAdvertisePayload } from "../server.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import {
  isBootId,
  resolveBootId,
  resolveLauncher,
  stopIntentLine,
  writeAdvertiseAtomic,
} from "../lib/runtimeIdentity.ts";

// devlog/_plan/260929_background_runtime/020: who launched a server and which
// boot it is must reach the advertise file, so the CLI and the desktop can tell
// a bundled server from a native one without guessing.

test("the launcher follows the marker each spawner sets", () => {
  assert.equal(resolveLauncher({ IMA2_DESKTOP: "1" }), "desktop");
  assert.equal(resolveLauncher({ IMA2_SERVICE: "1" }), "service");
  assert.equal(resolveLauncher({ IMA2_LAUNCHER: "background" }), "background");
  assert.equal(resolveLauncher({}), "foreground");
  // The desktop marker wins over an inherited service marker.
  assert.equal(resolveLauncher({ IMA2_DESKTOP: "1", IMA2_SERVICE: "1" }), "desktop");
});

test("a spawner-chosen boot id is adopted only when it is a UUID", () => {
  const chosen = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(resolveBootId({ IMA2_BOOT_ID: chosen }), chosen);
  const generated = resolveBootId({ IMA2_BOOT_ID: "not-a-uuid" });
  assert.notEqual(generated, "not-a-uuid");
  assert.ok(isBootId(generated));
  assert.equal(stopIntentLine(chosen), `IMA2_STOP_INTENT ${chosen}\n`);
});

test("the advertise payload carries boot id, launcher and install root", () => {
  const ctx = createTestRuntimeContext() as unknown as Record<string, unknown>;
  Object.assign(ctx, { serverActualPort: 3981, serverUrl: "http://127.0.0.1:3981", bootId: "123e4567-e89b-42d3-a456-426614174000", launcher: "background", rootDir: "/opt/ima2" });
  const payload = buildAdvertisePayload(ctx as never);
  assert.equal(payload.bootId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(payload.launcher, "background");
  assert.equal(payload.root, "/opt/ima2");
});

test("the advertise file is replaced atomically and stays owner-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-advertise-"));
  try {
    const file = join(dir, "nested", "server.json");
    writeAdvertiseAtomic(file, { pid: 1, adminNonce: "a" });
    writeAdvertiseAtomic(file, { pid: 2, adminNonce: "b" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), { pid: 2, adminNonce: "b" });
    assert.deepEqual(readdirSync(join(dir, "nested")), ["server.json"], "no temp file is left behind");
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
