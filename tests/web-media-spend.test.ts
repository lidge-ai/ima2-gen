// POST /api/media on the web instance (L9): the spend guard admits priced jobs,
// refuses unpriced ones before anything is sent, and the sidecar names the person.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-web-media-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { registerMediaRoutes } = await import("../routes/media.ts");
const { subscribe, _resetForTest: resetBus } = await import("../lib/eventBus.ts");
const { _resetForTests: resetInflight } = await import("../lib/inflight.ts");
const { createSpendGuard } = await import("../lib/webAccess/spendGuard.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
test.afterEach(() => { resetBus(); resetInflight(); });

const VIDEO_URL = "https://cdn.fake.example/out/clip.mp4";

test("priced jobs are admitted and tagged with the email; unpriced and over-cap jobs never reach the provider", async t => {
  const root = await mkdtemp(join(tmpdir(), "ima2-web-media-app-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({ fakeApiKey: FAKE_KEY }));
  const adapter = makeFakeAdapter({
    models: [fakeSpec("acme/clip-1"), fakeSpec("acme/free-1", { pricing: [] }),
      fakeSpec("acme/pricey-1", { pricing: [{ unit: "second", usd: 0.5, variant: "720p", source: "https://example.com/pricing", checkedAt: "2026-11-26" }] })],
    script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], submitted: [] },
  });
  const transport = fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4", type: "video/mp4" } } });
  const generatedDir = join(root, "generated");
  const spend = createSpendGuard({ dailyCapUsd: 5, requestCapUsd: 1, ledgerFile: join(root, "ledger.json"), timeZone: "UTC" });
  const ctx = { rootDir: root, packageVersion: "test", webAccess: { spend },
    config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir }, log: { ...config.log, level: "silent" } } };
  const deps = { registry: new MediaRegistry([adapter]), fetch: transport.fetch, env: {}, thumbnails: false, sleep: async () => { await new Promise(r => setImmediate(r)); } };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.webUser = { email: "jun@example.test" }; next(); });
  registerMediaRoutes(app, ctx as never, deps);
  const server = await new Promise<import("node:http").Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const events: { jobId: string; event: string; data: Record<string, unknown> }[] = [];
  const unsubscribe = subscribe(ev => events.push({ jobId: ev.jobId, event: ev.event, data: ev.data }));
  t.after(async () => { unsubscribe(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
  const post = (body: unknown) => fetch(base + "/api/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const free = await post({ requestId: "free", model: "acme/free-1", task: "text-to-video", prompt: "x", durationSec: 5 });
  assert.equal(free.status, 403);
  assert.equal((await free.json()).code, "WEB_SPEND_UNPRICED");
  const long = await post({ requestId: "long", model: "acme/pricey-1", task: "text-to-video", prompt: "x", durationSec: 5, resolution: "720p" });
  assert.equal(long.status, 402);
  assert.equal((await long.json()).code, "WEB_SPEND_REQUEST_CAP");
  assert.equal(adapter.script.submitted!.length, 0, "refused jobs are never submitted");

  const ok = await post({ requestId: "ok", model: "acme/clip-1", task: "text-to-video", prompt: "a fox", durationSec: 5, resolution: "720p" });
  assert.equal(ok.status, 202);
  for (let i = 0; i < 4000 && !events.some(e => e.jobId === "ok" && (e.event === "done" || e.event === "error")); i += 1) await new Promise(r => setTimeout(r, 2));
  const done = events.find(e => e.jobId === "ok" && e.event === "done");
  assert.ok(done, JSON.stringify(events.filter(e => e.jobId === "ok")));
  const sidecar = JSON.parse(await readFile(join(generatedDir, String(done.data.filename) + ".json"), "utf8"));
  assert.equal(sidecar.webUser, "jun@example.test");
  const status = await spend.status();
  assert.equal(status.spentUsd, 0.25);
  assert.equal(status.entries[0]!.email, "jun@example.test");
});
