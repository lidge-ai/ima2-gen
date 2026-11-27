// Contract additions for routes that run on the user's own machine (route "local"):
// keyless credentials, catalogs that change while the server runs, estimates without a
// provider price, and a status line on progress. No test here reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const configDir = await mkdtemp(join(tmpdir(), "ima2-local-route-config-"));
process.env.IMA2_CONFIG_DIR = configDir;

const { config } = await import("../config.ts");
const { buildMediaCatalog } = await import("../lib/providers/media/catalog.ts");
const { MediaKeySnapshot, mediaKeyVocabularies } = await import("../lib/providers/media/credentials.ts");
const { estimateMediaJob } = await import("../lib/providers/media/estimate.ts");
const { MediaRegistry, selectMediaRoute } = await import("../lib/providers/media/registry.ts");
const { pollUntilTerminal } = await import("../lib/providers/media/runnerPoll.ts");
const { registerMediaRoutes, mediaRunnerDeps } = await import("../routes/media.ts");
const { registerMediaToolRoutes } = await import("../routes/mediaTools.ts");
const { FAKE_KEY, fakeSpec, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");
import type { MediaModelSpec } from "../lib/providers/media/contract.ts";

test.after(async () => {
  await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const NO_KEYS = new MediaKeySnapshot({ env: {}, fileConfig: {} });
const localSpec = (id: string, overrides: Partial<MediaModelSpec> = {}) =>
  fakeSpec(id, { vendor: "here", kind: "image", tasks: ["text-to-image"], params: {}, pricing: [], ...overrides });

function localAdapter(list: () => MediaModelSpec[], extra: Parameters<typeof makeFakeAdapter>[0] = {}) {
  return makeFakeAdapter({ id: "here-local", route: "local", keyless: true, liveModels: { idPrefix: "here/", list }, ...extra });
}

test("a keyless route is usable with nothing saved, and has no entry among the keys", () => {
  const paid = makeFakeAdapter({ id: "paid" });
  const local = localAdapter(() => [localSpec("here/one")]);
  assert.equal(NO_KEYS.hasKey(local), true);
  assert.equal(NO_KEYS.hasKey(paid), false);
  assert.deepEqual([...mediaKeyVocabularies([paid, local]).keys()], ["paid"]);
});

test("a live catalog is read on every lookup, so a model appears and disappears without a restart", () => {
  let models = [localSpec("here/one")];
  const registry = new MediaRegistry([makeFakeAdapter({ id: "paid" }), localAdapter(() => models)]);
  assert.deepEqual(registry.listModels().map((m) => m.id), ["acme/clip-1", "here/one"]);
  models = [localSpec("here/two", { kind: "video", tasks: ["text-to-video"] })];
  assert.deepEqual(registry.listModels().map((m) => m.id), ["acme/clip-1", "here/two"]);
  assert.equal(registry.getModel("here/one"), undefined);
  assert.equal(registry.getModel("here/two")?.candidates[0]?.adapter.id, "here-local");
  assert.deepEqual(registry.listModels("video").map((m) => m.id), ["acme/clip-1", "here/two"]);
});

test("a live model can neither shadow a compiled model nor leave its own prefix", () => {
  const live = localAdapter(() => [localSpec("acme/clip-1"), localSpec("here/one"), localSpec("here/one", { label: "repeat" })]);
  const registry = new MediaRegistry([makeFakeAdapter({ id: "paid" }), live]);
  assert.deepEqual(registry.listModels().map((m) => m.id), ["acme/clip-1", "here/one"]);
  assert.deepEqual(registry.getModel("acme/clip-1")?.candidates.map((c) => c.adapter.id), ["paid"], "the compiled model keeps its own route only");
  assert.equal(registry.getModel("here/one")?.label, "Fake here/one", "the first spec wins a repeat");
  assert.throws(
    () => new MediaRegistry([makeFakeAdapter({ id: "paid", models: [fakeSpec("here/stolen")] }), localAdapter(() => [])]),
    /here\/stolen uses the id prefix reserved for here-local/,
  );
  assert.throws(() => new MediaRegistry([makeFakeAdapter({ id: "x", route: "local", keyless: true, liveModels: { idPrefix: "Bad", list: () => [] } })]), /invalid live model id prefix/);
});

test("a local model's only route is chosen without a key, and the catalog says it needs none", () => {
  const registry = new MediaRegistry([makeFakeAdapter({ id: "paid" }), localAdapter(() => [localSpec("here/one")])]);
  const selection = selectMediaRoute(registry.getModel("here/one"), { modelId: "here/one", task: "text-to-image", hasKey: (a) => NO_KEYS.hasKey(a) });
  assert.equal(selection.ok && selection.adapter.id, "here-local");
  const paid = selectMediaRoute(registry.getModel("acme/clip-1"), { modelId: "acme/clip-1", task: "text-to-video", hasKey: (a) => NO_KEYS.hasKey(a) });
  assert.equal(paid.ok === false && paid.code, "MEDIA_KEY_MISSING", "a paid model is not rescued by a local lane");
  const catalog = buildMediaCatalog(registry, NO_KEYS);
  const model = catalog.models.find((m) => m.id === "here/one")!;
  assert.equal(model.defaultRoute, "here-local");
  assert.deepEqual(model.routes.map((r) => [r.adapter, r.route, r.hasKey, r.keyless]), [["here-local", "local", true, true]]);
  assert.deepEqual(catalog.adapters.map((a) => [a.id, a.route, a.keyless]), [["paid", "direct", false], ["here-local", "local", true]]);
  assert.equal(catalog.models.find((m) => m.id === "acme/clip-1")!.routes[0]!.keyless, false);
});

test("a local estimate is free with an expected time from past runs, or unknown, never guessed", () => {
  const registry = (estimateLocal?: Parameters<typeof makeFakeAdapter>[0]["estimateLocal"]) =>
    new MediaRegistry([localAdapter(() => [localSpec("here/one")], estimateLocal ? { estimateLocal } : {})]);
  const body = { model: "here/one", task: "text-to-image" as const, inputs: [] };
  assert.deepEqual(estimateMediaJob(registry(), NO_KEYS, body), {
    model: "here/one", adapter: "here-local", route: "local", hasKey: true, unit: "request", quantity: 1, usd: 0, prices: [],
    local: { expectedSec: null, basis: "no runs yet", mayBill: false }, note: "runs locally; no provider charge",
  });
  const timed = estimateMediaJob(registry(() => ({ expectedSec: 42, basis: "median of 5 runs", mayBill: false })), NO_KEYS, body);
  assert.deepEqual(timed.local, { expectedSec: 42, basis: "median of 5 runs", mayBill: false });
  assert.equal(timed.usd, 0);
  const paidNode = estimateMediaJob(registry(() => ({ expectedSec: 42, basis: "median of 5 runs", mayBill: true })), NO_KEYS, body);
  assert.equal(paidNode.usd, null, "a workflow that may be charged elsewhere is not reported as free");
  assert.match(String(paidNode.note), /may be charged/);
});

test("a job's status line reaches the progress callback", async () => {
  const adapter = makeFakeAdapter({ script: { states: [
    { status: "queued", detail: "2 ahead in the queue", pollAfterMs: 1 },
    { status: "running", progress: 0.4, detail: "KSampler 8/20", pollAfterMs: 1 },
    { status: "succeeded", outputs: [] },
  ] } });
  const seen: unknown[] = [];
  const state = await pollUntilTerminal({
    deps: { sleep: async () => {} } as never, adapter,
    actx: { apiKey: FAKE_KEY, fetch: (async () => Response.json({})) as typeof fetch },
    job: { providerJobId: "j1", pollAfterMs: 1 }, signal: new AbortController().signal, secrets: [],
    onProgress: (p) => seen.push(p),
  });
  assert.equal(state.status, "succeeded");
  assert.deepEqual(seen, [
    { status: "queued", progress: undefined, detail: "2 ahead in the queue" },
    { status: "running", progress: 0.4, detail: "KSampler 8/20" },
  ]);
});

async function withApp(webAccess: boolean, run: (base: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ima2-local-route-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, "{}");
  const registry = new MediaRegistry([makeFakeAdapter({ id: "paid" }), localAdapter(() => [localSpec("here/one")])]);
  const deps = { registry, env: {}, thumbnails: false };
  const spend = { admit: async () => { throw new Error("the spend guard must not be reached for a local route"); } };
  const ctx = { rootDir: root, packageVersion: "test", ...(webAccess ? { webAccess: { spend } } : {}), config: { ...config, storage: {
    ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated"),
  }, log: { ...config.log, level: "silent" } } };
  const app = express();
  app.use(express.json());
  registerMediaToolRoutes(app, ctx as never, { deps });
  registerMediaRoutes(app, ctx as never, deps);
  const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  try {
    await run("http://127.0.0.1:" + String((server.address() as AddressInfo).port));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("on a local install the local model is in the catalog and priced as free", async () => {
  await withApp(false, async (base) => {
    const catalog = await (await fetch(base + "/api/media/catalog")).json();
    assert.deepEqual(catalog.models.map((m: { id: string }) => m.id), ["acme/clip-1", "here/one"]);
    const estimate = await (await post(base, "/api/media/estimate", { model: "here/one", task: "text-to-image" })).json();
    assert.equal(estimate.route, "local");
    assert.equal(estimate.usd, 0);
  });
});

test("the web instance has no local routes at all: not listed, not priced, not runnable", async () => {
  await withApp(true, async (base) => {
    const catalog = await (await fetch(base + "/api/media/catalog")).json();
    assert.deepEqual(catalog.models.map((m: { id: string }) => m.id), ["acme/clip-1"]);
    assert.deepEqual(catalog.adapters.map((a: { id: string }) => a.id), ["paid"]);
    for (const path of ["/api/media/estimate", "/api/media"]) {
      const res = await post(base, path, { model: "here/one", task: "text-to-image", requestId: "web-local-1" });
      assert.equal(res.status, 404, path);
      assert.equal((await res.json()).code, "MEDIA_MODEL_UNKNOWN", path);
    }
  });
  const registry = new MediaRegistry([localAdapter(() => [localSpec("here/one")])]);
  assert.equal(mediaRunnerDeps({ config, webAccess: { spend: {} } } as never, { registry }).registry.listModels().length, 0);
  assert.equal(mediaRunnerDeps({ config } as never, { registry }).registry, registry);
});
