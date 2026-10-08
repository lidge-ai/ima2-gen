import test from "node:test";
import assert from "node:assert/strict";
import { generateViaApi88Image } from "../lib/api88/imageTransport.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";
import { api88Origin } from "../lib/api88/origin.ts";
import { parseApi88GeminiImage } from "../lib/api88/geminiParse.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { config } from "../config.ts";

const originalFetch = globalThis.fetch;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const b64 = png.toString("base64");
const uri = `data:image/png;base64,${b64}`;
const reference = { b64, declaredMime: "image/png", detectedMime: "image/png" };
function context() {
  return createTestRuntimeContext({ api88ImageKey: "synthetic-image", api88VideoKey: "synthetic-video",
    config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://gateway.example/v1/" } } });
}
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("origin strips one trailing v1 and rejects unsafe configuration shapes", () => {
  assert.equal(api88Origin("https://gateway.example/v1///"), "https://gateway.example");
  assert.equal(api88Origin("http://127.0.0.1:8111/v1"), "http://127.0.0.1:8111");
  for (const value of ["http://public.example", "https://user:pass@gateway.example", "https://gateway.example?q=1", "ftp://gateway.example"]) {
    assert.throws(() => api88Origin(value), { code: "API88_BASE_URL_INVALID" });
  }
});

test("image option normalization preserves IDs and never accepts a video or unverified model", () => {
  const ctx = context();
  const options = resolveProviderOptions(ctx, { provider: "88api", rawModel: "gpt-image-2.5-flare", rawWebSearchEnabled: true, rawReasoningEffort: "high" });
  assert.equal(options.provider, "88api"); assert.equal(options.model, "gpt-image-2.5-flare");
  assert.equal(options.reasoningEffort, "none"); assert.equal(options.webSearchEnabled, false);
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: "grok-imagine-image" }).code, "API88_MODEL_UNVERIFIED");
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: " gpt-image-2" }).code, "API88_MODEL_UNSUPPORTED");
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: "SD2.5 720P" }).code, "API88_MODEL_UNSUPPORTED");
});

test("GPT generation fixes endpoint, image bearer, n and size without quality or response_format", async () => {
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls++;
    assert.equal(String(input), "https://gateway.example/v1/images/generations");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
    assert.deepEqual(JSON.parse(String(init?.body)), { model: "gpt-image-2.5-flare", prompt: "city", size: "1024x1024", n: 1 });
    return Response.json({ data: [{ b64_json: b64 }] });
  }) as typeof fetch;
  const result = await generateViaApi88Image("city", context(), { model: "gpt-image-2.5-flare", size: "1792x1024" });
  assert.equal(calls, 1); assert.equal(result.b64, b64); assert.equal(result.mime, "image/png");
});

test("GPT edit multipart includes source first and retains the requested model", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://gateway.example/v1/images/edits");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "gpt-image-2.5-sunburst");
    assert.equal(init.body.get("size"), "1536x1024"); assert.equal(init.body.get("n"), "1");
    assert.equal(init.body.has("quality"), false); assert.equal(init.body.has("response_format"), false);
    const files = init.body.getAll("image[]") as File[];
    assert.equal(files.length, 2);
    assert.deepEqual(Buffer.from(await files[0]!.arrayBuffer()), png);
    assert.deepEqual(Buffer.from(await files[1]!.arrayBuffer()), jpeg);
    return Response.json({ data: [{ b64_json: b64 }] });
  }) as typeof fetch;
  await generateViaApi88Image("edit", context(), { model: "gpt-image-2.5-sunburst", sourceImage: uri,
    references: [{ b64: jpeg.toString("base64"), declaredMime: "image/jpeg", detectedMime: "image/jpeg" }], size: "1536x1024" });
});

for (const model of ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"]) {
  test(`${model} uses chat completions for text and reference requests`, async () => {
    for (const references of [[], [reference]]) {
      globalThis.fetch = (async (input, init) => {
        assert.equal(String(input), "https://gateway.example/v1/chat/completions");
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, model);
        assert.deepEqual(body.messages, [{ role: "user", content: references.length
          ? [{ type: "text", text: "bird" }, { type: "image_url", image_url: { url: uri } }] : "bird" }]);
        return Response.json({ choices: [{ message: { images: [{ image_url: { url: uri } }] } }] });
      }) as typeof fetch;
      assert.equal((await generateViaApi88Image("bird", context(), { model, references })).mime, "image/png");
    }
  });
}

test("Gemini parser handles image fields in required order and rejects text-only answers", () => {
  for (const message of [
    { images: [{ url: uri }], content: "no image" },
    { content: [{ type: "image_url", image_url: { url: uri } }] },
    { content: `![image](${uri})` }, { content: uri },
    { content: "https://cdn.example/out.png?signature=a%2Fb&expires=3" },
  ]) assert.ok(parseApi88GeminiImage({ choices: [{ message }] }).startsWith("data:") || String(message.content).startsWith("https:"));
  assert.equal(parseApi88GeminiImage({ choices: [{ message: { images: [{ url: uri }], content: [{ type: "image_url", image_url: { url: "https://other.example/out.png" } }] } }] }), uri);
  assert.throws(() => parseApi88GeminiImage({ choices: [{ message: { content: "x".repeat(500) } }] }),
    (error: unknown) => error instanceof Error && error.message.length <= 260 && (error as { code?: string }).code === "API88_EMPTY_RESULT");
});

test("result download preserves signed query and sends no Authorization", async () => {
  const signed = "https://cdn.example/out.png?sig=a%2Fb&n=1";
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push(String(input));
    if (String(input) === "https://gateway.example/v1/images/generations") return Response.json({ data: [{ url: signed }] });
    assert.equal(String(input), signed); assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(init?.redirect, "follow");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  const result = await generateViaApi88Image("city", context());
  assert.deepEqual(calls, ["https://gateway.example/v1/images/generations", signed]);
  assert.equal(result.providerUrl, signed);
});

test("missing image key, hidden models and masks fail before HTTP, regardless of video key", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected HTTP"); }) as typeof fetch;
  for (const key of [undefined, "", "   "]) {
    const ctx = context(); ctx.api88ImageKey = key;
    await assert.rejects(() => generateViaApi88Image("city", ctx), { code: "API88_IMAGE_KEY_MISSING", status: 401 });
  }
  for (const model of getProvider("88api").models.filter((row) => "status" in row).map((row) => row.id)) {
    await assert.rejects(() => generateViaApi88Image("city", context(), { model }), { code: "API88_MODEL_UNVERIFIED" });
  }
  await assert.rejects(() => generateViaApi88Image("city", context(), { mask: b64 }), { code: "API88_MASK_UNSUPPORTED" });
  assert.equal(calls, 0);
});

for (const status of [400, 401, 403, 429, 502]) {
  test(`HTTP ${status} never retries or changes endpoint`, async () => {
    let calls = 0;
    globalThis.fetch = (async (input) => {
      calls++; assert.equal(String(input), "https://gateway.example/v1/images/generations");
      return new Response("failure", { status });
    }) as typeof fetch;
    await assert.rejects(() => generateViaApi88Image("city", context()), { status });
    assert.equal(calls, 1);
  });
}

test("download bounds and byte detection reject HTML and oversized bodies", async () => {
  for (const response of [new Response("<html>error</html>"), new Response(png, { headers: { "Content-Length": "999999999" } })]) {
    globalThis.fetch = (async (input) => String(input).endsWith("/images/generations")
      ? Response.json({ data: [{ url: "https://cdn.example/out.png" }] }) : response) as typeof fetch;
    await assert.rejects(() => generateViaApi88Image("city", context()),
      (error: unknown) => ["API88_IMAGE_INVALID", "API88_DOWNLOAD_TOO_LARGE"].includes(String((error as { code?: string }).code)));
  }
});

test("pre-aborted image work makes no HTTP call", async () => {
  globalThis.fetch = (async () => { throw new Error("unexpected HTTP"); }) as typeof fetch;
  const controller = new AbortController(); const reason = new Error("cancelled"); controller.abort(reason);
  await assert.rejects(() => generateViaApi88Image("city", context(), { signal: controller.signal }), (error) => error === reason);
});
