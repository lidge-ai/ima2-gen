import test from "node:test";
import assert from "node:assert/strict";
import { adapter, bflJobState } from "../lib/providers/media/direct/bfl.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";

const KEY = "bfl_test_key_0123456789";

interface Call { url: string; method: string; headers: Record<string, string>; body: any }

function fakeFetch(responses: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${call.url}`);
    return next(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function ctx(fetchImpl: typeof fetch, extra?: Record<string, string>): MediaAdapterContext {
  return extra ? { apiKey: KEY, fetch: fetchImpl, extra } : { apiKey: KEY, fetch: fetchImpl };
}

const accepted = (id = "task-1", host = "https://api.us1.bfl.ai") => () =>
  Response.json({ id, polling_url: `${host}/v1/get_result?id=${id}` });

function request(partial: Partial<MediaSubmitRequest>): MediaSubmitRequest {
  return { model: "black-forest-labs/flux-kontext-max", task: "text-to-image", prompt: "a red fox", inputs: [], ...partial };
}

test("bfl submits Kontext max text-to-image with x-key and returns the polling URL", async () => {
  const { calls, fetchImpl } = fakeFetch([accepted()]);
  const job = await adapter.submit(ctx(fetchImpl), request({ aspectRatio: "16:9", seed: 7 }));
  assert.equal(calls[0]?.url, "https://api.bfl.ai/v1/flux-kontext-max");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.headers["x-key"], KEY);
  assert.deepEqual(calls[0]?.body, { prompt: "a red fox", aspect_ratio: "16:9", seed: 7 });
  assert.equal(job.providerJobId, "task-1");
  assert.equal(job.resume?.["pollingUrl"], "https://api.us1.bfl.ai/v1/get_result?id=task-1");
  assert.equal(job.resume?.["outputFormat"], "png");
});

test("bfl inlines a source image as base64 for Kontext edits", async () => {
  const { calls, fetchImpl } = fakeFetch([accepted()]);
  await adapter.submit(ctx(fetchImpl), request({
    task: "image-to-image",
    inputs: [{ role: "source-image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    vendorOptions: { output_format: "jpeg", safety_tolerance: 2 },
  }));
  assert.equal(calls[0]?.body.input_image, "AQID");
  assert.equal(calls[0]?.body.output_format, "jpeg");
});

test("bfl maps FLUX.2 ratios to width/height and numbers extra reference slots", async () => {
  const { calls, fetchImpl } = fakeFetch([accepted()]);
  await adapter.submit(ctx(fetchImpl), request({
    model: "black-forest-labs/flux-2-pro",
    task: "image-to-image",
    aspectRatio: "16:9",
    inputs: [
      { role: "source-image", url: "https://example.com/a.png", mimeType: "image/png" },
      { role: "reference-image", url: "https://example.com/b.png", mimeType: "image/png" },
    ],
  }));
  const body = calls[0]?.body;
  assert.equal(calls[0]?.url, "https://api.bfl.ai/v1/flux-2-pro");
  assert.equal(body.width, 1344);
  assert.equal(body.height, 768);
  assert.equal(body.aspect_ratio, undefined);
  assert.equal(body.input_image, "https://example.com/a.png");
  assert.equal(body.input_image_2, "https://example.com/b.png");
});

test("bfl sends FLUX 3 references as an images array with a resolution tier", async () => {
  const { calls, fetchImpl } = fakeFetch([accepted()]);
  const job = await adapter.submit(ctx(fetchImpl), request({
    model: "black-forest-labs/flux-3-image",
    task: "image-to-image",
    resolution: "2k",
    inputs: [{ role: "reference-image", url: "https://example.com/a.png", mimeType: "image/png" }],
  }));
  assert.deepEqual(calls[0]?.body, { prompt: "a red fox", images: ["https://example.com/a.png"], resolution: "2k" });
  assert.equal(job.resume?.["outputFormat"], undefined);
});

test("bfl refuses fields and options the model does not support before any network call", async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  const cases: Array<[Partial<MediaSubmitRequest>, string]> = [
    [{ vendorOptions: { webhook_url: "https://x" } }, "BFL_UNKNOWN_OPTION"],
    [{ negativePrompt: "blur" }, "BFL_UNSUPPORTED_PARAM"],
    [{ count: 2 }, "BFL_UNSUPPORTED_PARAM"],
    [{ model: "black-forest-labs/flux-3-image", seed: 1 }, "BFL_UNSUPPORTED_PARAM"],
    [{ inputs: [{ role: "source-image", url: "https://e/a.png", mimeType: "image/png" }] }, "BFL_UNEXPECTED_INPUT"],
    [{ task: "image-to-image" }, "BFL_INPUT_REQUIRED"],
    [{ task: "image-upscale" }, "BFL_UNSUPPORTED_TASK"],
    [{ model: "black-forest-labs/nope" }, "BFL_UNKNOWN_MODEL"],
  ];
  for (const [partial, code] of cases) {
    await assert.rejects(() => adapter.submit(ctx(fetchImpl), request(partial)), (err) => adapter.normalizeError(err).code === code);
  }
  assert.equal(calls.length, 0);
});

test("bfl refuses a polling URL on a foreign host instead of sending the key there", async () => {
  const { fetchImpl } = fakeFetch([accepted("t", "https://evil.example")]);
  await assert.rejects(() => adapter.submit(ctx(fetchImpl), request({})), (err) => {
    const e = adapter.normalizeError(err);
    return e.code === "BFL_UNTRUSTED_POLLING_URL" && !e.message.includes(KEY);
  });
});

test("bfl poll walks Pending and Generating to Ready with a signed URL", async () => {
  const { calls, fetchImpl } = fakeFetch([
    () => Response.json({ id: "task-1", status: "Pending" }),
    () => Response.json({ id: "task-1", status: "Generating", progress: 0.5 }),
    () => Response.json({ id: "task-1", status: "Ready", result: { sample: "https://delivery-us1.bfl.ai/r/sample.png?sig=1" } }),
  ]);
  const job = { providerJobId: "task-1", resume: { pollingUrl: "https://api.us1.bfl.ai/v1/get_result?id=task-1", outputFormat: "png" } };
  assert.deepEqual(await adapter.poll(ctx(fetchImpl), job), { status: "running" });
  assert.deepEqual(await adapter.poll(ctx(fetchImpl), job), { status: "running", progress: 0.5 });
  const done = await adapter.poll(ctx(fetchImpl), job);
  assert.equal(calls[0]?.headers["x-key"], KEY);
  assert.equal(calls[0]?.url, "https://api.us1.bfl.ai/v1/get_result?id=task-1");
  assert.equal(done.status, "succeeded");
  if (done.status !== "succeeded") return;
  assert.equal(done.outputs[0]?.url, "https://delivery-us1.bfl.ai/r/sample.png?sig=1");
  assert.equal(done.outputs[0]?.mimeType, "image/png");
  assert.equal(done.outputs[0]?.downloadHeaders, undefined);
  assert.ok(done.outputs[0]?.expiresAt);
});

test("bfl maps terminal statuses to normalized failures", () => {
  const state = (status: string) => bflJobState({ text: "", json: { id: "t", status, details: { "Moderation Reasons": ["x"] } } }, "jpeg");
  const expect = (status: string, code: string, category: string) => {
    const result = state(status);
    assert.equal(result.status, "failed", status);
    if (result.status !== "failed") return;
    assert.equal(result.error.code, code);
    assert.equal(result.error.category, category);
    assert.equal(result.error.providerState, status);
  };
  expect("Content Moderated", "BFL_MODERATED", "moderation");
  expect("Request Moderated", "BFL_MODERATED", "moderation");
  expect("Task not found", "BFL_TASK_NOT_FOUND", "not-found");
  expect("Error", "BFL_GENERATION_FAILED", "upstream");
  expect("No Card Generated", "BFL_GENERATION_FAILED", "upstream");
  expect("Sideways", "BFL_UNEXPECTED_STATUS", "unknown");
  assert.deepEqual(state("Reasoning"), { status: "running" });
});

test("bfl falls back to the URL extension, then octet-stream, when no format is known", () => {
  const ready = (sample: string) => bflJobState({ text: "", json: { status: "Ready", result: { sample } } }, undefined);
  const a = ready("https://delivery.bfl.ai/x/sample.webp?s=1");
  const b = ready("https://delivery.bfl.ai/x/sample?s=1");
  assert.equal(a.status === "succeeded" && a.outputs[0]?.mimeType, "image/webp");
  assert.equal(b.status === "succeeded" && b.outputs[0]?.mimeType, "application/octet-stream");
});

test("bfl HTTP errors are classified and never echo the key", async () => {
  const echo = (status: number) => () => Response.json({ detail: `bad key ${KEY}` }, { status });
  const { fetchImpl } = fakeFetch([echo(402), echo(429), echo(422), echo(503)]);
  const expected: Array<[string, string, boolean]> = [
    ["BFL_INSUFFICIENT_CREDIT", "quota", false],
    ["BFL_RATE_LIMITED", "rate-limit", true],
    ["BFL_INVALID_REQUEST", "invalid-request", false],
    ["BFL_UPSTREAM", "upstream", true],
  ];
  for (const [code, category, retryable] of expected) {
    await assert.rejects(() => adapter.submit(ctx(fetchImpl), request({})), (err) => {
      const e = adapter.normalizeError(err);
      assert.equal(e.code, code);
      assert.equal(e.category, category);
      assert.equal(e.retryable, retryable);
      assert.ok(!e.message.includes(KEY), e.message);
      assert.ok(e.message.includes("[redacted]"));
      return true;
    });
  }
});

test("bfl validateKey reads /v1/credits on the chosen region and redacts failures", async () => {
  const { calls, fetchImpl } = fakeFetch([
    () => Response.json({ credits: 12 }),
    () => Response.json({ detail: `Invalid key ${KEY}` }, { status: 403 }),
  ]);
  assert.deepEqual(await adapter.validateKey(ctx(fetchImpl, { region: "eu" })), { ok: true });
  assert.equal(calls[0]?.url, "https://api.eu.bfl.ai/v1/credits");
  assert.equal(calls[0]?.method, "GET");
  const bad = await adapter.validateKey(ctx(fetchImpl));
  assert.equal(bad.ok, false);
  assert.ok(bad.reason && !bad.reason.includes(KEY));
  assert.deepEqual(await adapter.validateKey({ apiKey: "", fetch: fetchImpl }), { ok: false, reason: "API key is not configured" });
});

test("bfl reports a missing key and network failures with stable codes", async () => {
  const { fetchImpl } = fakeFetch([() => { throw new TypeError("fetch failed"); }]);
  await assert.rejects(() => adapter.submit({ apiKey: " ", fetch: fetchImpl }, request({})),
    (err) => adapter.normalizeError(err).code === "BFL_API_KEY_MISSING");
  await assert.rejects(() => adapter.submit(ctx(fetchImpl), request({})), (err) => {
    const e = adapter.normalizeError(err);
    return e.code === "BFL_NETWORK" && e.retryable;
  });
});

test("bfl catalog lists Kontext max under the Sume id with a sourced price", () => {
  const kontext = adapter.listModels().find((m) => m.id === "black-forest-labs/flux-kontext-max");
  assert.ok(kontext);
  assert.equal(kontext.upstreamId, "flux-kontext-max");
  assert.deepEqual(kontext.pricing.map((p) => [p.unit, p.usd]), [["image", 0.08]]);
  for (const model of adapter.listModels()) {
    assert.ok(model.pricing.every((p) => p.source.startsWith("https://bfl.ai/pricing") && p.checkedAt === "2026-11-26"), model.id);
  }
});
