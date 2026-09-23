import { after, describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import ts from "typescript";
import {
  resolveTarget,
  type LaneInfo,
  type ModelCatalog,
} from "../bin/lib/modelResolver.ts";
import type { McpJobOptions, McpJobResult } from "../bin/lib/mcpJob.ts";
import { parseEventCursor } from "../lib/eventsPolicy.ts";

const ready = (models: Partial<LaneInfo["models"]> = {}, defaults: LaneInfo["defaults"] = {}): LaneInfo => ({
  status: "ready",
  defaults,
  models: { image: models.image ?? [], video: models.video ?? [] },
});

function makeCatalog(): ModelCatalog {
  return {
    lanes: {
      oauth: ready({ image: [{ id: "gpt-5.6-luna" }, { id: "shared" }] }, { image: "gpt-5.6-luna" }),
      api: ready({ image: [{ id: "shared" }] }, { image: "shared" }),
      grok: ready({ video: [{ id: "grok-video" }] }, { video: "grok-video" }),
      "grok-api": ready(),
      agy: ready({ image: [{ id: "banana" }] }, { image: "banana" }),
      "gemini-api": ready({ image: [{ id: "gemini-image" }] }, { image: "gemini-image" }),
      atlascloud: ready(
        { image: [{ id: "openai/gpt-image-2/text-to-image" }] },
        { image: "openai/gpt-image-2/text-to-image" },
      ),
      minimax: ready(
        { image: [{ id: "image-01" }] },
        { image: "image-01" },
      ),
      comfy: ready(
        {
          image: [{ id: "sdxl" }],
          video: [{ id: "minimax-h3", executable: false, lockReason: "catalog only" }],
        },
        { image: "sdxl" },
      ),
      runway: ready(
        { image: [{ id: "gen-4" }], video: [{ id: "veo-3.1" }] },
        { image: "gen-4", video: "veo-3.1" },
      ),
      higgsfield: ready({ video: [{ id: "higgs-video" }] }, { video: "higgs-video" }),
    },
  };
}

function expectFailure(result: ReturnType<typeof resolveTarget>, code: string) {
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, code);
  return result.ok ? null : result;
}

describe("resolveTarget", () => {
  it("rejects removed provider auto with actionable guidance", () => {
    const failure = expectFailure(resolveTarget("image", { provider: "auto" }, makeCatalog(), {}), "PROVIDER_AUTO_REMOVED");
    assert.match(failure!.message, /ima2 models/);
    assert.match(failure!.message, /--provider <lane>/);
  });

  it("resolves namespaced models and canonicalizes only the model segment", () => {
    assert.deepStrictEqual(resolveTarget("image", { model: "oauth/luna" }, makeCatalog(), {}), {
      ok: true, lane: "oauth", model: "gpt-5.6-luna", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("video", { model: "runway/veo-3.1" }, makeCatalog(), {}), {
      ok: true, lane: "runway", model: "veo-3.1", transport: "mcp",
    });
  });

  it("returns MODEL_LOCKED for a catalog-only Comfy video workflow", () => {
    const failure = expectFailure(
      resolveTarget("video", { model: "comfy/minimax-h3" }, makeCatalog(), {}),
      "MODEL_LOCKED",
    );
    assert.equal(failure?.extra?.reason, "catalog only");
    assert.deepStrictEqual(resolveTarget("image", { model: "comfy/sdxl" }, makeCatalog(), {}), {
      ok: true, lane: "comfy", model: "sdxl", transport: "core",
    });
  });

  it("rejects unknown lanes, missing models, kind mismatches, and lane conflicts", () => {
    expectFailure(resolveTarget("image", { model: "unknown/x" }, makeCatalog(), {}), "UNKNOWN_LANE");
    expectFailure(resolveTarget("image", { model: "oauth/missing" }, makeCatalog(), {}), "MODEL_NOT_FOUND");
    expectFailure(resolveTarget("image", { model: "grok/grok-video" }, makeCatalog(), {}), "KIND_MISMATCH");
    expectFailure(
      resolveTarget("image", { provider: "api", model: "oauth/luna" }, makeCatalog(), {}),
      "LANE_CONFLICT",
    );
  });

  it("resolves a unique bare alias and lets provider narrow an ambiguous id", () => {
    assert.deepStrictEqual(resolveTarget("image", { model: "luna" }, makeCatalog(), {}), {
      ok: true, lane: "oauth", model: "gpt-5.6-luna", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "shared", provider: "api" }, makeCatalog(), {}), {
      ok: true, lane: "api", model: "shared", transport: "core",
    });
  });

  it("returns stable candidates for ambiguous bare ids", () => {
    const failure = expectFailure(resolveTarget("image", { model: "shared" }, makeCatalog(), {}), "MODEL_AMBIGUOUS");
    assert.deepStrictEqual(failure!.extra?.candidates, ["oauth/shared", "api/shared"]);
  });

  it("rejects missing bare ids and bare kind mismatches within a provider", () => {
    expectFailure(resolveTarget("image", { model: "missing" }, makeCatalog(), {}), "MODEL_NOT_FOUND");
    expectFailure(
      resolveTarget("image", { model: "grok-video", provider: "grok" }, makeCatalog(), {}),
      "KIND_MISMATCH",
    );
  });

  it("uses lane defaults for provider-only resolution and rejects absent defaults", () => {
    assert.deepStrictEqual(resolveTarget("image", { provider: "atlascloud" }, makeCatalog(), {}), {
      ok: true, lane: "atlascloud", model: "openai/gpt-image-2/text-to-image", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { provider: "runway" }, makeCatalog(), {}), {
      ok: true, lane: "runway", model: "gen-4", transport: "mcp",
    });
    expectFailure(resolveTarget("video", { provider: "agy" }, makeCatalog(), {}), "NO_DEFAULT_MODEL");
  });

  it("uses and validates CLI defaults when no flags are supplied", () => {
    assert.deepStrictEqual(resolveTarget("video", {}, makeCatalog(), { video: "runway/veo-3.1" }), {
      ok: true, lane: "runway", model: "veo-3.1", transport: "mcp",
    });
    expectFailure(resolveTarget("image", {}, makeCatalog(), { image: "oauth/missing" }), "MODEL_NOT_FOUND");
    expectFailure(resolveTarget("image", {}, makeCatalog(), { image: "not-namespaced" }), "MODEL_NOT_FOUND");
  });

  it("returns grouped models and two fix commands when the CLI default is absent", () => {
    const failure = expectFailure(resolveTarget("image", {}, makeCatalog(), {}), "NO_DEFAULT_MODEL");
    const models = failure!.extra?.models as Record<string, string[]>;
    assert.deepStrictEqual(models.oauth, ["gpt-5.6-luna", "shared"]);
    assert.deepStrictEqual(models.runway, ["gen-4"]);
    assert.deepStrictEqual(failure!.extra?.fix, [
      "ima2 defaults set image <lane>/<model>",
      "ima2 models --kind image",
    ]);
  });

  for (const status of ["locked", "disconnected", "key-missing"] as const) {
    it(`fails closed when a resolved lane is ${status}`, () => {
      const catalog = makeCatalog();
      catalog.lanes.runway.status = status;
      catalog.lanes.runway.reason = `${status} reason`;
      const failure = expectFailure(
        resolveTarget("video", { model: "runway/veo-3.1" }, catalog, {}),
        "LANE_UNAVAILABLE",
      );
      assert.strictEqual(failure!.extra?.status, status);
      assert.strictEqual(failure!.extra?.reason, `${status} reason`);
    });
  }
});

describe("loadCliDefaults", () => {
  it("reads only string defaults from the raw CLI config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ima2-cli-defaults-"));
    const moduleUrl = new URL("../bin/lib/config-store.ts", import.meta.url).href;
    try {
      writeFileSync(join(dir, "config.json"), JSON.stringify({
        defaults: { image: "oauth/gpt-5.6-luna", video: 42 },
        oauth: { model: "ignored" },
      }));
      const child = spawnSync(process.execPath, [
        "--input-type=module",
        "--eval",
        `const { loadCliDefaults } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(loadCliDefaults()));`,
      ], { encoding: "utf8", env: { ...process.env, IMA2_CONFIG_DIR: dir } });
      assert.strictEqual(child.status, 0, child.stderr);
      assert.strictEqual(child.stdout, '{"image":"oauth/gpt-5.6-luna"}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const transpiledDir = mkdtempSync(join(tmpdir(), "ima2-mcp-job-"));
const binLibDir = fileURLToPath(new URL("../bin/lib/", import.meta.url));
const serverLibDir = fileURLToPath(new URL("../lib/", import.meta.url));
writeFileSync(join(transpiledDir, "package.json"), '{"type":"module"}');
// mcpJob imports shared server modules with ../../lib/... specifiers, so the
// temp tree mirrors both directories instead of flattening them.
mkdirSync(join(transpiledDir, "bin", "lib"), { recursive: true });
mkdirSync(join(transpiledDir, "lib"), { recursive: true });
mkdirSync(join(transpiledDir, "lib", "errors"), { recursive: true });
for (const [sourceDir, targetDir, names] of [
  [binLibDir, join(transpiledDir, "bin", "lib"), ["sse", "mcpJob", "client"]],
  [serverLibDir, join(transpiledDir, "lib"), ["jobStatus", "eventsPolicy", "responsesErrors", "diagnosticText"]],
  [join(serverLibDir, "errors"), join(transpiledDir, "lib", "errors"), ["providerMap"]],
] as const) {
  for (const name of names) {
    const source = readFileSync(join(sourceDir, `${name}.ts`), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: `${name}.ts`,
    }).outputText;
    writeFileSync(join(targetDir, `${name}.js`), output);
  }
}
const mcpModule = await import(`${pathToFileURL(join(transpiledDir, "bin", "lib", "mcpJob.js")).href}?v=${Date.now()}`) as {
  runMcpJob(opts: McpJobOptions): Promise<McpJobResult>;
};
const sseModule = await import(pathToFileURL(join(transpiledDir, "bin", "lib", "sse.js")).href) as typeof import("../bin/lib/sse.ts");

const clients = new Set<ServerResponse>();
const eventTrace: unknown[] = [];
const terminalJobs = new Map<string, Record<string, unknown>>();
const postSawOpen = new Map<string, boolean>();
const reconnectCursors: string[] = [];
let postCount = 0;
let firstDropPosted = false;
let initialCursor: string | undefined;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    let text = "";
    for await (const chunk of req) text += String(chunk);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function emit(event: string, data: Record<string, unknown>, id: number) {
  eventTrace.push({ at: Date.now(), event, jobId: data.jobId, clients: clients.size });
  const frame = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(frame);
}

async function fakeHandler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    eventTrace.push({ at: Date.now(), method: req.method, path: url.pathname });
    if (req.method === "GET" && url.pathname === "/api/events") {
      if (firstDropPosted && url.searchParams.get("lastEventId") !== "7") {
        res.writeHead(409).end("first-frame reconnect lost its bookmark");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        ...(initialCursor === undefined ? {} : {
          "x-ima2-event-cursor": url.searchParams.get("lastEventId") ?? initialCursor,
        }),
      });
      res.flushHeaders();
      if (url.searchParams.has("lastEventId")) {
        reconnectCursors.push(String(url.searchParams.get("lastEventId")));
        if (firstDropPosted) {
          res.end('id: 8\nevent: done\ndata: {"jobId":"first-drop-job","filename":"replayed.mp4","url":"/generated/replayed.mp4"}\n\n');
        } else res.write(`event: replay-gap\ndata: {"oldestAvailableId":99}\n\n`);
      } else {
        clients.add(res);
        res.on("close", () => clients.delete(res));
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/mcp/generate") {
      postCount++;
      const body = await readJson(req);
      const requestId = String(body.requestId ?? "");
      postSawOpen.set(requestId, clients.size > 0);
      if (requestId === "first-drop-job") {
        firstDropPosted = true;
        for (const client of [...clients]) client.end();
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, requestId }));
      setImmediate(() => completeFakeJob(requestId));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/inflight") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobs: [], terminalJobs: [...terminalJobs.values()] }));
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "FAKE_ERROR", message: String(error) } }));
  }
}

function completeFakeJob(requestId: string) {
  if (requestId === "done-job") {
    emit("progress", { jobId: requestId, phase: "rendering" }, 1);
    emit("done", { jobId: requestId, filename: "done.png", url: "/generated/done.png" }, 2);
  } else if (requestId === "error-job") {
    emit("error", { jobId: requestId, code: "MCP_PROVIDER_FAILED", message: "provider failed" }, 3);
  } else if (requestId === "replay-job" || requestId === "pending-gap-job") {
    if (requestId === "replay-job") terminalJobs.set(requestId, {
      requestId, status: "done", meta: { filename: "replayed.mp4" },
    });
    emit("progress", { jobId: requestId, phase: "persisting" }, 10);
    for (const client of [...clients]) client.end();
  }
}

const fakeServer = createServer((req, res) => { void fakeHandler(req, res); });
fakeServer.listen(0, "127.0.0.1");
await once(fakeServer, "listening");
const address = fakeServer.address();
assert.ok(address && typeof address === "object");
const serverBase = `http://127.0.0.1:${address.port}`;

after(() => {
  for (const client of clients) client.end();
  fakeServer.closeAllConnections();
  fakeServer.close();
  rmSync(transpiledDir, { recursive: true, force: true });
});

// A loaded windows-latest runner can spend most of a 1s budget on process
// scheduling before the SSE stream even opens, which fails the job for a
// reason the test is not about. These cases assert ordering and payload -
// SSE opens before POST, progress arrives, done resolves - not latency, so
// the clock should not be the thing that decides them. Same reasoning as
// f6cdb8bc for job-terminal-status-contract.
function mcpOpts(requestId: string, timeoutMs = 20_000): McpJobOptions {
  return {
    serverBase,
    kind: requestId === "replay-job" ? "video" : "image",
    body: { provider: "runway", prompt: "test", requestId: "must-be-overridden" },
    requestId,
    timeoutMs,
    json: true,
  };
}

describe("runMcpJob", () => {
  it("opens SSE before POST, reports progress, and resolves done", async (t) => {
    const phases: string[] = [];
    const nativeFetch = globalThis.fetch;
    t.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
      eventTrace.push({ at: Date.now(), fetch: String(args[0]), stage: "start" });
      try {
        const response = await nativeFetch(...args);
        eventTrace.push({ at: Date.now(), stage: "headers", status: response.status });
        return response;
      } catch (error) {
        eventTrace.push({ at: Date.now(), stage: "error", error: String(error), cause: String((error as Error).cause) });
        throw error;
      }
    });
    const result = await mcpModule.runMcpJob({ ...mcpOpts("done-job"), onProgress: (phase) => phases.push(phase) })
      .catch((error) => {
        t.diagnostic(JSON.stringify({ eventTrace, phases, postOpen: postSawOpen.get("done-job"), clients: clients.size }));
        throw error;
      });
    assert.strictEqual(postSawOpen.get("done-job"), true);
    assert.deepStrictEqual(phases, ["rendering"]);
    assert.strictEqual(result.filename, "done.png");
    assert.strictEqual(result.url, "/generated/done.png");
  });

  it("throws the SSE error code", async () => {
    await assert.rejects(mcpModule.runMcpJob(mcpOpts("error-job")), { code: "MCP_PROVIDER_FAILED" });
  });

  it("aborts at the overall deadline", async () => {
    await assert.rejects(mcpModule.runMcpJob(mcpOpts("timeout-job", 80)), { code: "MCP_JOB_TIMEOUT" });
  });

  it("reconnects with the last id and recovers a replay gap from inflight", async () => {
    const before = reconnectCursors.length;
    const result = await mcpModule.runMcpJob(mcpOpts("replay-job"));
    assert.deepStrictEqual(reconnectCursors.slice(before), ["10"]);
    assert.strictEqual(result.filename, "replayed.mp4");
    assert.strictEqual(result.url, "/generated/replayed.mp4");
    assert.strictEqual(result.meta.status, "done");
  });

  it("keeps a replay gap without terminal evidence as an error without reposting", async () => {
    const before = postCount;
    await assert.rejects(mcpModule.runMcpJob(mcpOpts("pending-gap-job")), { code: "SSE_REPLAY_GAP" });
    assert.equal(postCount, before + 1);
  });

  it("replays after the initial stream drops before its first event without reposting", async () => {
    const before = postCount;
    const cursorStart = reconnectCursors.length;
    initialCursor = "7";
    try {
      const result = await mcpModule.runMcpJob(mcpOpts("first-drop-job"));
      assert.equal(postCount, before + 1);
      assert.equal(postSawOpen.get("first-drop-job"), true);
      assert.equal(result.filename, "replayed.mp4");
      assert.equal(result.url, "/generated/replayed.mp4");
      assert.deepStrictEqual(reconnectCursors.slice(cursorStart), ["7"]);
    } finally { firstDropPosted = false; initialCursor = undefined; }
  });
});

describe("SSE cursor contract", () => {
  it("parses only decimal nonnegative safe integers", () => {
    for (const [value, expected] of [["0", 0], ["007", 7], ["9007199254740991", 9007199254740991]] as const) {
      assert.equal(parseEventCursor(value), expected);
    }
    for (const value of [null, "", " ", "7\n", "7\r", "7\t", " 7", "7 ", "-1", "+1", "1.5", "1e2", "0x10", "7junk", "7,8", "9007199254740992"]) {
      assert.equal(parseEventCursor(value), null, JSON.stringify(value));
    }
  });

  for (const cursor of [null, "0", "007", "9007199254740991"]) {
    it(`accepts cursor ${cursor ?? "absent (legacy)"} before reading frames`, async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(null, {
        headers: cursor === null ? {} : { "x-ima2-event-cursor": cursor },
      }));
      const stream = await sseModule.openSse(`${serverBase}/api/events`);
      try { assert.equal(stream.initialEventId, cursor ?? undefined); } finally { stream.close(); }
    });
  }

  for (const cursor of ["", "-1", "+1", "1.5", "1e2", "0x10", "7junk", "7, 8", "9007199254740992"]) {
    it(`rejects malformed cursor ${JSON.stringify(cursor)} before POST and cancels the stream`, async (t) => {
      const methods: string[] = [];
      let signal: AbortSignal | null | undefined;
      t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
        methods.push(init?.method ?? "GET"); signal = init?.signal;
        if (methods.length > 1) throw new Error("unexpected request after invalid cursor");
        return new Response(null, { headers: { "x-ima2-event-cursor": cursor } });
      });
      await assert.rejects(mcpModule.runMcpJob(mcpOpts("invalid-header")), { message: "SSE_INVALID_EVENT_CURSOR" });
      assert.deepEqual(methods, ["GET"]); assert.equal(signal?.aborted, true);
    });
  }
});
