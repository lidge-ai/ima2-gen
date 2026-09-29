import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAdvertisePayload } from "../server.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

function ctxWith(overrides: Record<string, unknown> = {}) {
  const ctx = createTestRuntimeContext() as unknown as Record<string, unknown>;
  ctx.serverActualPort = 3981;
  ctx.serverConfiguredPort = 3981;
  ctx.serverUrl = "http://127.0.0.1:3981";
  Object.assign(ctx, overrides);
  return ctx as never;
}

test("the advertise payload publishes the bound backend endpoint", () => {
  const payload = buildAdvertisePayload(ctxWith());
  assert.equal(payload.backend.actualPort, 3981);
  assert.equal(payload.backend.url, "http://127.0.0.1:3981");
  assert.equal(payload.port, 3981);
});

test("a seeded xAI session advertises grok.auth oauth", () => {
  // grokAuthHomeDir is injected so this reads the fixture HOME, never the
  // developer's real ~/.progrok/auth.json.
  const seeded = seedGrokAuth();
  try {
    const payload = buildAdvertisePayload(ctxWith({ grokAuthHomeDir: seeded.homeDir }));
    assert.equal(payload.grok.auth, "oauth");
  } finally {
    seeded.cleanup();
  }
});

test("a HOME with no auth.json advertises grok.auth none", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "ima2-grok-noauth-"));
  try {
    const payload = buildAdvertisePayload(ctxWith({ grokAuthHomeDir: homeDir }));
    assert.equal(payload.grok.auth, "none");
  } finally {
    rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("grok auth state does not disturb the backend advertise contract", () => {
  const seeded = seedGrokAuth();
  const empty = mkdtempSync(join(tmpdir(), "ima2-grok-noauth-"));
  try {
    for (const homeDir of [seeded.homeDir, empty]) {
      const payload = buildAdvertisePayload(ctxWith({ grokAuthHomeDir: homeDir }));
      assert.equal(payload.backend.actualPort, 3981);
      assert.equal(payload.backend.url, "http://127.0.0.1:3981");
      assert.equal(payload.port, 3981);
    }
  } finally {
    seeded.cleanup();
    rmSync(empty, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
