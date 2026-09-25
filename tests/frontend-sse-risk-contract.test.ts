import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("eventChannel uses exponential reconnect backoff", () => {
  const src = read("ui/src/lib/eventChannel.ts");
  assert.match(src, /RECONNECT_BASE_MS/);
  assert.match(src, /RECONNECT_MAX_MS/);
  assert.match(src, /reconnectAttempt/);
  assert.match(src, /Math\.pow\(1\.5,\s*reconnectAttempt\)/);
  assert.match(src, /Math\.random\(\)/);
  assert.match(src, /Math\.min\(baseDelay[\s\S]*RECONNECT_MAX_MS\)/);
});

test("eventChannel disconnect clears both lifecycle callbacks", () => {
  const src = read("ui/src/lib/eventChannel.ts");
  const disconnectBlock = src.slice(src.indexOf("export function disconnect"));
  assert.match(disconnectBlock, /resyncCallback\s*=\s*null/);
  assert.match(disconnectBlock, /connectionStateCallback\s*=\s*null/);
});

test("events route normalizes duplicate Last-Event-ID values", () => {
  const src = read("routes/events.ts");
  assert.match(src, /Array\.isArray\(value\)\s*\?\s*value\[0\]/);
  assert.match(src, /split\(\s*["']\s*,\s*["']\s*,\s*1\s*\)/);
  assert.doesNotMatch(src, /req\.headers\["last-event-id"\]\s+as\s+string/);
});

test("shared writeSse safely rejects closed or failed responses", () => {
  const src = read("lib/routeHelpers.ts");
  const writeBlock = src.slice(src.indexOf("export function writeSse"), src.indexOf("export function dataUrlFromB64"));
  assert.match(writeBlock, /res\.writableEnded\s*\|\|\s*res\.destroyed/);
  assert.match(writeBlock, /try\s*\{/);
  assert.match(writeBlock, /catch\s*\{/);
  assert.match(writeBlock, /return false/);
  assert.match(writeBlock, /return true/);
});

test("stream clients use parseSseErrorPayload for SSE error events", () => {
  for (const rel of ["ui/src/lib/api-generation.ts", "ui/src/lib/nodeApi.ts"]) {
    const src = read(rel);
    assert.match(src, /parseSseErrorPayload/);
    const streamBlock = rel.includes("nodeApi")
      ? src.slice(src.indexOf("postNodeGenerateStream"))
      : src;
    assert.match(streamBlock, /event === "error"[\s\S]*parseSseErrorPayload/);
  }
});

test("node and video stores treat GENERATION_CANCELED as non-fatal", () => {
  for (const rel of ["ui/src/store/storeNodeGenImpl.ts", "ui/src/store/storeVideoImpl.ts"]) {
    const src = read(rel);
    assert.match(src, /isCanceledGenerationError/);
  }
});

test("sseStreamError handles flat abortJob and nested writeNodeError shapes", async () => {
  const { parseSseErrorPayload } = await import("../ui/src/lib/sseStreamError.ts");
  const flat = parseSseErrorPayload({
    error: "Generation canceled",
    code: "GENERATION_CANCELED",
    status: 499,
    requestId: "fn_1",
  });
  assert.equal(flat.message, "Generation canceled");
  assert.equal(flat.code, "GENERATION_CANCELED");
  assert.equal(flat.status, 499);

  const nested = parseSseErrorPayload({
    error: { code: "UPSTREAM_ERROR", message: "Provider failed" },
    status: 502,
    parentNodeId: null,
  }, "Node generation failed");
  assert.equal(nested.message, "Provider failed");
  assert.equal(nested.code, "UPSTREAM_ERROR");
  assert.equal(nested.status, 502);
});

test("App wires resync to reconcileInflight on SSE reconnect", () => {
  const app = read("ui/src/App.tsx");
  assert.match(app, /ensureConnected\(\)/);
  assert.match(app, /onResync\(\(\)\s*=>\s*reconcileInflight\(\)\)/);
});
