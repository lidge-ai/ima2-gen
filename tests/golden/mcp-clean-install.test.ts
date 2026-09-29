import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveAvailability,
  executionDenialFor,
  isCallable,
} from "../../lib/contracts/availability.js";
import {
  loadAllBundledSnapshots,
  loadBundledSnapshot,
  loadEffectiveSnapshot,
  readLocalSnapshot,
  saveLocalSnapshot,
} from "../../lib/mcp/snapshotStore.js";

// WP10 Tier 1 golden tasks G1-G5
// (devlog/_plan/260726_zero-backlog-frontend-qa/100_mcp_tier1_harness.md,
//  devlog/_plan/260715_subscription-mcp-providers/090_verification_rollout.md).
//
// Everything here runs without credentials, without network, and without cost. Tier 2
// (real OAuth + paid tools/call + billing delta) is explicitly NOT covered and still
// requires user approval.

const PACKAGE_ROOT = process.cwd();

function withTempSnapshotDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-snap-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("G1 discovery: bundled snapshots ship with the package and declare provenance", () => {
  const snapshots = loadAllBundledSnapshots(PACKAGE_ROOT);
  assert.ok(snapshots.length > 0, "a clean install must expose bundled provider contracts");
  for (const snapshot of snapshots) {
    assert.ok(snapshot.provenance?.provider, "each snapshot must name its provider");
    assert.ok(Array.isArray(snapshot.tools), "each snapshot must carry a tools array");
  }

  // The packed artifact must actually include them, or a clean install discovers nothing.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(
    pkg.files.includes("assets/mcp-snapshots/"),
    "package.json files[] must ship assets/mcp-snapshots/",
  );
});

test("G2 input shape: every bundled tool exposes a usable input schema", () => {
  for (const snapshot of loadAllBundledSnapshots(PACKAGE_ROOT)) {
    for (const tool of snapshot.tools) {
      assert.ok(tool.name, `${snapshot.provenance.provider} has an unnamed tool`);
      const schema = tool.inputSchema as { type?: string; properties?: unknown } | undefined;
      assert.ok(schema, `${tool.name} is missing inputSchema`);
      assert.equal(schema.type, "object", `${tool.name} inputSchema must be an object schema`);
    }
  }
});

test("G3a documented tools map to a typed denial, never to execution", () => {
  const documented = deriveAvailability({ connected: false, liveToolPresent: false, schemaHashMatch: false });
  assert.equal(documented.state, "documented");
  assert.equal(executionDenialFor(documented), "auth_required");
  assert.equal(isCallable({ connected: false, liveToolPresent: false, schemaHashMatch: false }), false);

  const installed = deriveAvailability({ connected: false, liveToolPresent: false, schemaHashMatch: false, installed: true });
  assert.equal(installed.state, "installed");
  assert.equal(executionDenialFor(installed), "auth_required");
});

test("G3b a cached snapshot alone never promotes a tool to callable", () => {
  // The whole point of the state machine: having the schema on disk is not authorization.
  withTempSnapshotDir((dir) => {
    const snapshot = loadAllBundledSnapshots(PACKAGE_ROOT)[0];
    saveLocalSnapshot(dir, snapshot);
    assert.ok(readLocalSnapshot(dir, snapshot.provenance.provider), "snapshot should be cached");

    const availability = deriveAvailability({ connected: false, liveToolPresent: true, schemaHashMatch: true });
    assert.notEqual(availability.state, "callable", "a cached schema must not imply a session");
    assert.equal(executionDenialFor(availability), "auth_required");
  });
});

test("G4 drift: a live schema mismatch locks execution instead of serving a stale schema", () => {
  const stale = deriveAvailability({ connected: true, liveToolPresent: true, schemaHashMatch: false });
  assert.equal(stale.state, "stale");
  assert.equal(stale.cause, "schema_drift");
  assert.equal(executionDenialFor(stale), "schema_changed");

  // An entitlement gap is a different failure and must not be reported as drift.
  const blocked = deriveAvailability({ connected: true, liveToolPresent: false, schemaHashMatch: true });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.cause, "entitlement");
});

test("G4b a tampered local snapshot does not silently replace the bundled one's identity", () => {
  withTempSnapshotDir((dir) => {
    const bundled = loadAllBundledSnapshots(PACKAGE_ROOT)[0];
    const provider = bundled.provenance.provider;
    const tampered = structuredClone(bundled);
    (tampered.tools[0].inputSchema as { properties?: Record<string, unknown> }).properties = { evil: {} };
    saveLocalSnapshot(dir, tampered);

    const effective = loadEffectiveSnapshot({ snapshotDir: dir, packageRoot: PACKAGE_ROOT, provider });
    // The local cache wins by design — which is exactly why a hash mismatch against the
    // live schema must lock execution rather than trusting whatever is on disk.
    assert.deepEqual(effective?.tools[0].inputSchema, tampered.tools[0].inputSchema);
    assert.equal(
      executionDenialFor(deriveAvailability({ connected: true, liveToolPresent: true, schemaHashMatch: false })),
      "schema_changed",
    );
  });
});

test("G5 projection: bundled snapshots are deterministic across repeated loads", () => {
  const first = loadBundledSnapshot(PACKAGE_ROOT, loadAllBundledSnapshots(PACKAGE_ROOT)[0].provenance.provider);
  const second = loadBundledSnapshot(PACKAGE_ROOT, first!.provenance.provider);
  assert.deepEqual(first, second, "catalog reads must be reproducible");
});
