import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { startStubUpstream, type StubHandle, type StubMode } from "./stubUpstream";
import { makeAppEnv } from "./appIsolation";
import { createAppProjection, verifyAppProjection, type Projection } from "./appProjection";
import { createGuardReport, type GuardReport } from "./appGuardReport";
import { issueAppHome, requireAppHome, registerOwnedApp, isOwnedBrowserOrigin, disposeOwnedApps, hasUnexitedOwnedApps } from "./appOwnership";
import { disposeRuntimeBuildCache } from "./appRuntimeBuild";
import type { Provider } from "../../src/types";

export { expect };
export const test = base.extend<{}, { ownedAppCleanup: void }>({
  ownedAppCleanup: [async ({}, use, workerInfo) => {
    const errors: unknown[] = [];
    let resourcesClosed = false, cacheDisposed = false;
    try { await use(); }
    finally {
      try { await disposeOwnedApps(); resourcesClosed = true; } catch (error) { errors.push(error); }
      if (!hasUnexitedOwnedApps()) {
        try { await disposeRuntimeBuildCache(); cacheDisposed = true; } catch (error) { errors.push(error); }
      }
      try {
        await writeFile(join(workerInfo.project.outputDir, `wp09-worker-${workerInfo.workerIndex}-cleanup.json`), JSON.stringify({
          runId: process.env.GITHUB_RUN_ID, project: workerInfo.project.name, workerIndex: workerInfo.workerIndex,
          resourcesClosed, cacheDisposed, childExitUnproven: hasUnexitedOwnedApps(), errorCount: errors.length,
        }));
      } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "E2E_WORKER_CLEANUP");
    }
  }, { scope: "worker", auto: true }],
});
export type AppHandle = {
  baseUrl: string; stub: StubHandle; home: string;
  isolation?: J6Isolation; guard: GuardReport; close(): Promise<void>;
};
export type AppStartOptions = {
  provider?: "minimax" | "oauth"; home?: string; withoutMinimaxKey?: boolean; j6?: boolean;
  lan?: { token: string; publicOrigins?: readonly string[] };
  prepareRuntime?: (paths: { runtimeRoot: string; home: string }) => Promise<void>;
};
export type J6Isolation = {
  checkout: string; osHome: string; runner: string; runId: string;
  dotenvAbsent: true; providerEnvironmentAbsent: true; authStoresAbsent: true;
  credentialMountsAbsent: true; autoStartDisabled: true;
  runnerPaths: { xdgConfigHome: string | null; azureExtensions: string | null };
  runnerPathMetadata: Record<string, unknown>;
  azureExtensionHandling: "absent" | "unused-public-tool-metadata";
  fallbackPorts?: Array<{ host: string; port: number; outcome: "ECONNREFUSED" }>;
};

// No HTTP or payload: a listener, timeout or unexpected socket error fails closed.
function refusedFallback(host: string, port: number): Promise<{ host: string; port: number; outcome: "ECONNREFUSED" }> {
  return new Promise((resolveProbe, reject) => {
    const socket = createConnection({ host, port });
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolveProbe({ host, port, outcome: "ECONNREFUSED" });
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(new Error(`J6 BLOCKED: fallback listener ${host}:${port}`)));
    socket.once("timeout", () => finish(new Error(`J6 BLOCKED: fallback probe timeout ${host}:${port}`)));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? undefined
      : new Error(`J6 BLOCKED: fallback probe ${host}:${port}: ${error.code ?? "UNKNOWN"}`)));
  });
}

export async function assertJ6FallbackPorts(): Promise<NonNullable<J6Isolation["fallbackPorts"]>> {
  // This guard MUST precede any socket creation, including direct helper callers.
  assertJ6Isolation();
  try {
    return await Promise.all(["127.0.0.1", "::1"].map((host) => refusedFallback(host, 10531)));
  } catch (error) { throw error; }
}

function verifiedRunnerPath(key: string, value: string | undefined, osHome: string): boolean {
  const expected = key === "XDG_CONFIG_HOME" ? join(osHome, ".config")
    : key === "AZURE_EXTENSION_DIR" ? "/opt/az/azcliextensions" : null;
  if (!expected || value !== expected) return false;
  let metadata: ReturnType<typeof lstatSync>;
  try { metadata = lstatSync(expected); } catch (error) {
    return key === "XDG_CONFIG_HOME" && (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) return false;
  try { if (realpathSync(expected) !== expected) return false; } catch { return false; }
  // The observed hosted image makes /opt world-writable. This exact path is
  // unused metadata, NOT trusted extension code; it is never inherited by J6's child.
  return key === "XDG_CONFIG_HOME" || (metadata.uid === 0
    && ((metadata.mode & 0o022) === 0 || (metadata.mode & 0o7777) === 0o777));
}

/** Diagnostic only: inspect two fixed public tool paths, never arbitrary env values or file contents. */
export function j6RunnerPathDiagnostics(): Record<string, unknown> {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
    || process.platform !== "linux") return { inspected: false };
  return Object.fromEntries([
    ["XDG_CONFIG_HOME", "/home/runner/.config"], ["AZURE_EXTENSION_DIR", "/opt/az/azcliextensions"],
  ].map(([key, expected]) => {
    if (process.env[key] !== expected) return [key, { expectedPath: false, inspected: false }];
    try {
      const metadata = lstatSync(expected);
      let canonical = false;
      try { canonical = realpathSync(expected) === expected; } catch { /* Report false, do not repair. */ }
      return [key, { expectedPath: true, directory: metadata.isDirectory(), symlink: metadata.isSymbolicLink(),
        uid: metadata.uid, mode: (metadata.mode & 0o777).toString(8), canonical }];
    } catch (error) {
      return [key, { expectedPath: true, code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN" }];
    }
  }));
}

// WP02 is deliberately hosted-only; this is a preflight, NOT WP09's OS sandbox.
// Never read credential contents or repair an unsafe environment to make it pass.
export function assertJ6Isolation(): J6Isolation {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
    || process.platform !== "linux" || !process.env.GITHUB_RUN_ID) {
    throw new Error("J6 BLOCKED: a disposable GitHub-hosted Linux runner is required");
  }
  const osHome = realpathSync(userInfo().homedir);
  const checkout = realpathSync(resolve(process.cwd(), ".."));
  if (osHome !== "/home/runner" || homedir() !== osHome || process.env.HOME !== osHome
    || checkout !== resolve(process.cwd(), "..")
    || !process.env.GITHUB_WORKSPACE || realpathSync(process.env.GITHUB_WORKSPACE) !== checkout
    || !checkout.startsWith(`${osHome}/work/`)) {
    throw new Error("J6 BLOCKED: checkout or actual OS home is not the disposable runner identity");
  }
  const unsafeEnv = Object.keys(process.env).filter((key) => !verifiedRunnerPath(key, process.env[key], osHome) && (
    /^(IMA2_|DOTENV_|OPENAI_|XAI_|GROK_|PROGROK_|CHATGPT_|GEMINI_|GOOGLE_|VERTEX_|ATLASCLOUD_|MINIMAX_|NOVELAI_|RUNWAY_|HIGGSFIELD_|AGY_|ANTHROPIC_|AWS_|AZURE_|PW_TEST_|PLAYWRIGHT_TEST_BASE_URL$|CODEX_HOME$|XDG_CONFIG_HOME$|NODE_OPTIONS$|NODE_PATH$|OAUTH_PORT$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)
    || /(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|CREDENTIALS|AUTH_TOKEN|COOKIE)/i.test(key)));
  if (unsafeEnv.length) throw new Error(`J6 BLOCKED: unsafe environment names: ${unsafeEnv.sort().join(", ")}`);
  const stores = [".ima2", ".codex", ".chatgpt-local", ".grok", ".progrok", ".gemini",
    ".antigravity", ".config/codex", ".config/gcloud", ".config/progrok", ".config/grok", ".aws", ".azure"];
  if ([osHome, checkout].some((root) => stores.some((entry) => existsSync(join(root, entry))))) {
    throw new Error("J6 BLOCKED: legacy configuration or auth store exists");
  }
  assertNoJ6Overrides(checkout);
  if (existsSync(join(checkout, "generated"))) throw new Error("J6 BLOCKED: legacy generated data exists");
  const mounts = readFileSync("/proc/self/mountinfo", "utf8");
  if (mounts.split("\n").some((line) => /\/(?:Users|\.ima2|\.codex|\.grok|\.gemini|\.aws|\.azure)(?:\/|\s)/.test(line))) {
    throw new Error("J6 BLOCKED: credential-bearing mount detected");
  }
  return { checkout, osHome, runner: "github-hosted/linux", runId: process.env.GITHUB_RUN_ID,
    dotenvAbsent: true, providerEnvironmentAbsent: true, authStoresAbsent: true,
    credentialMountsAbsent: true, autoStartDisabled: true,
    runnerPaths: { xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
      azureExtensions: process.env.AZURE_EXTENSION_DIR ?? null },
    runnerPathMetadata: j6RunnerPathDiagnostics(),
    azureExtensionHandling: process.env.AZURE_EXTENSION_DIR ? "unused-public-tool-metadata" : "absent" };
}

function assertNoJ6Overrides(checkout: string): void {
  const dirs = new Set([checkout, join(checkout, "ui"), homedir()]);
  for (let parent = dirname(checkout); parent !== dirname(parent); parent = dirname(parent)) dirs.add(parent);
  for (const dir of dirs) {
    if (readdirSync(dir).some((name) => /^\.env(?:\.|$)/.test(name)
      && !/\.(?:example|sample|template)$/.test(name))) {
      throw new Error(`J6 BLOCKED: dotenv override in ${dir}`);
    }
  }
  if (lstatSync(checkout).isSymbolicLink()) throw new Error("J6 BLOCKED: linked checkout");
}


export function assertStubOnlyCalls(stub: StubHandle): void {
  if (stub.externalAttempts.length) throw new Error("E2E_STUB_FOREIGN_HOST");
}
export type BrowserSeedOptions = {
  provider?: Provider; dismissOnboarding?: boolean; imageModel?: string; generationDefaults?: Record<string, unknown>;
  workspaceProfile?: "default" | "prompt-studio"; locale?: "en" | "ko" | "zh-Hans" | "zh-Hant"; seedId?: string;
};
const seeded = new WeakMap<object, string>();
const contexts = new WeakSet<BrowserContext>();
const browserViolations: string[] = [];

async function guardBrowser(context: BrowserContext): Promise<void> {
  if (contexts.has(context)) return;
  if (context.serviceWorkers().length) throw new Error("E2E_BROWSER_SERVICE_WORKER");
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["data:", "blob:", "about:"].includes(url.protocol) || isOwnedBrowserOrigin(url.origin)) await route.continue();
    else { browserViolations.push("unowned-origin"); await route.abort("blockedbyclient"); }
  });
  await context.routeWebSocket("**/*", (socket) => {
    browserViolations.push("websocket"); socket.close();
  });
  context.on("serviceworker", () => browserViolations.push("serviceworker"));
  contexts.add(context);
}
export async function seedBrowser(page: Page, options: BrowserSeedOptions = {}): Promise<void> {
  await guardBrowser(page.context());
  const provider = options.provider ?? "minimax";
  if (!options.imageModel && provider !== "minimax" && provider !== "oauth") throw new Error("E2E_SEED_MODEL_REQUIRED");
  const payload = JSON.stringify({ provider, dismissOnboarding: options.dismissOnboarding ?? false,
    imageModel: options.imageModel ?? (provider === "minimax" ? "image-01" : "gpt-5.6-luna"),
    generationDefaults: options.generationDefaults ?? {}, workspaceProfile: options.workspaceProfile ?? "default",
    locale: options.locale ?? "en", seedId: options.seedId ?? "initial" });
  const previous = seeded.get(page);
  if (previous) { if (previous !== payload) throw new Error("E2E_CONFLICTING_SEED"); return; }
  await page.addInitScript((text) => {
    if (!["http:", "https:"].includes(location.protocol)) return;
    const input = JSON.parse(text);
    const marker = "ima2.e2e.seed." + input.seedId;
    if (sessionStorage.getItem(marker)) return;
    if (input.dismissOnboarding) localStorage.setItem("ima2.onboardingDismissed", "1");
    localStorage.setItem("ima2.locale", input.locale);
    localStorage.setItem("ima2.workspaceProfile", input.workspaceProfile);
    localStorage.setItem("ima2.generationDefaults", JSON.stringify({ provider: input.provider, ...input.generationDefaults }));
    localStorage.setItem("ima2.imageModel", input.imageModel);
    sessionStorage.setItem(marker, "1");
  }, payload);
  seeded.set(page, payload);
}

function observeChild(child: ChildProcess) {
  let closed = false;
  const completion = new Promise<void>((resolve) => child.once("close", () => { closed = true; resolve(); }));
  return { exited: () => closed,
    async stop() {
      if (closed) return;
      let force: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          force = setTimeout(() => child.kill("SIGKILL"), 5000);
        }
        await Promise.race([completion, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("E2E_CHILD_EXIT_UNPROVEN")), 10000);
        })]);
      } finally { clearTimeout(force); clearTimeout(deadline); }
    },
  };
}
function listenAddress(child: ChildProcess, guard: GuardReport): Promise<string> {
  return new Promise((resolveAddress, reject) => {
    let text = "";
    const cleanup = () => {
      clearTimeout(timer); child.stdout?.off("data", data); child.stderr?.off("data", data);
      child.off("error", failed); child.off("exit", exited);
    };
    const failed = () => { cleanup(); reject(new Error("E2E_CHILD_START_FAILED")); };
    const exited = () => {
      const codes = text.match(/\b(?:E2E|ERR|UI_RECEIPT)_[A-Z_]+\b/g) ?? [];
      const nativeFrames = text.split("\n").filter((line) => /^\s+at [A-Za-z0-9_.<> ]+ \(node:[a-z_]+:\d+:\d+\)$/.test(line)).slice(-8);
      cleanup(); reject(new Error("E2E_CHILD_EARLY_EXIT:" + (codes.at(-1) ?? "unknown"), {
        cause: { connections: guard.deniedConnections, processes: guard.deniedProcesses,
          filesystem: guard.deniedFilesystem, nativeFrames },
      }));
    };
    const data = (chunk: Buffer) => {
      text = (text + chunk.toString("utf8")).slice(-65536);
      const match = /Image Gen running at (http:\/\/[^\s]+)/.exec(text);
      if (match) { cleanup(); resolveAddress(match[1]!); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("E2E_CHILD_START_TIMEOUT")); }, 20000);
    child.stdout?.on("data", data); child.stderr?.on("data", data); child.once("error", failed); child.once("exit", exited);
  });
}
async function launch(stub: StubHandle, home: string, projection: Projection, isolation: J6Isolation, env: NodeJS.ProcessEnv): Promise<AppHandle> {
  const guard = createGuardReport();
  const browserStart = browserViolations.length;
  let childState: ReturnType<typeof observeChild> | undefined, appOrigin: string | null = null;
  let resourcesClosed: Promise<void> | undefined, reported = false;
  const closeResources = () => resourcesClosed ??= (async () => {
    const errors: unknown[] = [];
    try { await childState?.stop(); } catch (error) { errors.push(error); }
    try { await stub.close(); } catch (error) { errors.push(error); }
    if (!childState || childState.exited()) {
      try { await projection.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "E2E_APP_CLEANUP");
  })();
  const verify = () => {
    reported = true; guard.assertClean(); assertStubOnlyCalls(stub);
    if (browserViolations.length > browserStart) throw new Error("E2E_BROWSER_UNEXPECTED_REQUEST");
  };
  try {
    await registerOwnedApp({ home, get appOrigin() { return appOrigin; }, stubOrigin: new URL(stub.url).origin,
      closeResources, exited: () => !childState || childState.exited(), verificationReported: () => reported, verify });
    const child = spawn(process.execPath, ["--import", projection.guardPath, projection.entryPath], {
      cwd: projection.root, env: { ...env, IMA2_E2E_POLICY: projection.policyPath }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    childState = observeChild(child);
    child.on("message", guard.accept);
    const [address] = await Promise.race([Promise.all([listenAddress(child, guard), guard.readyPromise]), guard.failure]);
    const url = new URL(address);
    const expectedHost = env.IMA2_E2E_LAN_BIND === "1" ? "localhost" : "127.0.0.1";
    if (url.origin !== address || url.protocol !== "http:" || url.hostname !== expectedHost || !url.port || url.port === "3333") throw new Error("E2E_CHILD_ORIGIN");
    appOrigin = address; guard.assertClean();
    return { baseUrl: address, stub, home, isolation, guard, async close() { await closeResources(); verify(); } };
  } catch (error) {
    reported = true;
    try { await closeResources(); } catch (cleanup) { throw new AggregateError([error, cleanup], "E2E_START_AND_CLEANUP"); }
    throw error;
  }
}
async function initializeHome(home: string, provider: string, withoutKey: boolean, fresh: boolean): Promise<void> {
  await requireAppHome(home);
  const temporary = join(home, "tmp");
  try { await mkdir(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const tempStat = await lstat(temporary);
  if (!tempStat.isDirectory() || tempStat.isSymbolicLink() || await realpath(temporary) !== temporary) throw new Error("E2E_HOME_TMP");
  const dotenv = join(home, "fixture.env");
  try { await writeFile(dotenv, "", { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = await lstat(dotenv);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) throw new Error("E2E_HOME_ENV");
  }
  if (fresh) await writeFile(join(home, "config.json"), JSON.stringify({ provider,
    ...(withoutKey ? {} : { minimaxApiKey: "e2e-minimax-key" }),
    oauth: { disableAutoStart: true }, mcp: { enabledProviders: [] },
  }), { flag: "wx" });
  // The one-time GitHub star prompt would cover journeys after their first image;
  // mark it answered (shared state with the CLI prompt) so specs never meet it.
  if (fresh) {
    await mkdir(join(home, "state"));
    await writeFile(join(home, "state", "star-prompt.json"), JSON.stringify({ prompted_at: "2026-01-01T00:00:00.000Z" }), { flag: "wx" });
  }
}
export async function startApp(mode: StubMode = "minimax", options: AppStartOptions = {}): Promise<AppHandle> {
  const isolation = assertJ6Isolation();
  if (options.j6) isolation.fallbackPorts = await assertJ6FallbackPorts();
  const stub = await startStubUpstream(mode);
  let projection: Projection | undefined, launched = false;
  try {
    const home = options.home ?? await issueAppHome();
    const provider = options.provider ?? (mode === "oauth-expired" ? "oauth" : "minimax");
    const withoutMinimaxKey = options.j6 ? true : options.withoutMinimaxKey ?? false;
    await initializeHome(home, provider, withoutMinimaxKey, options.home === undefined);
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    projection = await createAppProjection({ repoRoot, home, buildDir: join(repoRoot, "ui/dist") });
    await options.prepareRuntime?.({ runtimeRoot: projection.root, home });
    await requireAppHome(home); await verifyAppProjection(projection);
    const env = makeAppEnv(process.env, { home, stubUrl: stub.url, mode, withoutMinimaxKey,
      ...(options.lan ? { lan: options.lan } : {}) });
    launched = true;
    return await launch(stub, home, projection, isolation, env);
  } catch (error) {
    if (!launched) { try { await projection?.dispose(); } finally { await stub.close(); } }
    throw error;
  }
}
