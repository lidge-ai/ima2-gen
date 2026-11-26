// Runner behavior with a fake adapter and fake transport (plan 261126, L0):
// submit → poll → download → history save, error classification, cancel,
// retries, timeouts, route choice, and that no key reaches events or logs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-media-runner-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;

const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { launchMediaJob, prepareMediaJob } = await import("../lib/providers/media/runner.ts");
const { parseMediaJobBody } = await import("../lib/providers/media/validate.ts");
const { subscribe, _resetForTest: resetBus } = await import("../lib/eventBus.ts");
const { abortJob, _resetForTests: resetInflight } = await import("../lib/inflight.ts");
const { configureLogger } = await import("../lib/logger.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter, FakeHttpError } = await import("./_mediaFakeAdapter.ts");
const { closeDb } = await import("../lib/db.ts");
type FakeAdapter = ReturnType<typeof makeFakeAdapter>;

const logLines: string[] = [];
configureLogger({ level: "debug", sink: { log: (l) => logLines.push(l), debug: (l) => logLines.push(l), info: (l) => logLines.push(l), warn: (l) => logLines.push(l), error: (l) => logLines.push(l) } });

test.after(async () => {
  // Jobs persist through lib/inflight into <config>/sessions.db (and its WAL/SHM files);
  // Windows refuses to unlink them while the handle is open.
  closeDb();
  await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test.afterEach(() => {
  resetBus();
  resetInflight();
});

const VIDEO_URL = "https://cdn.fake.example/out/clip.mp4";

async function setup(adapters: FakeAdapter[], opts: { keys?: Record<string, string>; transport?: ReturnType<typeof fakeTransport>; maxWaitMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ima2-media-job-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify(opts.keys ?? { fakeApiKey: FAKE_KEY }));
  const transport = opts.transport ?? fakeTransport({ downloads: { [VIDEO_URL]: { body: "mp4-bytes", type: "video/mp4" } } });
  const deps = {
    registry: new MediaRegistry(adapters),
    generatedDir: join(root, "generated"),
    configFile,
    inputsDir: join(root, "inputs"),
    env: {},
    fetch: transport.fetch,
    sleep: async (_ms: number, signal: AbortSignal) => { if (signal.aborted) throw signal.reason; await new Promise((r) => setImmediate(r)); },
    thumbnails: false,
    ...(opts.maxWaitMs !== undefined ? { maxWaitMs: opts.maxWaitMs } : {}),
  };
  const events: { jobId: string; event: string; data: Record<string, unknown> }[] = [];
  const unsubscribe = subscribe((ev) => events.push({ jobId: ev.jobId, event: ev.event, data: ev.data }));
  return { root, deps, transport, events, done: async () => { unsubscribe(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } };
}

function body(extra: Record<string, unknown> = {}) {
  return parseMediaJobBody({ model: "acme/clip-1", task: "text-to-video", prompt: "a fox", durationSec: 5, ...extra });
}

function assertNoKey(where: unknown) {
  assert.ok(!JSON.stringify(where).includes(FAKE_KEY), "key leaked");
}

test("a succeeded job downloads the output, writes a sidecar and publishes submitted/progress/done", async () => {
  const adapter = makeFakeAdapter({ script: { states: [{ status: "running", progress: 0.4 }, { status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4", downloadHeaders: { "x-asset": "1" } }], billed: { usd: 0.25 } }] } });
  const s = await setup([adapter]);
  try {
    const prepared = await prepareMediaJob(s.deps, body());
    const result = await launchMediaJob(s.deps, prepared, { requestId: "req-ok", sessionId: "s1" }).done;
    assert.equal(result.outputs.length, 1);
    const saved = result.outputs[0]!;
    assert.match(saved.filename, /\.mp4$/);
    assert.equal(await readFile(join(s.deps.generatedDir, saved.filename), "utf8"), "mp4-bytes");
    const meta = JSON.parse(await readFile(join(s.deps.generatedDir, `${saved.filename}.json`), "utf8"));
    assert.equal(meta.model, "acme/clip-1");
    assert.equal(meta.provider, "media:fake");
    assert.equal(meta.mediaType, "video");
    assert.equal(meta.sessionId, "s1");
    assert.equal(meta.providerJobId, "job-1");
    const names = s.events.filter((e) => e.jobId === "req-ok").map((e) => e.event);
    assert.deepEqual(names, ["submitted", "progress", "done"]);
    const done = s.events.find((e) => e.event === "done")!.data;
    assert.equal(done.url, saved.url);
    assert.deepEqual(done.billed, { usd: 0.25 });
    const download = s.transport.calls.find((c) => c.url === VIDEO_URL)!;
    assert.equal(download.headers["x-asset"], "1");
    assert.ok(s.transport.calls.filter((c) => c.url.startsWith("https://fake.example/")).every((c) => c.headers.authorization === `Bearer ${FAKE_KEY}`));
    assertNoKey(s.events);
    assertNoKey(logLines);
  } finally {
    await s.done();
  }
});

test("a failed state becomes an error event with the vendor code, its category and no key", async () => {
  const adapter = makeFakeAdapter({ script: { states: [{ status: "failed", error: { code: "FAKE_INSUFFICIENT_CREDIT", message: `balance empty for ${FAKE_KEY}`, status: 402, retryable: false, category: "quota" } }] } });
  const s = await setup([adapter]);
  try {
    const prepared = await prepareMediaJob(s.deps, body());
    await assert.rejects(launchMediaJob(s.deps, prepared, { requestId: "req-fail" }).done, { code: "FAKE_INSUFFICIENT_CREDIT" });
    const err = s.events.find((e) => e.event === "error")!.data;
    assert.equal(err.code, "FAKE_INSUFFICIENT_CREDIT");
    assert.equal(err.category, "quota");
    assert.equal(err.status, 402);
    assert.match(String(err.error), /\[redacted\]/);
    assertNoKey(s.events);
    assertNoKey(logLines);
  } finally {
    await s.done();
  }
});

test("retryable poll errors retry the same job; a non-retryable one fails at once", async () => {
  const flaky = makeFakeAdapter({ script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], pollErrors: [new FakeHttpError(503, "busy"), new FakeHttpError(429, "slow down")] } });
  const s1 = await setup([flaky]);
  try {
    const r = await launchMediaJob(s1.deps, await prepareMediaJob(s1.deps, body()), { requestId: "req-retry" }).done;
    assert.equal(r.outputs.length, 1);
    assert.equal(s1.transport.calls.filter((c) => c.url.endsWith("/v1/jobs")).length, 1, "never resubmits");
  } finally {
    await s1.done();
  }
  const broken = makeFakeAdapter({ script: { states: [{ status: "running" }], pollErrors: [new FakeHttpError(401, "revoked")] } });
  const s2 = await setup([broken]);
  try {
    await assert.rejects(launchMediaJob(s2.deps, await prepareMediaJob(s2.deps, body()), { requestId: "req-auth" }).done, { code: "FAKE_AUTH", category: "auth" });
  } finally {
    await s2.done();
  }
  const storm = makeFakeAdapter({ script: { states: [{ status: "running" }], pollErrors: Array.from({ length: 5 }, () => new FakeHttpError(503, "down")) } });
  const s3 = await setup([storm]);
  try {
    await assert.rejects(launchMediaJob(s3.deps, await prepareMediaJob(s3.deps, body()), { requestId: "req-storm" }).done, { code: "FAKE_UPSTREAM" });
  } finally {
    await s3.done();
  }
});

test("a job that never finishes times out with MEDIA_TIMEOUT", async () => {
  const adapter = makeFakeAdapter({ script: { states: [{ status: "running" }] } });
  const s = await setup([adapter], { maxWaitMs: -1 });
  try {
    await assert.rejects(launchMediaJob(s.deps, await prepareMediaJob(s.deps, body()), { requestId: "req-slow" }).done, { code: "MEDIA_TIMEOUT", category: "timeout" });
  } finally {
    await s.done();
  }
});

test("cancel aborts polling, calls adapter.cancel once and publishes one canceled error", async () => {
  const canceled: unknown[] = [];
  const adapter = makeFakeAdapter({ script: { states: [{ status: "running" }], canceled: canceled as never } });
  const s = await setup([adapter]);
  try {
    const job = launchMediaJob(s.deps, await prepareMediaJob(s.deps, body()), { requestId: "req-cancel" });
    while (!s.events.some((e) => e.event === "progress")) await new Promise((r) => setImmediate(r));
    abortJob("req-cancel");
    await assert.rejects(job.done, { code: "GENERATION_CANCELED" });
    assert.equal(canceled.length, 1);
    const errors = s.events.filter((e) => e.jobId === "req-cancel" && e.event === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.data.code, "GENERATION_CANCELED");
  } finally {
    await s.done();
  }
});

test("route choice: direct before aggregator, explicit adapter honored, keyless routes never picked", async () => {
  const spec = fakeSpec("acme/clip-1");
  const direct = makeFakeAdapter({ id: "acme-direct", route: "direct", models: [spec] });
  const agg = makeFakeAdapter({ id: "agg", route: "aggregator", models: [spec] });
  const s = await setup([agg, direct], { keys: { aggApiKey: "agg-key-000000", acmeDirectApiKey: "direct-key-000000" } });
  try {
    assert.equal((await prepareMediaJob(s.deps, body())).adapter.id, "acme-direct");
    assert.equal((await prepareMediaJob(s.deps, body({ adapter: "agg" }))).adapter.id, "agg");
  } finally {
    await s.done();
  }
  const s2 = await setup([agg, direct], { keys: { aggApiKey: "agg-key-000000" } });
  try {
    assert.equal((await prepareMediaJob(s2.deps, body())).adapter.id, "agg", "falls to the keyed aggregator");
    await assert.rejects(prepareMediaJob(s2.deps, body({ adapter: "acme-direct" })), { code: "MEDIA_KEY_MISSING" });
  } finally {
    await s2.done();
  }
  const s3 = await setup([agg, direct], { keys: {} });
  try {
    await assert.rejects(prepareMediaJob(s3.deps, body()), { code: "MEDIA_KEY_MISSING" });
    await assert.rejects(prepareMediaJob(s3.deps, body({ model: "acme/nope" })), { code: "MEDIA_MODEL_UNKNOWN" });
  } finally {
    await s3.done();
  }
});

test("parameters outside the chosen spec are refused before anything is sent", async () => {
  const adapter = makeFakeAdapter();
  const s = await setup([adapter]);
  try {
    await assert.rejects(prepareMediaJob(s.deps, body({ durationSec: 7 })), { code: "MEDIA_INVALID_REQUEST" });
    await assert.rejects(prepareMediaJob(s.deps, body({ negativePrompt: "blur" })), { code: "MEDIA_INVALID_REQUEST" });
    await assert.rejects(prepareMediaJob(s.deps, body({ task: "lipsync" })), { code: "MEDIA_TASK_UNSUPPORTED" });
    assert.equal(s.transport.calls.length, 0);
  } finally {
    await s.done();
  }
});

test("inputs: upload transport uploads local bytes, url transport refuses them, filenames cannot escape", async () => {
  const uploaded: unknown[] = [];
  const submitted: { inputs: readonly { url?: string; bytes?: Uint8Array }[] }[] = [];
  const up = makeFakeAdapter({ inputTransport: "upload", script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], uploaded: uploaded as never, submitted: submitted as never } });
  const s = await setup([up]);
  try {
    await mkdir(s.deps.generatedDir, { recursive: true });
    await writeFile(join(s.deps.generatedDir, "frame.png"), "png-bytes");
    const req = body({ task: "image-to-video", inputs: [{ role: "first-frame", filename: "frame.png" }] });
    await launchMediaJob(s.deps, await prepareMediaJob(s.deps, req), { requestId: "req-up" }).done;
    assert.equal(uploaded.length, 1);
    assert.equal(submitted[0]!.inputs[0]!.url, "https://fake.example/uploaded/1.png");
    assert.equal(submitted[0]!.inputs[0]!.bytes, undefined);
    await assert.rejects(prepareMediaJob(s.deps, body({ task: "image-to-video", inputs: [{ role: "first-frame", filename: "../config.json" }] })), { code: "MEDIA_INPUT_INVALID" });
  } finally {
    await s.done();
  }
  const urlOnly = makeFakeAdapter({ inputTransport: "url" });
  const s2 = await setup([urlOnly]);
  try {
    await assert.rejects(prepareMediaJob(s2.deps, body({ task: "image-to-video", inputs: [{ role: "first-frame", dataUrl: "data:image/png;base64,AAAA" }] })), { code: "MEDIA_INPUT_URL_REQUIRED" });
    const ok = await prepareMediaJob(s2.deps, body({ task: "image-to-video", inputs: [{ role: "first-frame", url: "https://img.example/a.png" }] }));
    assert.equal(ok.request.inputs[0]!.url, "https://img.example/a.png");
  } finally {
    await s2.done();
  }
});

test("env keys win over config, and extra fields are required when the adapter says so", async () => {
  const adapter = makeFakeAdapter({ extraFields: [{ name: "region", envVar: "FAKE_REGION", secret: false, required: true }] });
  const s = await setup([adapter]);
  try {
    await assert.rejects(prepareMediaJob(s.deps, body()), { code: "MEDIA_KEY_MISSING" });
    const withEnv = { ...s.deps, env: { FAKE_API_KEY: "env-key-0000000", FAKE_REGION: "ap" } };
    const prepared = await prepareMediaJob(withEnv, body());
    assert.equal(prepared.credential.apiKey, "env-key-0000000");
    assert.deepEqual(prepared.credential.extra, { region: "ap" });
  } finally {
    await s.done();
  }
});

test("listing saved outputs: files land in the history folder only once per output", async () => {
  const adapter = makeFakeAdapter({ script: { states: [{ status: "succeeded", outputs: [
    { kind: "video", url: VIDEO_URL, mimeType: "video/mp4" },
    { kind: "video", bytes: new TextEncoder().encode("inline-bytes"), mimeType: "video/mp4" },
  ] }] } });
  const s = await setup([adapter]);
  try {
    const r = await launchMediaJob(s.deps, await prepareMediaJob(s.deps, body()), { requestId: "req-two" }).done;
    assert.equal(r.outputs.length, 2);
    const files = (await readdir(s.deps.generatedDir)).sort();
    assert.equal(files.filter((f) => f.endsWith(".mp4")).length, 2);
    assert.equal(files.filter((f) => f.endsWith(".mp4.json")).length, 2);
  } finally {
    await s.done();
  }
});

test("outputs served as octet-stream are typed from their bytes", async () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const url = "https://cdn.fake.example/out/blob";
  const adapter = makeFakeAdapter({ models: [fakeSpec("acme/still-1", { kind: "image", tasks: ["text-to-image"], params: {} })], script: { states: [{ status: "succeeded", outputs: [{ kind: "image", url, mimeType: "application/octet-stream", downloadHeaders: { "x-goog-api-key": "header-secret-abcdef" } }] }] } });
  const s = await setup([adapter], { transport: fakeTransport({ downloads: { [url]: { body: PNG, type: "application/octet-stream" } } }) });
  try {
    const req = parseMediaJobBody({ model: "acme/still-1", task: "text-to-image", prompt: "x" });
    const r = await launchMediaJob(s.deps, await prepareMediaJob(s.deps, req), { requestId: "req-sniff" }).done;
    assert.match(r.outputs[0]!.filename, /\.png$/);
    assert.equal(r.outputs[0]!.mimeType, "image/png");
    assert.ok(!JSON.stringify(s.events).includes("header-secret-abcdef"));
    const sidecar = await readFile(join(s.deps.generatedDir, r.outputs[0]!.filename + ".json"), "utf8");
    assert.ok(!sidecar.includes("header-secret-abcdef"));
  } finally {
    await s.done();
  }
});

test("a secret extra field alone makes a route usable, and asset:// inputs reach the adapter untouched", async () => {
  const submitted: { inputs: readonly { url?: string }[] }[] = [];
  const adapter = makeFakeAdapter({
    extraFields: [{ name: "accessKey", envVar: "FAKE_ACCESS_KEY", secret: true, required: false }],
    script: { states: [{ status: "succeeded", outputs: [{ kind: "video", url: VIDEO_URL, mimeType: "video/mp4" }] }], submitted: submitted as never },
  });
  const s = await setup([adapter], { keys: {} });
  try {
    await assert.rejects(prepareMediaJob(s.deps, body()), { code: "MEDIA_KEY_MISSING" });
    const deps = { ...s.deps, env: { FAKE_ACCESS_KEY: "access-secret-000111" } };
    const req = body({ task: "image-to-video", inputs: [{ role: "first-frame", url: "asset://portrait-42" }] });
    const prepared = await prepareMediaJob(deps, req);
    assert.equal(prepared.credential.apiKey, undefined);
    await launchMediaJob(deps, prepared, { requestId: "req-extra-only" }).done;
    assert.equal(submitted[0]!.inputs[0]!.url, "asset://portrait-42");
    assert.ok(!JSON.stringify(s.events).includes("access-secret-000111"));
    await assert.rejects(prepareMediaJob(deps, body({ task: "image-to-video", inputs: [{ role: "first-frame", url: "file:///etc/hosts" }] })), { code: "MEDIA_INPUT_INVALID" });
  } finally {
    await s.done();
  }
});
