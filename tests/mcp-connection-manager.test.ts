import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpConnectionManager } from "../lib/mcp/connectionManager.js";
import { readTokenRecord, writeTokenRecord } from "../lib/mcp/tokenStore.js";
import type { ServerOAuthProvider } from "../lib/mcp/oauthProvider.js";

type Deferred = { promise: Promise<void>; resolve(): void; reject(error: Error): void };
type FakeTransport = {
  authProvider: ServerOAuthProvider;
  finishAuthCalls: string[];
  closeCalls: number;
  finishAuth(code: string): Promise<void>;
  close(): Promise<void>;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-manager-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeHarness(t: TestContext, options: {
  connects?: Array<(transport: FakeTransport, options?: { signal?: AbortSignal }) => Promise<void>>;
  now?: () => number;
  pendingAuthTtlMs?: number;
  enabledProviders?: string[];
  finishAuth?: (transport: FakeTransport, code: string) => Promise<void>;
  closeTransport?: (transport: FakeTransport) => Promise<void>;
  restoreTimeoutMs?: number;
  reconnectDelayMs?: number;
  callTool?: () => Promise<Record<string, unknown>>;
  listTools?: (params: { cursor?: string }) => Promise<{ tools: Array<{ name: string }>; nextCursor?: string }>;
} = {}) {
  const dir = tempDir(t);
  const transports: FakeTransport[] = [];
  const providers: ServerOAuthProvider[] = [];
  const clients: Array<{ onerror?: (error: Error) => void; onclose?: () => void }> = [];
  const attemptWaiters = new Map<number, () => void>();
  let connectAttempts = 0;
  const manager = new McpConnectionManager({
    enabledProviders: options.enabledProviders ?? ["runway", "higgsfield"],
    tokenDir: dir,
    getOrigin: () => "http://localhost:4545",
    ...(options.now ? { now: options.now } : {}),
    ...(options.pendingAuthTtlMs ? { pendingAuthTtlMs: options.pendingAuthTtlMs } : {}),
    ...(options.restoreTimeoutMs ? { restoreTimeoutMs: options.restoreTimeoutMs } : {}),
    ...(options.reconnectDelayMs !== undefined ? { reconnectDelayMs: options.reconnectDelayMs } : {}),
    transportFactory: (_endpoint, authProvider) => {
      providers.push(authProvider);
      const transport: FakeTransport = {
        authProvider,
        finishAuthCalls: [],
        closeCalls: 0,
        async finishAuth(code) {
          this.finishAuthCalls.push(code);
          if (options.finishAuth) { await options.finishAuth(this, code); return; }
          authProvider.saveTokens({ access_token: "callback-token", token_type: "bearer" });
        },
        async close() {
          this.closeCalls += 1;
          if (options.closeTransport) await options.closeTransport(this);
        },
      };
      transports.push(transport);
      return transport as never;
    },
    clientFactory: () => {
      const index = connectAttempts;
      const client = {
        async connect(transport: FakeTransport, requestOptions?: { signal?: AbortSignal }) {
          connectAttempts += 1;
          attemptWaiters.get(connectAttempts)?.();
          attemptWaiters.delete(connectAttempts);
          const behavior = options.connects?.[index];
          if (behavior) await behavior(transport, requestOptions);
        },
        async listTools(params: { cursor?: string }) {
          if (options.listTools) return options.listTools(params);
          if (!params.cursor) return { tools: [{ name: "a" }, { name: "b" }], nextCursor: "p2" };
          return { tools: [{ name: "c" }] };
        },
        async callTool() { return options.callTool ? options.callTool() : {}; },
      };
      clients.push(client as unknown as (typeof clients)[number]);
      return client as never;
    },
  });
  const waitForAttempt = (attempt: number) => connectAttempts >= attempt
    ? Promise.resolve()
    : new Promise<void>((resolve) => attemptWaiters.set(attempt, resolve));
  return { manager, dir, transports, providers, clients, attempts: () => connectAttempts, waitForAttempt };
}

function pendingState(manager: McpConnectionManager): string {
  const pending = (manager as unknown as { pendingAuth: Map<string, unknown> }).pendingAuth;
  assert.equal(pending.size, 1);
  return [...pending.keys()][0];
}

test("ten concurrent connects coalesce into one client and transport", async (t) => {
  const gate = deferred();
  const h = makeHarness(t, { connects: [() => gate.promise] });
  const calls = Array.from({ length: 10 }, () => h.manager.connect("runway"));
  await Promise.resolve();
  assert.equal(h.attempts(), 1);
  assert.equal(h.transports.length, 1);
  gate.resolve();
  const results = await Promise.all(calls);
  assert.equal(results.every((result) => result.state === "connected"), true);
});

test("disconnect during deferred connect wins and leaves a credential-free tombstone", async (t) => {
  const gate = deferred();
  const h = makeHarness(t, { connects: [() => gate.promise] });
  writeTokenRecord(h.dir, "runway", { origin: "http://localhost:4545", tokens: { access_token: "stored" } });
  const connecting = h.manager.connect("runway");
  await Promise.resolve();
  const disconnected = await h.manager.disconnect("runway");
  gate.resolve();
  const late = await connecting;
  assert.equal(disconnected.state, "disconnected");
  assert.equal(late.state, "disconnected");
  assert.ok(h.transports[0].closeCalls >= 1);
  assert.equal(readTokenRecord(h.dir, "runway")?.tombstone, true);
  assert.equal(readTokenRecord(h.dir, "runway")?.tokens, undefined);
});

test("OAuth pending state is single-use and a callback after disconnect is rejected", async (t) => {
  const h = makeHarness(t, { connects: [async (transport) => {
    transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
    throw new UnauthorizedError("Unauthorized");
  }] });
  const status = await h.manager.connect("runway");
  assert.equal(status.state, "auth_required");
  const state = pendingState(h.manager);
  await h.manager.disconnect("runway");
  await assert.rejects(() => h.manager.handleOAuthCallback(state, "late-code"), /MCP_OAUTH_STATE_INVALID/);
  assert.equal(readTokenRecord(h.dir, "runway")?.tokens, undefined);
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("valid callback persists tokens, reconnects once, and remains single-use", async (t) => {
  const h = makeHarness(t, { connects: [async (transport) => {
    transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
    throw new UnauthorizedError("Unauthorized");
  }] });
  await h.manager.connect("runway");
  const state = pendingState(h.manager);
  const status = await h.manager.handleOAuthCallback(state, "one-time-code");
  assert.equal(status.state, "connected");
  assert.equal(h.attempts(), 2);
  assert.ok(readTokenRecord(h.dir, "runway")?.tokens);
  await assert.rejects(() => h.manager.handleOAuthCallback(state, "replay-code"), /MCP_OAUTH_STATE_INVALID/);
});

test("connect entering during an active callback joins that callback instead of creating another OAuth flow", async (t) => {
  const finishGate = deferred();
  const finishStarted = deferred();
  const h = makeHarness(t, {
    connects: [async (transport) => {
      transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
      throw new UnauthorizedError("Unauthorized");
    }],
    finishAuth: async (transport) => {
      finishStarted.resolve();
      await finishGate.promise;
      transport.authProvider.saveTokens({ access_token: "callback-token", token_type: "bearer" });
    },
  });
  await h.manager.connect("runway");
  const callback = h.manager.handleOAuthCallback(pendingState(h.manager), "callback-code");
  await finishStarted.promise;
  const joined = h.manager.connect("runway");
  finishGate.resolve();
  assert.equal((await callback).state, "connected");
  assert.equal((await joined).state, "connected");
  assert.equal(h.attempts(), 2);
  assert.equal((h.manager as unknown as { pendingAuth: Map<string, unknown> }).pendingAuth.size, 0);
});

test("disconnect during pending replacement prevents stale auth_required publication", async (t) => {
  const closeGate = deferred();
  const closeStarted = deferred();
  const unauthorized = async (transport: FakeTransport) => {
    transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
    throw new UnauthorizedError("Unauthorized");
  };
  const h = makeHarness(t, {
    connects: [unauthorized, unauthorized],
    closeTransport: async (transport) => {
      if (transport !== h.transports[0]) return;
      closeStarted.resolve();
      await closeGate.promise;
    },
  });
  await h.manager.connect("runway");
  const replacement = h.manager.connect("runway");
  await closeStarted.promise;
  const disconnect = h.manager.disconnect("runway");
  closeGate.resolve();
  assert.equal((await replacement).state, "disconnected");
  assert.equal((await disconnect).state, "disconnected");
  assert.equal(h.manager.status("runway").state, "disconnected");
  assert.equal((h.manager as unknown as { pendingAuth: Map<string, unknown> }).pendingAuth.size, 0);
});

test("disconnect during finishAuth makes the callback stale and blocks late persistence", async (t) => {
  const finishGate = deferred();
  const finishStarted = deferred();
  const h = makeHarness(t, {
    connects: [async (transport) => {
      transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
      throw new UnauthorizedError("Unauthorized");
    }],
    finishAuth: async (transport) => {
      finishStarted.resolve();
      await finishGate.promise;
      transport.authProvider.saveTokens({ access_token: "late-token", token_type: "bearer" });
    },
  });
  await h.manager.connect("runway");
  const callback = h.manager.handleOAuthCallback(pendingState(h.manager), "callback-code");
  await finishStarted.promise;
  await h.manager.disconnect("runway");
  finishGate.resolve();
  await assert.rejects(() => callback, /MCP_OAUTH_GENERATION_STALE/);
  assert.equal(readTokenRecord(h.dir, "runway")?.tokens, undefined);
  assert.equal(h.manager.status("runway").state, "disconnected");
});

test("a stale hung callback cannot block an explicit Connect after disconnect completes", async (t) => {
  const finishGate = deferred();
  const finishStarted = deferred();
  const h = makeHarness(t, {
    connects: [async (transport) => {
      transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
      throw new UnauthorizedError("Unauthorized");
    }],
    finishAuth: async () => { finishStarted.resolve(); await finishGate.promise; },
  });
  await h.manager.connect("runway");
  const callback = h.manager.handleOAuthCallback(pendingState(h.manager), "callback-code");
  await finishStarted.promise;
  await h.manager.disconnect("runway");
  const reconnected = await h.manager.connect("runway");
  assert.equal(reconnected.state, "connected");
  assert.equal(h.attempts(), 2);
  finishGate.resolve();
  await assert.rejects(() => callback, /MCP_OAUTH_GENERATION_STALE/);
});

test("expired pending auth closes its transport with an injected clock", async (t) => {
  let now = 100;
  const h = makeHarness(t, {
    now: () => now,
    pendingAuthTtlMs: 10,
    connects: [async (transport) => {
      transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
      throw new UnauthorizedError("Unauthorized");
    }],
  });
  await h.manager.connect("runway");
  const state = pendingState(h.manager);
  now = 111;
  await assert.rejects(() => h.manager.handleOAuthCallback(state, "expired-code"), /MCP_OAUTH_STATE_INVALID/);
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("an abandoned pending auth is swept on status reads after the TTL", async (t) => {
  let now = 100;
  const h = makeHarness(t, {
    now: () => now,
    pendingAuthTtlMs: 10,
    connects: [async (transport) => {
      transport.authProvider.redirectToAuthorization(new URL("https://provider.example/authorize"));
      throw new UnauthorizedError("Unauthorized");
    }],
  });
  const status = await h.manager.connect("runway");
  assert.equal(status.state, "auth_required");
  assert.equal((h.manager as unknown as { pendingAuth: Map<string, unknown> }).pendingAuth.size, 1);
  now = 111;
  const polled = h.manager.status("runway");
  assert.equal(polled.state, "disconnected");
  assert.equal((h.manager as unknown as { pendingAuth: Map<string, unknown> }).pendingAuth.size, 0);
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("reset cancels old work but preserves credentials", async (t) => {
  const gate = deferred();
  const h = makeHarness(t, { connects: [() => gate.promise] });
  writeTokenRecord(h.dir, "runway", { origin: "http://localhost:4545", tokens: { access_token: "stored" } });
  const connecting = h.manager.connect("runway");
  await Promise.resolve();
  await h.manager.reset("runway");
  gate.resolve();
  assert.equal((await connecting).state, "disconnected");
  assert.ok(readTokenRecord(h.dir, "runway")?.tokens);
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("connect entering during reset joins the disconnected reset result", async (t) => {
  const h = makeHarness(t);
  await h.manager.connect("runway");
  const reset = h.manager.reset("runway");
  const joined = h.manager.connect("runway");
  await reset;
  assert.equal((await joined).state, "disconnected");
  assert.equal(h.attempts(), 1);
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("disconnect closes a connected transport even when tombstone persistence fails", async (t) => {
  const h = makeHarness(t);
  await h.manager.connect("runway");
  writeFileSync(join(h.dir, "runway.json.lock"), JSON.stringify({ pid: process.pid, nonce: "held-lock" }), { mode: 0o600 });
  await assert.rejects(() => h.manager.disconnect("runway"), /MCP_TOKEN_STORE_BUSY/);
  assert.ok(h.transports[0].closeCalls >= 1);
  assert.equal(h.manager.status("runway").state, "disconnected");
});

test("concurrent refresh and connect coalesce, while disconnect remains terminal in both overlap orders", async (t) => {
  const first = deferred();
  const second = deferred();
  const h = makeHarness(t, { connects: [() => first.promise, () => second.promise] });
  const initial = h.manager.connect("runway");
  first.resolve();
  await initial;

  const refreshA = h.manager.refresh("runway");
  const refreshB = h.manager.refresh("runway");
  const joinedConnect = h.manager.connect("runway");
  await h.waitForAttempt(2);
  assert.equal(h.attempts(), 2);
  assert.ok(h.transports[0].closeCalls >= 1);
  const disconnect = h.manager.disconnect("runway");
  second.resolve();
  assert.equal((await disconnect).state, "disconnected");
  assert.equal((await refreshA).state, "disconnected");
  assert.equal((await refreshB).state, "disconnected");
  assert.equal((await joinedConnect).state, "disconnected");

  const disconnectFirst = h.manager.disconnect("higgsfield");
  const refreshDuring = h.manager.refresh("higgsfield");
  assert.equal((await disconnectFirst).state, "disconnected");
  assert.equal((await refreshDuring).state, "disconnected");
});

test("status is session-free for known-disabled providers and rejects unknown IDs", (t) => {
  const h = makeHarness(t, { enabledProviders: [] });
  assert.equal(h.manager.status("runway").state, "disconnected");
  assert.throws(() => h.manager.status("nope"), /MCP_PROVIDER_UNKNOWN/);
  const sessions = (h.manager as unknown as { sessions: Map<string, unknown> }).sessions;
  assert.equal(sessions.size, 0);
});

test("raw upstream error text never reaches public detail", async (t) => {
  const h = makeHarness(t, { connects: [async () => { throw new Error("upstream-body-with-sensitive-marker"); }] });
  const status = await h.manager.connect("runway");
  assert.equal(status.state, "error");
  assert.equal(status.detail, "MCP_CONNECT_FAILED");
  assert.equal(JSON.stringify(status).includes("sensitive-marker"), false);
});

test("listTools still paginates after lifecycle hardening", async (t) => {
  const h = makeHarness(t);
  await h.manager.connect("runway");
  const listing = await h.manager.listTools("runway");
  assert.deepEqual(listing.tools.map((tool) => tool.name), ["a", "b", "c"]);
});

test("listTools auth or closed-session failures invalidate only the current epoch", async (t) => {
  for (const error of [new UnauthorizedError("Unauthorized"), new Error("connection closed")]) {
    const h = makeHarness(t, { listTools: async () => { throw error; } });
    await h.manager.connect("runway");
    await assert.rejects(() => h.manager.listTools("runway"));
    assert.equal(h.manager.status("runway").state, "offline");
    assert.equal(h.manager.status("runway").detail, "MCP_SESSION_INVALID");
  }
});

test("startup restore connects one same-binding stored grant without opening authorization", async (t) => {
  const h = makeHarness(t);
  writeTokenRecord(h.dir, "runway", {
    schemaVersion: 1,
    revision: 1,
    binding: {
      provider: "runway",
      endpoint: "https://mcp.runwayml.com/mcp",
      redirectOrigin: "http://localhost:4545",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    tokens: { access_token: "stored-token" },
  });
  await h.manager.restoreStoredConnections();
  assert.equal(h.attempts(), 1);
  assert.equal(h.manager.status("runway").state, "connected");
  assert.equal(h.providers[0].lastAuthorizationUrl, null);
});

test("passive restore preserves binding mismatch and performs no network", async (t) => {
  const h = makeHarness(t);
  writeTokenRecord(h.dir, "runway", {
    schemaVersion: 1,
    revision: 1,
    binding: {
      provider: "runway",
      endpoint: "https://old.example/mcp",
      redirectOrigin: "http://localhost:4545",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    tokens: { access_token: "stored-token" },
  });
  await h.manager.restoreStoredConnections();
  assert.equal(h.attempts(), 0);
  assert.equal(h.manager.status("runway").state, "auth_required");
  assert.ok(readTokenRecord(h.dir, "runway")?.tokens);
});

test("restore timeout aborts, invalidates, and closes its candidate", async (t) => {
  const h = makeHarness(t, {
    restoreTimeoutMs: 5,
    connects: [async (_transport, options) => new Promise<void>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })],
  });
  writeTokenRecord(h.dir, "runway", {
    schemaVersion: 1, revision: 1,
    binding: { provider: "runway", endpoint: "https://mcp.runwayml.com/mcp", redirectOrigin: "http://localhost:4545", updatedAt: "2026-07-17T00:00:00.000Z" },
    tokens: { access_token: "stored" },
  });
  await h.manager.restoreStoredConnections();
  assert.equal(h.manager.status("runway").state, "disconnected");
  assert.ok(h.transports[0].closeCalls >= 1);
});

test("explicit Connect aborts an in-flight restore and wins with a new generation", async (t) => {
  const h = makeHarness(t, { connects: [async (_transport, options) => new Promise<void>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })] });
  writeTokenRecord(h.dir, "runway", {
    schemaVersion: 1, revision: 1,
    binding: { provider: "runway", endpoint: "https://mcp.runwayml.com/mcp", redirectOrigin: "http://localhost:4545", updatedAt: "2026-07-17T00:00:00.000Z" },
    tokens: { access_token: "stored" },
  });
  const restore = h.manager.restoreStoredConnections();
  await h.waitForAttempt(1);
  const connected = await h.manager.connect("runway");
  await restore;
  assert.equal(connected.state, "connected");
  assert.equal(h.attempts(), 2);
});

test("SDK terminal onerror goes offline and schedules one reconnect; transient error stays connected", async (t) => {
  const h = makeHarness(t, { reconnectDelayMs: 0 });
  await h.manager.connect("runway");
  h.clients[0].onerror?.(new Error("temporary stream issue"));
  assert.equal(h.manager.status("runway").state, "connected");
  assert.equal(h.manager.status("runway").detail, "MCP_TRANSPORT_DEGRADED");
  h.clients[0].onerror?.(new Error("Maximum reconnection attempts (2) exceeded."));
  assert.equal(h.manager.status("runway").state, "offline");
  await h.waitForAttempt(2);
  assert.equal(h.attempts(), 2);
});

test("shutdown closes live resources once and retains stored tokens", async (t) => {
  const h = makeHarness(t);
  writeTokenRecord(h.dir, "runway", { origin: "http://localhost:4545", tokens: { access_token: "stored" } });
  await h.manager.connect("runway");
  await h.manager.shutdown();
  assert.ok(h.transports[0].closeCalls >= 1);
  assert.ok(readTokenRecord(h.dir, "runway")?.tokens);
  await assert.rejects(() => h.manager.connect("runway"), /MCP_SHUTTING_DOWN/);
  await assert.rejects(() => h.manager.refresh("runway"), /MCP_SHUTTING_DOWN/);
});

test("unexpected close reconnects once while expected reset close stays disconnected", async (t) => {
  const h = makeHarness(t, { reconnectDelayMs: 0 });
  await h.manager.connect("runway");
  h.clients[0].onclose?.();
  assert.equal(h.manager.status("runway").state, "offline");
  await h.waitForAttempt(2);
  await h.manager.reset("runway");
  h.clients[1].onclose?.();
  assert.equal(h.manager.status("runway").state, "disconnected");
  assert.equal(h.attempts(), 2);
});

test("stale callTool failure cannot mark a newer epoch offline", async (t) => {
  const callGate = deferred();
  const h = makeHarness(t, { callTool: async () => { await callGate.promise; throw new UnauthorizedError("Unauthorized"); } });
  await h.manager.connect("runway");
  const oldCall = h.manager.callTool("runway", "x", {});
  await h.manager.refresh("runway");
  callGate.resolve();
  await assert.rejects(() => oldCall, /Unauthorized/);
  assert.equal(h.manager.status("runway").state, "connected");
});

async function waitForState(manager: McpConnectionManager, provider: string, state: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (manager.status(provider).state === state) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(manager.status(provider).state, state);
}

test("successful callTool clears sticky MCP_TRANSPORT_DEGRADED detail (010-A)", async (t) => {
  const h = makeHarness(t);
  await h.manager.connect("runway");
  h.clients[0].onerror?.(new Error("temporary stream issue"));
  assert.equal(h.manager.status("runway").detail, "MCP_TRANSPORT_DEGRADED");
  await h.manager.callTool("runway", "models_explore", {});
  assert.equal(h.manager.status("runway").state, "connected");
  assert.equal(h.manager.status("runway").detail, undefined);
});

test("successful listTools clears sticky MCP_TRANSPORT_DEGRADED detail (010-A)", async (t) => {
  const h = makeHarness(t);
  await h.manager.connect("runway");
  h.clients[0].onerror?.(new Error("temporary stream issue"));
  assert.equal(h.manager.status("runway").detail, "MCP_TRANSPORT_DEGRADED");
  await h.manager.listTools("runway");
  assert.equal(h.manager.status("runway").detail, undefined);
});

test("auto-reconnect budget: 4 consecutive drops without RPC stop after 3 reconnects (010-B)", async (t) => {
  const h = makeHarness(t, { reconnectDelayMs: 0 });
  await h.manager.connect("runway");
  for (let drop = 0; drop < 3; drop += 1) {
    h.clients[h.clients.length - 1].onclose?.();
    assert.equal(h.manager.status("runway").state, "offline");
    await h.waitForAttempt(drop + 2);
    await waitForState(h.manager, "runway", "connected");
  }
  assert.equal(h.attempts(), 4);
  // Fourth consecutive drop: budget exhausted — no further automatic reconnect.
  h.clients[h.clients.length - 1].onclose?.();
  assert.equal(h.manager.status("runway").state, "offline");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.attempts(), 4);
  assert.equal(h.manager.status("runway").state, "offline");
});

test("auto-reconnect budget resets after a successful RPC and after explicit connect (010-B)", async (t) => {
  const h = makeHarness(t, { reconnectDelayMs: 0 });
  await h.manager.connect("runway");
  for (let drop = 0; drop < 3; drop += 1) {
    h.clients[h.clients.length - 1].onclose?.();
    await h.waitForAttempt(drop + 2);
    await waitForState(h.manager, "runway", "connected");
  }
  assert.equal(h.attempts(), 4);
  // A working RPC proves the transport: budget goes back to full.
  await h.manager.callTool("runway", "models_explore", {});
  h.clients[h.clients.length - 1].onclose?.();
  await h.waitForAttempt(5);
  await waitForState(h.manager, "runway", "connected");
  // That drop consumed 1 of the fresh budget; reset again via RPC so the next
  // exhaustion loop starts from a full budget (auto-reconnect success itself
  // never resets — that is the contract under test).
  await h.manager.callTool("runway", "models_explore", {});
  // Exhaust the budget again without RPC, then verify explicit connect() also resets it.
  for (let drop = 0; drop < 3; drop += 1) {
    h.clients[h.clients.length - 1].onclose?.();
    await h.waitForAttempt(6 + drop);
    await waitForState(h.manager, "runway", "connected");
  }
  h.clients[h.clients.length - 1].onclose?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.manager.status("runway").state, "offline");
  const attemptsBefore = h.attempts();
  await h.manager.connect("runway");
  assert.equal(h.attempts(), attemptsBefore + 1);
  assert.equal(h.manager.status("runway").state, "connected");
  h.clients[h.clients.length - 1].onclose?.();
  await h.waitForAttempt(attemptsBefore + 2);
  await waitForState(h.manager, "runway", "connected");
});

test("stale-generation RPC success cannot reset the current reconnect budget (010-B audit R1)", async (t) => {
  const callGate = deferred();
  let gated = true;
  const h = makeHarness(t, {
    reconnectDelayMs: 0,
    callTool: async () => { if (gated) { gated = false; await callGate.promise; } return {}; },
  });
  await h.manager.connect("runway");
  const staleCall = h.manager.callTool("runway", "x", {}); // old generation, parked on gate
  await h.manager.refresh("runway"); // new generation
  // Exhaust the new generation's budget with consecutive drops (no successful RPC).
  for (let drop = 0; drop < 3; drop += 1) {
    h.clients[h.clients.length - 1].onclose?.();
    await h.waitForAttempt(3 + drop);
    await waitForState(h.manager, "runway", "connected");
  }
  h.clients[h.clients.length - 1].onclose?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.manager.status("runway").state, "offline");
  const attemptsBefore = h.attempts();
  // Stale RPC completes now: it must NOT restore the exhausted budget.
  callGate.resolve();
  await staleCall;
  h.clients[h.clients.length - 1]?.onclose?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.attempts(), attemptsBefore);
  assert.equal(h.manager.status("runway").state, "offline");
});
