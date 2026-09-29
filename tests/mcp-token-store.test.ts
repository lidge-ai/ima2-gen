import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerOAuthProvider } from "../lib/mcp/oauthProvider.js";
import {
  deleteTokenRecord,
  inspectTokenRecord,
  invalidateTokenRecord,
  readTokenRecord,
  tombstoneTokenRecord,
  updateTokenRecord,
  writeTokenRecord,
} from "../lib/mcp/tokenStore.js";

const current = {
  provider: "runway",
  endpoint: "https://mcp.runwayml.com/mcp",
  redirectOrigin: "http://localhost:4545",
  legacyEndpoint: "https://mcp.runwayml.com/mcp",
};

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-tokens-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function assertCleanSecure(dir: string, provider = "runway"): void {
  const names = readdirSync(dir);
  assert.equal(names.some((name) => name.includes(".tmp-") || name.includes(".lock")), false);
  // POSIX-only contract: chmod is a no-op on Windows, where file ACLs apply.
  if (process.platform !== "win32") {
    assert.equal(statSync(join(dir, `${provider}.json`)).mode & 0o777, 0o600);
  }
}

test("inspection classifies missing, corrupt, pending, usable, legacy, and mismatch without secrets", (t) => {
  const dir = tempDir(t);
  assert.equal(inspectTokenRecord(dir, "runway", current).state, "missing");

  writeFileSync(join(dir, "runway.json"), "{not json", { mode: 0o600 });
  assert.equal(inspectTokenRecord(dir, "runway", current).state, "corrupt");

  writeTokenRecord(dir, "runway", { origin: current.redirectOrigin, clientInformation: { client_id: "client-marker" } });
  assert.equal(inspectTokenRecord(dir, "runway", current).state, "pending-only");

  writeTokenRecord(dir, "runway", { origin: current.redirectOrigin, tokens: { access_token: "token-marker" } });
  const legacy = inspectTokenRecord(dir, "runway", current);
  assert.equal(legacy.state, "usable");
  assert.equal(legacy.legacy, true);
  assert.equal(inspectTokenRecord(dir, "runway", { ...current, endpoint: "https://new.runway.example/mcp" }).state, "binding-mismatch");

  writeTokenRecord(dir, "runway", {
    schemaVersion: 1,
    revision: 4,
    binding: { ...current, updatedAt: "2026-07-17T00:00:00.000Z" },
    tokens: { access_token: "token-marker" },
  });
  const usable = inspectTokenRecord(dir, "runway", current);
  assert.equal(usable.state, "usable");
  assert.equal(JSON.stringify(usable).includes("token-marker"), false);

  assert.equal(inspectTokenRecord(dir, "runway", { ...current, endpoint: "https://other.example/mcp" }).state, "binding-mismatch");
  assert.equal(inspectTokenRecord(dir, "runway", { ...current, redirectOrigin: "http://localhost:9999" }).state, "binding-mismatch");
  writeTokenRecord(dir, "runway", { tokens: { access_token: "unbound-token" } });
  assert.equal(inspectTokenRecord(dir, "runway", current).state, "binding-mismatch");
  assertCleanSecure(dir);
});

test("malformed token bundles are corrupt and never reusable", (t) => {
  const dir = tempDir(t);
  for (const tokens of [{}, { access_token: 7 }, { access_token: "   " }]) {
    writeTokenRecord(dir, "runway", {
      schemaVersion: 1,
      revision: 1,
      binding: { ...current, updatedAt: "2026-07-17T00:00:00.000Z" },
      tokens: tokens as Record<string, unknown>,
    });
    assert.equal(inspectTokenRecord(dir, "runway", current).state, "corrupt");
  }
});

test("field invalidation follows every SDK scope without over-clearing", (t) => {
  const dir = tempDir(t);
  writeTokenRecord(dir, "runway", {
    schemaVersion: 1,
    revision: 1,
    binding: { ...current, updatedAt: "2026-07-17T00:00:00.000Z" },
    clientInformation: { client_id: "client" },
    tokens: { access_token: "access", refresh_token: "refresh" },
    codeVerifier: "legacy-verifier",
  });

  let mutation = invalidateTokenRecord(dir, "runway", "discovery", 1);
  assert.equal(mutation.revision, 1);
  assert.ok(readTokenRecord(dir, "runway")?.tokens);

  mutation = invalidateTokenRecord(dir, "runway", "verifier", mutation.revision);
  assert.equal(readTokenRecord(dir, "runway")?.codeVerifier, undefined);
  assert.ok(readTokenRecord(dir, "runway")?.tokens);

  mutation = invalidateTokenRecord(dir, "runway", "tokens", mutation.revision);
  assert.equal(readTokenRecord(dir, "runway")?.tokens, undefined);
  assert.ok(readTokenRecord(dir, "runway")?.clientInformation);

  mutation = updateTokenRecord(dir, "runway", mutation.revision, (record) => ({
    ...record,
    clientInformation: { client_id: "client-2" },
    tokens: { access_token: "access-2" },
  }));
  mutation = invalidateTokenRecord(dir, "runway", "client", mutation.revision);
  assert.equal(readTokenRecord(dir, "runway")?.clientInformation, undefined);
  assert.equal(readTokenRecord(dir, "runway")?.tokens, undefined);
  assert.ok(readTokenRecord(dir, "runway")?.binding);

  mutation = invalidateTokenRecord(dir, "runway", "all", mutation.revision);
  const tombstone = readTokenRecord(dir, "runway");
  assert.equal(tombstone?.tombstone, true);
  assert.equal(tombstone?.clientInformation, undefined);
  assert.equal(tombstone?.tokens, undefined);
  assert.equal(tombstone?.codeVerifier, undefined);
  assertCleanSecure(dir);
});

test("disconnect tombstone rejects a provider holding an older persistent revision", (t) => {
  const dir = tempDir(t);
  const first = updateTokenRecord(dir, "runway", null, () => ({ tokens: { access_token: "first" } }));
  const dead = tombstoneTokenRecord(dir, "runway", current);
  assert.ok(dead.revision > first.revision);
  assert.throws(
    () => updateTokenRecord(dir, "runway", first.revision, (record) => ({ ...record, tokens: { access_token: "late" } })),
    /MCP_TOKEN_REVISION_STALE/,
  );
  assert.equal(readTokenRecord(dir, "runway")?.tokens, undefined);
  assertCleanSecure(dir);
});

test("OAuth provider keeps PKCE in memory, hides mismatched credentials, and adopts sequential revisions", (t) => {
  const dir = tempDir(t);
  writeTokenRecord(dir, "runway", {
    schemaVersion: 1,
    revision: 7,
    binding: { ...current, endpoint: "https://old.example/mcp", updatedAt: "2026-07-17T00:00:00.000Z" },
    clientInformation: { client_id: "old-client" },
    tokens: { access_token: "old-token" },
    codeVerifier: "legacy-verifier",
  });
  const provider = createServerOAuthProvider({
    provider: "runway",
    tokenDir: dir,
    origin: current.redirectOrigin,
    endpoint: current.endpoint,
    oauthState: "state-marker",
    isCurrent: () => true,
  });
  assert.equal(provider.bindingState, "binding-mismatch");
  assert.equal(provider.tokens(), undefined);
  assert.equal(provider.clientInformation(), undefined);
  assert.throws(() => provider.codeVerifier(), /MCP_OAUTH_VERIFIER_MISSING/);

  provider.saveCodeVerifier("memory-verifier");
  assert.equal(provider.codeVerifier(), "memory-verifier");
  assert.equal(readTokenRecord(dir, "runway")?.codeVerifier, "legacy-verifier");

  const beforeRegistration = readFileSync(join(dir, "runway.json"), "utf8");
  provider.saveClientInformation({ client_id: "new-client" });
  assert.equal(readFileSync(join(dir, "runway.json"), "utf8"), beforeRegistration);
  provider.saveTokens({ access_token: "new-token", token_type: "bearer" });
  provider.invalidateCredentials?.("tokens");
  provider.saveTokens({ access_token: "retried-token", token_type: "bearer" });
  const record = readTokenRecord(dir, "runway");
  assert.equal(record?.binding?.endpoint, current.endpoint);
  assert.equal((record?.tokens as Record<string, unknown>).access_token, "retried-token");
  assert.equal(record?.codeVerifier, undefined);
  provider.saveCodeVerifier("must-clear-on-all");
  provider.invalidateCredentials?.("all");
  assert.throws(() => provider.codeVerifier(), /MCP_OAUTH_VERIFIER_MISSING/);
  assertCleanSecure(dir);
});

test("stale generation rejects credential persistence with a code-only error", (t) => {
  const dir = tempDir(t);
  const provider = createServerOAuthProvider({
    provider: "runway",
    tokenDir: dir,
    origin: current.redirectOrigin,
    endpoint: current.endpoint,
    oauthState: "state-marker",
    isCurrent: () => false,
  });
  assert.throws(() => provider.saveTokens({ access_token: "never-written", token_type: "bearer" }), /^McpOAuthGenerationStaleError: MCP_OAUTH_GENERATION_STALE$/);
  assert.equal(readTokenRecord(dir, "runway"), null);
});

test("live lock and competing recovery claim fail closed; dead owner recovers without residue", (t) => {
  const dir = tempDir(t);
  const lockPath = join(dir, "runway.json.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, nonce: "live-owner" }), { mode: 0o600 });
  assert.throws(() => updateTokenRecord(dir, "runway", null, () => ({})), /MCP_TOKEN_STORE_BUSY/);
  rmSync(lockPath);

  const orphanPath = `${lockPath}-owner-orphan`;
  writeFileSync(orphanPath, "partial-owner-write", { mode: 0o600 });
  const orphanSafe = updateTokenRecord(dir, "runway", null, () => ({}));
  assert.equal(orphanSafe.revision, 1);
  deleteTokenRecord(dir, "runway");
  rmSync(orphanPath);

  writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, nonce: "../unsafe" }), { mode: 0o600 });
  assert.throws(() => updateTokenRecord(dir, "runway", null, () => ({})), /MCP_TOKEN_STORE_BUSY/);
  assert.equal(readdirSync(dir).some((name) => name.includes("unsafe")), false);
  rmSync(lockPath);

  const deadOwner = { pid: 2_147_483_647, nonce: "dead-owner" };
  writeFileSync(lockPath, JSON.stringify(deadOwner), { mode: 0o600 });
  const claimPath = `${lockPath}.recover-${deadOwner.nonce}`;
  linkSync(lockPath, claimPath);
  assert.throws(() => updateTokenRecord(dir, "runway", null, () => ({})), /MCP_TOKEN_STORE_BUSY/);
  assert.equal(readdirSync(dir).includes("runway.json.lock"), true);
  rmSync(claimPath);

  const mutation = updateTokenRecord(dir, "runway", null, () => ({ tokens: { access_token: "recovered" } }));
  assert.equal(mutation.revision, 1);
  assertCleanSecure(dir);
  assert.throws(() => updateTokenRecord(dir, "runway", null, () => ({})), /MCP_TOKEN_REVISION_STALE/);
  assertCleanSecure(dir);
});

test("path traversal is rejected and physical delete remains idempotent", (t) => {
  const dir = tempDir(t);
  assert.throws(() => readTokenRecord(dir, "../evil"), /MCP_PROVIDER_ID_INVALID/);
  assert.throws(() => writeTokenRecord(dir, "a/b", {}), /MCP_PROVIDER_ID_INVALID/);
  writeTokenRecord(dir, "runway", {});
  deleteTokenRecord(dir, "runway");
  deleteTokenRecord(dir, "runway");
  assert.equal(readTokenRecord(dir, "runway"), null);
});
