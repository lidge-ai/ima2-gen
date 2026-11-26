import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaAdapterContext } from "../lib/providers/media/contract.ts";

// Isolate config before importing modules that initialize it.
const configRoot = await mkdtemp(join(tmpdir(), "ima2-key-validate-config-"));
await writeFile(join(configRoot, "config.json"), "{}\n");
process.env.IMA2_CONFIG_DIR = configRoot;
const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { mountKeyRoutes } = await import("../routes/keys.ts");
const { makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");

test.after(async () => {
  await rm(configRoot, { recursive: true, force: true, maxRetries: 10 });
});

type Call = { adapter: string; apiKey: string; extra: Record<string, string> };
type Options = {
  env?: Record<string, string>;
  stored?: Record<string, unknown>;
  reject?: boolean;
};
type Harness = {
  request: (method: string, path: string, body?: unknown) => Promise<{ status: number; text: string; json: Record<string, unknown> }>;
  calls: Call[];
  configFile: string;
};

async function withApp(fn: (h: Harness) => Promise<void>, options: Options = {}) {
  const root = await mkdtemp(join(tmpdir(), "ima2-key-validate-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, `${JSON.stringify(options.stored ?? {}, null, 2)}\n`);
  const calls: Call[] = [];
  const fake = makeFakeAdapter({ id: "fake", extraFields: [
    { name: "region", envVar: "FAKE_REGION", secret: false, required: false },
    { name: "secretToken", envVar: "FAKE_SECRET_TOKEN", secret: true, required: false },
  ] });
  const pair = makeFakeAdapter({ id: "pair", extraFields: [
    { name: "secretToken", envVar: "PAIR_SECRET_TOKEN", secret: true, required: true },
    { name: "region", envVar: "PAIR_REGION", secret: false, required: true },
  ] });
  const vertex = makeFakeAdapter({ id: "google-vertex", vocabulary: "vertex" });
  const basePrefixed = makeFakeAdapter({ id: "prefixed" });
  const prefixed = { ...basePrefixed, credential: { ...basePrefixed.credential, keyPrefix: "pre-" } };
  for (const adapter of [fake, pair, vertex, prefixed]) {
    adapter.validateKey = async (ctx: MediaAdapterContext) => {
      calls.push({ adapter: adapter.id, apiKey: ctx.apiKey, extra: { ...ctx.extra } });
      if (!options.reject) return { ok: true };
      return { ok: false, reason: `rejected ${ctx.apiKey} ${(ctx.extra ?? {}).secretToken ?? ""}` };
    };
  }
  const registry = new MediaRegistry([fake, pair, vertex, prefixed]);
  const ctx = { rootDir: root, config: { ...config, storage: { ...config.storage, configFile } } };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const noNetwork: typeof fetch = async () => { throw new Error("unexpected network access"); };
  mountKeyRoutes(app, ctx as never, { mediaRegistry: registry, env: options.env ?? {}, fetch: noNetwork });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as import("node:net").AddressInfo).port;
  const request: Harness["request"] = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
  };
  try {
    await fn({ request, calls, configFile });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
}

const validate = (h: Harness, vocabulary: string, body: unknown = {}) =>
  h.request("POST", `/api/keys/${vocabulary}/validate`, body);

for (const key of ["0123456789abcdefghijklmnopqrstuv", "sixkey", "redact"]) {
  test(`validation redacts a rejected ${key.length}-character key from the whole response`, async () => {
    await withApp(async (h) => {
      const before = await readFile(h.configFile);
      const result = await validate(h, "fake", { apiKey: key });
      assert.equal(result.status, 400);
      assert.equal(result.json.code, "KEY_VALIDATION_FAILED");
      assert.equal(result.json.category, "auth");
      assert.equal(result.text.includes(key), false);
      assert.equal(h.calls.length, 1);
      assert.deepEqual(await readFile(h.configFile), before);
    }, { reject: true });
  });
}

test("short keys and secret extras fail before adapter validation", async () => {
  await withApp(async (h) => {
    for (const body of [{ apiKey: "12345" }, { apiKey: "valid-key", extra: { secretToken: "12345" } }]) {
      const result = await validate(h, "fake", body);
      assert.equal(result.status, 400);
      assert.equal(result.json.code, "KEY_TOO_SHORT");
      assert.equal(result.json.category, "auth");
    }
    assert.equal(h.calls.length, 0);
  });
});

test("missing credentials, unknown vocabulary, invalid format and missing required extras fail closed", async () => {
  await withApp(async (h) => {
    const cases = [
      { vocabulary: "fake", body: {}, code: "MEDIA_KEY_MISSING" },
      { vocabulary: "unknown", body: { apiKey: "valid-key" }, code: "INVALID_PROVIDER" },
      { vocabulary: "prefixed", body: { apiKey: "wrong-key" }, code: "INVALID_KEY_FORMAT" },
      { vocabulary: "pair", body: { apiKey: "valid-key" }, code: "MISSING_EXTRA" },
      { vocabulary: "fake", body: { apiKey: "valid-key", extra: { unknown: "value" } }, code: "INVALID_EXTRA" },
    ];
    for (const c of cases) {
      const result = await validate(h, c.vocabulary, c.body);
      assert.equal(result.status, 400);
      assert.equal(result.json.code, c.code);
      if (c.code === "MEDIA_KEY_MISSING") {
        assert.equal(result.json.category, "auth");
        assert.equal(result.json.error, "No key saved for Fake fake");
      }
    }
    assert.equal(h.calls.length, 0);
  });
});

test("request values override environment and saved values without modifying config bytes", async () => {
  await withApp(async (h) => {
    const before = await readFile(h.configFile);
    const result = await validate(h, "fake", { apiKey: "  request-key  ", extra: { region: "  request-region  ", secretToken: "request-secret" } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { ok: true, vocabulary: "fake", valid: true, source: "request" });
    assert.deepEqual(h.calls, [{ adapter: "fake", apiKey: "request-key", extra: { region: "request-region", secretToken: "request-secret" } }]);
    assert.deepEqual(await readFile(h.configFile), before);
  }, {
    env: { FAKE_API_KEY: "env-key", FAKE_REGION: "env-region", FAKE_SECRET_TOKEN: "env-secret" },
    stored: { fakeApiKey: "stored-key", mediaKeyExtras: { fake: { region: "stored-region", secretToken: "stored-secret" } } },
  });
});

test("omitted values use resolved env or config and per-field request overrides", async () => {
  await withApp(async (h) => {
    const envResult = await validate(h, "fake");
    assert.equal(envResult.status, 200);
    assert.equal(envResult.json.source, "env");
    const mixedResult = await validate(h, "fake", { extra: { region: "request-region" } });
    assert.equal(mixedResult.status, 200);
    assert.equal(mixedResult.json.source, "request");
    assert.deepEqual(h.calls.map((c) => [c.apiKey, c.extra]), [
      ["env-key", { region: "stored-region", secretToken: "stored-secret" }],
      ["env-key", { region: "request-region", secretToken: "stored-secret" }],
    ]);
  }, { env: { FAKE_API_KEY: "env-key" }, stored: { fakeApiKey: "stored-key", mediaKeyExtras: { fake: { region: "stored-region", secretToken: "stored-secret" } } } });
  await withApp(async (h) => {
    const result = await validate(h, "fake");
    assert.equal(result.status, 200);
    assert.equal(result.json.source, "config");
    assert.equal(h.calls[0]?.apiKey, "stored-key");
  }, { stored: { fakeApiKey: "stored-key" } });
});

test("a secret extra alone is a ready credential and rejected extra secrets are redacted", async () => {
  await withApp(async (h) => {
    const result = await validate(h, "pair", { extra: { secretToken: "extra-secret", region: "eu" } });
    assert.equal(result.status, 200);
    assert.equal(result.json.valid, true);
    assert.equal(result.json.source, "request");
    assert.deepEqual(h.calls, [{ adapter: "pair", apiKey: "", extra: { secretToken: "extra-secret", region: "eu" } }]);
  });
  await withApp(async (h) => {
    const result = await validate(h, "pair", { extra: { secretToken: "extra-secret", region: "eu" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.code, "KEY_VALIDATION_FAILED");
    assert.equal(result.text.includes("extra-secret"), false);
  }, { reject: true });
});

test("vertex vocabulary reaches the google-vertex adapter and accepts its larger key limit", async () => {
  await withApp(async (h) => {
    const key = "v".repeat(4097);
    const result = await validate(h, "vertex", { apiKey: key });
    assert.equal(result.status, 200);
    assert.equal(result.json.vocabulary, "vertex");
    assert.equal(result.json.valid, true);
    assert.equal(h.calls[0]?.adapter, "google-vertex");
    assert.equal(h.calls[0]?.apiKey, key);
    const tooLarge = await validate(h, "vertex", { apiKey: "v".repeat(51201) });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.json.code, "KEY_TOO_LARGE");
    assert.equal(h.calls.length, 1);
  });
});

test("validation coexists with PUT and DELETE through mountKeyRoutes", async () => {
  await withApp(async (h) => {
    const put = await h.request("PUT", "/api/keys/fake", { apiKey: "saved-key" });
    assert.equal(put.status, 200);
    const saved = await readFile(h.configFile);
    const result = await validate(h, "fake");
    assert.equal(result.status, 200);
    assert.equal(result.json.source, "config");
    assert.equal(h.calls.at(-1)?.apiKey, "saved-key");
    assert.deepEqual(await readFile(h.configFile), saved);
    const del = await h.request("DELETE", "/api/keys/fake");
    assert.equal(del.status, 200);
    const missing = await validate(h, "fake");
    assert.equal(missing.status, 400);
    assert.equal(missing.json.code, "MEDIA_KEY_MISSING");
  });
});
