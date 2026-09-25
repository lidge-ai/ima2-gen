import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import sharp from "sharp";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

// Import config-dependent modules only after installing the owned config/DB.
// The real fetch is reserved for the exact ephemeral app; every provider call
// uses the trapped transport, including loopback OAuth/Comfy endpoints.
const nativeFetch = globalThis.fetch;
const savedEnv = new Map<string, string | undefined>();
let rootDir: string;
let grokAuth: ReturnType<typeof seedGrokAuth>;
let image: string;
let mask: string;
let config: typeof import("../config.ts").config;
let runtime: typeof import("../lib/runtimeContext.ts");
let inflight: typeof import("../lib/inflight.ts");
let db: typeof import("../lib/db.ts");
let generate: typeof import("../routes/generate.ts");
let edit: typeof import("../routes/edit.ts");
let multimode: typeof import("../routes/multimode.ts");
let nodes: typeof import("../routes/nodes.ts");
let sequence = 0;
let processCalls = 0;

before(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "ima2-surface-boundary-"));
  // The grok lane is admitted only with a stored xAI session; seed one in an
  // isolated HOME so these boundary cases reach the surface checks they target
  // instead of stopping at 401 GROK_AUTH_REQUIRED (and never read the real ~/.progrok).
  grokAuth = seedGrokAuth();
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("IMA2_") || key === "DOTENV_CONFIG_PATH")) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  const isolatedEnv = {
    IMA2_CONFIG_DIR: rootDir,
    IMA2_DB_PATH: join(rootDir, "test.db"),
    IMA2_GENERATED_DIR: join(rootDir, "generated"),
    IMA2_LOG_LEVEL: "silent",
    DOTENV_CONFIG_PATH: "/dev/null",
  };
  for (const [key, value] of Object.entries(isolatedEnv)) {
    if (!savedEnv.has(key)) savedEnv.set(key, undefined);
    process.env[key] = value;
  }
  // The first config candidate prevents the repository-local fallback read.
  await writeFile(join(rootDir, "config.json"), "{}");
  globalThis.fetch = async () => { throw new Error("Unexpected setup network request"); };
  mock.method(childProcess, "spawn", () => {
    processCalls++;
    throw new Error("Provider process launch forbidden in boundary fixtures");
  });
  syncBuiltinESMExports();
  ({ config } = await import("../config.ts"));
  assert.equal(config.storage.configDir, rootDir);
  assert.equal(config.storage.dbPath, join(rootDir, "test.db"));
  (await import("../lib/logger.ts")).configureLogger({ level: "silent" });
  runtime = await import("../lib/runtimeContext.ts");
  inflight = await import("../lib/inflight.ts");
  db = await import("../lib/db.ts");
  generate = await import("../routes/generate.ts");
  edit = await import("../routes/edit.ts");
  multimode = await import("../routes/multimode.ts");
  nodes = await import("../routes/nodes.ts");
  image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer()).toString("base64");
  mask = (await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer()).toString("base64");
});

after(async () => {
  globalThis.fetch = nativeFetch;
  mock.restoreAll();
  syncBuiltinESMExports();
  db?.closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
  grokAuth?.cleanup();
});

interface UpstreamCall { url: string; init: RequestInit }
interface Fixture {
  requestId: string;
  generatedDir: string;
  calls: UpstreamCall[];
  post: (path: string, body: Record<string, unknown>) => Promise<Response>;
}
type FakeUpstream = (call: UpstreamCall) => Response;

async function withApp(fn: (fixture: Fixture) => Promise<void>, upstream?: FakeUpstream, xaiApiKey?: string) {
  const requestId = `surface-boundary-${++sequence}`;
  const generatedDir = join(rootDir, requestId);
  await mkdir(generatedDir);
  inflight._resetForTests();
  processCalls = 0;
  const calls: UpstreamCall[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (!upstream) throw new Error(`Unexpected upstream request: ${call.url}`);
    return upstream(call);
  };
  const ctx = runtime.createTestRuntimeContext({
    rootDir, apiKey: "sk-fixture-only", oauthReadyState: "ready", xaiApiKey,
    oauthUrl: "http://oauth-fixture.invalid",
    grokAuthHomeDir: grokAuth.homeDir,
    config: { ...config, storage: { ...config.storage, generatedDir } },
  });
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  generate.registerGenerateRoutes(app, ctx);
  edit.registerEditRoutes(app, ctx);
  multimode.registerMultimodeRoutes(app, ctx);
  nodes.registerNodeRoutes(app, ctx);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    await fn({ requestId, generatedDir, calls, post: (path, body) => nativeFetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, prompt: "surface contract fixture", webSearchEnabled: false, ...body }),
    }) });
    assert.equal(processCalls, 0, "no provider CLI may launch");
    if (!upstream) assert.deepEqual(calls, [], "rejection must precede every provider request");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = nativeFetch;
  }
}

function assertNoJob() {
  assert.deepEqual(inflight.listJobs(), []);
  assert.deepEqual(inflight.listTerminalJobs(), [], "pre-admission refusal must not create a job");
}

function responsesFixture(call: UpstreamCall): Response {
  assert.ok(["https://api.openai.com/v1/responses", "http://oauth-fixture.invalid/v1/responses"].includes(call.url));
  const events = [
    { type: "response.output_item.done", item: { type: "image_generation_call", result: image } },
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  });
}

describe("provider surface HTTP boundaries", { concurrency: false }, () => {
  const maskRejections = [
    ["grok", "GROK_MASK_UNSUPPORTED", "Grok"],
    ["grok-api", "GROK_MASK_UNSUPPORTED", "Grok"],
    ["agy", "AGY_MASK_UNSUPPORTED", "Agy"],
    ["gemini-api", "GEMINI_API_MASK_UNSUPPORTED", "Gemini API"],
    ["atlascloud", "ATLASCLOUD_MASK_UNSUPPORTED", "Atlas Cloud"],
    ["minimax", "MINIMAX_MASK_UNSUPPORTED", "MiniMax"],
    ["nai", "NAI_MASK_UNSUPPORTED", "NovelAI"],
    ["comfy", "COMFY_MASK_UNSUPPORTED", "ComfyUI"],
  ] as const;
  for (const [provider, code, label] of maskRejections) {
    it(`${provider} rejects a mask before mask validation or provider dispatch`, async () => {
      await withApp(async ({ post }) => {
        const res = await post("/api/edit", {
          provider, image, mask: "truthy-but-invalid-mask",
          ...(provider === "comfy" ? { model: "fixture-workflow" } : {}),
        });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), {
          error: `${label} provider does not support mask editing`, code,
          // Comfy's existing mask code has no providerMap classification.
          ...(provider === "comfy" ? {} : { rawCode: code, errorClass: "CAPABILITY_UNSUPPORTED" }),
        });
        assert.deepEqual(inflight.listJobs(), [], "edit admission is finalized after rejection");
      }, undefined, provider === "grok-api" ? "xai-mask-fixture-only" : undefined);
    });
  }

  it("NAI rejects edit without a mask using the flat edit envelope", async () => {
    await withApp(async ({ post }) => {
      const res = await post("/api/edit", { provider: "nai", image });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        error: "NovelAI image editing is not supported yet", code: "NAI_EDIT_UNSUPPORTED",
        rawCode: "NAI_EDIT_UNSUPPORTED", errorClass: "CAPABILITY_UNSUPPORTED",
      });
    });
  });

  it("NAI generate references refuse before admission with the flat envelope", async () => {
    await withApp(async ({ post, requestId }) => {
      const res = await post("/api/generate", { provider: "nai", references: [`data:image/png;base64,${image}`] });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        error: "NovelAI image generation does not accept reference images yet", code: "NAI_REF_UNSUPPORTED", requestId,
      });
      assertNoJob();
    });
  });

  for (const source of ["parent", "references"] as const) {
    it(`NAI node rejects actual ${source} images before admission`, async () => {
      await withApp(async ({ post, generatedDir }) => {
        const parentNodeId = source === "parent" ? "n_fixture_parent" : null;
        // Seed an actual file so NODE_NOT_FOUND cannot hide the policy guard.
        if (parentNodeId) await writeFile(join(generatedDir, `${parentNodeId}.png`), Buffer.from(image, "base64"));
        const res = await post("/api/node/generate", {
          provider: "nai", parentNodeId,
          references: source === "references" ? [`data:image/png;base64,${image}`] : [],
        });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), {
          error: { code: "NAI_REF_UNSUPPORTED", message: "NovelAI image generation does not accept input images yet." },
          code: "NAI_REF_UNSUPPORTED", parentNodeId,
        });
        assertNoJob();
      });
    });
  }

  it("Comfy node refuses before missing-model and parent-file resolution", async () => {
    await withApp(async ({ post }) => {
      const res = await post("/api/node/generate", { provider: "comfy", parentNodeId: "n_not_loaded" });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        error: { code: "COMFY_SURFACE_UNSUPPORTED", message: "provider 'comfy' is not supported on this surface yet" },
        parentNodeId: "n_not_loaded",
      });
      assertNoJob();
    });
  });

  for (const asyncMode of [true, false]) {
    it(`Comfy multimode preserves ${asyncMode ? "400 JSON" : "200 legacy SSE error"} before model resolution`, async () => {
      await withApp(async ({ post, requestId }) => {
        const res = await post("/api/generate/multimode", { provider: "comfy", async: asyncMode });
        const expected = {
          error: "provider 'comfy' is not supported on this surface yet",
          code: "COMFY_SURFACE_UNSUPPORTED", status: 400, requestId,
        };
        assert.equal(res.status, asyncMode ? 400 : 200);
        if (asyncMode) {
          assert.match(res.headers.get("content-type")!, /application\/json/);
          assert.deepEqual(await res.json(), expected);
        } else {
          assert.match(res.headers.get("content-type")!, /text\/event-stream/);
          const frames = (await res.text()).trim().split("\n\n");
          assert.equal(frames.length, 1, "no phase/image/done frames may precede or follow refusal");
          assert.equal(frames[0].split("\n")[0], "event: error");
          assert.deepEqual(JSON.parse(frames[0].split("\n")[1].slice("data: ".length)), expected);
        }
        assertNoJob();
      });
    });
  }

  // GPT OAuth masked edits (source then mask guide, rendered through the Images API) are pinned in
  // tests/oauth-image-lane-contract.test.ts; this keeps the Responses wire of the API-key lane.
  for (const provider of ["api"] as const) {
    it(`${provider} preserves masked edit forwarding through Responses`, async () => {
      await withApp(async ({ post, calls }) => {
        const res = await post("/api/edit", { provider, image, mask: `data:image/png;base64,${mask}` });
        const result = await res.json();
        assert.equal(res.status, 200);
        assert.equal(result.provider, provider);
        assert.equal(result.image, `data:image/png;base64,${image}`);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, provider === "api" ? "https://api.openai.com/v1/responses" : "http://oauth-fixture.invalid/v1/responses");
        assert.equal(new Headers(calls[0].init.headers).get("Authorization"), provider === "api" ? "Bearer sk-fixture-only" : null);
        const payload = JSON.parse(String(calls[0].init.body));
        const content = payload.input[1].content;
        assert.equal(content.length, 4);
        assert.equal(content[0].type, "input_image");
        assert.match(content[0].image_url, /^data:image\/jpeg;base64,/);
        const decoded = await sharp(Buffer.from(content[0].image_url.split(",")[1], "base64")).metadata();
        assert.equal(decoded.width, 8);
        assert.equal(decoded.height, 8);
        assert.deepEqual(content[1], { type: "input_image", image_url: `data:image/png;base64,${mask}` });
        assert.match(content[2].text, /edit mask guide/);
        assert.match(content[3].text, /surface contract fixture/);
        assert.deepEqual(payload.tool_choice, { type: "image_generation" });
        assert.equal(payload.stream, true);
      }, responsesFixture);
    });
  }
});
