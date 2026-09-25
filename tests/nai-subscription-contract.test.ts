import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import test, { mock } from "node:test";
import express from "express";
import config from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { generateViaNai } from "../lib/naiImageAdapter.ts";
import {
  classifyNai402, fetchNaiSubscription, isNaiBatteryModel,
  naiAnlasAvailable, naiBatteryExhausted, parseNaiSubscription,
} from "../lib/naiSubscription.ts";
import type { QuotaResult } from "../routes/quota.ts";

// Keep mounted quota tests independent of the developer's local credentials.
mock.module("node:fs", { namedExports: {
  ...realFs,
  readFileSync: (...args: unknown[]) => String(args[0]).endsWith("auth.json")
    ? "{}" : Reflect.apply(readFileSync, undefined, args),
} });
const { fetchNaiQuota, registerQuotaRoutes } = await import("../routes/quota.ts");
// The Codex usage lane reads ~/.codex/auth.json and friends with async fs, which
// the mock above does not cover; give it a store with no session instead.
const { setCodexSessionStoreForTests } = await import("../lib/codexBackend/index.ts");
const noCodexSession = async (): Promise<never> => { throw new Error("no ChatGPT session in tests"); };
setCodexSessionStoreForTests({ get: noCodexSession, refresh: noCodexSession });
test.after(() => { setCodexSessionStoreForTests(null); });
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; mock.restoreAll(); });

// Issue #193's measured fields, with no live account identifiers.
const fixture = {
  tier: 3, active: true,
  perks: { maxPriorityActions: 1000, startPriority: 10, unlimitedMaxPriority: true, moduleTrainingSteps: 10000 },
  trainingStepsLeft: { fixedTrainingStepsLeft: 4000, purchasedTrainingSteps: 0 },
  usage: { percent: 2, isNegative: false, timeUntilNextPercent: 7888 },
};
const emptyAnlas = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 };
const exhausted = { ...fixture, trainingStepsLeft: emptyAnlas, usage: { ...fixture.usage, isNegative: true } };

function naiCtx(key: string | undefined = "fixture-token") {
  return createTestRuntimeContext({
    naiApiKey: key,
    config: { ...config, naiProvider: { ...config.naiProvider, accountBaseUrl: "https://account.example.test/" } },
  });
}

function stubSequence(...responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.ok(responses.length, "unexpected extra upstream request");
    return responses.shift()!;
  };
  return calls;
}

async function getQuota(ctx = naiCtx()): Promise<{ codex: QuotaResult; grok: QuotaResult; nai: QuotaResult }> {
  const app = express();
  registerQuotaRoutes(app, ctx);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    return await new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/quota" }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            assert.equal(res.statusCode, 200);
            resolve(JSON.parse(body));
          } catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("subscription parses the issue fixture into separate battery and Anlas meters", () => {
  assert.deepEqual(parseNaiSubscription(fixture), {
    active: true, tier: 3,
    battery: { percent: 2, isNegative: false, timeUntilNextPercentSec: 7888 },
    anlas: { fixed: 4000, purchased: 0 },
  });
});

test("subscription locates a moved nested meter and skips an earlier invalid percent", () => {
  const { usage, ...rest } = fixture;
  assert.deepEqual(parseNaiSubscription({ ...rest, old: { percent: Infinity }, renamed: { meter: usage } }),
    parseNaiSubscription(fixture));
  const first = parseNaiSubscription({ active: true, a: { percent: 5 }, b: { percent: 9 } });
  assert.equal(first?.battery?.percent, 5);
});

test("subscription validates finite numbers without coercing strings or inventing a meter", () => {
  for (const value of [null, undefined, [], 3, "body", {}, { active: "true" }]) {
    assert.equal(parseNaiSubscription(value), null);
  }
  for (const percent of [undefined, null, "2", NaN, Infinity, -Infinity]) {
    assert.equal(parseNaiSubscription({ active: true, usage: { percent } })?.battery, null);
  }
  for (const invalid of [undefined, "0", NaN, Infinity, -Infinity]) {
    assert.deepEqual(parseNaiSubscription({
      active: false, tier: invalid,
      usage: { percent: 0, isNegative: "true", timeUntilNextPercent: invalid },
      trainingStepsLeft: { fixedTrainingStepsLeft: invalid, purchasedTrainingSteps: invalid },
    }), {
      active: false, tier: null,
      battery: { percent: 0, isNegative: false, timeUntilNextPercentSec: null },
      anlas: { fixed: 0, purchased: 0 },
    });
  }
});

test("subscription never reads or forwards identity or token fields", () => {
  const input = { ...fixture };
  for (const key of ["email", "id", "user_id", "userId", "token", "accessToken", "rawBody"]) {
    Object.defineProperty(input, key, { enumerable: true, get() { assert.fail(`read forbidden field ${key}`); } });
  }
  const result = parseNaiSubscription(input);
  assert.deepEqual(result, parseNaiSubscription(fixture));
  assert.doesNotMatch(JSON.stringify(result), /email|userId|user_id|token|rawBody|"id"/i);
});

test("battery predicates keep missing meters, V4.5, and available Anlas distinct", () => {
  for (const model of ["nai-diffusion-5-full", "nai-diffusion-5-curated"]) assert.equal(isNaiBatteryModel(model), true);
  for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated", "other"]) assert.equal(isNaiBatteryModel(model), false);
  assert.equal(naiBatteryExhausted(parseNaiSubscription({ active: true })!), false);
  assert.equal(naiBatteryExhausted(parseNaiSubscription(fixture)!), false);
  for (const usage of [{ percent: 0 }, { percent: -1 }, { percent: 2, isNegative: true }]) {
    assert.equal(naiBatteryExhausted(parseNaiSubscription({ active: true, usage })!), true);
  }
  assert.equal(naiAnlasAvailable(parseNaiSubscription(fixture)!), true);
  assert.equal(naiAnlasAvailable(parseNaiSubscription(exhausted)!), false);
  assert.equal(naiAnlasAvailable(parseNaiSubscription({ ...fixture,
    trainingStepsLeft: { ...emptyAnlas, purchasedTrainingSteps: 1 },
  })!), true);
});

test("subscription fetch uses the configured account host and generation header parity", async () => {
  const calls = stubSequence(Response.json(fixture));
  assert.deepEqual(await fetchNaiSubscription(naiCtx()), { ok: true, snapshot: parseNaiSubscription(fixture) });
  assert.equal(calls[0].url, "https://account.example.test/user/subscription");
  assert.deepEqual(calls[0].init?.headers, { Authorization: "Bearer fixture-token", "Content-Type": "application/json" });
  assert.equal(calls[0].init?.body, undefined);
});

test("subscription fetch bounds its timeout and handles an aborted probe", async () => {
  const controller = new AbortController();
  const timeout = mock.method(AbortSignal, "timeout", (ms: number) => {
    assert.equal(ms, 5000);
    return controller.signal;
  });
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    controller.abort();
  });
  assert.deepEqual(await fetchNaiSubscription(naiCtx(), { timeoutMs: 60_000 }), { ok: false, status: "error" });
  assert.equal(timeout.mock.callCount(), 1);
});

test("subscription fetch rejects malformed, failed and cancelled responses without exposing details", async () => {
  for (const response of [Response.json({}, { status: 500 }), new Response("{"), Response.json({})]) {
    stubSequence(response);
    assert.deepEqual(await fetchNaiSubscription(naiCtx()), { ok: false, status: "error" });
  }
  globalThis.fetch = async () => { throw new Error("synthetic private detail"); };
  assert.deepEqual(await fetchNaiSubscription(naiCtx()), { ok: false, status: "error" });
  const calls = stubSequence();
  assert.deepEqual(await fetchNaiSubscription(naiCtx(), { signal: AbortSignal.abort() }), { ok: false, status: "error" });
  assert.equal(calls.length, 0);
});

test("mounted quota route returns unauthenticated NAI without a key or on 401", async () => {
  const calls = stubSequence();
  const ctx = naiCtx();
  ctx.naiApiKey = undefined;
  assert.deepEqual((await getQuota(ctx)).nai, { provider: "nai", authenticated: false, windows: [] });
  assert.equal(calls.length, 0);
  stubSequence(Response.json({ message: "private error" }, { status: 401 }));
  assert.deepEqual((await getQuota()).nai, { provider: "nai", authenticated: false, windows: [] });
});

test("mounted quota route contains a subscription 500 as an NAI error", async () => {
  stubSequence(Response.json({ token: "synthetic-private-value" }, { status: 500 }));
  assert.deepEqual((await getQuota()).nai, { provider: "nai", error: true, windows: [] });
});

test("mounted quota route serializes charge, Anlas and the +1 percent ISO ETA without PII", async () => {
  mock.method(Date, "now", () => Date.parse("2026-09-08T00:00:00.000Z"));
  stubSequence(Response.json({ ...fixture, email: "synthetic@example.test", user_id: "fixture-id", token: "fixture-secret" }));
  const result = await getQuota();
  assert.deepEqual(Object.keys(result).sort(), ["codex", "grok", "nai"]);
  assert.deepEqual(result.nai, {
    provider: "nai", account: { email: null, plan: "Tier 3" },
    windows: [{ label: "v5-battery", percent: 2, resetsAt: "2026-09-08T02:11:28.000Z" }],
    nai: { active: true, isNegative: false, anlasFixed: 4000, anlasPurchased: 0, meter: "charge" },
  });
  assert.doesNotMatch(JSON.stringify(result.nai), /synthetic|fixture-id|fixture-secret|token|user_id/);
});

test("quota preserves missing meters and null or out-of-range ETAs", async () => {
  stubSequence(Response.json({ active: false }));
  assert.deepEqual(await fetchNaiQuota(naiCtx()), {
    provider: "nai", account: { email: null, plan: "inactive" }, windows: [],
    nai: { active: false, isNegative: false, anlasFixed: 0, anlasPurchased: 0, meter: "missing" },
  });
  for (const timeUntilNextPercent of [null, Number.MAX_VALUE]) {
    stubSequence(Response.json({ ...fixture, usage: { percent: 0, isNegative: true, timeUntilNextPercent } }));
    const result = await fetchNaiQuota(naiCtx());
    assert.equal(result.windows[0].resetsAt, null);
    assert.equal(result.nai?.isNegative, true);
  }
});

async function assert402(snapshot: unknown, code: string, model = "nai-diffusion-5-full") {
  const calls = stubSequence(Response.json({ message: "payment required" }, { status: 402 }), Response.json(snapshot));
  await assert.rejects(generateViaNai("fixture prompt", naiCtx(), { model }), {
    code, status: 402, isOperational: true,
  });
  return calls;
}

test("V5 generation 402 probes once and identifies exhaustion only without available Anlas", async () => {
  for (const usage of [{ percent: 0 }, { percent: -1 }, { percent: 2, isNegative: true }]) {
    const calls = await assert402({ ...exhausted, usage }, "NAI_USAGE_EXHAUSTED");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/ai\/generate-image$/);
    assert.equal(calls[1].url, "https://account.example.test/user/subscription");
    assert.deepEqual(calls[1].init?.headers, calls[0].init?.headers);
  }
  assert.equal((await assert402(exhausted, "NAI_USAGE_EXHAUSTED", "nai-diffusion-5-curated")).length, 2);
});

test("V5 generation 402 keeps the subscription code for inactive, missing, charged or Anlas-funded accounts", async () => {
  for (const snapshot of [
    { ...exhausted, active: false }, { active: true }, {},
    { ...exhausted, usage: { percent: 2 } },
    { ...exhausted, trainingStepsLeft: { ...emptyAnlas, fixedTrainingStepsLeft: 1 } },
    { ...exhausted, trainingStepsLeft: { ...emptyAnlas, purchasedTrainingSteps: 1 } },
  ]) assert.equal((await assert402(snapshot, "NAI_SUBSCRIPTION_REQUIRED")).length, 2);
});

test("V4.5 generation 402 never sends a subscription probe", async () => {
  for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]) {
    assert.equal((await assert402(exhausted, "NAI_SUBSCRIPTION_REQUIRED", model)).length, 1);
  }
});

test("successful generation stays a single request with null usage", async () => {
  // Minimal stored ZIP entry containing the adapter's recognized PNG signature.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(png.length, 18);
  header.writeUInt32LE(png.length, 22);
  const calls = stubSequence(new Response(Buffer.concat([header, png])));
  const result = await generateViaNai("fixture prompt", naiCtx());
  assert.equal(result.usage, null);
  assert.equal(result.mime, "image/png");
  assert.equal(calls.length, 1);
});

test("402 classifier preserves the operational subscription error when a probe fails or aborts", async () => {
  for (const response of [Response.json({}, { status: 401 }), Response.json({}, { status: 500 })]) {
    stubSequence(response);
    const error = await classifyNai402(naiCtx(), "nai-diffusion-5-full", "generation detail");
    assert.equal(Object.getOwnPropertyDescriptor(error, "code")?.value, "NAI_SUBSCRIPTION_REQUIRED");
  }
  const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(); return Response.json(exhausted); };
  const error = await classifyNai402(naiCtx(), "nai-diffusion-5-full", "generation detail", controller.signal);
  assert.ok(error instanceof Error);
  assert.deepEqual({ ...error }, { status: 402, code: "NAI_SUBSCRIPTION_REQUIRED", isOperational: true });
});
