import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const TEST_DIR = await mkdtemp(join(tmpdir(), "ima2-structured-filename-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { config } = await import("../config.js");
const { registerGenerateRoutes } = await import("../routes/generate.ts");
const { registerMultimodeRoutes } = await import("../routes/multimode.ts");
const { registerEditRoutes } = await import("../routes/edit.ts");
const { registerAgentRoutes } = await import("../routes/agent.ts");
const { subscribe, _resetForTest: resetEventBus } = await import("../lib/eventBus.js");
const { _resetForTests: resetInflight } = await import("../lib/inflight.js");
const db = await import("../lib/db.js");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetEventBus();
  resetInflight();
});

after(async () => {
  db.closeDb();
  await rm(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const STRUCTURED_RE = /^[a-z0-9.\-]+_\d+x\d+_\d{8}_[a-z0-9가-힣一-鿿\-]+(_\d+)*\.(png|jpe?g|webp)$/;
const LEGACY_RE = /^\d{10,}_[0-9a-f]{8,}/;

async function pngB64(width = 8, height = 8, background = "#334455"): Promise<string> {
  const buffer = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
  return buffer.toString("base64");
}

function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

function imageEvents(b64: string, revised = "revised"): unknown[] {
  return [
    { type: "response.output_item.done", item: { type: "image_generation_call", result: b64, revised_prompt: revised } },
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ];
}

function mockUpstream(events: unknown[] | (() => unknown[])) {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
    return sseResponse(typeof events === "function" ? events() : events);
  };
}

async function withApp(
  register: (app: express.Express, ctx: unknown) => void,
  fn: (baseUrl: string, generatedDir: string) => Promise<void>,
): Promise<void> {
  const rootDir = await mkdtemp(join(TEST_DIR, "app-"));
  const generatedDir = join(rootDir, "generated");
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  register(app, {
    rootDir,
    apiKey: "sk-test",
    config: { ...config, storage: { ...config.storage, generatedDir }, log: { ...config.log, level: "silent" } },
    packageVersion: "test",
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`, generatedDir);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function doneEventFor(requestId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for done event: ${requestId}`));
    }, 15000);
    const unsubscribe = subscribe((ev) => {
      if (ev.jobId === requestId && ev.event === "done") {
        clearTimeout(timer);
        unsubscribe();
        resolve(ev.data as Record<string, unknown>);
      }
    });
  });
}

async function mediaFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => !name.endsWith(".json") && !name.includes("thumb"));
}

describe("structured filenames across image pipelines", () => {
  it("classic generate saves a structured filename with paired sidecar", async () => {
    const b64 = await pngB64();
    mockUpstream(imageEvents(b64));
    const done = doneEventFor("sf_classic_1");
    await withApp(registerGenerateRoutes as never, async (baseUrl, generatedDir) => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "classic name", provider: "api", requestId: "sf_classic_1", async: true }),
      });
      assert.equal(res.status, 202);
      const data = await done;
      const filename = String(data.filename);
      assert.match(filename, STRUCTURED_RE);
      assert.ok(filename.includes("_classic-name_0."), `slug in ${filename}`);
      assert.ok(!LEGACY_RE.test(filename));
      const sidecar = JSON.parse(await readFile(join(generatedDir, `${filename}.json`), "utf8"));
      assert.equal(sidecar.kind, "classic");
      assert.equal(sidecar.prompt, "classic name");
      const files = await mediaFiles(generatedDir);
      assert.deepEqual(files, [filename]);
    });
  });

  it("two identical concurrent classic requests resolve distinct filenames", async () => {
    const b64 = await pngB64();
    mockUpstream(imageEvents(b64));
    const doneA = doneEventFor("sf_classic_a");
    const doneB = doneEventFor("sf_classic_b");
    await withApp(registerGenerateRoutes as never, async (baseUrl, generatedDir) => {
      const post = (requestId: string) => fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "same prompt collision", provider: "api", requestId, async: true }),
      });
      const [ra, rb] = await Promise.all([post("sf_classic_a"), post("sf_classic_b")]);
      assert.equal(ra.status, 202);
      assert.equal(rb.status, 202);
      const [da, db] = await Promise.all([doneA, doneB]);
      const nameA = String(da.filename);
      const nameB = String(db.filename);
      assert.match(nameA, STRUCTURED_RE);
      assert.match(nameB, STRUCTURED_RE);
      assert.notEqual(nameA, nameB);
      // Collision path (the _N suffix) is proven deterministically in
      // tests/filename.test.ts; here we assert pipeline-level distinctness.
      const names = [nameA, nameB].sort();
      const files = (await mediaFiles(generatedDir)).sort();
      assert.deepEqual(files, names);
      for (const name of names) {
        const sidecar = JSON.parse(await readFile(join(generatedDir, `${name}.json`), "utf8"));
        assert.equal(sidecar.prompt, "same prompt collision");
      }
    });
  });

  it("multimode saves structured names with incrementing index", async () => {
    const b64a = await pngB64(8, 8, "#334455");
    const b64b = await pngB64(8, 8, "#554433");
    mockUpstream([
      { type: "response.output_item.done", item: { type: "image_generation_call", result: b64a, revised_prompt: "r1" } },
      { type: "response.output_item.done", item: { type: "image_generation_call", result: b64b, revised_prompt: "r2" } },
      { type: "response.completed", response: { usage: { total_tokens: 5 } } },
    ]);
    const done = doneEventFor("sf_mm_1");
    await withApp(registerMultimodeRoutes as never, async (baseUrl, generatedDir) => {
      const res = await fetch(`${baseUrl}/api/generate/multimode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "structured multimode batch", provider: "api", maxImages: 2, requestId: "sf_mm_1", async: true }),
      });
      assert.ok(res.status === 202 || res.status === 200, `status ${res.status}`);
      await done;
      const files = (await mediaFiles(generatedDir)).sort();
      assert.equal(files.length, 2);
      for (const name of files) assert.match(name, STRUCTURED_RE);
      assert.ok(files[0].includes("_structured-multimode_0."), `index 0 in ${files[0]}`);
      assert.ok(files[1].includes("_structured-multimode_1."), `index 1 in ${files[1]}`);
      for (const name of files) {
        const sidecar = JSON.parse(await readFile(join(generatedDir, `${name}.json`), "utf8"));
        assert.equal(sidecar.kind, "multimode-image");
      }
    });
  });

  it("edit saves a structured filename with prompt slug", async () => {
    const b64 = await pngB64();
    mockUpstream(imageEvents(b64, "edited"));
    await withApp(registerEditRoutes as never, async (baseUrl, generatedDir) => {
      const res = await fetch(`${baseUrl}/api/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "make it watercolor", image: b64, provider: "api", requestId: "sf_edit_1" }),
      });
      assert.equal(res.status, 200);
      const files = await mediaFiles(generatedDir);
      assert.equal(files.length, 1);
      assert.match(files[0], STRUCTURED_RE);
      assert.ok(files[0].includes("_make-it-watercolor."), `slug in ${files[0]}`);
      const sidecar = JSON.parse(await readFile(join(generatedDir, `${files[0]}.json`), "utf8"));
      assert.equal(sidecar.kind, "edit");
    });
  });

  it("agent image records the true non-square aspect", async () => {
    const b64 = await pngB64(12, 8);
    mockUpstream(() => [
      { type: "response.output_text.delta", delta: "agent reply" },
      { type: "response.output_text.done", text: "agent reply" },
      { type: "response.output_item.done", item: { type: "image_generation_call", result: b64, revised_prompt: "agent revised" } },
      { type: "response.completed", response: { usage: { total_tokens: 7 } } },
    ]);
    await withApp(registerAgentRoutes as never, async (baseUrl, generatedDir) => {
      const created = await fetch(`${baseUrl}/api/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "sf agent" }),
      });
      assert.equal(created.status, 201);
      const session = await created.json() as { selectedSessionId: string };
      const res = await fetch(`${baseUrl}/api/agent/sessions/${session.selectedSessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "wide agent banner", provider: "api", size: "1536x1024" }),
      });
      assert.equal(res.status, 200);
      const files = await mediaFiles(generatedDir);
      assert.equal(files.length, 1);
      assert.match(files[0], STRUCTURED_RE);
      assert.ok(files[0].includes("_3x2_"), `aspect 3x2 in ${files[0]}`);
      assert.ok(files[0].includes("_wide-agent-banner."), `slug in ${files[0]}`);
    });
  });

  it("wires the effective grok/grok-api high-quality model rule into all three lanes", () => {
    // The high-quality knob now resolves through the shared helper, which maps
    // "high" onto the current flagship model instead of hardcoding the legacy
    // grok-imagine-image-quality id at every call site.
    const grokRule = /\(activeProvider === "grok" \|\| activeProvider === "grok-api"\) \? resolveGrokQualityModel\(imageModel, quality\)/;
    const classic = readFileSync(join(process.cwd(), "lib/generatePipeline.ts"), "utf8");
    const multimode = readFileSync(join(process.cwd(), "lib/multimodePipeline.ts"), "utf8");
    const edit = readFileSync(join(process.cwd(), "routes/edit.ts"), "utf8");
    const agent = readFileSync(join(process.cwd(), "lib/agentImageVideoGen.ts"), "utf8");
    assert.match(classic, grokRule);
    assert.match(multimode, grokRule);
    assert.match(edit, grokRule);
    // Agent lane: caller's effectiveModel (grok high override at :85-87) is the
    // persisted generation.model.
    assert.match(agent, /const effectiveModel = activeProvider === "grok"\s*\?\s*resolveGrokQualityModel\(providerOptions\.model, options\.quality\)/);
    assert.match(agent, /buildFilename\(\{ model: generation\.model, size, createdAt, prompt, ext: format \}\)/);
  });
});
