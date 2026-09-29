import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertOwned, isolateExecution } from "./_executionRouteIsolation.ts";
import { drain, installTrackedWrites } from "./_executionTrackedWrites.ts";
import { listenOwnedLoopback } from "./_grokImageTransportFixture.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

const isolation = await isolateExecution();
// grok-lane cases resolve an OAuth bearer from ~/.progrok/auth.json; isolate that HOME.
const grokAuth = seedGrokAuth();
const { imageTransport } = isolation;
const deniedFetch = globalThis.fetch;
const originalFetch = isolation.nativeFetch;
let appOrigin: string | undefined;
let appServer: import("node:http").Server | undefined;
let closeDb: (() => void) | undefined;
let restoreWrites: (() => void) | undefined;
after(async () => {
  try { await drain(); }
  finally {
    try { closeDb?.(); restoreWrites?.(); }
    finally { try { await isolation.close(); } finally { grokAuth.cleanup(); } }
  }
});
afterEach(async () => {
  try {
    await imageTransport.deactivate();
    assert.deepEqual(imageTransport.violations, []);
  } finally { globalThis.fetch = deniedFetch; }
});

const { config } = await import("../config.js");
for (const key of ["configDir", "dbPath", "generatedDir", "trashDir", "generationRequestLogFile"] as const) {
  assertOwned(isolation.rootDir, config.storage[key]);
}
({ closeDb } = await import("../lib/db.js"));
restoreWrites = await installTrackedWrites();
const { registerGenerateRoutes } = await import("../routes/generate.ts");
const { registerEditRoutes } = await import("../routes/edit.ts");
const { registerMultimodeRoutes } = await import("../routes/multimode.ts");
const { registerNodeRoutes } = await import("../routes/nodes.ts");

const FINAL_B64 = await pngB64();
const SECOND_B64 = await pngB64({ alpha: true });
const PARTIAL_B64 = Buffer.from("partial image").toString("base64");

async function fetchOwnedApp(url: Parameters<typeof fetch>[0], init?: RequestInit) {
  const target = new URL(url instanceof Request ? url.url : String(url));
  assert.ok(appOrigin && target.origin === appOrigin, "Native fetch is limited to the owned app server");
  assert.ok(appServer);
  return isolation.fetchOwned(appServer, url, { ...init, redirect: "error" });
}

function sseResponse(events) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

function jsonResponse(body, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function imageEvents(images = [FINAL_B64]) {
  return [
    { type: "response.image_generation_call.partial_image", partial_image: PARTIAL_B64, index: 0 },
    ...images.map((result) => ({
      type: "response.output_item.done",
      item: { type: "image_generation_call", result, revised_prompt: "revised" },
    })),
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ];
}

async function withApp(fn, { apiKey = "sk-test" } = {}) {
  const rootDir = await mkdtemp(join(isolation.rootDir, "api-provider-"));
  const generatedDir = join(rootDir, "generated");
  const ctx = {
    rootDir,
    apiKey,
    grokAuthHomeDir: grokAuth.homeDir,
    config: {
      ...config,
      storage: { ...config.storage, generatedDir },
      log: { ...config.log, level: "silent" },
    },
    packageVersion: "test",
  };
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerGenerateRoutes(app, ctx);
  registerEditRoutes(app, ctx);
  registerMultimodeRoutes(app, ctx);
  registerNodeRoutes(app, ctx);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = listenOwnedLoopback(() => app.listen(0, "127.0.0.1", () => resolve(s)));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  appOrigin = baseUrl;
  appServer = server;
  const respond = globalThis.fetch;
  try {
    assert.notEqual(respond, originalFetch);
    assert.notEqual(respond, deniedFetch);
    imageTransport.activate({
      hosts: { "cdn.x.ai": [{ address: "8.8.8.8", family: 4 }] },
      respond: (call) => {
        assert.equal(call.method, "GET");
        assert.equal(call.body, "");
        return respond(call.url, { method: "GET", headers: call.headers, signal: call.signal });
      },
    });
    await fn({ baseUrl, generatedDir });
  } finally {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await imageTransport.deactivate();
      await drain();
    } finally { appOrigin = undefined; appServer = undefined; }
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function pngB64({ alpha = false } = {}) {
  const buffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 255, g: 255, b: 255, alpha: 0.5 } : "#336699",
    },
  }).png().toBuffer();
  return buffer.toString("base64");
}

describe("API provider parity", () => {
  it("generate provider=api calls Responses with API auth and selected options", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      calls.push({ url, init, body: JSON.parse(init.body) });
      return sseResponse(imageEvents());
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "api provider generate",
          provider: "api",
          model: "gpt-5.4",
          reasoningEffort: "high",
          webSearchEnabled: true,
          size: "1024x1024",
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.provider, "api");
      assert.equal(body.model, "gpt-5.4");
      assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
      assert.match(calls[0].init.headers.Authorization, /^Bearer sk-test$/);
      assert.equal(calls[0].body.model, "gpt-5.4");
      assert.equal(calls[0].body.reasoning.effort, "high");
      assert.equal(calls[0].body.tools[0].type, "web_search");
      assert.equal(calls[0].body.tools[1].type, "image_generation");
      assert.deepEqual(calls[0].body.tool_choice, { type: "image_generation" });
    });
  });

  it("generate provider=grok reports one search call for n>1 plan reuse", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned grok prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/png" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-parity-gen.png" }],
        usage: { cost_in_usd_ticks: 1 },
      });
    };

    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "grok provider n two",
          provider: "grok",
          model: "grok-imagine-image-quality",
          size: "2048x1152",
          n: 2,
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.provider, "grok");
      assert.equal(body.count, 2);
      assert.equal(body.webSearchCalls, 1);
      assert.equal(body.images[0].providerUrl, "https://cdn.x.ai/test-parity-gen.png");
      assert.equal(typeof body.images[0].createdAt, "number");
      assert.equal(body.images[1].providerUrl, "https://cdn.x.ai/test-parity-gen.png");
      assert.equal(typeof body.images[1].createdAt, "number");
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/responses")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/chat/completions")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/images/generations")).length, 2);
      assert.equal(imageTransport.calls.length, 2);
      assert.equal(imageTransport.resolutions.length, 2);
    });
  });

  it("generate provider=grok returns provider URL metadata for immediate continue-as-url actions", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned grok prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/png" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-single-gen.png" }],
        usage: { cost_in_usd_ticks: 1 },
      });
    };

    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "grok provider single",
          provider: "grok",
          model: "grok-imagine-image-quality",
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.provider, "grok");
      assert.equal(body.providerUrl, "https://cdn.x.ai/test-single-gen.png");
      assert.equal(typeof body.createdAt, "number");
      assert.equal(imageTransport.calls.length, 1);
      assert.equal(imageTransport.resolutions.length, 1);
    });
  });

  it("generate provider=grok uses providerUrl as an edit reference for classic continue-as-url", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned grok i2i prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/png" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/classic-i2i-output.png" }],
        usage: { cost_in_usd_ticks: 1 },
      });
    };

    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "classic url continue",
          provider: "grok",
          model: "grok-imagine-image-quality",
          providerUrl: "https://cdn.x.ai/source-image.png",
        }),
      });
      const body = await res.json();
      const editCall = calls.find((call) => call.url.endsWith("/v1/images/edits"));
      assert.equal(res.status, 200);
      assert.equal(body.provider, "grok");
      assert.equal(body.providerUrl, "https://cdn.x.ai/classic-i2i-output.png");
      assert.ok(editCall);
      assert.equal(editCall.body.image.url, "https://cdn.x.ai/source-image.png");
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/images/generations")).length, 0);
      assert.equal(imageTransport.calls.length, 1);
      assert.equal(imageTransport.resolutions.length, 1);
    });
  });

  it("edit provider=grok preserves the returned provider URL for local-image i2i outputs", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/jpeg" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/edit-output.jpeg", revised_prompt: "edited local image" }],
        usage: { cost_in_usd_ticks: 2 },
      });
    };

    const image = await pngB64();
    await withApp(async ({ baseUrl, generatedDir }) => {
      const res = await fetch(`${baseUrl}/api/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "edit this local image",
          image,
          provider: "grok",
          model: "grok-imagine-image-quality",
        }),
      });
      const body = await res.json();
      const editCall = calls.find((call) => call.url.endsWith("/v1/images/edits"));
      assert.equal(res.status, 200);
      assert.equal(body.provider, "grok");
      assert.equal(body.providerUrl, "https://cdn.x.ai/edit-output.jpeg");
      assert.equal(typeof body.createdAt, "number");
      assert.ok(editCall);
      assert.match(editCall.body.image.url, /^data:image\/png;base64,/);

      const sidecar = JSON.parse(await readFile(join(generatedDir, `${body.filename}.json`), "utf-8"));
      assert.equal(sidecar.providerUrl, "https://cdn.x.ai/edit-output.jpeg");
      assert.equal(sidecar.kind, "edit");
      assert.equal(sidecar.provider, "grok");
      assert.equal(imageTransport.calls.length, 1);
      assert.equal(imageTransport.resolutions.length, 1);
    });
  });

  it("generate provider=grok counts providerUrl toward the five-reference cap", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      calls.push({ url: String(url), body: init?.body });
      return Response.json({ error: "unexpected upstream" }, { status: 500 });
    };

    const ref = await pngB64();
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "grok provider url too many refs",
          provider: "grok",
          model: "grok-imagine-image-quality",
          providerUrl: "https://cdn.x.ai/source-image.png",
          // The url occupies a slot, so five classic references plus it is six inputs —
          // one past the cap xAI raised to 5 on 2026-09-08.
          references: [ref, ref, ref, ref, ref],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      // Five references pass the shared maxRefCount gate; it is the provider check
      // that counts providerUrl as a sixth input and refuses.
      assert.equal(body.code, "GROK_REF_TOO_MANY");
      assert.equal(calls.length, 0);
    });
  });

  it("generate provider=grok rejects more than five classic references before upstream", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      calls.push({ url: String(url), body: init?.body });
      return Response.json({ error: "unexpected upstream" }, { status: 500 });
    };

    const ref = await pngB64();
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "grok too many refs",
          provider: "grok",
          model: "grok-imagine-image-quality",
          references: [ref, ref, ref, ref, ref, ref],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      // Six references trip the shared limits.maxRefCount gate (5) before the
      // provider-specific one, now that the grok lane's own cap rose to match it.
      // Both are real; this asserts which fires first.
      assert.equal(body.code, "REF_TOO_MANY");
      assert.equal(calls.length, 0);
    });
  });

  it("generate provider=api forces the image tool when web search is off", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      calls.push({ body: JSON.parse(init.body) });
      return sseResponse(imageEvents());
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "api provider no search",
          provider: "api",
          webSearchEnabled: false,
        }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(calls[0].body.tools.map((tool) => tool.type), ["image_generation"]);
      assert.deepEqual(calls[0].body.tool_choice, { type: "image_generation" });
    });
  });

  it("provider=api requires an API key before upstream", async () => {
    let upstreamHits = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      upstreamHits++;
      return sseResponse(imageEvents());
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "missing key", provider: "api" }),
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.code, "API_KEY_REQUIRED");
      assert.equal(upstreamHits, 0);
    }, { apiKey: null });
  });

  it("provider=api sanitizes upstream 4xx messages before route responses", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      return jsonResponse({
        error: {
          message: "Bad prompt private prompt text data:image/png;base64,AAAA sk-test-secret",
          code: "invalid_value",
          type: "invalid_request_error",
          param: "input[1].content",
        },
      });
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "private prompt text",
          provider: "api",
        }),
      });
      const body = await res.json();
      const serialized = JSON.stringify(body);
      assert.equal(res.status, 400);
      assert.equal(body.code, "INVALID_REQUEST");
      assert.equal(body.upstreamCode, "invalid_value");
      assert.equal(body.upstreamType, "invalid_request_error");
      assert.equal(body.upstreamParam, "input[1].content");
      assert.match(body.error, /OpenAI rejected the image request parameters/);
      assert.doesNotMatch(serialized, /private prompt text/);
      assert.doesNotMatch(serialized, /data:image/);
      assert.doesNotMatch(serialized, /AAAA/);
      assert.doesNotMatch(serialized, /sk-test-secret/);
    });
  });

  it("edit provider=api sends input image and mask guidance", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      calls.push(JSON.parse(init.body));
      return sseResponse(imageEvents());
    };
    const image = await pngB64();
    const mask = await pngB64({ alpha: true });
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "edit inside mask", image, mask, provider: "api" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.provider, "api");
      const content = calls[0].input[1].content;
      assert.ok(content.some((item) => item.type === "input_image"));
      assert.ok(content.some((item) => item.type === "input_text" && /mask guide/.test(item.text)));
      assert.deepEqual(calls[0].tool_choice, { type: "image_generation" });
    });
  });

  it("multimode provider=api preserves SSE image and done envelope", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      return sseResponse(imageEvents([FINAL_B64, SECOND_B64]));
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate/multimode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "two stages", provider: "api", maxImages: 2 }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.match(text, /event: phase/);
      assert.match(text, /event: image/);
      assert.match(text, /event: done/);
      assert.ok(text.indexOf("event: image") < text.indexOf("event: done"));
      assert.equal((text.match(/event: image/g) || []).length, 2);
      assert.match(text, /"provider":"api"/);
      assert.match(text, /"requested":2/);
      assert.match(text, /"returned":2/);
    });
  });

  it("multimode provider=api converts zero returned images into an SSE error", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      return sseResponse(imageEvents([]));
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate/multimode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "empty stages", provider: "api", maxImages: 1 }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.match(text, /event: error/);
      assert.doesNotMatch(text, /event: done/);
      assert.match(text, /"code":"EMPTY_RESPONSE"/);
      assert.match(text, /"returned":0/);
    });
  });

  it("node provider=api preserves SSE partial and done envelope", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return fetchOwnedApp(url, init);
      }
      return sseResponse(imageEvents());
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/node/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ prompt: "node api", provider: "api", requestId: "req_node_api" }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.match(text, /event: phase/);
      assert.match(text, /event: partial/);
      assert.match(text, /event: done/);
      assert.match(text, /"provider":"api"/);
    });
  });

  it("node provider=grok uses planned Images API output without Responses SSE partials", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{ type: "message", content: [{ type: "output_text", text: "Node visual brief." }] }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned node grok prompt", model: "grok-imagine-image" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/jpeg" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-parity-node.png" }],
        usage: { cost_in_usd_ticks: 3 },
      });
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/node/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          prompt: "node grok",
          provider: "grok",
          model: "grok-imagine-image",
          quality: "high",
          requestId: "req_node_grok",
        }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.match(text, /event: phase/);
      assert.doesNotMatch(text, /event: partial/);
      assert.match(text, /event: done/);
      assert.match(text, /"provider":"grok"/);
      assert.match(text, /"format":"jpeg"/);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/responses")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/chat/completions")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/images/generations")).length, 1);
      assert.equal(calls.find((call) => call.url.endsWith("/v1/images/generations"))?.body.model, "grok-imagine-image-2.0");
      assert.equal(imageTransport.calls.length, 1);
      assert.equal(imageTransport.resolutions.length, 1);
    });
  });

  it("node provider=grok rejects more than five total reference images before upstream", async () => {
    const reference = await pngB64();
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      throw new Error(`unexpected upstream call: ${String(url)}`);
    };
    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/node/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "too many node grok refs",
          provider: "grok",
          references: [reference, reference, reference, reference, reference, reference],
        }),
      });
      const body = await res.json() as any;
      assert.equal(res.status, 400);
      // Same ordering as the classic route: the shared maxRefCount gate answers first
      // now that the grok lane's own cap is also 5.
      assert.equal(body.error.code, "REF_TOO_MANY");
    });
  });
});

describe("grok web-search toggle (070 QA regression)", () => {
  it("generate provider=grok honors webSearchEnabled:false — zero search calls and zero webSearchCalls", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) {
        return fetchOwnedApp(url, init);
      }
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: { name: "generate_image", arguments: JSON.stringify({ prompt: "planned grok prompt" }) },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from(FINAL_B64, "base64"), { headers: { "Content-Type": "image/png" } });
      }
      return Response.json({ data: [{ url: "https://cdn.x.ai/test-toggle.png" }], usage: { cost_in_usd_ticks: 1 } });
    };

    await withApp(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "grok no search please", provider: "grok", webSearchEnabled: false }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.webSearchEnabled, false);
      assert.equal(body.webSearchCalls, 0);
      assert.equal(calls.filter((c) => c.url.endsWith("/v1/responses")).length, 0, "no forced web search when disabled");
      assert.equal(calls.filter((c) => c.url.endsWith("/v1/chat/completions")).length, 1, "planner still runs without search");
      assert.equal(calls.filter((c) => c.url.endsWith("/v1/images/generations")).length, 1);
      assert.equal(imageTransport.calls.length, 1);
      assert.equal(imageTransport.resolutions.length, 1);
    });
  });
});
