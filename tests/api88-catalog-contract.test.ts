import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { getApi88Catalog, invalidateApi88Catalogs, seedApi88Catalog, validateApi88Key } from "../lib/api88/catalog.ts";
import { buildLaneMap } from "../routes/models.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { deriveUnsupportedImageModelsFrom } from "../lib/providers/deriveCore.ts";
import { REGISTRY } from "../lib/providers/registry.ts";
import { isSensitiveConfigKey } from "../lib/configKeys.ts";

const originalFetch = globalThis.fetch;
function context() {
  return createTestRuntimeContext({ grokAuthHomeDir: "/synthetic/api88-contract-no-grok-auth", config: { ...config,
    mcp: { ...config.mcp, enabledProviders: [] },
    api88Provider: { ...config.api88Provider, baseUrl: "https://catalog.example/v1" } } });
}
const deps = { detectAgyInstalled: async () => false, listComfyWorkflows: async () => [], probeComfyOrigins: async () => new Map() };
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("registry has 10 image and 25 exact video IDs and image-only surfaces", () => {
  const manifest = getProvider("88api");
  assert.equal(manifest.vendor, "88api"); assert.equal(manifest.errorPrefix, "API88_");
  assert.deepEqual([...manifest.surfaces], ["generate", "edit", "multimode", "node"]);
  assert.equal(manifest.models.filter((row) => row.kind === "image").length, 10);
  assert.deepEqual(manifest.models.filter((row) => row.kind === "video").map((row) => row.id), [
    "gemini-omni-flash", "grok-imagine-video", "grok-imagine-video-1.5",
    "kling-3.0-turbo-720p", "kling-3.0-turbo-1080p", "kling-3.0-turbo-2k", "kling-3.0-turbo-4k",
    "minimax-h3-768p", "SD2.0 480P", "SD2.0 720P", "SD2.0 1080P", "SD2.0 4k",
    "SD2.5 480P", "SD2.5 720P", "SD2.5 1080P", "Seedance-2.0-720p官方版",
    "Seedance-2.0-fast-720p官方版", "Seedance-2.5-720p官方版", "seedance-2.0-mini-480p",
    "seedance-2.0-mini-720p", "veo-3.1", "veo-3.1-fast", "wan3.0-video-480p", "wan3.0-video-720p", "wan3.0-video-1080p",
  ]);
  assert.deepEqual(manifest.credentials, [
    { kind: "api-key", keyVocabulary: "api88-image", envVars: ["IMA2_88API_IMAGE_KEY"], configKey: "api88ImageKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
    { kind: "api-key", keyVocabulary: "api88-video", envVars: ["IMA2_88API_VIDEO_KEY"], configKey: "api88VideoKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
  ]);
  for (const credential of manifest.credentials) {
    assert.equal(credential.kind, "api-key");
    if (credential.kind === "api-key") assert.equal("keyPrefix" in credential, false);
  }
  assert.deepEqual([...deriveUnsupportedImageModelsFrom(REGISTRY)], ["grok-imagine-edit"]);
  assert.equal(isSensitiveConfigKey("api88ImageKey"), true); assert.equal(isSensitiveConfigKey("api88VideoKey"), true);
});

test("catalog kinds cache independently, coalesce and retain exact IDs", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only"; ctx.api88VideoKey = "video-only";
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://catalog.example/v1/models");
    const bearer = new Headers(init?.headers).get("Authorization")!; calls.push(bearer);
    return Response.json({ data: [{ id: bearer === "Bearer image-only" ? "gpt-image-2" : "SD2.5 720P" }] });
  }) as typeof fetch;
  const [image1, image2, video] = await Promise.all([getApi88Catalog(ctx, "image"), getApi88Catalog(ctx, "image"), getApi88Catalog(ctx, "video")]);
  assert.deepEqual([...image1!], ["gpt-image-2"]); assert.equal(image1, image2);
  assert.deepEqual([...video!], ["SD2.5 720P"]); assert.equal(calls.length, 2);
  await getApi88Catalog(ctx, "image"); assert.equal(calls.length, 2);
  invalidateApi88Catalogs(ctx, "image"); await getApi88Catalog(ctx, "image"); assert.equal(calls.length, 3);
});

test("known empty catalog differs from unknown and rejects malformed validation", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only";
  globalThis.fetch = (async () => Response.json({ data: [] })) as typeof fetch;
  assert.equal((await getApi88Catalog(ctx, "image"))?.size, 0);
  ctx.api88ImageKey = "new-key";
  globalThis.fetch = (async () => Response.json({ error: "invalid" })) as typeof fetch;
  await assert.rejects(() => validateApi88Key(ctx, "candidate"), { code: "API88_CATALOG_INVALID" });
  assert.equal(await getApi88Catalog(ctx, "image"), null);
});

test("same-kind initial requests share a pending GET before any snapshot exists", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only";
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://catalog.example/v1/models"); calls++;
    await gate; return Response.json({ data: [{ id: "gpt-image-2" }] });
  }) as typeof fetch;
  const first = getApi88Catalog(ctx, "image");
  const second = getApi88Catalog(ctx, "image");
  try { assert.equal(calls, 1, "pending identity must exist before the first snapshot"); }
  finally { release(); await Promise.allSettled([first, second]); }
  assert.equal(await first, await second);
});

for (const credentials of [{}, { api88ImageKey: "image" }, { api88VideoKey: "video" }, { api88ImageKey: "image", api88VideoKey: "video" }]) {
  test(`DTO kind locks and readiness ${JSON.stringify(Object.keys(credentials))}`, async () => {
    const ctx = Object.assign(context(), credentials);
    globalThis.fetch = (async () => { throw new Error("catalog unavailable"); }) as typeof fetch;
    const lane = (await buildLaneMap(ctx, deps))["88api"]!;
    assert.equal(lane.status, Object.keys(credentials).length ? "ready" : "key-missing");
    assert.equal(lane.models.image.length, 7); assert.equal(lane.models.video.length, 25);
    assert.deepEqual(lane.defaults, { image: "gpt-image-2", video: "grok-imagine-video-1.5" });
    for (const row of lane.models.image) assert.equal(row.executable, Boolean(ctx.api88ImageKey));
    for (const row of lane.models.video) {
      assert.equal(row.executable, false);
      assert.equal(row.lockReason, ctx.api88VideoKey ? "API88_VIDEO_NOT_READY" : "API88_VIDEO_KEY_MISSING");
    }
    assert.equal(lane.surfaces?.video.supported, false);
  });
}

test("live intersection is per kind and unverified image IDs remain hidden", async () => {
  const ctx = context(); ctx.api88ImageKey = "image"; ctx.api88VideoKey = "video";
  seedApi88Catalog(ctx, "image", "image", new Set(["gpt-image-2", "grok-imagine-image", "remote-unknown"]));
  seedApi88Catalog(ctx, "video", "video", new Set(["SD2.5 720P", "Seedance-2.0-720p官方版"]));
  globalThis.fetch = (async () => { throw new Error("unexpected catalog refresh"); }) as typeof fetch;
  const lane = (await buildLaneMap(ctx, deps))["88api"]!;
  assert.deepEqual(lane.models.image.map((row) => row.id), ["gpt-image-2"]);
  assert.deepEqual(lane.models.video.map((row) => row.id), ["SD2.5 720P", "Seedance-2.0-720p官方版"]);
});

test("key and origin replacement cannot reuse the old catalog", async () => {
  const ctx = context(); ctx.api88ImageKey = "old";
  seedApi88Catalog(ctx, "image", "old", new Set(["old-model"]));
  ctx.api88ImageKey = "new"; ctx.config.api88Provider.baseUrl = "https://replacement.example";
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://replacement.example/v1/models");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new");
    return Response.json({ data: [{ id: "gpt-image-2" }] });
  }) as typeof fetch;
  assert.deepEqual([...(await getApi88Catalog(ctx, "image"))!], ["gpt-image-2"]);
});
