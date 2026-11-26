// Sume publisher for workflow video inputs: link request, key-less PUT, public URL. Fake transport only.
import test from "node:test";
import assert from "node:assert/strict";
import { createSumePublisher } from "../lib/providers/media/publishInput.ts";

const KEY = "sume-test-key-1234567890";

test("publishes bytes with a Sume upload link and returns the public URL; the key never reaches storage", async () => {
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body });
    if (String(url).endsWith("/v1/files/generate-upload-url")) {
      return Response.json({ data: { upload_url: "https://storage.example/put?sig=1", upload_method: "PUT", upload_headers: { "Content-Type": "video/mp4" }, public_url: "https://media.example/a/source.mp4" } });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const publish = createSumePublisher(KEY, fetchImpl, "https://api.example");
  const out = await publish({ role: "source-video", bytes: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }, new AbortController().signal);
  assert.deepEqual(out, { url: "https://media.example/a/source.mp4" });
  assert.equal(calls[0]?.url, "https://api.example/v1/files/generate-upload-url");
  assert.equal(calls[0]?.auth, "Bearer " + KEY);
  assert.deepEqual(JSON.parse(String(calls[0]?.body)), { content_type: "video/mp4", size_bytes: 3 });
  assert.equal(calls[1]?.url, "https://storage.example/put?sig=1");
  assert.equal(calls[1]?.auth, null, "the storage PUT carries no API key");
});

test("a refused link or upload is a coded publish error", async () => {
  const deny = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(createSumePublisher(KEY, deny)({ role: "source-video", bytes: new Uint8Array([1]), mimeType: "video/mp4" }, new AbortController().signal),
    (e: { code?: string; options?: { category?: string } }) => e.code === "WORKFLOW_PUBLISH_FAILED" && e.options?.category === "auth");
});
