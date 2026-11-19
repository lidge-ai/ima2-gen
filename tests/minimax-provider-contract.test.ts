import test from "node:test";
import assert from "node:assert/strict";
import { generateViaMinimax, MINIMAX_TEXT_TO_IMAGE_MODEL, MINIMAX_IMAGE_TO_IMAGE_MODEL } from "../lib/minimaxImageAdapter.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";

const originalFetch = globalThis.fetch;

// Real magic bytes: the adapter validates payloads against the detected image
// signature, so placeholder text would (correctly) be rejected as non-image.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG_B64 = JPEG_BYTES.toString("base64");
const PNG_B64 = PNG_BYTES.toString("base64");

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function minimaxCtx(over: Record<string, unknown> = {}) {
  return createTestRuntimeContext({
    minimaxApiKey: "mm-test-key",
    config: {
      minimaxProvider: {
        defaultImageModel: "image-01",
        region: "global_en",
        globalBaseUrl: "https://api.minimax.io/v1",
        cnBaseUrl: "https://api.minimaxi.com/v1",
        generationTimeoutMs: 120_000,
      },
    },
    ...over,
  } as never);
}

test("minimax provider options normalize model and disable unsupported controls", () => {
  const resolved = resolveProviderOptions(minimaxCtx(), {
    provider: "minimax",
    rawModel: "image-01",
    rawReasoningEffort: "high",
    rawWebSearchEnabled: true,
    rawSize: "1024x1024",
  });

  assert.equal(resolved.provider, "minimax");
  assert.equal(resolved.model, "image-01");
  assert.equal(resolved.reasoningEffort, "none");
  assert.equal(resolved.webSearchEnabled, false);
  assert.equal(resolved.size, "1024x1024");
});

test("minimax provider options reject an unknown model", () => {
  const resolved = resolveProviderOptions(minimaxCtx(), {
    provider: "minimax",
    rawModel: "image-99",
  });
  assert.equal(resolved.code, "INVALID_MINIMAX_IMAGE_MODEL");
  assert.equal(resolved.status, 400);
});

test("minimax adapter requires MINIMAX_API_KEY", async () => {
  await assert.rejects(
    () => generateViaMinimax("city skyline", createTestRuntimeContext()),
    (err: any) => err?.code === "MINIMAX_API_KEY_MISSING" && err?.status === 401,
  );
});

test("minimax adapter submits a text-to-image request and parses a url response", async () => {
  const calls: Array<{ url: string; body?: any; headers?: Record<string, string> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, body, headers });

    if (url === "https://api.minimax.io/v1/image_generation") {
      return Response.json({
        data: { image_urls: ["https://cdn.example/out.jpg"] },
        metadata: { success_count: 1, failed_count: 0 },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    if (url === "https://cdn.example/out.jpg") {
      return new Response(JPEG_BYTES, { headers: { "content-type": "image/jpeg" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await generateViaMinimax("city skyline", minimaxCtx(), {
    model: "image-01",
    size: "1024x1024",
  });

  assert.equal(calls[0].url, "https://api.minimax.io/v1/image_generation");
  assert.equal(calls[0].headers?.Authorization, "Bearer mm-test-key");
  assert.equal(calls[0].headers?.["Content-Type"], "application/json");
  assert.deepEqual(calls[0].body, {
    model: "image-01",
    prompt: "city skyline",
    response_format: "url",
    aspect_ratio: "1:1",
  });
  assert.equal(result.b64, JPEG_B64);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(result.providerUrl, "https://cdn.example/out.jpg");
});

test("minimax adapter maps references to subject_reference and keeps the requested model", async () => {
  const calls: Array<{ body?: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url === "https://api.minimax.io/v1/image_generation") {
      calls.push({ body });
      return Response.json({
        data: { image_base64: [PNG_B64] },
        metadata: { success_count: 1, failed_count: 0 },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await generateViaMinimax("same character", minimaxCtx(), {
    model: MINIMAX_TEXT_TO_IMAGE_MODEL,
    references: [{ b64: Buffer.from("ref").toString("base64"), declaredMime: "image/png" }],
  });

  // image-01 accepts subject_reference, so attaching one must not silently
  // swap the model the user picked (the stored provenance would then lie).
  assert.equal(calls[0].body.model, MINIMAX_TEXT_TO_IMAGE_MODEL);
  assert.equal(result.effectiveModel, MINIMAX_TEXT_TO_IMAGE_MODEL);
  assert.ok(Array.isArray(calls[0].body.subject_reference));
  assert.equal(calls[0].body.subject_reference[0].type, "character");
  assert.match(calls[0].body.subject_reference[0].image_file, /^data:image\/png;base64,/);
  assert.equal(result.b64, PNG_B64);
});

test("minimax adapter routes to the China base url for the cn_zh region", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://api.minimaxi.com/v1/image_generation") {
      return Response.json({
        data: { image_base64: [PNG_B64] },
        metadata: { success_count: 1, failed_count: 0 },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const cnCtx = minimaxCtx({
    config: {
      minimaxProvider: {
        defaultImageModel: "image-01",
        region: "cn_zh",
        globalBaseUrl: "https://api.minimax.io/v1",
        cnBaseUrl: "https://api.minimaxi.com/v1",
        generationTimeoutMs: 120_000,
      },
    },
  });
  await generateViaMinimax("city skyline", cnCtx, { model: MINIMAX_TEXT_TO_IMAGE_MODEL });
  assert.ok(urls.includes("https://api.minimaxi.com/v1/image_generation"));
});

test("minimax adapter rejects more than one subject reference", async () => {
  await assert.rejects(
    () => generateViaMinimax("two refs", minimaxCtx(), {
      references: [
        { b64: "AAAA", declaredMime: "image/png" },
        { b64: "BBBB", declaredMime: "image/png" },
      ],
    }),
    (err: any) => err?.code === "MINIMAX_REF_TOO_MANY" && err?.status === 400,
  );
});

test("minimax adapter surfaces content-safety blocks as a safety error", async () => {
  globalThis.fetch = (async () => {
    return Response.json({
      data: { image_urls: [] },
      metadata: { success_count: 0, failed_count: 1 },
      base_resp: { status_code: 0, status_msg: "success" },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("blocked", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_SAFETY_BLOCKED" && err?.status === 400,
  );
});

test("minimax adapter surfaces upstream base_resp auth failures", async () => {
  globalThis.fetch = (async () => {
    return Response.json({
      base_resp: { status_code: 2049, status_msg: "invalid api key" },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_AUTH_FAILED" && err?.status === 401,
  );
});

// ── Repair coverage: each case drives the branch it guards ────────────────

test("minimax adapter keeps image-01-live when a reference is attached", async () => {
  const calls: Array<{ body?: any }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ body });
    return Response.json({
      data: { image_base64: [PNG_B64] },
      base_resp: { status_code: 0, status_msg: "success" },
    });
  }) as typeof fetch;

  const result = await generateViaMinimax("same character", minimaxCtx(), {
    model: MINIMAX_IMAGE_TO_IMAGE_MODEL,
    references: [{ b64: Buffer.from("ref").toString("base64"), declaredMime: "image/png" }],
  });

  assert.equal(calls[0].body.model, MINIMAX_IMAGE_TO_IMAGE_MODEL);
  assert.equal(result.effectiveModel, MINIMAX_IMAGE_TO_IMAGE_MODEL);
});

test("minimax adapter rejects image-01-live without a reference outside China", async () => {
  globalThis.fetch = (async () => {
    throw new Error("must not reach the API");
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx(), { model: MINIMAX_IMAGE_TO_IMAGE_MODEL }),
    (err: any) => err?.code === "MINIMAX_MODEL_REQUIRES_REFERENCE" && err?.status === 400,
  );
});

test("minimax adapter allows image-01-live text-to-image in the cn_zh region", async () => {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return Response.json({
      data: { image_base64: [PNG_B64] },
      base_resp: { status_code: 0, status_msg: "success" },
    });
  }) as typeof fetch;

  const cnCtx = minimaxCtx({
    config: {
      minimaxProvider: {
        defaultImageModel: "image-01",
        region: "cn_zh",
        globalBaseUrl: "https://api.minimax.io/v1",
        cnBaseUrl: "https://api.minimaxi.com/v1",
        generationTimeoutMs: 120_000,
      },
    },
  });
  const result = await generateViaMinimax("city skyline", cnCtx, {
    model: MINIMAX_IMAGE_TO_IMAGE_MODEL,
  });

  assert.equal(calls[0].url, "https://api.minimaxi.com/v1/image_generation");
  assert.equal(result.effectiveModel, MINIMAX_IMAGE_TO_IMAGE_MODEL);
});

test("minimax adapter maps a request timeout to 504, not a network failure", async () => {
  globalThis.fetch = (async () => {
    // AbortSignal.timeout() rejects with TimeoutError, not AbortError.
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "GENERATION_TIMEOUT" && err?.status === 504,
  );
});

test("minimax adapter reads string safety counters as a content block", async () => {
  globalThis.fetch = (async () => Response.json({
    data: {},
    // MiniMax documents these counters as strings in its response samples.
    metadata: { success_count: "0", failed_count: "1" },
    base_resp: { status_code: 0, status_msg: "success" },
  })) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("blocked prompt", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_SAFETY_BLOCKED" && err?.status === 400,
  );
});

test("minimax adapter rejects a download that declares more than 50MB", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/image_generation")) {
      return Response.json({
        data: { image_urls: ["https://cdn.example/huge.png"] },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    return new Response(PNG_BYTES, {
      headers: { "content-type": "image/png", "content-length": String(64 * 1024 * 1024) },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE",
  );
});

test("minimax adapter caps a stream that lies about its length", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  chunk.set(PNG_BYTES);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/image_generation")) {
      return Response.json({
        data: { image_urls: ["https://cdn.example/endless.png"] },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    // No content-length: the cap has to hold while the bytes arrive.
    return new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(chunk);
        },
      }),
      { headers: { "content-type": "image/png" } },
    );
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE",
  );
});

test("minimax adapter rejects a non-HTTP provider url", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/image_generation")) {
      return Response.json({
        data: { image_urls: ["file:///etc/passwd"] },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_DOWNLOAD_FAILED",
  );
});

test("minimax adapter rejects a downloaded body that is not an image", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/image_generation")) {
      return Response.json({
        data: { image_urls: ["https://cdn.example/error.html"] },
        base_resp: { status_code: 0, status_msg: "success" },
      });
    }
    // A CDN error page served with a lying image content-type.
    return new Response(Buffer.from("<html>gateway error</html>"), {
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_INVALID" && err?.status === 502,
  );
});

test("minimax adapter rejects inline base64 that is not an image", async () => {
  globalThis.fetch = (async () => Response.json({
    data: { image_base64: [Buffer.from("<html>nope</html>").toString("base64")] },
    base_resp: { status_code: 0, status_msg: "success" },
  })) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_INVALID",
  );
});

test("minimax adapter rejects an oversized inline base64 payload", async () => {
  // MiniMax could ignore response_format:"url" and inline a huge payload; the
  // URL path is capped, so the inline path has to be capped too.
  const huge = PNG_B64 + "A".repeat(80 * 1024 * 1024);
  globalThis.fetch = (async () => Response.json({
    data: { image_base64: [huge] },
    base_resp: { status_code: 0, status_msg: "success" },
  })) as typeof fetch;

  await assert.rejects(
    () => generateViaMinimax("city skyline", minimaxCtx()),
    (err: any) => err?.code === "MINIMAX_IMAGE_DOWNLOAD_TOO_LARGE",
  );
});

test("H3 Highspeed uses the China endpoint and a ten-minute timeout", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  const ctx = minimaxCtx();
  ctx.config.minimaxProvider.region = "cn_zh";
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://example.invalid/output.jpg") return new Response(JPEG_BYTES);
    assert.equal(String(input), "https://api.minimax.cn/v1/images/generations");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "MiniMax-H3-Image-Highspeed", prompt: "A red tile", aspect_ratio: "16:9", response_format: "url",
    });
    return Response.json({ data: [{ error: { code: "1027" } }, {
      url: "https://example.invalid/output.jpg", revised_prompt: "A red ceramic tile",
    }] });
  };
  const result = await generateViaMinimax("A red tile", ctx, { model: "MiniMax-H3-Image-Highspeed", size: "16:9" });
  assert.equal(timeout.mock.calls[0]?.arguments[0], 600_000);
  assert.equal(result.b64, JPEG_B64);
  assert.equal(result.revisedPrompt, "A red ceramic tile");
});

test("H3 reports per-image failures and rejects reference inputs before submission", async () => {
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return Response.json({ data: [{ error: { code: "1027", message: "Output withheld" } }] });
  };
  const model = "MiniMax-H3-Image";
  await assert.rejects(generateViaMinimax("tile", minimaxCtx(), { model }), { code: "MINIMAX_SAFETY_BLOCKED" });
  await assert.rejects(generateViaMinimax("tile", minimaxCtx(), { model, references: [{ b64: PNG_B64 }] }), { code: "MINIMAX_BAD_REQUEST" });
  assert.equal(count, 1);
});

test("agent H3 generation does not repeat an upstream no-image response", async () => {
  const { generateAgentImageWithRetry } = await import("../lib/agentImageVideoGen.ts");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: "No image data (1000)" } }, { status: 500 });
  };
  await assert.rejects(
    generateAgentImageWithRetry(minimaxCtx(), "fixture", "A tile", "", false, {
      provider: "minimax", model: "MiniMax-H3-Image",
    }),
    { code: "MINIMAX_UPSTREAM_ERROR" },
  );
  assert.equal(calls, 1);
});
