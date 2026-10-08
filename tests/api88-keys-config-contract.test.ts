import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withApi88Routes } from "./_api88RouteFixture.ts";
import { getApi88Catalog } from "../lib/api88/catalog.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("both key IDs validate once, persist independently, hot-update and delete only the selected key", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      assert.equal(url, "https://route-gateway.example/v1/models");
      const bearer = new Headers(init?.headers).get("Authorization")!; calls.push(bearer);
      return Response.json({ data: [{ id: bearer === "Bearer image-key" ? "gpt-image-2" : "SD2.5 720P" }] });
    }) as typeof fetch;
    for (const [id, key] of [["api88-image", "image-key"], ["api88-video", "video-key"]]) {
      const response = await fetch(`${base}/api/keys/${id}`, { ...json({ apiKey: key }), method: "PUT" });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(calls, ["Bearer image-key", "Bearer video-key"]);
    assert.equal(ctx.api88ImageKey, "image-key"); assert.equal(ctx.api88VideoKey, "video-key");
    assert.equal((await getApi88Catalog(ctx, "image"))?.has("gpt-image-2"), true); assert.equal(calls.length, 2);
    const status = await (await fetch(`${base}/api/keys/status`)).json();
    assert.equal(status["api88-image"].valid, true); assert.equal(status["api88-video"].valid, true);
    await fetch(`${base}/api/keys/api88-image`, { method: "DELETE" });
    const stored = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(stored.api88ImageKey, undefined); assert.equal(stored.api88VideoKey, "video-key");
    assert.equal(ctx.api88ImageKey, undefined); assert.equal(ctx.api88VideoKey, "video-key");
  });
});

for (const response of [Response.json({ error: "wrong shape" }), new Response("denied", { status: 401 })]) {
  test(`failed validation does not save or hot-update (${response.status})`, async () => {
    await withApi88Routes(async ({ ctx, base, configFile }) => {
      globalThis.fetch = (async (input, init) => String(input).startsWith(`${base}/`) ? originalFetch(input, init) : response) as typeof fetch;
      const result = await fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "candidate" }), method: "PUT" });
      assert.equal(result.status, 400); assert.equal(ctx.api88ImageKey, undefined);
      await assert.rejects(() => readFile(configFile), { code: "ENOENT" });
    });
  });
}

test("base URL PATCH persists provider settings, keeps keys and hot-updates subsequent validation", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      assert.ok(["https://route-gateway.example/v1/models", "https://changed.example/v1/models"].includes(url));
      return Response.json({ data: [{ id: "gpt-image-2" }] });
    }) as typeof fetch;
    await fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "image-key" }), method: "PUT" });
    const result = await fetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://changed.example/v1/" }), method: "PATCH" });
    assert.deepEqual(await result.json(), { baseUrl: "https://changed.example", source: "config" });
    assert.equal(ctx.config.api88Provider.baseUrl, "https://changed.example");
    const stored = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(stored.api88Provider.baseUrl, "https://changed.example"); assert.equal(stored.api88ImageKey, "image-key");
  });
});

test("env URL is immutable; invalid URL never writes", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    ctx.config.api88Provider.baseUrlSource = "env";
    const locked = await originalFetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://new.example" }), method: "PATCH" });
    assert.equal(locked.status, 409); assert.equal((await locked.json()).code, "API88_BASE_URL_ENV_LOCKED");
    ctx.config.api88Provider.baseUrlSource = "default";
    const invalid = await originalFetch(`${base}/api/config/88api`, { ...json({ baseUrl: "http://public.example" }), method: "PATCH" });
    assert.equal(invalid.status, 400); await assert.rejects(() => readFile(configFile), { code: "ENOENT" });
  });
});

test("key PUT completing after an origin PATCH never seeds host A's IDs under host B", async () => {
  await withApi88Routes(async ({ ctx, base }) => {
    let enter = () => {}, release = () => {};
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      calls.push(url);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer image-key");
      if (url === "https://route-gateway.example/v1/models") {
        enter(); await gate; return Response.json({ data: [{ id: "host-A-only" }] });
      }
      assert.equal(url, "https://changed.example/v1/models");
      return Response.json({ data: [{ id: "host-B-only" }] });
    }) as typeof fetch;
    const put = fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "image-key" }), method: "PUT" });
    try {
      await entered;
      const patch = await fetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://changed.example" }), method: "PATCH" });
      assert.equal(patch.status, 200);
    } finally { release(); }
    assert.equal((await put).status, 200);
    assert.deepEqual([...(await getApi88Catalog(ctx, "image"))!], ["host-B-only"]);
    assert.deepEqual(calls, ["https://route-gateway.example/v1/models", "https://changed.example/v1/models"]);
  });
});
