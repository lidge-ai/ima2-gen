import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Execute the actual provider checker with synthetic config/auth/filesystem.
// No operator environment, credential store, native auth process or network.
const compiled = await build({ entryPoints: [resolve(root, "bin/lib/doctor-providers.ts")], bundle: true,
  write: false, platform: "node", format: "cjs", external: ["node:*"], logLevel: "silent",
  plugins: [{ name: "doctor-owned-observations", setup(builder) {
    builder.onResolve({ filter: /(?:config|codexDetect|authStatus)\.js$/ }, (args) => ({ path: args.path, namespace: "doctor-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "doctor-fixture" }, (args) => ({ loader: "js", contents: args.path.endsWith("codexDetect.js")
      ? 'export const detectCodexAuth=()=>({proxyReady:false,authed:false,probe:"missing"});'
      : args.path.endsWith("authStatus.js")
      ? 'export const gptAuthStatus=()=>({provider:"gpt",loggedIn:false,health:"not_logged_in",reason:"no_session",refreshable:false,action:"ima2 login"});'
      : 'export const config={comfy:{defaultUrl:"http://127.0.0.1:8188"},minimaxProvider:{region:"global_en",globalBaseUrl:"https://api.minimax.io/v1",cnBaseUrl:"https://api.minimax.chat/v1"},diagnostics:{keyTimeoutMs:5000}};' }));
  } }],
});
const modules: Record<string, unknown> = { "node:fs": { existsSync: () => false, constants: {} },
  "node:fs/promises": {}, "node:path": path, "node:os": { homedir: () => "/synthetic/doctor-home" } };
const module = { exports: {} };
runInNewContext(compiled.outputFiles[0]!.text, { module, Buffer, URL, AbortController, setTimeout, clearTimeout,
  process: { env: {}, platform: "linux" }, fetch: () => { throw Error("Uninjected fetch prohibited"); },
  require: (name: string) => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
}, { timeout: 2000 });
const { buildProviderDoctorLines, listedValidateUrls, resolveValidateUrl, verifyConfiguredKeys } = module.exports as typeof import("../bin/lib/doctor-providers.ts");
const { listProviders } = await import("../lib/providers/registry.ts");
const { bundleContainsSecrets, buildDoctorBundle, expectedLaneIds } = await import("../bin/lib/doctor-bundle.ts");

function source(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("070 doctor provider contract", () => {
  it("lists every registry lane", () => {
    const lanes = expectedLaneIds();
    assert.deepEqual(lanes, listProviders().map((provider) => provider.id));
    assert.equal(lanes.length, 10);
    const lines = buildProviderDoctorLines({});
    for (const lane of lanes) {
      assert.ok(lines.some((line) => line.lane === lane), `missing lane ${lane}`);
    }
  });

  it("keeps default doctor off the network and off image-probe", () => {
    const doctor = source("bin/commands/doctor.ts");
    assert.match(doctor, /if \(args\.includes\("--verify-keys"\)\)/);
    assert.match(doctor, /if \(args\[0\] === "image-probe"\)/);
    const verifyBlock = doctor.slice(doctor.indexOf('if (args.includes("--verify-keys"))'));
    assert.match(verifyBlock, /verifyConfiguredKeys/);
    const standard = doctor.slice(doctor.indexOf("async function standardDoctor"), doctor.indexOf("export async function doctor"));
    assert.doesNotMatch(standard, /runImageDoctorProbe/);
    assert.doesNotMatch(standard.replace(/if \(args\.includes\("--verify-keys"\)\)[\s\S]*?}\n/, ""), /verifyConfiguredKeys/);
  });

  it("image-probe warns on stderr before the live probe", () => {
    const doctor = source("bin/commands/doctor.ts");
    const probe = doctor.slice(doctor.indexOf("async function imageProbe"), doctor.indexOf("async function standardDoctor"));
    assert.ok(probe.indexOf("console.error(\"Warning: ima2 doctor image-probe") < probe.indexOf("runImageDoctorProbe"));
  });

  it("verify-keys uses the Gemini header, not Bearer", async () => {
    const seen: Array<{ url: string; headerKeys: string[] }> = [];
    await verifyConfiguredKeys({ geminiApiKey: "AItest" }, (async (input, init) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      seen.push({ url: String(input), headerKeys: Object.keys(headers) });
      assert.equal(headers["x-goog-api-key"], "AItest");
      assert.equal("Authorization" in headers, false);
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    assert.ok(seen.some((entry) => entry.url.includes("generativelanguage.googleapis.com")));
  });

  it("verify-keys only calls resolved validateUrl values", async () => {
    const urls: string[] = [];
    const allowed = new Set(listedValidateUrls());
    await verifyConfiguredKeys({ apiKey: "sk-test" }, (async (input) => {
      urls.push(String(input));
      return new Response("{}", { status: 401 });
    }) as typeof fetch);
    assert.ok(urls.length >= 1);
    for (const url of urls) assert.ok(allowed.has(url), url);
    const minimax = listProviders().find((provider) => provider.id === "minimax")?.credentials[0];
    assert.equal(minimax && minimax.kind === "api-key", true);
    if (minimax && minimax.kind === "api-key") {
      assert.ok(listedValidateUrls().includes(resolveValidateUrl(minimax)!));
    }
  });

  it("redacts secrets from the diagnostic bundle", () => {
    const bundle = buildDoctorBundle({
      version: "test",
      providerLines: [{ code: "AUTH_INVALID", lane: "api", kind: "fail", text: "opaque_password sk-secret and Bearer abc.def" }],
    });
    assert.equal(bundleContainsSecrets(bundle), false);
    assert.equal(bundle.lanes[0]!.text, "The authentication endpoint rejected the credential.");
    assert.equal(JSON.stringify(bundle).includes("opaque_password"), false);
  });

  it("treats Vertex JSON as a parsed service account, not a file path", () => {
    const lines = buildProviderDoctorLines({
      vertexServiceAccountJson: JSON.stringify({ type: "service_account", project_id: "demo" }),
    });
    assert.ok(lines.some((line) => line.lane === "gemini-api" && line.text.includes("service-account JSON present")));
  });
});

it("remote auth distinguishes status failures and cancels every response body", async () => {
  for (const [status, code] of [[200, "AUTH_VERIFIED"], [401, "AUTH_INVALID"], [403, "AUTH_INVALID"],
    [429, "AUTH_RATE_LIMITED"], [503, "AUTH_UPSTREAM_FAILED"]] as const) {
    let cancelled = 0;
    const result = await verifyConfiguredKeys({ naiApiKey: "synthetic-owned-key" }, (async (_url, init) => {
      assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status });
    }) as typeof fetch, { timeoutMs: 100 });
    assert.equal(result.length, 1); assert.equal(result[0]!.code, code); assert.equal(cancelled, 1);
    assert.equal(result[0]!.evidence, "remote-auth");
  }
});

it("remote auth network and body-cleanup timeout cannot become credential-invalid", async () => {
  const network = await verifyConfiguredKeys({ naiApiKey: "synthetic-owned-key" }, (async () => {
    throw Error("https://opaque-secret@invalid.test/upstream-body");
  }) as typeof fetch, { timeoutMs: 20 });
  assert.equal(network[0]!.code, "AUTH_NETWORK_FAILED"); assert.equal(JSON.stringify(network).includes("opaque"), false);
  let signal: AbortSignal | undefined, cancelStarted = false;
  const timeout = await verifyConfiguredKeys({ naiApiKey: "synthetic-owned-key" }, (async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ cancel() { cancelStarted = true; return new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true })); } }));
  }) as typeof fetch, { timeoutMs: 10 });
  assert.equal(timeout[0]!.code, "AUTH_TIMEOUT"); assert.equal(cancelStarted, true); assert.equal(signal?.aborted, true);
});
