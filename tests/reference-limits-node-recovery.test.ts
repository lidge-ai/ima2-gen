import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Run: node --import tsx --test tests/reference-limits-node-recovery.test.ts
// Runtime-only bridge: no TS fixture casts, module mocks, or historical sources.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const BLOCKED = "reference recovery test: network forbidden";

class FakeStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

// Only the browser transport is fake. No socket, reconnect event, or server exists.
class FakeEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.OPEN;
  addEventListener() {}
  close() { this.readyState = FakeEventSource.CLOSED; }
}

function installGlobals(attempts) {
  const replacements = {
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
    EventSource: FakeEventSource,
    fetch: async (url, options) => {
      attempts.push({ url: String(url), method: options?.method, body: options?.body });
      throw new Error(BLOCKED);
    },
  };
  const saved = new Map(Object.keys(replacements).map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

async function loadConsumer() {
  try {
    const result = await build({
      stdin: { resolveDir: repoRoot, contents: `
        export { effectiveReferenceLimit } from "./ui/src/lib/referenceLimits.ts";
        export { mapSessionToGraph } from "./ui/src/store/storeGraphSave.ts";
        export { runGenerateNodeInPlaceImpl } from "./ui/src/store/storeNodeGenImpl.ts";
        export { disconnect } from "./ui/src/lib/eventChannel.ts";
      ` },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      // The sole source define emulates Vite's config, not application behavior.
      define: { "import.meta.env": "{}" },
    });
    const bridge = { exports: {} };
    // Evaluate only esbuild's trusted, current-checkout output. CJS is a test
    // loading bridge for extensionless UI imports, NOT production CJS code.
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      createRequire(join(repoRoot, "ui", "reference-recovery-bridge.cjs")),
      bridge, bridge.exports,
    );
    return bridge.exports;
  } catch (error) {
    throw new Error("Could not bundle the real node consumer", { cause: error });
  }
}

function restoreSavedGraph(sessionStore, consumer, provider) {
  const session = sessionStore.createSession({ title: `reference recovery: ${provider}` });
  const nodeId = `recovery-${provider}`;
  sessionStore.saveGraph(session.id, {
    expectedVersion: 0,
    nodes: [{ id: nodeId, x: 0, y: 0, data: {
      provider, prompt: "synthetic reference recovery", model: "gpt-5.6-luna",
    } }],
    edges: [],
  });
  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.nodes[0].data.provider, provider);
  assert.equal(stored.graphVersion, 1);
  const state = {
    ...consumer.mapSessionToGraph(stored),
    provider: "oauth", referenceLimit: 5, videoModelSelected: false, mcpProvider: null,
    activeSessionId: session.id, inFlight: [], activeGenerations: 0,
    imageModel: "gpt-5.6-luna", quality: "auto", format: "png", moderation: "auto",
    reasoningEffort: "medium", webSearchEnabled: false, storyboardActive: false,
    getResolvedSize: () => "1024x1024",
    startInFlightPolling() {}, showToast() {}, showErrorCard() {},
    // Persistence was exercised above; background saves/polling are out of scope.
    scheduleGraphSave() {}, flushGraphSave: async () => {},
  };
  assert.equal(state.graphNodes[0].data.provider, provider);
  assert.equal(state.graphNodes[0].data.status, "empty");
  return { state, nodeId };
}

async function invokeNode(consumer, fixture) {
  try {
    const value = await consumer.runGenerateNodeInPlaceImpl(fixture.nodeId, {},
      (patch) => Object.assign(fixture.state, patch), () => fixture.state, () => {});
    return { value, error: null };
  } catch (error) {
    // Capture to let the SAME node's retry run even when the first assertion is RED.
    return { value: undefined, error };
  }
}

function assertSettledError(state) {
  const data = state.graphNodes[0].data;
  assert.equal(data.status, "error");
  assert.equal(data.error, BLOCKED);
  assert.equal(data.pendingRequestId, null);
  assert.equal(data.pendingPhase, null);
  assert.equal(data.pendingStartedAt, null);
  assert.equal(state.activeGenerations, 0);
  assert.deepEqual(state.inFlight, []);
}

function assertAttempt(attempt, provider, fixture) {
  assert.equal(attempt.url, "/api/node/generate");
  assert.equal(attempt.method, "POST");
  const payload = JSON.parse(attempt.body);
  assert.equal(payload.provider, provider);
  assert.equal(payload.clientNodeId, fixture.nodeId);
  assert.equal(payload.sessionId, fixture.state.activeSessionId);
}

async function checkRecovery(t, context, provider) {
  const { sessionStore, consumer, attempts } = context;
  const fixture = restoreSavedGraph(sessionStore, consumer, provider);
  const before = attempts.length;
  const first = await invokeNode(consumer, fixture);
  await t.test(`${provider}: first restored run handles failure without escaping`, () => {
    assert.equal(first.error, null, `unexpected escaped exception: ${first.error?.message}`);
    assert.equal(first.value, null); // Expected blocked transport, not generation success.
    assert.equal(attempts.length, before + 1);
    assertAttempt(attempts[before], provider, fixture);
    assertSettledError(fixture.state);
  });
  fixture.state.graphNodes[0].data.provider = "oauth";
  const beforeRetry = attempts.length;
  const retry = await invokeNode(consumer, fixture);
  await t.test(`${provider}: correcting to oauth retries the same node without a leaked lock`, () => {
    assert.equal(retry.error, null);
    assert.equal(attempts.length, beforeRetry + 1,
      "corrected node must attempt a request, not return locked null");
    assertAttempt(attempts[beforeRetry], "oauth", fixture);
    assert.equal(retry.value, null);
    assertSettledError(fixture.state);
  });
  await t.test(`${provider}: absent surface metadata preserves numeric server limit`, () => {
    assert.equal(consumer.effectiveReferenceLimit({
      provider, serverLimit: 5, videoModelSelected: false, mcpProvider: null,
    }), 5);
  });
}

test("BUG-R1: saved non-core providers do not poison node generation recovery", async (t) => {
  const ownedDir = mkdtempSync(join(tmpdir(), "ima2-reference-node-recovery-"));
  const envKeys = ["IMA2_CONFIG_DIR", "IMA2_DB_PATH", "DOTENV_CONFIG_PATH"];
  const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const attempts = [];
  let restoreGlobals = () => {};
  let db;
  let consumer;
  try {
    // Must precede ALL dynamic application imports; do not override HOME or read
    // real credentials. An owned empty config also prevents repo-config fallback.
    writeFileSync(join(ownedDir, "config.json"), "{}");
    writeFileSync(join(ownedDir, ".env"), "");
    process.env.DOTENV_CONFIG_PATH = join(ownedDir, ".env");
    process.env.IMA2_CONFIG_DIR = ownedDir;
    process.env.IMA2_DB_PATH = join(ownedDir, "sessions.db");
    restoreGlobals = installGlobals(attempts);
    db = await import("../lib/db.ts");
    assert.equal(db.getDbPath(), process.env.IMA2_DB_PATH);
    const sessionStore = await import("../lib/sessionStore.ts");
    consumer = await loadConsumer();
    for (const provider of ["auto", "legacy-unknown-provider", "constructor", "__proto__", "toString"]) {
      await checkRecovery(t, { sessionStore, consumer, attempts }, provider);
    }
  } finally {
    try {
      consumer?.disconnect();
      db?.closeDb();
    } finally {
      restoreGlobals();
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(ownedDir, { recursive: true, force: true });
    }
  }
});
