// WP3 (030): connection routes — secret-free envelopes over a fake manager.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMcpConnectionRoutes } from "../routes/mcpConnections.js";
import { clearModelsCatalogCache } from "../lib/mcp/modelsCatalog.js";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-routes-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const fakeManager = {
  last: new Map<string, Record<string, unknown>>(),
  toolCalls: [] as Array<{ provider: string; name: string; args: Record<string, unknown> }>,
  toolBehavior: "pages" as "pages" | "not-connected" | "boom",
  probeBehavior: "ok" as "ok" | "unauthorized",
  status(id: string) { return this.last.get(id) ?? { provider: id, state: "disconnected" }; },
  async callTool(provider: string, name: string, args: Record<string, unknown>) {
    this.toolCalls.push({ provider, name, args });
    if (this.toolBehavior === "not-connected") throw new Error("MCP_NOT_CONNECTED");
    if (this.toolBehavior === "boom") throw new Error("MCP_TOOL_ERROR:models_explore:boom");
    return {
      structuredContent: {
        items: args.type === "video"
          ? [{ id: "kling_3", name: "Kling 3" }]
          : [{ id: "soul_2", name: "Higgsfield Soul 2.0" }],
        has_more: false,
      },
    };
  },
  async listTools(id: string) {
    if (this.probeBehavior === "unauthorized") {
      this.last.set(id, { provider: id, state: "offline", detail: "MCP_SESSION_INVALID" });
      throw new Error("Unauthorized");
    }
    return { provider: id, fetchedAt: new Date(0).toISOString(), tools: [], serverInfo: null };
  },
  async connect(id: string) {
    const status = { provider: id, state: "auth_required", authorizationUrl: "https://provider.example/authorize" };
    this.last.set(id, status);
    return status;
  },
  async handleOAuthCallback(state: string) {
    if (state !== "good-state") throw new Error("MCP_OAUTH_STATE_INVALID");
    const status = { provider: "runway", state: "connected" };
    this.last.set("runway", status);
    return status;
  },
  reset: async () => undefined,
  async refresh(id: string) { const status = { provider: id, state: "connected" }; this.last.set(id, status); return status; },
  connectionIdentity: () => null,
  attachSnapshotDiff: () => undefined,
  async disconnect(id: string) { const status = { provider: id, state: "disconnected" }; this.last.set(id, status); return status; },
};

async function withApp(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const ctx = {
    config: { mcp: { enabledProviders: ["runway", "higgsfield"], tokenDir: dir } },
    serverActualPort: 4546,
    mcpConnectionManager: fakeManager,
  };
  registerMcpConnectionRoutes(app, ctx as never);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    const address = server.address() as import("node:net").AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("providers listing includes registry entries with per-provider status", async () => withApp(async (base) => {
  const body = await (await fetch(`${base}/api/mcp/providers`)).json() as { ok: boolean; providers: Array<{ id: string; status: { state: string } }> };
  assert.equal(body.ok, true);
  assert.deepEqual(body.providers.map((p) => p.id).sort(), ["higgsfield", "runway"]);
  assert.equal(body.providers[0].status.state, "disconnected");
}));

test("connect returns 202 with authorizationUrl when auth is required", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/providers/runway/connect`, { method: "POST" });
  assert.equal(response.status, 202);
  const body = await response.json() as { ok: boolean; status: { authorizationUrl: string } };
  assert.equal(body.ok, false);
  assert.match(body.status.authorizationUrl, /provider\.example/);
}));

test("refresh returns offline when the post-connect tool probe invalidates the session", async () => withApp(async (base) => {
  fakeManager.probeBehavior = "unauthorized";
  const response = await fetch(`${base}/api/mcp/providers/runway/refresh`, { method: "POST" });
  assert.equal(response.status, 503);
  const body = await response.json() as { ok: boolean; status: { state: string; detail: string } };
  assert.equal(body.ok, false);
  assert.deepEqual(body.status, { provider: "runway", state: "offline", detail: "MCP_SESSION_INVALID" });
  fakeManager.probeBehavior = "ok";
}));

test("unknown status returns canonical 404", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/providers/unknown/status`);
  assert.equal(response.status, 404);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "MCP_PROVIDER_UNKNOWN");
}));

test("callback validates params and state before any exchange", async () => withApp(async (base) => {
  assert.equal((await fetch(`${base}/api/mcp/oauth/callback`)).status, 400);
  assert.equal((await fetch(`${base}/api/mcp/oauth/callback?state=bad&code=x`)).status, 400);
  const ok = await fetch(`${base}/api/mcp/oauth/callback?state=good-state&code=x`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /연결 완료/);
}));

test("disconnect responds with the non-revocation note and no secrets anywhere", async () => withApp(async (base) => {
  const response = await fetch(`${base}/api/mcp/providers/runway/connection`, { method: "DELETE" });
  const text = await response.text();
  assert.match(text, /provider-side grant is not revoked/);
  for (const path of ["/api/mcp/providers", "/api/mcp/providers/runway/status"]) {
    const body = await (await fetch(base + path)).text();
    assert.ok(!/access_token|refresh_token|code_verifier/i.test(body), `${path} leaked a secret field`);
  }
}));

// 040 — /models catalog endpoint contract.
test("models endpoint serves runway statically and higgsfield via models_explore only", async () => withApp(async (base) => {
  clearModelsCatalogCache();
  fakeManager.toolCalls = [];
  fakeManager.toolBehavior = "pages";

  const runway = await fetch(`${base}/api/mcp/providers/runway/models`);
  assert.equal(runway.status, 200);
  const runwayBody = await runway.json() as { ok: boolean; models: { video: Array<{ id: string }> } };
  assert.equal(runwayBody.ok, true);
  assert.ok(runwayBody.models.video.some((entry) => entry.id === "seedance-2"));
  assert.equal(fakeManager.toolCalls.length, 0);

  const hf = await fetch(`${base}/api/mcp/providers/higgsfield/models?name=confirm_billing_purchase`);
  assert.equal(hf.status, 200);
  const hfBody = await hf.json() as {
    ok: boolean;
    models: {
      image: Array<{ id: string; label: string; capabilities?: { source?: string } }>;
      video: Array<{ id: string }>;
    };
  };
  assert.deepEqual(
    hfBody.models.image.map((entry) => ({ id: entry.id, label: entry.label })),
    [{ id: "soul_2", label: "Higgsfield Soul 2.0" }],
  );
  // Catalog entries now carry a capability contract for preset-driven UIs.
  assert.equal(typeof hfBody.models.image[0]?.capabilities?.source, "string");
  assert.deepEqual(hfBody.models.video.map((entry) => entry.id), ["kling_3"]);
  // Hostile query params cannot influence the tool name: only models_explore fires.
  assert.ok(fakeManager.toolCalls.length >= 2);
  for (const call of fakeManager.toolCalls) assert.equal(call.name, "models_explore");
}));

test("models endpoint returns canonical typed errors", async () => withApp(async (base) => {
  const unknown = await fetch(`${base}/api/mcp/providers/krea/models`);
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as { error: { code: string } }).error.code, "MCP_PROVIDER_UNKNOWN");

  clearModelsCatalogCache();
  fakeManager.toolBehavior = "not-connected";
  const disconnected = await fetch(`${base}/api/mcp/providers/higgsfield/models`);
  assert.equal(disconnected.status, 409);
  assert.equal(((await disconnected.json()) as { error: { code: string } }).error.code, "MCP_NOT_CONNECTED");

  clearModelsCatalogCache();
  fakeManager.toolBehavior = "boom";
  const upstream = await fetch(`${base}/api/mcp/providers/higgsfield/models`);
  assert.equal(upstream.status, 502);
  assert.equal(((await upstream.json()) as { error: { code: string } }).error.code, "MCP_UPSTREAM_ERROR");
  fakeManager.toolBehavior = "pages";
}));
