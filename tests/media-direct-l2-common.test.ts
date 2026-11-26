// L2 direct adapters share these helpers; the contract they hold is that
// HTTP statuses map to stable categories and secrets never reach a message.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MediaAdapterError, categoryForStatus, mediaError, normalizeUnknownError, redactSecrets,
} from "../lib/providers/media/direct/_l2/errors.ts";
import { sendJson } from "../lib/providers/media/direct/_l2/http.ts";
import { mimeFromUrl, urlOrDataUri } from "../lib/providers/media/direct/_l2/inputs.ts";
import { assertKnownOptions } from "../lib/providers/media/direct/_l2/validate.ts";

test("status codes map to the contract categories", () => {
  const seen = [400, 401, 402, 403, 404, 408, 422, 429, 500, 503, 504].map((s) => [s, categoryForStatus(s)]);
  assert.deepEqual(seen, [
    [400, "invalid-request"], [401, "auth"], [402, "quota"], [403, "auth"], [404, "not-found"],
    [408, "timeout"], [422, "invalid-request"], [429, "rate-limit"], [500, "upstream"], [503, "upstream"], [504, "timeout"],
  ]);
});

test("mediaError joins the prefix once and derives retryable from the category", () => {
  assert.equal(mediaError("BYTEPLUS_", "RATE_LIMIT", "rate-limit", "slow").code, "BYTEPLUS_RATE_LIMIT");
  assert.equal(mediaError("KLING", "AUTH", "auth", "no").code, "KLING_AUTH");
  assert.equal(mediaError("KLING", "AUTH", "auth", "no").retryable, false);
  assert.equal(mediaError("KLING", "BUSY", "upstream", "no").retryable, true);
});

test("redactSecrets removes the key, bearer tokens and JWTs", () => {
  const key = "sk-live-0123456789abcdef";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmNkZWZnaCJ9.c2lnbmF0dXJlLXZhbHVl";
  const out = redactSecrets(`bad key ${key}; Authorization: Bearer abcdefghijk; token ${jwt}`, [key]);
  assert.ok(!out.includes(key));
  assert.ok(!out.includes("abcdefghijk"));
  assert.ok(!out.includes(jwt));
});

test("normalizeUnknownError keeps adapter errors and classifies aborts and network failures", () => {
  const detail = mediaError("VIDU", "X", "quota", "m");
  assert.equal(normalizeUnknownError("VIDU", new MediaAdapterError(detail)), detail);
  const abort = new Error("a"); abort.name = "AbortError";
  assert.equal(normalizeUnknownError("VIDU", abort).code, "VIDU_ABORTED");
  const timeout = new Error("t"); timeout.name = "TimeoutError";
  assert.equal(normalizeUnknownError("VIDU", timeout).category, "timeout");
  assert.equal(normalizeUnknownError("VIDU", new TypeError("fetch failed")).category, "upstream");
});

test("sendJson returns error statuses and redacts a key echoed in a non-JSON body", async () => {
  const key = "secret-key-123456";
  const fetchStub = (async () => new Response(`invalid key ${key}`, { status: 401 })) as typeof fetch;
  const res = await sendJson({ apiKey: key, fetch: fetchStub }, "X", { url: "https://x.test/a" });
  assert.equal(res.status, 401);
  assert.ok(!JSON.stringify(res.body).includes(key));
});

test("inputs become URLs or data URIs and output mime follows the extension", () => {
  assert.equal(urlOrDataUri("X", { role: "first-frame", url: "https://a/b.png", mimeType: "image/png" }), "https://a/b.png");
  assert.equal(urlOrDataUri("X", { role: "first-frame", bytes: new Uint8Array([1, 2]), mimeType: "image/png" }), "data:image/png;base64,AQI=");
  assert.equal(mimeFromUrl("https://cdn/x.webp?sig=1", "image"), "image/webp");
  assert.equal(mimeFromUrl("https://cdn/x", "video"), "video/mp4");
});

test("unknown vendor options are refused", () => {
  assert.deepEqual(assertKnownOptions("X", { a: 1 }, ["a"]), { a: 1 });
  assert.throws(() => assertKnownOptions("X", { b: 1 }, ["a"]), (e: unknown) => e instanceof MediaAdapterError && e.detail.code === "X_UNKNOWN_OPTION");
});
