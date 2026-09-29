// WP4 (040): snapshot pipeline — build/diff/store lifecycle + route boundary.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshotArtifact, diffSnapshot, ingestLiveTools } from "../lib/mcp/snapshotPipeline.js";
import { loadEffectiveSnapshot, readLocalSnapshot, saveLocalSnapshot } from "../lib/mcp/snapshotStore.js";
import { registerMcpConnectionRoutes } from "../routes/mcpConnections.js";
import type { SnapshotSource } from "../lib/contracts/types.js";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-snap-"));
const snapshotDir = join(dir, "snapshots");
const packageRoot = join(dir, "pkg");
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const rawTools: Array<Record<string, unknown>> = [
  { name: "generate_image", description: "make", inputSchema: { type: "object", properties: { prompt: { type: "string" } } } },
  { name: "upscale_video", description: "up", inputSchema: { type: "object" } },
];

function makeArtifact(tools = rawTools, fetchedAt = "2026-07-16T00:00:00.000Z"): SnapshotSource {
  return buildSnapshotArtifact({
    provider: "runway", endpoint: "https://mcp.runwayml.com/mcp", entitlementTag: "user-oauth-account",
    tools, serverInfo: { name: "runway-mcp" }, protocolVersion: "2025-06-18", fetchedAt,
  });
}

test("buildSnapshotArtifact: per-tool schemaHash + volatile provenance excluded from hashes", () => {
  const a = makeArtifact(rawTools, "2026-07-16T00:00:00.000Z");
  const b = makeArtifact(rawTools, "2026-07-16T09:09:09.999Z");
  assert.equal(a.provenance.sanitizedHash, b.provenance.sanitizedHash);
  assert.equal(a.provenance.protocolVersion, "2025-06-18");
  for (const tool of a.tools) assert.match(tool.schemaHash ?? "", /^sha256:/);
});

test("diffSnapshot distinguishes drift (schema change) from entitlement (missing) and additions", () => {
  const stored = makeArtifact();
  const live = makeArtifact([
    { name: "generate_image", description: "make", inputSchema: { type: "object", properties: { prompt: { type: "string" }, size: { type: "string" } } } },
    { name: "brand_new", inputSchema: { type: "object" } },
  ]);
  const diff = diffSnapshot(stored, live);
  assert.deepEqual(diff, { drifted: ["generate_image"], missing: ["upscale_video"], added: ["brand_new"] });
});

test("diffSnapshot recomputes when stored schemaHash is absent", () => {
  const stored = makeArtifact();
  for (const tool of stored.tools) delete (tool as { schemaHash?: string }).schemaHash;
  assert.deepEqual(diffSnapshot(stored, makeArtifact()), { drifted: [], missing: [], added: [] });
});

test("store precedence: local cache wins over bundled; local file is 0600", () => {
  mkdirSync(join(packageRoot, "assets", "mcp-snapshots"), { recursive: true });
  const bundled = makeArtifact(rawTools.slice(0, 1));
  writeFileSync(join(packageRoot, "assets", "mcp-snapshots", "runway.sanitized.json"), JSON.stringify(bundled));
  assert.equal(loadEffectiveSnapshot({ snapshotDir, packageRoot, provider: "runway" })?.tools.length, 1);
  saveLocalSnapshot(snapshotDir, makeArtifact());
  assert.equal(loadEffectiveSnapshot({ snapshotDir, packageRoot, provider: "runway" })?.tools.length, 2);
  // POSIX-only contract: chmod is a no-op on Windows (ACLs instead).
  if (process.platform !== "win32") {
    assert.equal(statSync(join(snapshotDir, "runway.json")).mode & 0o777, 0o600);
  }
});

test("ingestLiveTools carries listing metadata into provenance and persists locally", async () => {
  rmSync(join(snapshotDir, "runway.json"), { force: true });
  const { snapshot, diff } = await ingestLiveTools({
    listing: { provider: "runway", fetchedAt: "2026-07-16T01:00:00.000Z", tools: rawTools, serverInfo: { name: "runway-mcp" }, protocolVersion: "2025-06-18" },
    endpoint: "https://mcp.runwayml.com/mcp", entitlementTag: "user-oauth-account", snapshotDir, packageRoot,
  });
  assert.equal(snapshot.provenance.protocolVersion, "2025-06-18");
  assert.deepEqual(diff.missing, []); // bundled had 1 tool; live has both -> added covers the delta
  assert.equal(readLocalSnapshot(snapshotDir, "runway")?.provenance.protocolVersion, "2025-06-18");
});

test("route boundary: connect response carries snapshotDiff after ingest", async () => {
  const fakeManager = {
    statusValue: { provider: "runway", state: "connected" } as Record<string, unknown>,
    status(id: string) { return { ...this.statusValue, provider: id }; },
    async connect(id: string) { return { provider: id, state: "connected" }; },
    async listTools(id: string) {
      return { provider: id, fetchedAt: new Date().toISOString(), tools: rawTools, serverInfo: { name: "runway-mcp" }, protocolVersion: "2025-06-18" };
    },
    connectionIdentity() { return { generation: 1, epoch: 1 }; },
    attachSnapshotDiff(_id: string, _identity: unknown, diff: unknown) { this.statusValue.snapshotDiff = diff; },
    async refresh(id: string) { return { provider: id, state: "connected" }; },
    async reset() {}, async disconnect(id: string) { return { provider: id, state: "disconnected" }; },
    async handleOAuthCallback() { throw new Error("MCP_OAUTH_STATE_INVALID"); },
  };
  const app = express();
  app.use(express.json());
  registerMcpConnectionRoutes(app, {
    config: { mcp: { enabledProviders: ["runway"], tokenDir: dir, snapshotDir }, storage: { packageRoot } },
    serverActualPort: 4547,
    mcpConnectionManager: fakeManager,
  } as never);
  const server = await new Promise<import("node:http").Server>((resolve) => { const v = app.listen(0, "127.0.0.1", () => resolve(v)); });
  try {
    const address = server.address() as import("node:net").AddressInfo;
    const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mcp/providers/runway/connect`, { method: "POST" })).json() as { status: { snapshotDiff?: unknown } };
    assert.ok(body.status.snapshotDiff, "connect response must carry snapshotDiff");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("stale connection identity rejects snapshot persistence before write", async () => {
  rmSync(join(snapshotDir, "runway.json"), { force: true });
  await assert.rejects(() => ingestLiveTools({
    listing: { provider: "runway", fetchedAt: new Date().toISOString(), tools: rawTools },
    endpoint: "https://mcp.runwayml.com/mcp",
    entitlementTag: "user-oauth-account",
    snapshotDir,
    packageRoot,
    isCurrent: () => false,
  }), /MCP_SNAPSHOT_IDENTITY_STALE/);
  assert.equal(readLocalSnapshot(snapshotDir, "runway"), null);
});
