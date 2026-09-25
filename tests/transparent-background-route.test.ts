// Behavioral tests: these drive the REAL /api/generate pipeline over HTTP
// rather than asserting on source text, so they catch wiring regressions that
// a regex contract cannot (adversarial review 260821, blocker 6).
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { registerGenerateRoutes } from "../routes/generate.ts";

// GPT OAuth plans on /v1/responses and renders on /v1/images/generations; the render call is
// where background reaches gpt-image-2, so that is the payload under test.
type RenderPayload = { model?: string; background?: string; output_format?: string };
type UpstreamBody = RenderPayload | null;
type ErrorBody = { code?: string; error?: string };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/** Answers the planner, captures the render payload, then fails the render on purpose. */
async function withHarness(
  run: (ctx: { appUrl: string; captured: () => UpstreamBody }) => Promise<void>,
): Promise<void> {
  let capturedBody: UpstreamBody = null;
  const oauthServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.url === "/v1/responses") {
        const call = { type: "function_call", call_id: "call_1", name: "image_gen", arguments: JSON.stringify({ prompt: "a red apple cutout" }) };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end([{ type: "response.output_item.done", item: call }, { type: "response.completed", response: {} }]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
        return;
      }
      try { capturedBody = JSON.parse(raw) as UpstreamBody; } catch { capturedBody = null; }
      // Fail the generation deliberately: only the request shape is under test.
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "harness stop", type: "invalid_request_error", code: "invalid_value" } }));
    });
  });
  const oauthUrl = await listen(oauthServer);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-transparent-"));
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  registerGenerateRoutes(app, {
    rootDir: process.cwd(),
    oauthUrl,
    config: { ...config, storage: { ...config.storage, generatedDir } },
  });
  const appServer = createServer(app);
  const appUrl = await listen(appServer);
  try {
    await run({ appUrl, captured: () => capturedBody });
  } finally {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => oauthServer.close(() => resolve()));
    await rm(generatedDir, { recursive: true, force: true });
  }
}

function post(appUrl: string, body: Record<string, unknown>): Promise<Response> {
  // Unique per call: the inflight registry rejects a reused requestId with 409,
  // which would mask the status code under test.
  const requestId = `req_t_${Math.random().toString(36).slice(2, 10)}`;
  return fetch(`${appUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "a red apple cutout", quality: "low", size: "1024x1024", moderation: "low", n: 1, requestId, ...body }),
  });
}

function renderPayload(body: UpstreamBody): RenderPayload {
  assert.equal(body?.model, "gpt-image-2", "no gpt-image-2 render call reached upstream");
  return body as RenderPayload;
}

test("transparent request asks gpt-image-2 for a transparent background on the OAuth lane", async () => {
  await withHarness(async ({ appUrl, captured }) => {
    await post(appUrl, { provider: "oauth", backgroundPreset: "transparent" });
    // Measured 2026-09-25: the ChatGPT Images endpoint returns a real alpha PNG for this.
    assert.equal(renderPayload(captured()).background, "transparent");
  });
});

test("opaque presets leave the render payload untouched", async () => {
  await withHarness(async ({ appUrl, captured }) => {
    await post(appUrl, { provider: "oauth", backgroundPreset: "chroma-green" });
    const render = renderPayload(captured());
    assert.ok(!("background" in render), "background must not appear for matte presets");
    assert.ok(!("output_format" in render), "output_format must not appear for matte presets");
  });
});

test("the canonical format field cannot smuggle jpeg past the alpha guard", async () => {
  await withHarness(async ({ appUrl, captured }) => {
    const res = await post(appUrl, { provider: "oauth", backgroundPreset: "transparent", format: "jpeg" });
    assert.equal(res.status, 400);
    const json = (await res.json()) as ErrorBody;
    assert.equal(json.code, "TRANSPARENT_FORMAT_CONFLICT");
    // Must be refused BEFORE any upstream spend.
    assert.equal(captured(), null, "request reached upstream despite the conflict");
  });
});

test("webp is accepted as an alpha-capable format", async () => {
  await withHarness(async ({ appUrl, captured }) => {
    const res = await post(appUrl, { provider: "oauth", backgroundPreset: "transparent", format: "webp" });
    assert.notEqual(((await res.json()) as ErrorBody).code, "TRANSPARENT_FORMAT_CONFLICT");
    assert.equal(renderPayload(captured()).background, "transparent");
  });
});

test("a lane without an alpha parameter refuses transparent instead of billing for an opaque image", async () => {
  await withHarness(async ({ appUrl, captured }) => {
    const res = await post(appUrl, { provider: "grok", backgroundPreset: "transparent" });
    assert.equal(res.status, 400);
    const json = (await res.json()) as ErrorBody;
    assert.equal(json.code, "TRANSPARENT_PROVIDER_UNSUPPORTED");
    assert.equal(captured(), null, "grok request should never reach upstream");
  });
});

test("unknown background presets are still rejected", async () => {
  await withHarness(async ({ appUrl }) => {
    const res = await post(appUrl, { provider: "oauth", backgroundPreset: "see-through" });
    assert.equal(res.status, 400);
    const json = (await res.json()) as ErrorBody;
    assert.equal(json.code, "INVALID_BACKGROUND_PRESET");
  });
});
