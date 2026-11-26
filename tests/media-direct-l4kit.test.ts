import test from "node:test";
import assert from "node:assert/strict";
import { resolveInputBytes } from "../lib/providers/media/direct/_l4kit/inputBytes.ts";
import { byteResultRef, readSyncResult, urlResultRef } from "../lib/providers/media/direct/_l4kit/syncJobs.ts";
import { normalizeUnknownError } from "../lib/providers/media/direct/_l4kit/errors.ts";

const failing = (async () => { throw new Error("no network expected"); }) as typeof fetch;

test("resolveInputBytes returns bytes as-is and fetches https URLs without credentials", async () => {
  const bytes = new Uint8Array([9, 8]);
  assert.deepEqual(await resolveInputBytes("X", { apiKey: "k", fetch: failing }, { role: "source-image", bytes, mimeType: "image/png" }),
    { bytes, mimeType: "image/png" });
  const seen: Array<{ url: string; headers: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: init?.headers });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;
  const out = await resolveInputBytes("X", { apiKey: "secret-key-123456", fetch: fetchImpl },
    { role: "source-image", url: "https://cdn.example/a.jpg", mimeType: "" });
  assert.deepEqual([...out.bytes], [1, 2, 3]);
  assert.equal(out.mimeType, "image/jpeg");
  assert.equal(seen[0]?.headers, undefined);
});

test("resolveInputBytes refuses non-https URLs and oversized bodies", async () => {
  await assert.rejects(() => resolveInputBytes("X", { apiKey: "k", fetch: failing }, { role: "mask", url: "http://cdn/a.png", mimeType: "image/png" }),
    (err) => normalizeUnknownError("X", err).code === "X_INPUT_URL_INVALID");
  const big = (async () => new Response(new Uint8Array(11))) as typeof fetch;
  await assert.rejects(() => resolveInputBytes("X", { apiKey: "k", fetch: big }, { role: "mask", url: "https://cdn/a.png", mimeType: "image/png" }, 10),
    (err) => normalizeUnknownError("X", err).code === "X_INPUT_TOO_LARGE");
});

test("sync results: URL refs survive serialization, byte refs expire instead of re-running", () => {
  const urlRef = JSON.parse(JSON.stringify(urlResultRef([{ kind: "image", url: "https://r/x.png", mimeType: "image/png" }])));
  assert.deepEqual(readSyncResult("X", urlRef), { status: "succeeded", outputs: [{ kind: "image", url: "https://r/x.png", mimeType: "image/png" }] });
  const now = 1_000_000;
  const byteRef = byteResultRef([{ kind: "audio", bytes: new Uint8Array([1]), mimeType: "audio/mpeg" }], now);
  assert.equal(readSyncResult("X", byteRef, now + 1).status, "succeeded");
  assert.equal(readSyncResult("X", byteRef, now + 2).status, "succeeded", "a repeat poll sees the same result");
  const expired = readSyncResult("X", byteRef, now + 31 * 60 * 1000);
  assert.equal(expired.status === "failed" && expired.error.code, "X_RESULT_EXPIRED");
});
