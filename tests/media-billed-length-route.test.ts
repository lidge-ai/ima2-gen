// POST /api/media for a job billed by the length of an uploaded input (lip-sync): the shared-key web
// instance prices it from the measured length, and refuses it when the length cannot be read.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-billed-length-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { registerMediaRoutes } = await import("../routes/media.ts");
const { subscribe, _resetForTest: resetBus } = await import("../lib/eventBus.ts");
const { _resetForTests: resetInflight } = await import("../lib/inflight.ts");
const { createSpendGuard } = await import("../lib/webAccess/spendGuard.ts");
const { closeDb } = await import("../lib/db.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");

test.after(async () => {
  closeDb();
  await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
test.afterEach(() => { resetBus(); resetInflight(); });

const VIDEO_URL = "https://cdn.fake.example/out/talk.mp4";

test("a lip-sync job is priced from the measured input length; an unmeasured one is refused before the provider is called", async t => {
  const root = await mkdtemp(join(tmpdir(), "ima2-billed-length-app-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({ fakeApiKey: FAKE_KEY }));
  const adapter = makeFakeAdapter({
    models: [fakeSpec("acme/lips-1", {
      tasks: ["lipsync"],
      params: { inputs: [{ role: "source-video", min: 1, max: 1, billedLength: true }, { role: "source-audio", min: 1, max: 1, billedLength: true }] },
      pricing: [{ unit: "second", usd: 0.1, source: "https://example.com/pricing", checkedAt: "2026-11-27" }],
    })],
    script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], submitted: [] },
  });
  const transport = fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4", type: "video/mp4" } } });
  const spend = createSpendGuard({ dailyCapUsd: 5, requestCapUsd: 1, ledgerFile: join(root, "ledger.json"), timeZone: "UTC" });
  const ctx = { rootDir: root, packageVersion: "test", webAccess: { spend },
    config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated") }, log: { ...config.log, level: "silent" } } };
  let lengths: Record<string, number | null> = { "source-video": 3.2, "source-audio": 6.5 };
  const deps = { registry: new MediaRegistry([adapter]), fetch: transport.fetch, env: {}, thumbnails: false,
    sleep: async () => { await new Promise(r => setImmediate(r)); },
    probeInputLength: async (input: { role: string }) => lengths[input.role] ?? null };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.webUser = { email: "jun@example.test" }; next(); });
  registerMediaRoutes(app, ctx as never, deps as never);
  const server = await new Promise<import("node:http").Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const events: { jobId: string; event: string }[] = [];
  const unsubscribe = subscribe(ev => events.push({ jobId: ev.jobId, event: ev.event }));
  t.after(async () => { unsubscribe(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
  const upload = async (type: string) => (await (await fetch(base + "/api/media/inputs", { method: "POST", headers: { "content-type": type }, body: new Uint8Array([1, 2, 3]) })).json() as { ref: string }).ref;
  const body = async (requestId: string) => ({ requestId, model: "acme/lips-1", task: "lipsync",
    inputs: [{ role: "source-video", ref: await upload("video/mp4") }, { role: "source-audio", ref: await upload("audio/mpeg") }] });
  const post = async (requestId: string) => fetch(base + "/api/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await body(requestId)) });

  const ok = await post("talk");
  assert.equal(ok.status, 202, await ok.clone().text());
  for (let i = 0; i < 4000 && !events.some(e => e.jobId === "talk" && (e.event === "done" || e.event === "error")); i += 1) await new Promise(r => setTimeout(r, 2));
  assert.ok(events.some(e => e.jobId === "talk" && e.event === "done"), JSON.stringify(events));
  // 7 whole seconds of the longer input at $0.10.
  assert.equal((await spend.status()).spentUsd, 0.7);
  assert.equal(adapter.script.submitted!.length, 1);
  assert.equal(adapter.script.submitted![0]!.durationSec, undefined, "the provider request carries no duration");

  lengths = { "source-video": 3.2, "source-audio": null };
  const unknown = await post("unmeasured");
  assert.equal(unknown.status, 403);
  assert.equal((await unknown.json()).code, "WEB_SPEND_UNPRICED");
  assert.equal(adapter.script.submitted!.length, 1, "the unmeasured job never reached the provider");
});

