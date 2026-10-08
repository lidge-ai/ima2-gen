import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as sourceText } from "node:fs";
import { grokAuthFilePath } from "../lib/xaiAuth.ts";
import { api88VideoLedgerPath, findApi88VideoTask } from "../lib/api88/videoLedger.ts";
import { generateApi88Video } from "../lib/api88/videoTransport.ts";
import { childEnvironment, keysFrom, loadPorts, once, parseEnvFile, parseFlags,
  runDemo, stageMandatoryArtifacts, videoStep, type DemoPorts } from "../scripts/api88Demo.ts";
import { masker, recordFetch } from "../scripts/api88DemoRecord.ts";

const originalFetch = globalThis.fetch;
const imageKey = "fixture-image-credential";
const videoKey = "fixture-video-credential";
const keys = { image: imageKey, video: videoKey, baseUrl: "https://api.88api.ai/v1/" };
const flags = { seedance: false, veo: false, omni: false, server: false };
const dirs: string[] = [];
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), "api88-demo-test-")); dirs.push(dir); return dir;
}
test.beforeEach(() => {
  globalThis.fetch = (async () => { assert.fail("Unexpected network call"); }) as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("manual entry refuses CI, missing --run, unknown and duplicate flags", () => {
  assert.throws(() => parseFlags(["--run"], { CI: "true" }), /CI_FORBIDDEN/);
  assert.throws(() => parseFlags([], {}), /Usage/);
  assert.throws(() => parseFlags(["--run", "--all"], {}), /Usage/);
  assert.throws(() => parseFlags(["--run", "--veo", "--veo"], {}), /Usage/);
  assert.deepEqual(parseFlags(["--run", "--veo"], {}), { ...flags, veo: true });
});
test("env parsing never evaluates shell syntax, keys are separate, env wins", () => {
  const file = parseEnvFile("IMA2_88API_IMAGE_KEY='fixture-file-image'\nIMA2_88API_VIDEO_KEY=fixture-file-video\n");
  assert.equal(keysFrom({ IMA2_88API_IMAGE_KEY: imageKey }, file).image, imageKey);
  assert.equal(keysFrom({}, file).video, "fixture-file-video");
  assert.throws(() => keysFrom({ IMA2_88API_IMAGE_KEY: imageKey }, {}), /BOTH_KEYS_REQUIRED/);
  assert.throws(() => parseEnvFile("IMA2_88API_IMAGE_KEY=$(command)"), /FORMAT/);
  assert.throws(() => parseEnvFile("export IMA2_88API_IMAGE_KEY=fixture"), /FORMAT/);
  assert.throws(() => keysFrom({ IMA2_88API_BASE_URL: "http://api.88api.ai" }, {
    IMA2_88API_IMAGE_KEY: imageKey, IMA2_88API_VIDEO_KEY: videoKey }), /HTTPS_BASE_REQUIRED/);
});
test("masked copies retain Gemini response topology and hide auth/signed queries", () => {
  const raw = { choices: [{ message: { images: [{ image_url: { url: "https://cdn.example/a.png?signature=private" } }], content: "data:image/png;base64,YQ==" } }],
    authorization: "Bearer " + imageKey, api88VideoKey: videoKey, text: imageKey };
  const text = JSON.stringify(masker([imageKey, videoKey]).clean(raw));
  for (const secret of [imageKey, videoKey, "signature=private"]) assert.ok(!text.includes(secret));
  assert.match(text, /choices/); assert.match(text, /image_url/); assert.match(text, /data:image/);
  assert.equal((masker([]).clean({ api88ImageKey: "unexpected-credential" }) as { api88ImageKey: string }).api88ImageKey, "[REDACTED]");
});
test("server environment isolates all storage, excludes ambient provider keys", () => {
  const dir = directory();
  const env = childEnvironment(keys, dir);
  const childHome = join(dir, "home");
  const configDir = join(childHome, ".ima2");
  assert.equal(env.IMA2_PORT, "0"); assert.equal(env.IMA2_HOST, "127.0.0.1");
  assert.equal(env.HOME, childHome); assert.notEqual(env.HOME, process.env.HOME);
  assert.equal(env.USERPROFILE, childHome); assert.equal(env.IMA2_CONFIG_DIR, configDir);
  assert.deepEqual(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")), {
    mcp: { enabledProviders: [] }, api88Provider: { baseUrl: keys.baseUrl } });
  assert.equal(grokAuthFilePath(env.HOME), join(childHome, ".progrok", "auth.json"));
  assert.equal(env.IMA2_DB_PATH, join(configDir, "sessions.db"));
  assert.equal(env.IMA2_GENERATED_DIR, join(configDir, "generated"));
  assert.equal(env.IMA2_MCP_PROVIDERS, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.IMA2_88API_IMAGE_KEY, imageKey); assert.equal(env.IMA2_88API_VIDEO_KEY, videoKey);
});
test("mandatory artifacts enter the preview gallery with accurate sidecars and no fetch", () => {
  const dir = directory(); const gallery = join(dir, "gallery");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=", "base64");
  for (const name of ["01-generation.png", "02-edit.png", "03-gemini.png"]) writeFileSync(join(dir, name), png);
  writeFileSync(join(dir, "04-grok.mp4"), Buffer.from("000000186674797069736f6d", "hex"));
  writeFileSync(join(dir, "04-grok-task.json"), JSON.stringify({ providerTaskId: "fixture-task" }));
  globalThis.fetch = (async () => { throw new Error("staging must never fetch"); }) as typeof fetch;
  stageMandatoryArtifacts(dir, gallery, [imageKey, videoKey]);
  const expected = { "01-generation.png": "gpt-image-2", "02-edit.png": "gpt-image-2",
    "03-gemini.png": "gemini-3.1-flash-lite-image", "04-grok.mp4": "grok-imagine-video-1.5" };
  for (const [name, model] of Object.entries(expected)) {
    const filename = "api88-demo-" + name;
    assert.deepEqual(readFileSync(join(gallery, filename)), readFileSync(join(dir, name)));
    const metadata = JSON.parse(readFileSync(join(gallery, filename + ".json"), "utf8"));
    assert.equal(metadata.provider, "88api"); assert.equal(metadata.model, model);
    assert.equal(metadata.kind, name.endsWith("mp4") ? "video" : "image");
    assert.equal(metadata.createdAt, statSync(join(dir, name)).mtimeMs);
    assert.equal(typeof metadata.prompt, "string"); assert.ok(metadata.prompt.length > 0);
  }
  assert.equal(JSON.parse(readFileSync(join(gallery, "api88-demo-02-edit.png.json"), "utf8")).prompt,
    "Change the mug color to deep navy blue, keep everything else identical");
  const video = JSON.parse(readFileSync(join(gallery, "api88-demo-04-grok.mp4.json"), "utf8"));
  assert.equal(video.video.providerTaskId, "fixture-task");
  assert.equal(JSON.parse(readFileSync(join(dir, "gallery-staging.masked.json"), "utf8")).paidSubmissions, 0);
});
test("UI preview blocks outbound submit and sets child umask before server import", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("preview reached network"); }) as typeof fetch;
  const recorder = recordFetch(directory(), "https://api.88api.ai", [imageKey, videoKey], "preview.json", false);
  try {
    await assert.rejects(() => fetch("https://api.88api.ai/v1/videos", { method: "POST" }), /PREVIEW_SUBMIT_FORBIDDEN/);
    assert.equal(calls, 0);
  } finally { recorder.restore(); }
  const source = sourceText(new URL("../scripts/api88DemoServer.ts", import.meta.url), "utf8");
  const maskIndex = source.indexOf("process.umask(0o077)");
  const bootIndex = source.indexOf('import("../server.ts")');
  assert.ok(maskIndex >= 0 && bootIndex >= 0 && maskIndex < bootIndex);
  assert.match(source, /config\.mcp\.enabledProviders = \[\]/);
  assert.doesNotMatch(source, /\/api\/(?:video\/)?generate/);
});
test("attempt marker prevents the same operation being repeated in a run directory", () => {
  const dir = directory(); once(dir, "01-generation", "gpt-image-2");
  assert.throws(() => once(dir, "01-generation", "gpt-image-2"), /EEXIST/);
});
test("a failed real catalog probe aborts before any paid submission", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    assert.ok(url.endsWith("/v1/models")); assert.equal(init?.method ?? "GET", "GET");
    return Response.json({ error: { message: "fixture denied" } }, { status: 401 });
  }) as typeof fetch;
  await assert.rejects(() => runDemo(keys, flags, directory()));
  assert.ok(calls.length > 0); assert.ok(calls.every(url => url.endsWith("/v1/models")));
});
test("mandatory four use actual transports once each, edit generated PNG, capture masked Gemini JSON", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "white" } }).png().toBuffer();
  const mp4 = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");
  const paid: string[] = []; const probes: string[] = [];
  const dir = directory();
  const stub = await wireStub(png, mp4, paid, probes, dir);
  globalThis.fetch = stub;
  await runDemo(keys, flags, dir);
  assert.deepEqual(paid, ["/v1/images/generations", "/v1/images/edits", "/v1/chat/completions", "/v1/videos"]);
  assert.deepEqual(probes, ["Bearer " + imageKey, "Bearer " + videoKey]);
  for (const name of ["01-generation.png", "02-edit.png", "03-gemini.png", "04-grok.mp4", "04-grok-task.json"]) assert.ok(readdirSync(dir).includes(name));
  const raw = readFileSync(join(dir, "gemini-response.masked.json"), "utf8");
  assert.match(raw, /choices/); assert.match(raw, /images/); assert.ok(!raw.includes(imageKey));
  const rows = JSON.parse(readFileSync(join(dir, "requests.masked.json"), "utf8")) as Array<{ status: number; bytes: number; authorization: string }>;
  assert.ok(rows.every(row => row.status === 200 && row.bytes > 0));
  assert.equal(rows.at(-1)?.authorization, "absent");
  const task = JSON.parse(readFileSync(join(dir, "04-grok-task.json"), "utf8"));
  assert.equal(task.providerTaskId, "task/fixture");
  const ports = await loadPorts();
  const ctx = ports.context(keys, dir);
  assert.equal(api88VideoLedgerPath(ctx), join(dir, "home", ".ima2", "88api-video-tasks.jsonl"));
  const row = await findApi88VideoTask(ctx, task.requestId);
  assert.equal(row?.phase, "completed"); assert.equal(row?.taskId, "task/fixture");
  const savedLog = readFileSync(join(dir, "requests.masked.json"), "utf8");
  await assert.rejects(() => runDemo(keys, flags, dir), /EEXIST/);
  assert.equal(readFileSync(join(dir, "requests.masked.json"), "utf8"), savedLog);
});
async function wireStub(png: Buffer, mp4: Buffer, paid: string[], probes: string[], dir: string): Promise<typeof fetch> {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers);
    const image = headers.get("authorization") === "Bearer " + imageKey;
    const video = headers.get("authorization") === "Bearer " + videoKey;
    if (url.pathname === "/v1/models") {
      probes.push(headers.get("authorization")!); assert.ok(image || video);
      return Response.json({ data: (image ? ["gpt-image-2", "gemini-3.1-flash-lite-image"] : ["grok-imagine-video-1.5"]).map(id => ({ id })) });
    }
    if (init?.method === "POST") {
      paid.push(url.pathname); assert.equal(probes.length, 2);
      if (url.pathname === "/v1/images/edits") {
        assert.ok(image && !video); assert.ok(init.body instanceof FormData);
        assert.equal(init.body.get("model"), "gpt-image-2"); assert.equal(init.body.get("n"), "1");
        const files = init.body.getAll("image[]"); assert.equal(files.length, 1);
        assert.ok(files[0] instanceof Blob); assert.equal(files[0].type, "image/png");
        assert.deepEqual(Buffer.from(await files[0].arrayBuffer()), readFileSync(join(dir, "01-generation.png")));
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      }
      const body = JSON.parse(String(init.body));
      if (url.pathname === "/v1/images/generations") {
        assert.ok(image && !video); assert.equal(body.n, 1); assert.equal(body.size, "1024x1024");
        assert.equal(body.model, "gpt-image-2"); assert.equal(body.quality, undefined); assert.equal(body.response_format, undefined);
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      }
      if (url.pathname === "/v1/chat/completions") {
        assert.ok(image && !video); assert.equal(body.model, "gemini-3.1-flash-lite-image");
        assert.equal(typeof body.messages[0].content, "string");
        return Response.json({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + png.toString("base64") } }] } }], authorization: "Bearer " + imageKey });
      }
      if (url.pathname === "/v1/videos") {
        assert.ok(video && !image);
        assert.deepEqual(body, { model: "grok-imagine-video-1.5", prompt: body.prompt, duration: 4, size: "16:9", metadata: { resolution: "480p" } });
        return Response.json({ id: "task/fixture", status: "queued" });
      }
    }
    if (url.pathname === "/v1/videos/task%2Ffixture") {
      const task = JSON.parse(readFileSync(join(dir, "04-grok-task.json"), "utf8"));
      assert.equal(task.providerTaskId, "task/fixture", "id must be persisted before the first poll");
      const ledger = readFileSync(join(dir, "home", ".ima2", "88api-video-tasks.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.equal(ledger.at(-1).phase, "submitted"); assert.equal(ledger.at(-1).taskId, "task/fixture");
      assert.ok(video && !image); return Response.json({ status: "completed", url: "https://cdn.example/video.mp4?signature=unchanged" });
    }
    if (url.href === "https://cdn.example/video.mp4?signature=unchanged") {
      assert.equal(headers.has("authorization"), false); return new Response(new Uint8Array(mp4), { headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`unexpected fetch ${url.origin}${url.pathname}`);
  }) as typeof fetch;
}
test("recorder blocks a second submit even if a transport incorrectly retries", async () => {
  let count = 0;
  globalThis.fetch = (async () => { count++; throw new TypeError("fixture network loss"); }) as typeof fetch;
  const recorder = recordFetch(directory(), "https://api.88api.ai", [imageKey, videoKey]);
  recorder.setOperation("04-grok", "grok-imagine-video-1.5");
  const submit = () => fetch("https://api.88api.ai/v1/videos", { method: "POST", body: JSON.stringify({ model: "grok-imagine-video-1.5" }) });
  try {
    await assert.rejects(submit, /network loss/); await assert.rejects(submit, /SUBMIT_RETRY_FORBIDDEN/);
    assert.equal(count, 1);
  } finally { recorder.restore(); }
});
test("uncertain submit is recorded in the isolated ledger and never retried", async () => {
  const dir = directory(); const ports = await loadPorts(); const ctx = ports.context(keys, dir);
  let submits = 0;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.88api.ai/v1/videos");
    assert.equal(init?.method, "POST"); submits++;
    throw new TypeError("fixture connection lost after acceptance");
  }) as typeof fetch;
  await assert.rejects(() => videoStep(ports, ctx, dir, "uncertain", "grok-imagine-video-1.5", 4, "480p", []),
    (error: unknown) => (error as { code: string }).code === "API88_VIDEO_SUBMIT_UNCERTAIN");
  const task = JSON.parse(readFileSync(join(dir, "uncertain-task.json"), "utf8"));
  assert.equal(task.state, "uncertain"); assert.equal(task.providerTaskId, undefined);
  const row = await findApi88VideoTask(ctx, task.requestId);
  assert.equal(row?.phase, "uncertain"); assert.equal(row?.error, "API88_VIDEO_SUBMIT_UNCERTAIN");
  assert.equal(submits, 1);
});
test("poll failure retains the accepted task in JSON and ledger without another POST", async () => {
  const dir = directory(); const actual = await loadPorts(); const ctx = actual.context(keys, dir);
  const ports: DemoPorts = { ...actual, video: (context, input, options) => generateApi88Video(context, input, {
    ...options, sleep: async (ms, signal) => { assert.equal(ms, 4000); signal.throwIfAborted(); },
  }) };
  let submits = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "https://api.88api.ai/v1/videos" && init?.method === "POST") {
      submits++; return Response.json({ id: "accepted-task" });
    }
    assert.equal(url, "https://api.88api.ai/v1/videos/accepted-task"); assert.equal(init?.method, "GET");
    const task = JSON.parse(readFileSync(join(dir, "poll-failure-task.json"), "utf8"));
    assert.equal((await findApi88VideoTask(ctx, task.requestId))?.phase, "submitted");
    return Response.json({ status: "failed" });
  }) as typeof fetch;
  await assert.rejects(() => videoStep(ports, ctx, dir, "poll-failure", "grok-imagine-video-1.5", 4, "480p", []),
    (error: unknown) => (error as { code: string }).code === "API88_VIDEO_FAILED");
  const task = JSON.parse(readFileSync(join(dir, "poll-failure-task.json"), "utf8"));
  assert.equal(task.providerTaskId, "accepted-task"); assert.equal(task.state, "failed");
  const row = await findApi88VideoTask(ctx, task.requestId);
  assert.equal(row?.phase, "failed"); assert.equal(row?.taskId, "accepted-task"); assert.equal(submits, 1);
});
test("request recorder supports a configured API path and preserves download query bytes", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async input => { urls.push(String(input)); return Response.json({ data: [] }); }) as typeof fetch;
  const recorder = recordFetch(directory(), "https://gateway.example/proxy", [imageKey]);
  try {
    const response = await fetch("https://gateway.example/proxy/v1/models", { headers: { Authorization: "Bearer " + imageKey } });
    await response.json();
    const download = await fetch("https://cdn.example/out.png?signature=a%2Fb%2Bc"); await download.json();
    assert.deepEqual(urls, ["https://gateway.example/proxy/v1/models", "https://cdn.example/out.png?signature=a%2Fb%2Bc"]);
    assert.equal(recorder.rows[0].authorization, "Bearer [REDACTED]");
    assert.equal(recorder.rows[1].authorization, "absent");
  } finally { recorder.restore(); }
});
test("optional flags schedule only selected cheap video models", async () => {
  const dir = directory(); const models: string[] = [];
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "white" } }).png().toBuffer();
  const actual = await loadPorts();
  const ports: DemoPorts = { ...actual,
    catalog: async (_ctx, kind) => kind === "image" ? ["gpt-image-2", "gemini-3.1-flash-lite-image"]
      : ["grok-imagine-video-1.5", "seedance-2.0-mini-480p", "veo-3.1-fast", "gemini-omni-flash"],
    image: async () => ({ b64: png.toString("base64") }),
    video: async (_ctx, input) => { models.push(input.model);
      if (input.model === "veo-3.1-fast") { assert.equal(input.duration, 4); assert.equal(input.resolution, "720p"); }
      if (input.model === "seedance-2.0-mini-480p") { assert.equal(input.duration, 4); assert.equal(input.resolution, "480p"); }
      if (input.model === "gemini-omni-flash") { assert.equal(input.duration, 3); assert.equal(input.resolution, "720p"); }
      return { videoBuffer: Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex"), providerTaskId: "fixture" }; },
  };
  await runDemo(keys, { ...flags, seedance: true, veo: true, omni: true }, dir, ports);
  assert.deepEqual(models, ["grok-imagine-video-1.5", "seedance-2.0-mini-480p", "veo-3.1-fast", "gemini-omni-flash"]);
});
test("live entrypoint and helper are never referenced by workflow or npm scripts", () => {
  const { scripts } = JSON.parse(sourceText(new URL("../package.json", import.meta.url), "utf8"));
  for (const command of Object.values(scripts)) assert.doesNotMatch(String(command), /api88-live-smoke|api88DemoServer/);
  const workflowDir = new URL("../.github/workflows/", import.meta.url);
  for (const file of readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
    assert.doesNotMatch(sourceText(new URL(file, workflowDir), "utf8"), /api88-live-smoke|api88DemoServer/);
  }
});
