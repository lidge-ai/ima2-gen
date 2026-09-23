import { after, before, beforeEach, afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Same emitted-tree technique as cli-model-resolver. Only these inspected source
// modules execute; config/provider/OS boundaries below are inert mocks. No CLI
// entry, config singleton, personal advertise file, listener or real fetch runs.
const dir = mkdtempSync(join(tmpdir(), "ima2-cli-lan-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const A = "http://selected.test:4011", B = "http://artifact.test:4012";
const TOKEN = "synthetic-wp12s-lan-secret", BODY_SECRET = "synthetic-auth-body-secret";
const envKeys = ["IMA2_SERVER", "IMA2_LAN_TOKEN", "IMA2_ADVERTISE_FILE"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const advertise = join(dir, "server.json");
type Seen = { url: URL; init: RequestInit; headers: Headers };
const seen: Seen[] = [];
let route: (call: Seen) => Response | Promise<Response>;
let client: typeof import("../bin/lib/client.ts");
let sse: typeof import("../bin/lib/sse.ts");
let jobs: typeof import("../bin/lib/mcpJob.ts");
let character: typeof import("../bin/lib/characterResolve.ts");
let output: typeof import("../bin/lib/output.ts");
const commands: Record<string, (args: string[]) => Promise<void>> = {};
const listeners = { uncaughtException: process.listeners("uncaughtException"), unhandledRejection: process.listeners("unhandledRejection") };

function emit(path: string, text: string): void {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

before(async () => {
  emit("package.json", '{"type":"module","version":"fixture"}');
  const sources = [
    ...["client", "output", "error-hints", "args", "argsExplicit", "sse", "mcpJob", "characterResolve", "videoMcp",
      "files", "modelResolver", "model-aliases", "recover-output", "serviceTemplates"].map((n) => `bin/lib/${n}`),
    ...["ping", "models", "defaults", "capabilities", "gen", "video", "upscale", "service", "prompt", "tools"].map((n) => `bin/commands/${n}`),
    ...["eventsPolicy", "jobStatus", "errInfo", "pngInfo", "sizeNudge", "backgroundPresets", "videoClientTimeouts"].map((n) => `lib/${n}`),
    "lib/contracts/discovery", "lib/mcp/sanitizer", "lib/errors/providerMap", "lib/responsesErrors",
    // `responsesErrors` doc cau upstream/cau mo hinh viet ra qua
    // `safeDiagnosticMessage`, nen no can ca module nay luc CHAY chu khong chi
    // luc bien dich.
    "lib/diagnosticText",
  ];
  for (const path of sources) emit(`${path}.js`, ts.transpileModule(readFileSync(join(root, `${path}.ts`), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, fileName: `${path}.ts`,
  }).outputText);
  emit("config.js", `export const config = { limits: {maxGeneratedImages:24,maxRefCount:5}, storage: {generatedDir:${JSON.stringify(dir)}}, mcp:{enabledProviders:[]} };`);
  emit("bin/lib/config-store.js", `export const CONFIG_FILE = 'synthetic';
    export const loadCliDefaults = () => ({}); export const buildEffectiveConfig = () => ({});
    export const getNestedKey = () => 'fixture';
    export const loadFileCfg = () => {throw Error('unexpected config read')};
    export const saveFileCfg = () => {throw Error('unexpected config write')};
    export const deleteNestedKey = saveFileCfg, setNestedKey = saveFileCfg;
    export const displayPath = x => x, envOverrideForKey = () => null, restartNotice = () => '';`);
  emit("lib/providers/derive.js", `export const deriveProviderIds = () => ['oauth','grok']; export const deriveVideoProviderIds = () => ['grok'];`);
  emit("lib/mcp/providerRegistry.js", `export const listProviders = () => [{id:'runway'},{id:'higgsfield'}];`);
  emit("lib/imageModels.js", `export const GROK_VIDEO_MODEL_15 = 'grok-imagine-video-1.5', GROK_VIDEO_MODEL_15_PREVIEW_ALIAS = 'preview',
    GROK_VIDEO_MODEL_BASE = 'grok-imagine-video'; export const MIN_VIDEO_DURATION = 1, MAX_VIDEO_DURATION = 15;
    export const validateVideoResolutionForRequest = () => ({ok:true});`);
  emit("lib/capabilities.js", `export const buildIma2Capabilities = () => ({ok:true, source:'local'});`);
  emit("lib/contracts/catalog.js", `export const buildCatalog = () => [];`);
  emit("lib/mcp/snapshotStore.js", `export const loadAllBundledSnapshots = () => {throw Error('unexpected snapshot read')};
    export const readLocalSnapshot = loadAllBundledSnapshots;`);
  emit("bin/lib/nai-options.js", `export const NAI_CLI_FLAGS = {}, NAI_CLI_HELP = '';
    export const parseNaiCliOptions = () => ({payload:{}}), finalizeNaiCliTarget = x => x, unwrapNaiCliResult = x => x;`);
  emit("lib/processControl.js", `const deny = () => {throw Error('unexpected OS operation')};
    export const corroborateByStartTime=deny, escalateKill=deny, gracefulStop=deny, isProcessAlive=deny,
    verifyServerIdentity=deny, waitForExit=deny;`);
  client = await import(pathToFileURL(join(dir, "bin/lib/client.js")).href);
  sse = await import(pathToFileURL(join(dir, "bin/lib/sse.js")).href);
  jobs = await import(pathToFileURL(join(dir, "bin/lib/mcpJob.js")).href);
  character = await import(pathToFileURL(join(dir, "bin/lib/characterResolve.js")).href);
  output = await import(pathToFileURL(join(dir, "bin/lib/output.js")).href);
  for (const name of ["ping", "models", "defaults", "capabilities", "gen", "video", "upscale", "service", "prompt", "tools"]) {
    const module = await import(pathToFileURL(join(dir, `bin/commands/${name}.js`)).href);
    commands[name] = name === "service" ? module.service : module.default;
  }
});

beforeEach(() => {
  delete process.env.IMA2_SERVER;
  process.env.IMA2_LAN_TOKEN = TOKEN;
  process.env.IMA2_ADVERTISE_FILE = advertise;
  writeFileSync(advertise, JSON.stringify({ url: A }));
  client.clearServerBinding(); seen.length = 0;
  route = () => Response.json({ ok: true });
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    assert.equal(typeof url, "string");
    const call = { url: new URL(String(url)), init, headers: new Headers(init.headers) };
    seen.push(call);
    return route(call);
  });
});
afterEach(() => { mock.restoreAll(); client.clearServerBinding(); });
after(() => {
  for (const key of envKeys) savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key];
  for (const listener of process.listeners("uncaughtException")) {
    if (!listeners.uncaughtException.includes(listener)) process.removeListener("uncaughtException", listener);
  }
  for (const listener of process.listeners("unhandledRejection")) {
    if (!listeners.unhandledRejection.includes(listener)) process.removeListener("unhandledRejection", listener);
  }
  rmSync(dir, { recursive: true, force: true });
});

function denied(status = 401, code = "LAN_TOKEN_REQUIRED"): Response {
  return Response.json({ error: { code, message: `${TOKEN}:${BODY_SECRET}` } }, { status });
}
function safeError(code: string, status?: number) {
  return (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    if (status) assert.equal((error as { status?: number }).status, status);
    assert.doesNotMatch(String(error) + JSON.stringify(error), new RegExp(`${TOKEN}|${BODY_SECRET}`));
    return true;
  };
}
function assertTransport(call: Seen, token: string | null = TOKEN): void {
  assert.equal(call.headers.get("x-ima2-token"), token);
  assert.equal(call.headers.get("cookie"), null);
  assert.equal(call.init.credentials, "omit"); assert.equal(call.init.redirect, "error");
  assert.equal(call.url.searchParams.has("token"), false);
}
async function invoke(name: string, args: string[]) {
  let stdout = "", stderr = "", caught: unknown;
  const oldCode = process.exitCode;
  process.exitCode = undefined;
  const originalOut = process.stdout.write.bind(process.stdout), originalErr = process.stderr.write.bind(process.stderr);
  // Node's test runner sends binary reporter frames through stdout in its child.
  // Capture only CLI strings so the runner retains every test/result event.
  const outMock = mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return originalOut(chunk);
    stdout += chunk; return true;
  });
  const errMock = mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return originalErr(chunk);
    stderr += chunk; return true;
  });
  try { await commands[name]!(args); } catch (error) { caught = error; }
  finally { outMock.mock.restore(); errMock.mock.restore(); }
  const exit = process.exitCode ?? 0;
  process.exitCode = oldCode;
  if (caught instanceof Error) throw caught; // Commands must own their exit/error envelope.
  assert.doesNotMatch(stdout + stderr, new RegExp(`${TOKEN}|${BODY_SECRET}`));
  return { stdout, stderr, exit };
}

describe("late CLI authentication consumers", () => {
  it("recovery preserves terminal and history auth denial instead of the old timeout", async () => {
    const recovery = await import(pathToFileURL(join(dir, "bin/lib/recover-output.js")).href) as typeof import("../bin/lib/recover-output.ts");
    await client.resolveServer({ serverFlag: A });
    for (const target of ["/api/inflight", "/api/history"]) {
      seen.length = 0;
      route = ({ url }) => url.pathname === target ? denied() : Response.json({ jobs: [], terminalJobs: [] });
      await assert.rejects(recovery.recoverGeneratedOutputs(A, "owned-request", {}), safeError("LAN_TOKEN_REQUIRED", 401));
      assert.equal(seen.length, target === "/api/inflight" ? 1 : 2);
    }
  });
  it("optional prompt sources cannot turn late auth denial into empty successful output", async () => {
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : denied();
    const result = await invoke("prompt", ["import", "sources", "--server", A, "--json"]);
    assert.equal(result.exit, 4); assert.equal(result.stdout, ""); assert.match(result.stderr, /LAN_TOKEN_REQUIRED/);
  });
  it("tools preserves auth envelopes and explicit-env unreachable without local fallback", async () => {
    process.env.IMA2_SERVER = A;
    route = () => denied();
    const auth = await invoke("tools", ["list", "--json"]);
    assert.equal(auth.exit, 4); assert.equal(JSON.parse(auth.stdout).error.code, "LAN_TOKEN_REQUIRED");
    route = () => { throw new TypeError("synthetic refused socket"); };
    const offline = await invoke("tools", ["list", "--json"]);
    assert.equal(offline.exit, 3); assert.equal(JSON.parse(offline.stdout).error.code, "SERVER_UNREACHABLE");
    const count = seen.length;
    const local = await invoke("tools", ["list", "--offline", "--json"]);
    assert.equal(local.exit, 0); assert.equal(JSON.parse(local.stdout).data.source, "local-snapshot");
    assert.equal(seen.length, count);
  });
});

describe("CLI destination binding", () => {
  for (const phase of ["headers", "body"]) it(`health ${phase} timeout is unreachable and discovery stays unbound`, async () => {
    route = ({ url, init }) => {
      if (url.origin !== A) return Response.json({ ok: true });
      if (phase === "headers") return new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      return new Response(new ReadableStream({ start(controller) {
        init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason), { once: true });
      } }));
    };
    const result = await invoke("ping", ["--server", A, "--json"]);
    assert.equal(result.exit, 3); assert.equal(JSON.parse(result.stdout).code, "SERVER_UNREACHABLE");
    assert.equal(seen.length, 1); assertTransport(seen[0]!);
    const stalled = route;
    route = () => Response.json({ ok: true });
    await client.fetchServerUrl(`${A}/api/health`); assertTransport(seen.at(-1)!, null);
    route = stalled; seen.length = 0;
    assert.notEqual((await client.findRunningServer())?.base, A);
    assert.equal(seen.length, 2); seen.forEach((call) => assertTransport(call, null));
  });
  for (const status of [401, 403]) it(`known ${status} survives an aborted auth body`, async () => {
    route = ({ init }) => new Response(new ReadableStream({ start(controller) {
      init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason), { once: true });
    } }), { status });
    await assert.rejects(client.resolveServer({ serverFlag: A }), safeError("SERVER_ACCESS_DENIED", status));
    assert.equal(seen.length, 1);
  });
  it("never binds from helper URLs; explicit selection binds only its normalized origin", async () => {
    await client.fetchServerUrl(`${A}/api/events`);
    await client.fetchServer(A, "/api/health");
    assertTransport(seen[0]!, null); assertTransport(seen[1]!, null);
    process.env.IMA2_SERVER = B;
    const selected = await client.resolveServer({ serverFlag: `${A}/` });
    assert.equal(selected.base, A); assert.equal(JSON.stringify(selected).includes(TOKEN), false);
    const signal = new AbortController().signal;
    await client.fetchServer(A, "/api/sample?position=2", { method: "POST", body: "body", signal, headers: { "X-Test": "keep" } });
    assertTransport(seen.at(-1)!); assert.equal(seen.at(-1)!.init.body, "body");
    assert.equal(seen.at(-1)!.init.signal, signal); assert.equal(seen.at(-1)!.headers.get("x-test"), "keep");
    await client.fetchServerUrl(`${B}/generated/a?signature=valid`); assertTransport(seen.at(-1)!, null);
    await client.resolveServer(); assert.equal(seen.at(-1)!.url.origin, B); assertTransport(seen.at(-1)!);
    await client.fetchServerUrl(`${A}/api/events`); assertTransport(seen.at(-1)!, null);
  });
  it("clears binding on failed/change/invalid selection and includeEnv:false", async () => {
    await client.resolveServer({ serverFlag: A });
    route = () => denied();
    await assert.rejects(client.resolveServer({ serverFlag: B }), safeError("LAN_TOKEN_REQUIRED", 401));
    route = () => Response.json({ ok: true });
    await client.fetchServerUrl(`${A}/api/events`); assertTransport(seen.at(-1)!, null);
    await client.resolveServer({ serverFlag: A });
    await assert.rejects(client.resolveServer({ serverFlag: `http://user:${TOKEN}@selected.test` }), safeError("SERVER_URL_INVALID"));
    await client.fetchServerUrl(`${A}/api/events`); assertTransport(seen.at(-1)!, null);
    await client.resolveServer({ serverFlag: A });
    process.env.IMA2_SERVER = B;
    await client.findRunningServer({ includeEnv: false }); assertTransport(seen.at(-1)!, null);
  });
  it("fails invalid bases, cross-origin URLs and caller cookie/token conflicts before fetch", async () => {
    for (const base of [`${A}/path`, `${A}?token=${TOKEN}`, `${A}#x`, "file:///x", "", `${A}?`, "http:selected.test"]) {
      await assert.rejects(client.resolveServer({ serverFlag: base }), safeError("SERVER_URL_INVALID"));
    }
    await assert.rejects(client.fetchServer(A, `${B}/x`), safeError("SERVER_URL_INVALID"));
    await assert.rejects(client.fetchServer(A, `//artifact.test:4012/x`), safeError("SERVER_URL_INVALID"));
    await assert.rejects(client.fetchServer(A, `/x?%74oken=${TOKEN}`), safeError("SERVER_URL_INVALID"));
    for (const headers of [{ Cookie: TOKEN }, { "X-Ima2-Token": TOKEN }, [["x-ima2-token", TOKEN], ["x-ima2-token", "other"]]]) {
      await assert.rejects(client.fetchServerUrl(`${A}/api`, { headers: headers as HeadersInit }), safeError("SERVER_CREDENTIAL_CONFLICT"));
    }
    assert.equal(seen.length, 0);
  });
  it("no token is sent when absent; invalid health fails safely and clears binding", async () => {
    delete process.env.IMA2_LAN_TOKEN;
    await client.resolveServer({ serverFlag: A }); assertTransport(seen.at(-1)!, null);
    process.env.IMA2_LAN_TOKEN = TOKEN;
    route = () => new Response(TOKEN);
    await assert.rejects(client.resolveServer({ serverFlag: A }), safeError("SERVER_INVALID_HEALTH"));
    route = () => Response.json({ ok: true });
    await client.fetchServerUrl(`${A}/api/health`); assertTransport(seen.at(-1)!, null);
  });
  it("discovery denial stops before any fallback; explicit network failure is exit 3", async () => {
    route = () => denied();
    await assert.rejects(client.findRunningServer(), safeError("LAN_TOKEN_REQUIRED", 401));
    assert.equal(seen.length, 1); assertTransport(seen[0]!, null);
    route = () => { throw new TypeError("synthetic refused socket"); };
    await assert.rejects(client.resolveServer({ serverFlag: A }), (e) => {
      safeError("SERVER_UNREACHABLE")(e); assert.equal(output.exitCodeForError(e), 3); return true;
    });
    assert.equal(seen.length, 2);
  });
  it("maps safe 401/403 and rejects redirects without exposing body/Location", async () => {
    for (const [status, incoming, expected] of [[401, "evil", "SERVER_ACCESS_DENIED"], [403, "LOCAL_HOST_REJECTED", "LOCAL_HOST_REJECTED"],
      [403, "LOCAL_ORIGIN_REJECTED", "LOCAL_ORIGIN_REJECTED"], [403, TOKEN, "SERVER_ACCESS_DENIED"]] as const) {
      route = () => denied(status, incoming);
      await assert.rejects(client.request(A, "/api/models"), (e) => {
        safeError(expected, status)(e); assert.equal(output.exitCodeForError(e), 4); return true;
      });
    }
    route = () => new Response(null, { status: 302, headers: { Location: `${B}/?token=${TOKEN}` } });
    await assert.rejects(client.fetchServer(A, "/api"), safeError("SERVER_REDIRECT_REJECTED"));
    route = () => { throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") }); };
    await assert.rejects(client.fetchServer(A, "/api"), safeError("SERVER_REDIRECT_REJECTED"));
    assert.ok(seen.every((call) => call.url.origin === A));
  });
});

describe("provider authentication identity", () => {
  for (const [code, message] of [
    ["GROK_API_KEY_MISSING", "Grok API key is required for grok-api image generation"],
    ["AUTH_API_KEY_INVALID", "Provider API key is invalid"],
    ["AUTH_CHATGPT_EXPIRED", "ChatGPT session expired"],
    ["API_KEY_REQUIRED", "An API key is required"],
  ] as const) it(`preserves flat and nested ${code} through request and command`, async () => {
    for (const nested of [false, true]) {
      const payload = nested ? { error: { code, message } } : { error: message, code };
      route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : Response.json(payload, { status: 401 });
      await client.resolveServer({ serverFlag: A });
      await assert.rejects(client.request(A, "/api/generate", { method: "POST", body: {} }), (error) => {
        safeError(code, 401)(error); assert.equal((error as Error).message, message);
        assert.deepEqual((error as { body: unknown }).body, payload); return true;
      });
      const result = await invoke("models", ["--server", A, "--json"]);
      assert.equal(result.exit, 4); assert.equal(JSON.parse(result.stdout).code, code);
      assert.equal(JSON.parse(result.stdout).message, message); assert.doesNotMatch(result.stdout + result.stderr, /LAN authentication/);
    }
  });
  it("reserved codes on either mixed side override domain bodies and reject mismatched statuses", async () => {
    for (const code of ["LAN_TOKEN_REQUIRED", "LOCAL_HOST_REJECTED", "LOCAL_ORIGIN_REJECTED"]) {
      const status = code === "LAN_TOKEN_REQUIRED" ? 401 : 403;
      for (const payload of [
        { code, error: `${TOKEN}:${BODY_SECRET}` }, { error: { code, message: `${TOKEN}:${BODY_SECRET}` } },
        { code, error: { code: "AUTH_API_KEY_INVALID", message: `${TOKEN}:${BODY_SECRET}` } },
        { code: "AUTH_API_KEY_INVALID", error: { code, message: `${TOKEN}:${BODY_SECRET}` } },
      ]) for (const observed of [status, status === 401 ? 403 : 401]) {
        route = () => Response.json(payload, { status: observed });
        await assert.rejects(client.request(A, "/api/generate"), (error) => {
          safeError(observed === status ? code : "SERVER_ACCESS_DENIED", observed)(error);
          assert.equal(Object.hasOwn(error as object, "body"), false); assert.equal(Object.hasOwn(error as object, "cause"), false); return true;
        });
      }
    }
  });
  it("unknown or malformed auth bodies are neutral and never reflected", async () => {
    for (const status of [401, 403]) for (const payload of [
      null, [], { error: [] }, { error: TOKEN }, { error: { code: TOKEN, message: BODY_SECRET } },
      { code: "constructor", error: BODY_SECRET }, { code: "AUTH_INVENTED", error: TOKEN },
      { error: { code: "AUTH_API_KEY_INVALID", message: {} } }, { code: "API_KEY_REQUIRED", error: "  " },
      { code: "API_KEY_REQUIRED", error: { code: "AUTH_API_KEY_INVALID", message: BODY_SECRET } },
      { code: "SERVER_ACCESS_DENIED", error: { code: "AUTH_API_KEY_INVALID", message: TOKEN } },
    ]) {
      route = () => Response.json(payload, { status });
      await assert.rejects(client.request(A, "/api/models"), safeError("SERVER_ACCESS_DENIED", status));
    }
    for (const text of ["", `<html>${TOKEN}</html>`, `{"error":"${BODY_SECRET}`]) {
      route = () => new Response(text, { status: 401 });
      await assert.rejects(client.request(A, "/api/models"), safeError("SERVER_ACCESS_DENIED", 401));
    }
  });
  it("registered domain403 survives raw video and SSE open with consumed-body cleanup", async () => {
    const payload = { error: { code: "GROK_VIDEO_REQUEST_FAILED", message: "Video input was rejected" } };
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : Response.json(payload, { status: 403 });
    const result = await invoke("video", ["analyze", "clip.mp4", "--server", A, "--json"]);
    assert.equal(result.exit, 4); assert.equal(JSON.parse(result.stdout).code, payload.error.code);
    assert.equal(JSON.parse(result.stdout).message, payload.error.message);
    await assert.rejects(sse.openSse(`${A}/api/events`), (error) => {
      safeError(payload.error.code, 403)(error); assert.deepEqual((error as { body: unknown }).body, payload); return true;
    });
    assert.equal(seen.at(-1)!.init.signal?.aborted, true);
  });
  it("MCP provider-auth submit/reconnect failures keep body and never replay the POST", async () => {
    const payload = { code: "AUTH_CHATGPT_EXPIRED", error: "ChatGPT session expired" };
    for (const reconnect of [false, true]) {
      seen.length = 0; mcpRoutes(undefined, true); const normal = route;
      route = (call) => (!reconnect && call.url.pathname === "/api/mcp/generate"
        || reconnect && call.url.pathname === "/api/events" && seen.filter((item) => item.url.pathname === "/api/events").length > 1)
        ? Response.json(payload, { status: 401 }) : normal(call);
      await client.resolveServer({ serverFlag: A });
      await assert.rejects(jobs.runMcpJob({ serverBase: A, kind: "image", body: {}, requestId: "provider-auth-job", timeoutMs: 1000, json: true }), (error) => {
        safeError(payload.code, 401)(error); assert.deepEqual((error as { body: unknown }).body, payload); return true;
      });
      assert.equal(seen.filter((call) => call.init.method === "POST").length, 1);
      assert.ok(seen.filter((call) => call.url.pathname === "/api/events").every((call) => call.init.signal?.aborted));
      seen.forEach((call) => assertTransport(call));
    }
  });
  it("success and non-auth responses remain unread for their existing consumers", async () => {
    for (const status of [200, 400, 409]) {
      const payload = { error: { code: "INVALID_REQUEST", message: "ordinary response" } };
      route = () => Response.json(payload, { status });
      const response = await client.fetchServer(A, "/api/models");
      assert.equal(response.bodyUsed, false); assert.deepEqual(await response.json(), payload);
      if (status !== 200) await assert.rejects(client.request(A, "/api/models"), { code: "INVALID_REQUEST", status, message: "ordinary response" });
    }
  });
});

describe("CLI consumers preserve access failures", () => {
  it("capabilities falls back only for implicit unreachable discovery", async () => {
    route = () => { throw new TypeError("synthetic refused socket"); };
    assert.equal(JSON.parse((await invoke("capabilities", ["--json"])).stdout).source, "local");
    assert.equal((await invoke("capabilities", ["--require-server", "--json"])).exit, 3);
    process.env.IMA2_SERVER = A;
    assert.equal((await invoke("capabilities", ["--json"])).exit, 3);
  });
  for (const [name, args] of [["ping", []], ["models", []], ["defaults", ["ls"]], ["defaults", ["set", "image", "runway/gen-4"]],
    ["capabilities", []], ["gen", ["fixture"]], ["video", ["fixture"]], ["upscale", ["1780000000000_test.png"]]] as const) {
    it(`${name} ${args.join(" ")} preserves explicit env auth/forbidden/unreachable JSON and exit`, async () => {
      process.env.IMA2_SERVER = A;
      for (const status of [401, 403, 0]) {
        seen.length = 0;
        route = () => { if (!status) throw new TypeError("refused"); return denied(status); };
        const result = await invoke(name, [...args, "--json"]);
        assert.equal(result.exit, status ? 4 : 3);
        assert.equal(JSON.parse(result.stdout).code, status === 401 ? "LAN_TOKEN_REQUIRED" : status === 403 ? "SERVER_ACCESS_DENIED" : "SERVER_UNREACHABLE");
        assert.equal(seen.length, 1); assertTransport(seen[0]!);
      }
    });
  }
  it("defaults --local never queries even with a selected env target", async () => {
    process.env.IMA2_SERVER = A;
    const result = await invoke("defaults", ["ls", "--local", "--json"]);
    assert.equal(result.exit, 0); assert.equal(JSON.parse(result.stdout).source, "local"); assert.equal(seen.length, 0);
  });
  for (const name of ["defaults", "capabilities"]) it(`${name} does not fall back after API denial or discovery auth denial`, async () => {
    for (const healthOk of [true, false]) {
      route = ({ url }) => healthOk && url.pathname === "/api/health" ? Response.json({ ok: true }) : denied();
      const result = await invoke(name, ["--json"]);
      assert.equal(result.exit, 4); assert.equal(JSON.parse(result.stdout).code, "LAN_TOKEN_REQUIRED");
    }
  });
  for (const [name, args] of [["models", []], ["gen", ["fixture"]], ["video", ["fixture"]],
    ["defaults", ["set", "video", "runway/veo"]]] as const) it(`${name} catalog catch preserves API denial after healthy selection`, async () => {
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : denied(403, "LOCAL_ORIGIN_REJECTED");
    const result = await invoke(name, [...args, "--server", A, "--json"]);
    assert.equal(result.exit, 4); assert.equal(JSON.parse(result.stdout).code, "LOCAL_ORIGIN_REJECTED");
    assert.equal(seen.length, 2); seen.forEach((call) => assertTransport(call));
  });
});

const catalog = { lanes: {
  runway: { status: "ready", defaults: { image: "gen-4", video: "veo" }, models: {
    image: [{ id: "gen-4", capabilities: { inputRoles: ["text", "image_references"] } }],
    video: [{ id: "veo", capabilities: { inputRoles: ["text", "image_references"] } }],
  } },
  grok: { status: "ready", defaults: { video: "grok-imagine-video" }, models: { image: [], video: [{ id: "grok-imagine-video" }] } },
} };
function mcpRoutes(denyPath?: string, drop = false): void {
  let stream: ReadableStreamDefaultController<Uint8Array>;
  let requestId = "", opens = 0;
  route = ({ url, init }) => {
    if (url.pathname === denyPath) return denied();
    if (url.pathname === "/api/health") return Response.json({ ok: true });
    if (url.pathname === "/api/models") return Response.json(catalog);
    if (url.pathname === "/api/assets") return Response.json({ assets: [{ id: "char", name: "fixture", metadata: {
      elementKind: "character", characterBindings: [{ provider: "runway", mode: "reference" }],
    } }] });
    if (url.pathname === "/api/events") {
      opens++;
      if (drop && opens > 1) return denied();
      return new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { "x-ima2-event-cursor": "41" } });
    }
    if (url.pathname.startsWith("/api/mcp/")) {
      requestId = JSON.parse(String(init.body)).requestId;
      if (drop) stream.close();
      else { stream.enqueue(new TextEncoder().encode(`id: 42\nevent: done\ndata: ${JSON.stringify({ jobId: requestId, filename: "1780000000000_test.png", url: `${A}/generated/result` })}\n\n`)); stream.close(); }
      return Response.json({ requestId }, { status: 202 });
    }
    if (url.pathname === "/generated/result") return new Response("fixture-media");
    throw new Error(`unexpected fixture route ${url.pathname}`);
  };
}

describe("raw CLI transport callsites", () => {
  for (const [name, args, status, code] of [
    ["gen", ["fixture", "--model", "runway/gen-4", "--character", "char"], 400, "CHARACTER_REFS_EXCEED_PROVIDER_CAP"],
    ["video", ["fixture", "--model", "runway/veo", "--character", "char"], 409, "MCP_NOT_CONNECTED"],
    ["upscale", ["1780000000000_test.png", "--scale-factor", "2", "--sharpen", "25"], 409, "MCP_NOT_CONNECTED"],
    ["upscale", ["1780000000000_test.png"], 409, "MCP_NOT_CONNECTED"],
  ] as const) it(`${name} ${args.join(" ")} keeps ordinary MCP exit1`, async () => {
    mcpRoutes(); const normal = route;
    route = (call) => call.url.pathname.startsWith("/api/mcp/")
      ? Response.json({ error: { code, message: "synthetic rejection" } }, { status }) : normal(call);
    const result = await invoke(name, [...args, "--server", A, "--json"]);
    assert.equal(result.exit, 1); assert.equal(JSON.parse(result.stdout).code, code);
    const posts = seen.filter((call) => call.init.method === "POST"); assert.equal(posts.length, 1);
    const body = JSON.parse(String(posts[0]!.init.body));
    if (name === "gen") assert.equal(body.characterElementId, "char");
    else if (name === "video") {
      assert.equal(body.kind, "video"); assert.equal(body.model, "veo");
      assert.equal(body.characterElementId, "char"); assert.deepEqual(body.parameters, {});
    }
    else if (args.length > 1) assert.deepEqual(body.parameters, { scaleFactor: 2, sharpen: 25 });
    else assert.equal("parameters" in body, false);
    seen.forEach((call) => assertTransport(call));
  });
  it("explicit service startup retries its selected target and reports its URL", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.IMA2_SERVER = B;
    route = () => { if (seen.length === 1) throw new TypeError("not listening yet"); return Response.json({ ok: true }); };
    try {
      const result = await invoke("service", ["start"]);
      assert.equal(result.exit, 0);
      assert.equal(result.stdout.trim(), "Service started — http://artifact.test:4012");
      assert.equal(seen.length, 2);
      seen.forEach((call) => { assert.equal(call.url.origin, B); assertTransport(call); });
    } finally { Object.defineProperty(process, "platform", platform); }
  });
  for (const [name, args] of [["gen", ["fixture", "--model", "runway/gen-4", "--character", "char"]],
    ["video", ["fixture", "--model", "runway/veo", "--character", "char"]], ["upscale", ["1780000000000_test.png"]]] as const) {
    it(`${name} authenticates character/SSE/submit/download; denial never becomes exit1`, async () => {
      for (const denyPath of [undefined, "/api/events", "/api/mcp/generate", "/api/mcp/media-action", "/generated/result"]) {
        if (denyPath === "/api/mcp/generate" && name === "upscale" || denyPath === "/api/mcp/media-action" && name !== "upscale") continue;
        seen.length = 0; mcpRoutes(denyPath);
        const target = join(dir, `result-${name}`);
        const result = await invoke(name, [...args, "--server", A, "--json", "--out", target]);
        assert.equal(result.exit, denyPath ? 4 : 0, result.stdout + result.stderr);
        if (denyPath) assert.equal(JSON.parse(result.stdout).code, "LAN_TOKEN_REQUIRED");
        else assert.equal(readFileSync(target, "utf8"), "fixture-media");
        seen.forEach((call) => assertTransport(call));
        assert.ok(seen.filter((c) => c.init.method === "POST").length <= 1);
      }
    });
  }
  it("MCP reconnect keeps initial cursor, one submission, and safe auth error", async () => {
    mcpRoutes(undefined, true); await client.resolveServer({ serverFlag: A });
    await assert.rejects(jobs.runMcpJob({ serverBase: A, kind: "image", body: {}, requestId: "fixture-job", timeoutMs: 1000, json: true }), safeError("LAN_TOKEN_REQUIRED", 401));
    assert.equal(seen.filter((c) => c.init.method === "POST").length, 1);
    assert.equal(seen.at(-1)!.url.searchParams.get("lastEventId"), "41");
    seen.forEach((call) => assertTransport(call));
  });
  it("MCP replay-gap inflight GET authenticates and preserves terminal/error recovery without resubmit", async () => {
    for (const deniedRecovery of [false, true]) {
      seen.length = 0;
      route = ({ url }) => {
        if (url.pathname === "/api/health") return Response.json({ ok: true });
        if (url.pathname === "/api/events") return new Response('id: 43\nevent: replay-gap\ndata: {}\n\n');
        if (url.pathname === "/api/mcp/generate") return Response.json({}, { status: 202 });
        assert.equal(url.pathname, "/api/inflight"); assert.equal(url.searchParams.get("includeTerminal"), "1");
        return deniedRecovery ? denied() : Response.json({ terminalJobs: [{ requestId: "fixture-job", status: "completed", meta: { filename: "result.png" } }] });
      };
      await client.resolveServer({ serverFlag: A });
      const promise = jobs.runMcpJob({ serverBase: A, kind: "image", body: {}, requestId: "fixture-job", timeoutMs: 1000, json: true });
      if (deniedRecovery) await assert.rejects(promise, safeError("LAN_TOKEN_REQUIRED", 401));
      else assert.equal((await promise).filename, "result.png");
      assert.equal(seen.filter((c) => c.init.method === "POST").length, 1); seen.forEach((call) => assertTransport(call));
    }
  });
  it("GET and POST SSE openers preserve headers, abort and initial cursor", async () => {
    await client.resolveServer({ serverFlag: A });
    route = () => new Response('id: 8\nevent: done\ndata: {"ok":true}\n\n', { headers: { "x-ima2-event-cursor": "7" } });
    const controller = new AbortController();
    const stream = await sse.openSse(`${A}/api/events`, { signal: controller.signal, headers: { "Last-Event-ID": "6" } });
    assert.equal(stream.initialEventId, "7"); assert.equal(seen.at(-1)!.headers.get("last-event-id"), "6");
    controller.abort(); assert.equal(seen.at(-1)!.init.signal?.aborted, true); stream.close();
    for await (const event of sse.streamSse(`${A}/api/video/generate`, { body: { fixture: true } })) assert.equal(event.id, "8");
    assert.equal(seen.at(-1)!.init.method, "POST"); assert.deepEqual(JSON.parse(String(seen.at(-1)!.init.body)), { fixture: true });
    assertTransport(seen.at(-1)!);
  });
  it("character lookup propagates denial safely", async () => {
    await client.resolveServer({ serverFlag: A }); route = () => denied();
    await assert.rejects(character.resolveCharacterElement(A, "fixture"), safeError("LAN_TOKEN_REQUIRED", 401)); assertTransport(seen.at(-1)!);
  });
  for (const sub of ["edit", "extend", "frame", "analyze"]) it(`video ${sub} preserves auth denial at the raw request`, async () => {
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : denied();
    const args = sub === "edit" || sub === "extend" ? [sub, "fixture", "--video", "clip.mp4"] : [sub, join(dir, "absent.mp4")];
    const result = await invoke("video", [...args, "--server", A, ...(sub === "frame" ? [] : ["--json"])]);
    assert.equal(result.exit, 4); assert.equal(seen.at(-1)!.url.pathname, `/api/video/${sub}`); assertTransport(seen.at(-1)!);
  });
  it("frame upload preserves bytes/position; generated frame preserves encoded query", async () => {
    const input = join(dir, "source.mp4"), target = join(dir, "frame.png"); writeFileSync(input, "synthetic-video");
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true }) : new Response("frame");
    for (const file of [input, join(dir, "missing & clip.mp4")]) {
      const result = await invoke("video", ["frame", file, "--position", "2.5", "--server", A, "--out", target]);
      assert.equal(result.exit, 0); const call = seen.at(-1)!; assertTransport(call);
      if (file === input) assert.deepEqual(JSON.parse(String(call.init.body)), { video: Buffer.from("synthetic-video").toString("base64"), position: "2.5" });
      else { assert.equal(call.url.searchParams.get("file"), file); assert.equal(call.url.searchParams.get("position"), "2.5"); }
    }
    assert.equal(readFileSync(target, "utf8"), "frame");
  });
  it("edit downloads normalized same-origin media and credential-free signed external media", async () => {
    for (const media of [`${A}/generated/result`, `${B}/clip.mp4?signature=signed-value&expires=123`]) {
      route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true })
        : url.pathname === "/api/video/edit" ? Response.json({ url: media }) : new Response("media");
      const target = join(dir, "edit.mp4");
      const result = await invoke("video", ["edit", "fixture", "--video", "clip.mp4", "--server", A, "--json", "--out", target]);
      assert.equal(result.exit, 0); assert.equal(readFileSync(target, "utf8"), "media");
      assertTransport(seen.at(-1)!, media.startsWith(B) ? null : TOKEN);
      assert.equal(seen.at(-1)!.url.href, media);
    }
  });
  it("core video SSE/download and @last auth catch preserve transport", async () => {
    route = ({ url }) => url.pathname === "/api/health" ? Response.json({ ok: true })
      : url.pathname === "/api/models" ? Response.json(catalog)
      : url.pathname === "/api/history" ? denied()
      : url.pathname === "/api/video/generate" ? new Response(`event: done\ndata: ${JSON.stringify({ filename: "clip.mp4", url: `${A}/generated/result` })}\n\n`)
      : new Response("core-video");
    const args = ["fixture", "--model", "grok/grok-imagine-video", "--server", A, "--json", "--out", join(dir, "core.mp4")];
    assert.equal((await invoke("video", args)).exit, 0); seen.forEach((call) => assertTransport(call));
    const deniedLast = await invoke("video", [...args, "--ref", "@last"]);
    assert.equal(deniedLast.exit, 4); assert.equal(JSON.parse(deniedLast.stdout).code, "LAN_TOKEN_REQUIRED");
  });
  it("service health polling starts unbound and honors only explicit env selection", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    // Skip every launchctl/systemctl branch; exercise the real polling consumer.
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      await client.resolveServer({ serverFlag: A }); seen.length = 0; route = () => denied();
      assert.equal((await invoke("service", ["start"])).exit, 4); assert.equal(seen.length, 1); assertTransport(seen[0]!, null);
      process.env.IMA2_SERVER = B; seen.length = 0;
      assert.equal((await invoke("service", ["start"])).exit, 4); assert.equal(seen.length, 1); assert.equal(seen[0]!.url.origin, B); assertTransport(seen[0]!);
    } finally { Object.defineProperty(process, "platform", platform); }
    assert.equal(existsSync(join(dir, "service-state.json")), false);
  });
});
