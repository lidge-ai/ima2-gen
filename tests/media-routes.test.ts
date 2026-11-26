// HTTP surface of the media lane (plan 261126, L0): catalog, inputs upload,
// POST /api/media (202 + /api/events), cancel, workflows, studio mount and the
// generalized key store. Drives real Express routes with a fake adapter.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-media-routes-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { registerMediaRoutes } = await import("../routes/media.ts");
const { registerWorkflowRoutes } = await import("../routes/workflows.ts");
const { mountStudioUi, registerStudioRoutes } = await import("../routes/studios.ts");
const { mountKeyRoutes } = await import("../routes/keys.ts");
const { subscribe, _resetForTest: resetBus } = await import("../lib/eventBus.ts");
const { _resetForTests: resetInflight } = await import("../lib/inflight.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");
type MediaWorkflow = import("../lib/providers/media/workflow.ts").MediaWorkflow;

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true }); });
test.afterEach(() => { resetBus(); resetInflight(); });

const VIDEO_URL = "https://cdn.fake.example/out/clip.mp4";

const twoStep: MediaWorkflow = {
  id: "two-step",
  label: "Two step",
  description: "image then video",
  inputs: [{ name: "prompt", label: "Prompt", type: "text", required: true }],
  estimate: (_input, catalog) => [{ id: "clip", label: "Clip", model: "acme/clip-1", usd: catalog.getModel("acme/clip-1") ? 0.25 : undefined }],
  async run(ctx) {
    const first = await ctx.runStep("clip", { model: "acme/clip-1", task: "text-to-video", prompt: String(ctx.input.prompt), durationSec: 5, inputs: [] });
    const second = await ctx.runStep("clip", { model: "acme/clip-1", task: "image-to-video", prompt: "again", durationSec: 5, inputs: [ctx.asInput({ filename: first.outputs[0]!.filename }, "first-frame")] });
    return { outputs: second.outputs };
  },
};

async function withApp(fn: (h: { base: string; root: string; configFile: string; events: { jobId: string; event: string; data: Record<string, unknown> }[]; adapter: ReturnType<typeof makeFakeAdapter>; calls: { url: string }[] }) => Promise<void>, opts: { keys?: Record<string, unknown>; states?: unknown[]; status?: (url: string) => number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ima2-media-app-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify(opts.keys ?? { fakeApiKey: FAKE_KEY }));
  const adapter = makeFakeAdapter({
    models: [fakeSpec("acme/clip-1"), fakeSpec("acme/still-1", { kind: "image", tasks: ["text-to-image"], params: {} })],
    extraFields: [{ name: "region", envVar: "FAKE_REGION", secret: false, required: false }, { name: "secretToken", envVar: "FAKE_SECRET_TOKEN", secret: true, required: false }],
    script: { states: (opts.states ?? [{ status: "running", progress: 0.5 }, { status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }]) as never },
  });
  const aggregator = makeFakeAdapter({ id: "agg", route: "aggregator", models: [fakeSpec("acme/clip-1")] });
  const registry = new MediaRegistry([adapter, aggregator]);
  const transport = fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4", type: "video/mp4" } }, ...(opts.status ? { status: opts.status } : {}) });
  const studiosRoot = join(root, "studios");
  await mkdir(join(studiosRoot, "higgs", "dist", "assets"), { recursive: true });
  await writeFile(join(studiosRoot, "higgs", "dist", "index.html"), "<html>higgs studio</html>");
  await writeFile(join(studiosRoot, "higgs", "dist", "assets", "app.js"), "console.log(1)");
  await mkdir(join(studiosRoot, "kit", "dist"), { recursive: true });
  await writeFile(join(studiosRoot, "kit", "dist", "index.html"), "kit");
  const ctx = { rootDir: root, packageVersion: "test", config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated") }, log: { ...config.log, level: "silent" } } };
  const deps = { registry, fetch: transport.fetch, env: {}, thumbnails: false, sleep: async () => { await new Promise((r) => setImmediate(r)); } };
  const app = express();
  mountStudioUi(app, ctx as never, { root: studiosRoot, env: {} });
  app.get("/", (_req, res) => { res.send("classic ui"); });
  app.use(express.json({ limit: "5mb" }));
  registerMediaRoutes(app, ctx as never, deps);
  registerWorkflowRoutes(app, ctx as never, { deps, workflows: [twoStep] });
  registerStudioRoutes(app, ctx as never, { root: studiosRoot, env: {} });
  mountKeyRoutes(app, ctx as never, { mediaRegistry: registry, fetch: transport.fetch, env: {} });
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const events: { jobId: string; event: string; data: Record<string, unknown> }[] = [];
  const unsubscribe = subscribe((ev) => events.push({ jobId: ev.jobId, event: ev.event, data: ev.data }));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    await fn({ base: `http://127.0.0.1:${port}`, root, configFile, events, adapter, calls: transport.calls });
  } finally {
    unsubscribe();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}

async function waitFor(events: { jobId: string; event: string }[], jobId: string, names: string[]) {
  for (let i = 0; i < 2000; i += 1) {
    if (events.some((e) => e.jobId === jobId && names.includes(e.event))) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`no ${names.join("/")} for ${jobId}`);
}

test("catalog lists models with every route, prices and key state, and never the key", async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/api/media/catalog`);
    const text = await res.text();
    assert.ok(!text.includes(FAKE_KEY));
    const body = JSON.parse(text);
    const clip = body.models.find((m: { id: string }) => m.id === "acme/clip-1");
    assert.deepEqual(clip.routes.map((r: { adapter: string }) => r.adapter), ["fake", "agg"]);
    assert.equal(clip.defaultRoute, "fake");
    assert.equal(clip.routes[0].pricing[0].usd, 0.05);
    assert.equal(clip.routes[1].hasKey, false);
    const fake = body.adapters.find((a: { id: string }) => a.id === "fake");
    assert.equal(fake.hasKey, true);
    assert.equal(fake.maskedKey, "fake..90");
    const videoOnly = await (await fetch(`${base}/api/media/catalog?kind=image`)).json();
    assert.deepEqual(videoOnly.models.map((m: { id: string }) => m.id), ["acme/still-1"]);
  });
});

test("POST /api/media answers 202 and the job finishes on /api/events", async () => {
  await withApp(async ({ base, events, root }) => {
    const res = await fetch(`${base}/api/media`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r1", model: "acme/clip-1", task: "text-to-video", prompt: "a fox", durationSec: 5 }) });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { requestId: "r1", model: "acme/clip-1", adapter: "fake" });
    await waitFor(events, "r1", ["done", "error"]);
    const done = events.find((e) => e.jobId === "r1" && e.event === "done")!;
    assert.equal(await readFile(join(root, "generated", String(done.data.filename)), "utf8"), "mp4");
    assert.ok(!JSON.stringify(events).includes(FAKE_KEY));
  });
});

test("POST /api/media refuses bad bodies and keyless routes synchronously", async () => {
  await withApp(async ({ base, calls }) => {
    const post = (b: unknown) => fetch(`${base}/api/media`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const noTask = await post({ model: "acme/clip-1" });
    assert.equal(noTask.status, 400);
    assert.equal((await noTask.json()).code, "MEDIA_INVALID_REQUEST");
    const unknown = await post({ model: "acme/none", task: "text-to-video" });
    assert.equal(unknown.status, 404);
    const keyless = await post({ model: "acme/clip-1", task: "text-to-video", adapter: "agg" });
    assert.equal(keyless.status, 400);
    assert.equal((await keyless.json()).code, "MEDIA_KEY_MISSING");
    assert.equal(calls.length, 0);
  });
});

test("inputs upload returns a ref that POST /api/media accepts", async () => {
  await withApp(async ({ base, adapter, events }) => {
    adapter.script.submitted = [];
    const up = await fetch(`${base}/api/media/inputs`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) });
    assert.equal(up.status, 201);
    const { ref, bytes } = await up.json();
    assert.match(ref, /^input:[a-f0-9]{24}\.png$/);
    assert.equal(bytes, 4);
    const bad = await fetch(`${base}/api/media/inputs`, { method: "POST", headers: { "content-type": "text/html" }, body: "<x>" });
    assert.equal(bad.status, 415);
    const res = await fetch(`${base}/api/media`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r-in", model: "acme/clip-1", task: "image-to-video", durationSec: 5, inputs: [{ role: "first-frame", ref }] }) });
    assert.equal(res.status, 202);
    await waitFor(events, "r-in", ["done", "error"]);
    assert.deepEqual([...(adapter.script.submitted![0]!.inputs[0]!.bytes ?? [])], [137, 80, 78, 71]);
  });
});

test("cancel route stops a running job", async () => {
  await withApp(async ({ base, events }) => {
    await fetch(`${base}/api/media`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "r-c", model: "acme/clip-1", task: "text-to-video", durationSec: 5 }) });
    await waitFor(events, "r-c", ["progress"]);
    const res = await fetch(`${base}/api/media/r-c/cancel`, { method: "POST" });
    assert.equal((await res.json()).ok, true);
    await waitFor(events, "r-c", ["error"]);
    assert.equal(events.find((e) => e.jobId === "r-c" && e.event === "error")!.data.code, "GENERATION_CANCELED");
  }, { states: [{ status: "running" }] });
});

test("workflows: list, estimate, and a two-step run with child jobs and step events", async () => {
  await withApp(async ({ base, events }) => {
    const list = await (await fetch(`${base}/api/workflows`)).json();
    assert.equal(list.workflows[0].id, "two-step");
    const est = await (await fetch(`${base}/api/workflows/two-step/estimate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.equal(est.totalUsd, 0.25);
    const missing = await fetch(`${base}/api/workflows/two-step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {} }) });
    assert.equal(missing.status, 400);
    const res = await fetch(`${base}/api/workflows/two-step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "wf1", input: { prompt: "fox" } }) });
    assert.equal(res.status, 202);
    await waitFor(events, "wf1", ["done", "error"]);
    const steps = events.filter((e) => e.jobId === "wf1" && e.event === "step").map((e) => `${e.data.childRequestId}:${e.data.status}`);
    assert.deepEqual(steps, ["wf1.clip:started", "wf1.clip:done", "wf1.clip-2:started", "wf1.clip-2:done"]);
    assert.ok(events.some((e) => e.jobId === "wf1.clip-2" && e.event === "done"));
    assert.equal(events.find((e) => e.jobId === "wf1" && e.event === "done")!.data.workflow, "two-step");
    const unknown = await fetch(`${base}/api/workflows/nope`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(unknown.status, 404);
  });
});

test("studios: served under /studio/<name>/, SPA fallback, default UI redirect and classic escape", async () => {
  await withApp(async ({ base }) => {
    const studios = await (await fetch(`${base}/api/studios`)).json();
    assert.deepEqual(studios, { studios: [{ name: "higgs", built: true, url: "/studio/higgs/" }], defaultUi: "classic" });
    assert.equal(await (await fetch(`${base}/studio/higgs/`)).text(), "<html>higgs studio</html>");
    assert.equal(await (await fetch(`${base}/studio/higgs/library/item-3`)).text(), "<html>higgs studio</html>");
    assert.equal(await (await fetch(`${base}/studio/higgs/assets/app.js`)).text(), "console.log(1)");
    assert.equal((await fetch(`${base}/studio/higgs/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/studio/kit/`)).status, 404);
    const noSlash = await fetch(`${base}/studio/higgs`, { redirect: "manual" });
    assert.equal(noSlash.headers.get("location"), "/studio/higgs/");
    assert.equal(await (await fetch(`${base}/`)).text(), "classic ui");
    const bad = await fetch(`${base}/api/studios/default`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "kit" }) });
    assert.equal(bad.status, 400);
    const set = await fetch(`${base}/api/studios/default`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "higgs" }) });
    assert.equal((await set.json()).defaultUi, "higgs");
    const home = await fetch(`${base}/`, { redirect: "manual" });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/studio/higgs/");
    assert.equal(await (await fetch(`${base}/?ui=classic`)).text(), "classic ui");
  });
});

test("keys: media vocabularies are validated by the adapter, saved with extras, masked in status", async () => {
  await withApp(async ({ base, configFile, calls }) => {
    const vocab = await (await fetch(`${base}/api/keys/vocabulary`)).json();
    const fake = vocab.vocabularies.find((v: { vocabulary: string }) => v.vocabulary === "fake");
    assert.deepEqual(fake.extraFields.map((f: { name: string }) => f.name), ["region", "secretToken"]);
    const put = await fetch(`${base}/api/keys/agg`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "agg-secret-value-123", extra: {} }) });
    assert.equal(put.status, 200);
    assert.ok(calls.some((c) => c.url === "https://fake.example/v1/me"));
    const saved = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(saved.aggApiKey, "agg-secret-value-123");
    const extra = await fetch(`${base}/api/keys/fake/extra`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ extra: { region: "eu", secretToken: "tok-secret-999999" } }) });
    assert.equal(extra.status, 200);
    const unknownField = await fetch(`${base}/api/keys/fake/extra`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ extra: { bogus: "1" } }) });
    assert.equal(unknownField.status, 400);
    const statusText = await (await fetch(`${base}/api/keys/status`)).text();
    for (const secret of [FAKE_KEY, "agg-secret-value-123", "tok-secret-999999"]) assert.ok(!statusText.includes(secret), "status leaks a secret");
    const status = JSON.parse(statusText);
    assert.equal(status.agg.configured, true);
    assert.equal(status.fake.extraFields.find((f: { name: string }) => f.name === "region").value, "eu");
    assert.equal(status.fake.extraFields.find((f: { name: string }) => f.name === "secretToken").value, undefined);
    assert.ok(status.openai, "legacy entries remain");
    const del = await fetch(`${base}/api/keys/agg`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).aggApiKey, undefined);
  });
});

test("keys: a rejected media key is not saved and the error does not echo it", async () => {
  await withApp(async ({ base, configFile }) => {
    const res = await fetch(`${base}/api/keys/agg`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "agg-rejected-key-777" }) });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /KEY_VALIDATION_FAILED/);
    assert.ok(!text.includes("agg-rejected-key-777"));
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).aggApiKey, undefined);
  }, { keys: {}, status: (url) => (url.endsWith("/v1/me") ? 401 : 0) });
});
