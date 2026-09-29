import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-idempotency-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const idem = await import("../lib/jobs/idempotency.js");
const db = await import("../lib/db.js");

test.beforeEach(() => idem._resetForTests());
test.after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a key is read from the header, the body, or neither", () => {
  assert.equal(idem.readIdempotencyKey("key-1", undefined), "key-1");
  assert.equal(idem.readIdempotencyKey(undefined, "key-2"), "key-2");
  assert.equal(idem.readIdempotencyKey(undefined, undefined), null);
  assert.equal(idem.readIdempotencyKey("  key-3  ", undefined), "key-3");
  // Agreeing sources are fine; the check is for disagreement.
  assert.equal(idem.readIdempotencyKey("same", "same"), "same");
});

test("a client that disagrees with itself is an error, not a coin flip", () => {
  assert.throws(() => idem.readIdempotencyKey("from-header", "from-body"), idem.IdempotencyKeyInvalid);
});

test("key syntax is bounded", () => {
  assert.throws(() => idem.readIdempotencyKey("has spaces", undefined), idem.IdempotencyKeyInvalid);
  assert.throws(() => idem.readIdempotencyKey("a".repeat(256), undefined), idem.IdempotencyKeyInvalid);
  assert.equal(idem.readIdempotencyKey("a".repeat(255), undefined), "a".repeat(255));
  assert.equal(idem.readIdempotencyKey("ok_key.v1:2-3", undefined), "ok_key.v1:2-3");
});

test("the fingerprint ignores routing fields and is order-independent", () => {
  const a = idem.fingerprintRequest({ prompt: "cat", requestId: "r1", async: true, clientNodeId: "n1" });
  const b = idem.fingerprintRequest({ async: false, prompt: "cat", requestId: "r2", clientNodeId: "n2" });
  assert.equal(a, b, "identifiers and transport flags must not change the fingerprint");
});

test("the fingerprint covers result-affecting options, including new ones", () => {
  const base = { prompt: "cat", model: "gpt-image-2", size: "1024x1024" };
  const baseline = idem.fingerprintRequest(base);
  // A whitelist would have to be taught about each of these. A blacklist
  // covers them the day they are added.
  for (const [field, value] of [
    ["quality", "high"],
    ["moderation", "low"],
    ["reasoningEffort", "high"],
    ["webSearchEnabled", true],
    ["backgroundPreset", "studio"],
    ["elementIds", ["e1"]],
    ["providerUrl", "https://example.test/x.png"],
    ["someFutureOption", "whatever"],
  ] as Array<[string, unknown]>) {
    assert.notEqual(
      idem.fingerprintRequest({ ...base, [field]: value }),
      baseline,
      `${field} changes the result, so it must change the fingerprint`,
    );
  }
});

test("the first claim wins and the second is reported as a duplicate", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  assert.deepEqual(idem.claimIdempotencyKey("k1", "req_a", "classic", fp), { outcome: "claimed" });
  const second = idem.claimIdempotencyKey("k1", "req_b", "classic", fp);
  assert.equal(second.outcome, "duplicate");
  assert.equal(second.outcome === "duplicate" && second.record.requestId, "req_a", "the replay must point at the original request");
});

test("reusing a key for different content is refused", () => {
  idem.claimIdempotencyKey("k2", "req_a", "classic", idem.fingerprintRequest({ prompt: "cat" }));
  assert.throws(
    () => idem.claimIdempotencyKey("k2", "req_b", "classic", idem.fingerprintRequest({ prompt: "dog" })),
    idem.IdempotencyFingerprintConflict,
    "a reused key must never answer with another request's result",
  );
});

test("a completed request replays its stored outcome", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  idem.claimIdempotencyKey("k3", "req_a", "classic", fp);
  idem.completeIdempotencyKey("k3", "completed", { images: [{ filename: "a.png" }], requestId: "req_a" });

  const replay = idem.claimIdempotencyKey("k3", "req_b", "classic", fp);
  assert.equal(replay.outcome, "duplicate");
  assert.equal(replay.outcome === "duplicate" && replay.record.terminalStatus, "completed");
  assert.deepEqual(
    replay.outcome === "duplicate" ? replay.record.terminalPayload : null,
    { images: [{ filename: "a.png" }], requestId: "req_a" },
  );
});

test("a failed request replays its failure, not a fresh attempt", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  idem.claimIdempotencyKey("k4", "req_a", "classic", fp);
  idem.completeIdempotencyKey("k4", "error", { error: "upstream exploded", code: "UPSTREAM_5XX", status: 502 });

  const replay = idem.claimIdempotencyKey("k4", "req_b", "classic", fp);
  assert.equal(replay.outcome === "duplicate" && replay.record.terminalStatus, "error");
  assert.equal(replay.outcome === "duplicate" && replay.record.terminalPayload?.status, 502);
});

test("an in-flight duplicate has no stored payload yet", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  idem.claimIdempotencyKey("k5", "req_a", "classic", fp);
  const replay = idem.claimIdempotencyKey("k5", "req_b", "classic", fp);
  assert.equal(replay.outcome === "duplicate" && replay.record.terminalPayload, null);
  assert.equal(replay.outcome === "duplicate" && replay.record.requestId, "req_a");
});

test("an expired key stops replaying and frees itself", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  const longAgo = Date.now() - idem.IDEMPOTENCY_TTL_MS - 1000;
  idem.claimIdempotencyKey("k6", "req_old", "classic", fp, longAgo);
  assert.equal(idem.lookupIdempotencyKey("k6"), null, "an expired key must not replay");
  // And the slot is reusable rather than poisoned forever.
  assert.deepEqual(idem.claimIdempotencyKey("k6", "req_new", "classic", fp), { outcome: "claimed" });
});

test("purge removes expired rows", () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  idem.claimIdempotencyKey("k7", "req_a", "classic", fp, Date.now() - idem.IDEMPOTENCY_TTL_MS - 1000);
  idem.claimIdempotencyKey("k8", "req_b", "classic", fp);
  idem.purgeExpiredIdempotencyKeys();
  const rows = db.getDb().prepare("SELECT key FROM idempotency_keys").all() as Array<{ key: string }>;
  assert.deepEqual(rows.map((r) => r.key), ["k8"]);
});

test("a key survives a restart, so a retry after a crash still replays", async () => {
  const fp = idem.fingerprintRequest({ prompt: "cat" });
  idem.claimIdempotencyKey("k9", "req_a", "classic", fp);
  idem.completeIdempotencyKey("k9", "completed", { images: [] });

  const restarted = await import(`../lib/jobs/idempotency.js?restart=${Date.now()}`);
  const record = restarted.lookupIdempotencyKey("k9");
  assert.equal(record?.requestId, "req_a");
  assert.equal(record?.terminalStatus, "completed");
});
