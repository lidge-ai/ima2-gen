// HTTP surface of the media lane (plan 261126, L0): catalog, inputs upload,
// POST /api/media (202 + /api/events), cancel, workflows, studio mount and the
// generalized key store. Drives real Express routes with a fake adapter.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { existsSync } from "node:fs";
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
type WorkflowDefinition = import("../lib/workflows/types.ts").WorkflowDefinition;

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
test.afterEach(() => { resetBus(); resetInflight(); });

const VIDEO_URL = "https://cdn.fake.example/out/clip.mp4";

// A one-step L6 workflow on the fake adapter: the bridge resolves its route and key
// through the media registry, runs it, and copies the final artifact into history.
const oneStep = {
  id: "test-flow",
  label: "Test flow",
  description: "one fake clip",
  equivalents: [],
  fields: [{ type: "text", name: "prompt", label: "Prompt", required: true, maxLength: 200 }],
  slots: [{ name: "render", label: "Render", task: "text-to-video", defaultModel: "acme/clip-1", alternatives: [], rationale: "test" }],
  plan(values: Record<string, unknown>, slots: Record<string, { model: string; route?: string }>) {
    const model = slots.render!.model;
    const route = slots.render!.route;
    return { workflowId: "test-flow", steps: [{
      id: "render", label: "Render", kind: "media", dependsOn: [], final: true, slot: "render", model, ...(route ? { route } : {}), outputKind: "video",
      units: { unit: "second", quantity: 5, variant: "720p" },
      build: async () => ({ model, task: "text-to-video", prompt: String(values.prompt), durationSec: 5, inputs: [] }),
    }] };
  },
} as unknown as WorkflowDefinition;

const noLocalOps = {
  probe: async () => { throw new Error("no media fields"); },
  frame: async () => { throw new Error("unused"); },
  muxAudio: async () => { throw new Error("unused"); },
  concat: async () => { throw new Error("unused"); },
  cut: async () => { throw new Error("unused"); },
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
  const aggregator = makeFakeAdapter({ id: "agg", route: "aggregator", models: [fakeSpec("acme/clip-1")], script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }] } });
  const registry = new MediaRegistry([adapter, aggregator]);
  const transport = fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4", type: "video/mp4" } }, ...(opts.status ? { status: opts.status } : {}) });
  const studiosRoot = join(root, "studios");
  await mkdir(join(studiosRoot, "higgs", "dist", "assets"), { recursive: true });
  await writeFile(join(studiosRoot, "higgs", "dist", "index.html"), "<html>higgs studio</html>");
  await writeFile(join(studiosRoot, "higgs", "dist", "assets", "app.js"), "console.log(1)");
  await mkdir(join(studiosRoot, "kit", "assets", "vendors"), { recursive: true });
  await writeFile(join(studiosRoot, "kit", "assets", "vendors", "acme.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(join(studiosRoot, "kit", "assets", "vendors", "manifest.json"), JSON.stringify({ generatedAt: "2026-11-26", vendors: [
    { id: "acme", name: "Acme Media", aliases: ["fake"], files: [{ file: "acme.svg", variant: "primary", format: "svg" }, { file: "../escape.svg", variant: "dark", format: "svg" }], sourceUrl: "https://acme.example/brand" },
  ] }));
  await mkdir(join(studiosRoot, "kit", "dist"), { recursive: true });
  await writeFile(join(studiosRoot, "kit", "dist", "index.html"), "kit");
  const ctx = { rootDir: root, packageVersion: "test", config: { ...config, storage: { ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated") }, log: { ...config.log, level: "silent" } } };
  const deps = { registry, fetch: transport.fetch, env: {}, thumbnails: false, sleep: async () => { await new Promise((r) => setImmediate(r)); } };
  const app = express();
  mountStudioUi(app, ctx as never, { root: studiosRoot, env: {} });
  app.get("/", (_req, res) => { res.send("classic ui"); });
  app.use(express.json({ limit: "5mb" }));
  registerMediaRoutes(app, ctx as never, deps);
  registerWorkflowRoutes(app, ctx as never, { deps, workflows: [oneStep], local: noLocalOps, sessionRoutes: {
    "fake-oauth": { adapterId: "agg", label: "Fake subscription", open: async () => ({ apiKey: "session-token-abcdef" }) },
    "dead-oauth": { adapterId: "agg", label: "Dead subscription", open: async () => { throw new Error("not signed in"); } },
  } });
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
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function waitFor(events: { jobId: string; event: string }[], jobId: string, names: string[]) {
  for (let i = 0; i < 4000; i += 1) {
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
    assert.deepEqual(clip.logo, { id: "acme", name: "Acme Media", urls: { primary: "/media-assets/vendors/acme.svg" }, source: "https://acme.example/brand" });
    assert.equal(clip.routes[0].logo.id, "acme", "the fake adapter id is a manifest alias");
    assert.equal(clip.routes[1].logo, null, "an aggregator without its own logo does not use the model vendor logo");
    assert.equal(fake.logo.id, "acme");
    const svg = await fetch(`${base}${clip.logo.urls.primary}`);
    assert.equal(svg.status, 200);
    assert.match(String(svg.headers.get("content-security-policy")), /default-src 'none'/);
    assert.equal(svg.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/media-assets/vendors/missing.svg`)).status, 404);
    const vendors = await (await fetch(`${base}/api/media/vendors`)).json();
    assert.deepEqual(vendors.vendors.map((v: { id: string }) => v.id), ["acme"]);
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
    assert.equal(done.data.jobKind, "media");
    const jobs = await (await fetch(`${base}/api/media/jobs?status=all`)).json();
    assert.ok(jobs.terminalJobs.some((j: { requestId: string }) => j.requestId === "r1"));
    assert.equal((await (await fetch(`${base}/api/media/jobs/r1`)).json()).job.requestId, "r1");
    assert.equal((await fetch(`${base}/api/media/jobs/nope`)).status, 404);
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

test("workflows: list, estimate and a run through the L6 engine land the final clip in history", async () => {
  await withApp(async ({ base, events, root }) => {
    const list = await (await fetch(`${base}/api/workflows`)).json();
    assert.equal(list.workflows[0].id, "test-flow");
    assert.equal(list.workflows[0].slots[0].available["acme/clip-1"], true);
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const est = await (await post("/api/workflows/test-flow/estimate", { values: { prompt: "fox" } })).json();
    assert.equal(est.estimate.usd, 0.25);
    assert.equal(est.estimate.complete, true);
    const missing = await post("/api/workflows/test-flow", { values: {} });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "WORKFLOW_INPUT_INVALID");
    const res = await post("/api/workflows/test-flow", { requestId: "wf1", values: { prompt: "fox" } });
    assert.equal(res.status, 202);
    await waitFor(events, "wf1", ["done", "error"]);
    const mine = events.filter((e) => e.jobId === "wf1");
    assert.deepEqual(mine.filter((e) => e.event === "step").map((e) => e.data.status), ["started", "artifact", "done"]);
    const done = mine.find((e) => e.event === "done")!;
    assert.equal(done.data.jobKind, "workflow");
    assert.equal(await readFile(join(root, "generated", String(done.data.filename)), "utf8"), "mp4");
    assert.ok(!JSON.stringify(mine).includes(root), "server paths stay on the server");
    assert.ok(!JSON.stringify(mine).includes(FAKE_KEY));
    const unknown = await post("/api/workflows/nope", {});
    assert.equal(unknown.status, 404);
  });
});

test("workflows: a requestId of '..' never turns the run's scratch folder into the config folder", async () => {
  await withApp(async ({ base, events, root, configFile }) => {
    const res = await fetch(`${base}/api/workflows/test-flow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "..", values: { prompt: "fox" } }) });
    assert.equal(res.status, 202);
    await waitFor(events, "..", ["done", "error"]);
    assert.ok(existsSync(configFile), "config.json survives the run's cleanup");
    assert.ok(existsSync(join(root, "generated")), "history survives the run's cleanup");
  });
});

test("workflows: a session route runs a keyless adapter with the signed-in token, and a missing session fails clearly", async () => {
  await withApp(async ({ base, events, calls }) => {
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post("/api/workflows/test-flow", { requestId: "wf-sub", values: { prompt: "fox" }, selection: { routes: { render: "fake-oauth" } } });
    assert.equal(ok.status, 202);
    await waitFor(events, "wf-sub", ["done", "error"]);
    assert.ok(events.some((e) => e.jobId === "wf-sub" && e.event === "done"), JSON.stringify(events.filter((e) => e.jobId === "wf-sub" && e.event === "error")));
    const submit = calls.find((c) => c.url === "https://fake.example/v1/jobs") as { headers?: Record<string, string> } | undefined;
    assert.equal(submit?.headers?.authorization, "Bearer session-token-abcdef");
    assert.ok(!JSON.stringify(events).includes("session-token-abcdef"));
    await post("/api/workflows/test-flow", { requestId: "wf-dead", values: { prompt: "fox" }, selection: { routes: { render: "dead-oauth" } } });
    await waitFor(events, "wf-dead", ["done", "error"]);
    assert.equal(events.find((e) => e.jobId === "wf-dead" && e.event === "error")?.data.code, "MEDIA_SESSION_MISSING");
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
    assert.equal(fake.logo.urls.primary, "/media-assets/vendors/acme.svg", "key settings use the same logo files");
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
