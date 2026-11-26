import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MediaHttpError, httpJson, normalizeMediaError, parkSyncResult, readVendorOptions, redact, takeSyncResult,
} from "../lib/providers/media/direct/l3-http.js";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.js";

const KEY = "sk-test-SECRET-123456";

function ctxReturning(status: number, body: string): { ctx: MediaAdapterContext; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { ctx: { apiKey: KEY, fetch: fakeFetch }, calls };
}

test("httpJson sends JSON with the given headers and parses the body", async () => {
  const { ctx, calls } = ctxReturning(200, '{"id":"j1"}');
  const out = await httpJson<{ id: string }>(ctx, "Submit", "https://api.example/v1/jobs", {
    headers: { Authorization: "Bearer " + KEY }, json: { a: 1 },
  });
  assert.equal(out.id, "j1");
  const [url, init] = calls[0]!;
  assert.equal(url, "https://api.example/v1/jobs");
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(init.body, '{"a":1}');
});

test("an HTTP failure is classified and the echoed key is scrubbed", async () => {
  const cases: [number, string, string, boolean][] = [
    [401, "AUTH", "auth", false], [402, "INSUFFICIENT_CREDIT", "quota", false],
    [404, "NOT_FOUND", "not-found", false], [422, "INVALID_REQUEST", "invalid-request", false],
    [429, "RATE_LIMITED", "rate-limit", true], [503, "UPSTREAM", "upstream", true],
  ];
  for (const [status, reason, category, retryable] of cases) {
    const { ctx } = ctxReturning(status, '{"error":"bad key ' + KEY + '"}');
    const error = await httpJson(ctx, "Submit", "https://api.example").catch((e: unknown) => e);
    assert.ok(error instanceof MediaHttpError);
    const normalized = normalizeMediaError("DEMO", error, [KEY]);
    assert.equal(normalized.code, "DEMO_" + reason);
    assert.equal(normalized.category, category);
    assert.equal(normalized.retryable, retryable);
    assert.equal(normalized.status, status);
    assert.ok(!normalized.message.includes(KEY), "key leaked for " + status);
  }
});

test("a classify hook can override the status mapping", async () => {
  const { ctx } = ctxReturning(400, '{"code":"insufficient_credits"}');
  const error = await httpJson(ctx, "Submit", "https://api.example", {
    classify: (_s, body) => body.includes("insufficient") ? { reason: "INSUFFICIENT_CREDIT", category: "quota" } : undefined,
  }).catch((e: unknown) => e);
  assert.equal(normalizeMediaError("DEMO", error).code, "DEMO_INSUFFICIENT_CREDIT");
});

test("normalizeMediaError maps plain errors and never leaks secrets", () => {
  const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
  assert.equal(normalizeMediaError("DEMO", timeout).category, "timeout");
  assert.equal(normalizeMediaError("DEMO", new TypeError("fetch failed")).code, "DEMO_NETWORK");
  const other = normalizeMediaError("DEMO", "token " + KEY, [KEY]);
  assert.equal(other.code, "DEMO_UNKNOWN");
  assert.ok(!other.message.includes(KEY));
  assert.equal(normalizeMediaError("DEMO", undefined).category, "unknown");
  assert.equal(redact("abc", ["abc"]), "abc", "values shorter than 6 chars are not treated as secrets");
});

test("normalizeMediaError scrubs common key shapes even without the key value", () => {
  const samples = [
    "sk-live-ABCDEFGHIJKLMNOP", "xai-ABCDEFGHIJKLMNOPQRSTUV", "AIzaSyA1234567890abcdefghijklmnopqrstu",
    "Bearer eyJhbGciOiJSUzI1NiJ9.payload", "ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz",
  ];
  for (const secret of samples) {
    const out = normalizeMediaError("DEMO", new Error("upstream said " + secret + " is invalid"));
    assert.ok(!out.message.includes(secret), secret);
    assert.match(out.message, /upstream said \[redacted\] is invalid/);
  }
  assert.equal(normalizeMediaError("DEMO", new Error("video too long")).message, "video too long");
});

test("unknown vendorOptions are refused, known ones pass through", () => {
  const request = { model: "m", task: "lipsync", inputs: [], vendorOptions: { mode: "x", extra: 1 } } as MediaSubmitRequest;
  assert.throws(() => readVendorOptions(request, ["mode"]), /Unknown vendorOptions: extra/);
  assert.deepEqual(readVendorOptions({ ...request, vendorOptions: { mode: "x" } }, ["mode"]), { mode: "x" });
});

test("a parked synchronous result is handed out once, then reads as expired", () => {
  const job = parkSyncResult("DEMO", { status: "succeeded", outputs: [{ kind: "audio", bytes: new Uint8Array([1]), mimeType: "audio/mpeg" }] });
  assert.equal(takeSyncResult("DEMO", job).status, "succeeded");
  const again = takeSyncResult("DEMO", job);
  assert.equal(again.status, "failed");
  assert.equal(again.status === "failed" && again.error.code, "DEMO_RESULT_EXPIRED");
});
