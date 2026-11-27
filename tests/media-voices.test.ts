// Voice lists for text-to-speech routes: the adapter reads the maker's own list with the user's key,
// and GET /api/media/voices serves it cached, only when a key exists, without the key ever leaving.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const configDir = await mkdtemp(join(tmpdir(), "ima2-voices-config-"));
process.env.IMA2_CONFIG_DIR = configDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { adapter: elevenlabs } = await import("../lib/providers/media/direct/elevenlabs.ts");
const { adapter: cartesia } = await import("../lib/providers/media/direct/cartesia.ts");
const { registerMediaVoiceRoutes } = await import("../routes/mediaVoices.ts");
const { createVoiceCache } = await import("../lib/providers/media/voices.ts");

test.after(async () => { await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const KEY = "sk_test_SECRET_0123456789abcdef";
type Call = { url: string; headers: Record<string, string> };

function scripted(responses: [number, unknown][]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    calls.push({ url: String(input), headers });
    const [status, body] = responses.shift() ?? [500, { detail: "no more scripted responses " + KEY }];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const ELEVEN_PAGE_1 = { voices: [
  { voice_id: "v-rachel", name: "Rachel", category: "premade", description: "Calm narrator", preview_url: "https://storage.example/rachel.mp3", labels: { gender: "female", language: "en", accent: "american" } },
  { voice_id: "v-mine", name: "My clone", category: "cloned", labels: {} },
], has_more: true, next_page_token: "page-2" };
const ELEVEN_PAGE_2 = { voices: [{ voice_id: "v-yeji", name: "Yeji", category: "premade", labels: { gender: "female", language: "ko" } }], has_more: false, next_page_token: null };

test("ElevenLabs lists voices from /v2/voices with the key header and follows pages", async () => {
  const { fetch, calls } = scripted([[200, ELEVEN_PAGE_1], [200, ELEVEN_PAGE_2]]);
  const voices = await elevenlabs.listVoices!({ apiKey: KEY, fetch });
  assert.deepEqual(voices, [
    { id: "v-rachel", name: "Rachel", description: "Calm narrator", language: "en", gender: "female", previewUrl: "https://storage.example/rachel.mp3" },
    { id: "v-mine", name: "My clone", owned: true },
    { id: "v-yeji", name: "Yeji", language: "ko", gender: "female" },
  ]);
  assert.equal(calls[0]!.url, "https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false");
  assert.equal(calls[1]!.url, "https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false&next_page_token=page-2");
  assert.equal(calls[0]!.headers["xi-api-key"], KEY);
});

test("Cartesia lists voices from /voices with its version header and cursor", async () => {
  const { fetch, calls } = scripted([
    [200, { data: [{ id: "c-1", name: "Skylar", tagline: "Friendly Guide", description: "Approachable", language: "en", gender: "feminine", is_owner: false, preview_file_url: "https://api.cartesia.ai/private/preview" }], has_more: true, next_page: "c-1" }],
    [200, { data: [{ id: "c-2", name: "Mine", language: "ko", gender: null, is_owner: true }], has_more: false }],
  ]);
  const voices = await cartesia.listVoices!({ apiKey: KEY, fetch });
  // The preview URL needs the key, so a browser cannot play it: it is left out.
  assert.deepEqual(voices, [
    { id: "c-1", name: "Skylar", description: "Friendly Guide", language: "en", gender: "female" },
    { id: "c-2", name: "Mine", language: "ko", owned: true },
  ]);
  assert.equal(calls[0]!.url, "https://api.cartesia.ai/voices?limit=100");
  assert.equal(calls[1]!.url, "https://api.cartesia.ai/voices?limit=100&starting_after=c-1");
  assert.equal(calls[0]!.headers.authorization, "Bearer " + KEY);
  assert.equal(calls[0]!.headers["cartesia-version"], "2026-08-14");
});

test("a rejected key surfaces as an auth error that does not repeat the key", async () => {
  const { fetch } = scripted([[401, { detail: { message: "Invalid API key " + KEY } }]]);
  const error = await elevenlabs.listVoices!({ apiKey: KEY, fetch }).then(() => null, (e: unknown) => e);
  const normalized = elevenlabs.normalizeError(error);
  assert.equal(normalized.category, "auth");
  assert.ok(!JSON.stringify(normalized).includes(KEY));
  assert.ok(!String((error as Error).message).includes(KEY));
});

test("speech models declare the voice as a required option; music and sound effects do not", () => {
  const option = (id: string) => [...elevenlabs.listModels(), ...cartesia.listModels()].find((m) => m.id === id)!.params.options?.find((o) => o.name === "voice_id");
  assert.deepEqual(option("elevenlabs/eleven-v3"), { name: "voice_id", type: "voice", required: true });
  assert.deepEqual(option("cartesia/sonic-3"), { name: "voice_id", type: "voice", required: true });
  assert.equal(option("elevenlabs/elevenlabs-music-2.5"), undefined);
  assert.equal(option("elevenlabs/eleven-text-to-sound-v3"), undefined);
});

async function withApp(run: (base: string, calls: Call[], clock: { now: number }) => Promise<void>, options: { fileConfig?: Record<string, unknown>; responses?: [number, unknown][] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ima2-voices-routes-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify(options.fileConfig ?? { elevenlabsApiKey: KEY }));
  const transport = scripted(options.responses ?? [[200, ELEVEN_PAGE_2], [200, ELEVEN_PAGE_2], [200, ELEVEN_PAGE_2]]);
  const clock = { now: 1_000_000 };
  const deps = { registry: new MediaRegistry([elevenlabs, cartesia]), env: {}, fetch: transport.fetch, thumbnails: false };
  const ctx = { rootDir: root, packageVersion: "test", config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated") }, log: { ...config.log, level: "silent" } } };
  const app = express();
  app.use(express.json());
  registerMediaVoiceRoutes(app, ctx as never, { deps, cache: createVoiceCache({ ttlMs: 60_000, now: () => clock.now }) });
  const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  try {
    await run("http://127.0.0.1:" + (server.address() as AddressInfo).port, transport.calls, clock);
    return { root, configFile };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("GET /api/media/voices serves the list once per key and time window, and refresh asks again", async () => {
  await withApp(async (base, calls, clock) => {
    const first = await fetch(base + "/api/media/voices?provider=elevenlabs");
    assert.equal(first.status, 200);
    const body = await first.json() as { provider: string; voices: { id: string }[]; cached: boolean };
    assert.deepEqual({ provider: body.provider, ids: body.voices.map((v) => v.id), cached: body.cached }, { provider: "elevenlabs", ids: ["v-yeji"], cached: false });
    assert.ok(!JSON.stringify(body).includes(KEY));
    const second = await (await fetch(base + "/api/media/voices?provider=elevenlabs")).json() as { cached: boolean };
    assert.equal(second.cached, true);
    assert.equal(calls.length, 1, "the second read did not call the provider");
    await fetch(base + "/api/media/voices?provider=elevenlabs&refresh=1");
    assert.equal(calls.length, 2);
    clock.now += 61_000;
    await fetch(base + "/api/media/voices?provider=elevenlabs");
    assert.equal(calls.length, 3, "an expired entry is read again");
  });
});

test("without a key the provider is never called", async () => {
  await withApp(async (base, calls) => {
    const res = await fetch(base + "/api/media/voices?provider=elevenlabs");
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { code: string }).code, "MEDIA_KEY_MISSING");
    assert.equal(calls.length, 0);
  }, { fileConfig: {} });
});

test("an unknown provider, or one without voices, is a 404; a missing provider is a 400", async () => {
  await withApp(async (base, calls) => {
    const unknown = await fetch(base + "/api/media/voices?provider=nope");
    assert.deepEqual([unknown.status, (await unknown.json() as { code: string }).code], [404, "MEDIA_VOICES_UNSUPPORTED"]);
    assert.equal((await fetch(base + "/api/media/voices")).status, 400);
    assert.equal(calls.length, 0);
  });
});

test("a provider failure is reported with its category and without the key, and is not cached", async () => {
  await withApp(async (base, calls) => {
    const res = await fetch(base + "/api/media/voices?provider=elevenlabs");
    const body = await res.json() as { ok: boolean; category: string; error: string };
    assert.equal(res.status, 401);
    assert.equal(body.category, "auth");
    assert.ok(!JSON.stringify(body).includes(KEY));
    const again = await fetch(base + "/api/media/voices?provider=elevenlabs");
    assert.equal(again.status, 200);
    assert.equal(calls.length, 2);
  }, { responses: [[401, { detail: { message: "Invalid API key " + KEY } }], [200, ELEVEN_PAGE_2]] });
});

test("a different key does not read another key's cached list", async () => {
  const cache = createVoiceCache({ ttlMs: 60_000, now: () => 0 });
  let reads = 0;
  const load = async () => { reads += 1; return [{ id: "v" + reads, name: "Voice " + reads }]; };
  assert.equal((await cache.get("elevenlabs", "key-one", load)).voices[0]!.id, "v1");
  assert.equal((await cache.get("elevenlabs", "key-one", load)).voices[0]!.id, "v1");
  assert.equal((await cache.get("elevenlabs", "key-two", load)).voices[0]!.id, "v2");
  assert.equal(reads, 2);
});

