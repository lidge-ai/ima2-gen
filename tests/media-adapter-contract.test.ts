// Contract suite for every registered media adapter (plan 261126, L0). It runs
// against BUILTIN_MEDIA_ADAPTERS automatically, so a lane adapter is checked the
// moment L0 registers it. The fake adapter keeps the suite meaningful while the
// list is empty. No test here reaches a real endpoint: global fetch throws.
import test from "node:test";
import assert from "node:assert/strict";
import type { MediaKind, MediaProviderAdapter, MediaTask } from "../lib/providers/media/contract.ts";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.ts";
import { MediaRegistry } from "../lib/providers/media/registry.ts";
import { makeFakeAdapter } from "./_mediaFakeAdapter.ts";

const SECRET = "contract-secret-key-9f8e7d6c5b4a";
const CATEGORIES = new Set(["auth", "quota", "rate-limit", "invalid-request", "moderation", "not-found", "upstream", "timeout", "unknown"]);
const PRICE_UNITS = new Set(["second", "image", "request", "megapixel", "1k-tokens", "minute", "character"]);
const MODEL_ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/;
const TASK_KINDS: Record<MediaTask, readonly MediaKind[]> = {
  "text-to-image": ["image"], "image-to-image": ["image"], "image-upscale": ["image"], "image-vectorize": ["image"], "image-segment": ["image"],
  "text-to-video": ["video"], "image-to-video": ["video"], "reference-to-video": ["video"], "video-to-video": ["video"], "video-extend": ["video"],
  "video-upscale": ["video"], lipsync: ["video"], avatar: ["video"], dubbing: ["video", "audio"], subtitles: ["video"],
  "text-to-audio": ["audio"], "video-to-audio": ["audio", "video"],
};

const subjects: MediaProviderAdapter[] = [makeFakeAdapter({ id: "contract-fake" }), ...BUILTIN_MEDIA_ADAPTERS];

function https(url: string): boolean {
  return /^https:\/\/[^\s]+$/.test(url);
}

async function withoutGlobalFetch<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("adapter bypassed ctx.fetch"); }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

function statusFetch(status: number, calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ error: { message: `rejected ${auth} ${SECRET}`, code: status } }), {
      status, headers: { "content-type": "application/json", "retry-after": "1" },
    });
  }) as typeof fetch;
}

test("registered media adapters build one registry without id clashes", () => {
  const registry = new MediaRegistry(BUILTIN_MEDIA_ADAPTERS);
  assert.equal(registry.listAdapters().length, BUILTIN_MEDIA_ADAPTERS.length);
});

for (const adapter of subjects) {
  test(`${adapter.id}: identity, credential and transport follow the contract`, () => {
    assert.match(adapter.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(adapter.errorPrefix, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(adapter.label.trim());
    assert.ok(adapter.route === "direct" || adapter.route === "aggregator");
    assert.ok(["url", "inline", "upload"].includes(adapter.inputTransport));
    if (adapter.inputTransport === "upload") assert.equal(typeof adapter.uploadInput, "function");
    const cred = adapter.credential;
    assert.match(cred.keyVocabulary, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(cred.envVars.length > 0);
    for (const v of cred.envVars) assert.match(v, /^[A-Z][A-Z0-9_]*$/);
    assert.match(cred.configKey, /^[a-zA-Z][a-zA-Z0-9]*$/);
    assert.ok(https(cred.consoleUrl), "consoleUrl must be https");
    for (const f of cred.extraFields ?? []) {
      assert.match(f.envVar, /^[A-Z][A-Z0-9_]*$/);
      assert.match(f.name, /^[a-zA-Z][a-zA-Z0-9]*$/);
    }
  });

  test(`${adapter.id}: every model spec is well formed and priced only from a cited source`, () => {
    const models = adapter.listModels();
    assert.ok(models.length > 0, "listModels() must not be empty");
    const ids = new Set<string>();
    for (const m of models) {
      assert.match(m.id, MODEL_ID, m.id);
      assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
      ids.add(m.id);
      assert.ok(m.upstreamId.trim() && m.vendor.trim() && m.label.trim(), m.id);
      assert.ok(m.tasks.length > 0, `${m.id} has no tasks`);
      for (const t of m.tasks) assert.ok(TASK_KINDS[t]?.includes(m.kind), `${m.id}: task ${t} cannot produce ${m.kind}`);
      assert.ok(https(m.docsUrl), `${m.id} docsUrl`);
      for (const p of m.pricing) {
        assert.ok(PRICE_UNITS.has(p.unit), `${m.id} price unit`);
        assert.ok(Number.isFinite(p.usd) && p.usd >= 0, `${m.id} price usd`);
        assert.ok(https(p.source), `${m.id} price source`);
        assert.match(p.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  test(`${adapter.id}: normalizeError returns the contract shape for any thrown value`, () => {
    const samples: unknown[] = [undefined, null, "boom", 42, new Error(`failed with ${SECRET}`), { status: 500 }, new TypeError("fetch failed")];
    for (const sample of samples) {
      const e = adapter.normalizeError(sample);
      assert.ok(e.code.startsWith(`${adapter.errorPrefix}_`), `code ${e.code}`);
      assert.equal(typeof e.message, "string");
      assert.equal(typeof e.retryable, "boolean");
      assert.ok(CATEGORIES.has(e.category), e.category);
    }
  });

  for (const [status, expected] of [[401, "auth"], [429, "rate-limit"]] as const) {
    test(`${adapter.id}: HTTP ${status} on submit is classified ${expected} through ctx.fetch, without the key`, async () => {
      const model = adapter.listModels()[0]!;
      const calls: string[] = [];
      const ctx = { apiKey: SECRET, extra: Object.fromEntries((adapter.credential.extraFields ?? []).map((f) => [f.name, "x-extra"])), fetch: statusFetch(status, calls) };
      const thrown = await withoutGlobalFetch(async () => {
        try {
          await adapter.submit(ctx, { model: model.id, task: model.tasks[0]!, prompt: "a lighthouse at dusk", inputs: [] });
        } catch (error) {
          return error;
        }
        return undefined;
      });
      assert.ok(thrown !== undefined, "submit must reject when the upstream answers an error");
      assert.notEqual((thrown as Error)?.message, "adapter bypassed ctx.fetch");
      const e = adapter.normalizeError(thrown);
      assert.ok(!e.message.includes(SECRET), "normalized message leaks the key");
      if (calls.length === 0) {
        assert.equal(e.category, "invalid-request", "rejected before any request, so it must be a request error");
        return;
      }
      for (const url of calls) assert.ok(https(url), `non-https request ${url}`);
      assert.equal(e.category, expected);
      if (expected === "rate-limit") assert.equal(e.retryable, true);
      if (expected === "auth") assert.equal(e.retryable, false);
    });
  }
}
