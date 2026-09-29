import assert from "node:assert/strict";
import childProcess, { type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import os from "node:os";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, delimiter, join, isAbsolute } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import type { Request, Response } from "express";
import type { RuntimeContext } from "../lib/runtimeContext.ts";
import type { generateViaAgy } from "../lib/providers/adapters/agyOperations.ts";
import type { prepareImageExecution } from "../lib/providers/execution/index.ts";
import { assertOwned, isolateExecution } from "./_executionRouteIsolation.ts";

export interface AgyProcessFixture {
  root: string;
  generate: typeof generateViaAgy;
  prepare: typeof prepareImageExecution;
  ctx: RuntimeContext;
  configure(scenario: string, options?: Record<string, unknown>): Promise<void>;
  waitFor(event: string): Promise<Record<string, unknown>>;
  spawnCount(): number;
  observations(): readonly Record<string, unknown>[];
  diagnostics(error?: unknown): string;
  track<T>(work: Promise<T>): Promise<T>;
  close(): Promise<void>;
  node(signal?: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }>;
}

const WATCHDOG_MS = 10_000;
const DRAIN_MS = 3_000;
const DIAGNOSTIC_TEXT_LIMIT = 2_048;
const SCENARIOS = new Set(["success", "malformed-result", "no-artifact", "unparseable",
  "unparseable-with-recent-artifact", "error", "quota", "outside-path", "cooperative-wait",
  "term-ignored-wait", "stderr-result", "saved-path", "nonzero", "raw-quota", "tiny-overflow"]);
type ArtifactPolicy = Readonly<{ maxBytes: number; chunkBytes: number }>;
let policyKey: string | undefined;
type Observation = Record<string, unknown>;
type Isolation = Awaited<ReturnType<typeof isolateExecution>>;
type NativeSpawn = typeof childProcess.spawn;
interface NativeChild {
  child: ChildProcessWithoutNullStreams;
  kill: ChildProcessWithoutNullStreams["kill"];
  closed: boolean;
  close: Promise<void>;
  paths: string[];
  stderr: string;
  stderrTruncated: boolean;
}
interface State {
  root: string;
  executable: string;
  executableSource: string;
  isolation: Isolation;
  nativeSpawn: NativeSpawn;
  setTimer: typeof setTimeout;
  clearTimer: typeof clearTimeout;
  children: NativeChild[];
  controllers: Set<AbortController>;
  pending: Set<Promise<unknown>>;
  lastFailure: unknown;
  observations: Observation[];
  listeners: Set<() => void>;
  restorations: Array<() => void>;
  cursor: number;
  closing: boolean;
  restored: boolean;
}

function observe(state: State, value: Observation): void {
  state.observations.push({ ...value, sequence: state.observations.length });
  for (const listener of state.listeners) listener();
}

function diagnostics(state: State, error: unknown = state.lastFailure): string {
  const text = (value: unknown) => typeof value === "string" ? value.slice(0, DIAGNOSTIC_TEXT_LIMIT) : value;
  const primary = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const events = state.observations.slice(state.cursor).filter((entry) =>
    ["phase", "input", "ready", "fixture-error", "violation", "process-error", "watchdog", "close"].includes(String(entry.event)));
  // Fixed owned child only. Never serialize prompts, reference bytes, argv or environment.
  return JSON.stringify({ primary: { name: text(primary.name), message: text(primary.message),
    code: text(primary.code), status: primary.status }, events: events.slice(-24).map((entry) => ({
    event: entry.event, phase: entry.phase, pid: entry.pid, code: entry.code, signal: entry.signal,
    message: text(entry.message), stderr: text(entry.stderr), stderrTruncated: entry.stderrTruncated,
    refsExist: entry.refsExist, sequence: entry.sequence,
  })) });
}

function track<T>(state: State, work: Promise<T>): Promise<T> {
  state.pending.add(work);
  void work.then(() => state.pending.delete(work), (error) => {
    state.lastFailure = error;
    state.pending.delete(work);
  });
  return work;
}

async function bounded<T>(state: State, work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = state.setTimer(() => reject(new Error(`${label}; root=${state.root}; pids=${
        state.children.filter((entry) => !entry.closed).map((entry) => entry.child.pid).join(",")}`)), DRAIN_MS);
    })]);
  } finally { if (timer) state.clearTimer(timer); }
}

function waitFor(state: State, event: string): Promise<Observation> {
  let listener: (() => void) | undefined;
  const work = new Promise<Observation>((resolve) => {
    listener = () => {
      const found = state.observations.slice(state.cursor).find((entry) => entry.event === event);
      if (found) resolve(found);
    };
    state.listeners.add(listener);
    listener();
  });
  return bounded(state, work, `Missing Agy fixture event ${event}`).finally(() => {
    if (listener) state.listeners.delete(listener);
  });
}

function validateSpawn(state: State, executable: string, args: readonly string[], options: SpawnOptions): void {
  try {
    assert.equal(state.closing, false, "Fixture is closing");
    assert.equal(executable, state.executable, "Only the fixed owned executable may run");
    assert.ok(existsSync(executable));
    assert.ok(lstatSync(executable).isFile(), "Fixture executable must not be a symlink");
    assert.equal(readFileSync(executable, "utf8"), state.executableSource, "Fixture executable was replaced");
    assert.deepEqual(args, ["-p", "-"]);
    assert.deepEqual(Object.keys(options).sort(), ["env", "stdio"]);
    assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    assert.deepEqual(options.env, {
      PATH: `${dirname(state.executable)}${delimiter}${dirname(process.execPath)}`,
      HOME: state.root, USERPROFILE: state.root, TMPDIR: state.root, TEMP: state.root,
      LANG: "C", GEMINI_API_KEY: undefined,
    });
  } catch (error) { state.isolation.violations.push(error); throw error; }
}

function consumeReceipts(state: State, entry: NativeChild): { drain(): void; close(): void } {
  const path = join(state.root, "agy-observations.jsonl");
  const received: Observation[] = [];
  const message = (value: unknown) => {
    try {
      assert.ok(value && typeof value === "object");
      const packet = value as { channel?: unknown; receipt?: Observation };
      assert.equal(packet.channel, "agy-fixture");
      const receipt = packet.receipt;
      assert.ok(receipt && typeof receipt.event === "string");
      assert.equal(receipt.pid, entry.child.pid);
      if (receipt.event === "input") entry.paths = receipt.paths as string[];
      if (receipt.event === "violation" || receipt.event === "fixture-error") {
        state.isolation.violations.push(new Error(`Child fixture failure: ${JSON.stringify(receipt)}`));
      }
      received.push(receipt);
      observe(state, receipt);
    } catch (error) { state.isolation.violations.push(error); }
  };
  entry.child.on("message", message);
  return {
    drain() {
      const persisted = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      assert.deepEqual(received, persisted, "Native IPC and independent file receipts must agree");
    },
    close() {
      entry.child.removeListener("message", message);
    }
  };
}

function retainChild(state: State, child: ChildProcessWithoutNullStreams): NativeChild {
  let resolveClose!: () => void;
  const entry: NativeChild = { child, kill: child.kill.bind(child), closed: false, paths: [], stderr: "", stderrTruncated: false,
    close: new Promise<void>((resolve) => { resolveClose = resolve; }) };
  state.children.push(entry);
  const onStderr = (chunk: Buffer) => {
    const remaining = DIAGNOSTIC_TEXT_LIMIT - entry.stderr.length;
    entry.stderr += chunk.subarray(0, remaining).toString();
    if (chunk.length > remaining) entry.stderrTruncated = true;
  };
  child.stderr.on("data", onStderr);
  let receipts: ReturnType<typeof consumeReceipts> | undefined;
  const watchdog = state.setTimer(() => {
    if (entry.closed) return;
    state.isolation.violations.push(new Error(`Native Agy watchdog reaped pid=${child.pid}; root=${state.root}`));
    observe(state, { event: "watchdog", pid: child.pid });
    entry.kill("SIGKILL");
  }, WATCHDOG_MS);
  child.once("close", (code, signal) => {
    try { receipts?.drain(); } catch (error) { state.isolation.violations.push(error); }
    receipts?.close();
    child.stderr.removeListener("data", onStderr);
    entry.closed = true;
    state.clearTimer(watchdog);
    observe(state, { event: "close", pid: child.pid, code, signal,
      stderr: entry.stderr, stderrTruncated: entry.stderrTruncated,
      paths: [...entry.paths], refsExist: entry.paths.map((path) => existsSync(path)) });
    resolveClose();
  });
  child.once("error", (error) => observe(state, { event: "process-error", message: error.message,
    code: Reflect.get(error, "code") }));
  const kill = child.kill.bind(child);
  child.kill = (signal) => {
    observe(state, { event: "kill", signal: signal ?? "SIGTERM", pid: child.pid });
    return kill(signal);
  };
  try { receipts = consumeReceipts(state, entry); }
  catch (error) { state.isolation.violations.push(error); entry.kill("SIGKILL"); throw error; }
  return entry;
}

function installSpawn(state: State): void {
  const guarded = mock.method(childProcess, "spawn", (executable: string, args: string[], options: SpawnOptions) => {
    validateSpawn(state, executable, args, options);
    // Windows uses a fixed Node bridge, NOT a claim about native agy.cmd launch.
    const command = process.platform === "win32" ? process.execPath : state.executable;
    const argv = process.platform === "win32" ? [state.executable, ...args] : args;
    // The test bridge adds a private receipt channel AFTER validating the DUT's
    // exact three stdio pipes. Native stdout/stderr stay untouched; no fs.watch race.
    const child = state.nativeSpawn(command, argv, { ...options, cwd: state.root,
      stdio: ["pipe", "pipe", "pipe", "ipc"], shell: false }) as ChildProcessWithoutNullStreams;
    retainChild(state, child);
    return child;
  });
  state.restorations.push(() => guarded.mock.restore());
  syncBuiltinESMExports();
}

function isolateEnvironment(root: string): () => void {
  const saved = { ...process.env };
  const systemRoot = process.env.SystemRoot;
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith("IMA2_") && key !== "DOTENV_CONFIG_PATH") delete process.env[key];
  }
  Object.assign(process.env, { HOME: root, USERPROFILE: root, TMPDIR: root, TEMP: root, TMP: root,
    XDG_CONFIG_HOME: root, PATH: dirname(process.execPath), LANG: "C" });
  // Windows libuv supplies a missing child SystemRoot from the parent. Keep
  // only this OS prerequisite; the DUT's exact restricted env remains unchanged.
  if (process.platform === "win32" && systemRoot !== undefined) process.env.SystemRoot = systemRoot;
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  };
}

async function configure(state: State, scenario: string, options: Record<string, unknown> = {}): Promise<void> {
  try {
    assert.ok(SCENARIOS.has(scenario), `Unknown fixture scenario: ${scenario}`);
    assert.equal(state.children.some((entry) => !entry.closed), false, "Previous child still alive");
    assert.equal(state.pending.size, 0, "Previous operation still pending");
    assert.deepEqual(Object.keys(options), [], "No unrecognized child control options");
    state.cursor = state.observations.length;
    state.lastFailure = undefined;
    await rm(join(state.root, ".gemini", "antigravity-cli", "brain", "artifact"), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await writeFile(join(state.root, "agy-observations.jsonl"), "");
    await writeFile(join(state.root, "agy-control.json"), JSON.stringify({ scenario }));
  } catch (error) { throw error; }
}

function ownedSignal(state: State, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  state.controllers.add(controller);
  return signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
}

async function close(state: State): Promise<void> {
  if (state.restored) return;
  state.closing = true;
  for (const controller of state.controllers) controller.abort();
  for (const entry of state.children) if (!entry.closed) entry.kill("SIGKILL");
  // If either drain fails, retain traps/storage/handles; never restore under live work.
  await bounded(state, Promise.all(state.children.map((entry) => entry.close)), "Native child did not close");
  await bounded(state, Promise.allSettled([...state.pending]), "Agy operation did not drain");
  await state.isolation.imageTransport.drain();
  try {
    assert.deepEqual(state.isolation.violations, [], `Agy fixture violations before restoring protections; ${diagnostics(state)}`);
    assert.deepEqual(state.isolation.imageTransport.violations, []);
  } finally {
    // Restoring spawn exposes the shared DEFAULT-DENY guard, never native spawn.
    for (const restore of state.restorations.reverse()) restore();
    syncBuiltinESMExports();
    try { await state.isolation.close(); }
    catch (error) {
      throw new Error(`Agy fixture isolation teardown failed; ${diagnostics(state)}`, { cause: error });
    }
    finally { state.restored = true; }
  }
}

function isolateConfig(state: State, config: RuntimeContext["config"]): void {
  const saved = { storage: config.storage, mcp: config.mcp, log: config.log };
  config.storage = { ...config.storage, packageRoot: state.root, configDir: state.root,
    generatedDir: join(state.root, "generated"), trashDir: join(state.root, "trash"),
    dbPath: join(state.root, "test.db"), configFile: join(state.root, "config.json"),
    advertiseFile: join(state.root, "server.json"), generationRequestLogFile: join(state.root, "requests.json"),
    promptImportIndexCacheFile: join(state.root, "prompt-import-index.json"),
    promptImportDiscoveryRegistryFile: join(state.root, "prompt-import-discovery.json") };
  config.mcp = { ...config.mcp, tokenDir: join(state.root, "mcp"), snapshotDir: join(state.root, "mcp", "snapshots") };
  config.log = { ...config.log, level: "silent" };
  state.restorations.push(() => Object.assign(config, saved));
  for (const value of [...Object.values(config.storage), config.mcp.tokenDir, config.mcp.snapshotDir]) {
    if (typeof value === "string" && isAbsolute(value)) assertOwned(state.root, value);
  }
}

async function loadHandle(state: State, artifactPolicy?: ArtifactPolicy): Promise<AgyProcessFixture> {
  try {
    const configModule = await import("../config.ts");
    const { config } = configModule;
    isolateConfig(state, config);
    if (artifactPolicy) {
      const { default: defaultExport, ...namedExports } = configModule;
      const configured = mock.module(new URL("../config.ts", import.meta.url).href, {
        defaultExport,
        namedExports: { ...namedExports, AGY_ARTIFACT_POLICY: Object.freeze({ ...artifactPolicy }) },
      });
      state.restorations.push(() => configured.restore());
    }
    const { configureLogger } = await import("../lib/logger.ts");
    configureLogger({ level: "silent" });
    state.restorations.push(() => configureLogger({ level: "silent" }));
    const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
    const { generateViaAgy: generate } = await import("../lib/providers/adapters/agyOperations.ts");
    const { prepareImageExecution: prepare } = await import("../lib/providers/execution/index.ts");
    const ctx = createTestRuntimeContext({ rootDir: state.root, config });
    assertOwned(state.root, ctx.rootDir);
    for (const value of Object.values(ctx.config.storage)) {
      if (typeof value === "string" && isAbsolute(value)) assertOwned(state.root, value);
    }
    return { root: state.root, ctx,
      generate: (prompt, options = {}) => track(state, generate(prompt,
        { ...options, signal: ownedSignal(state, options.signal) })),
      prepare: async (context, request, progress) => {
        try {
          // Forward late field reads; copying request here would falsify classic capture tests.
          const forwarded = new Proxy(request, { get: (target, key, receiver) => key === "signal"
            ? ownedSignal(state, target.signal) : Reflect.get(target, key, receiver) });
          const prepared = await prepare(context, forwarded, progress);
          return { execute: () => track(state, prepared.execute()) };
        } catch (error) { throw error; }
      },
      configure: (scenario, options) => configure(state, scenario, options),
      waitFor: (event) => waitFor(state, event), spawnCount: () => state.children.length,
      observations: () => state.observations.slice(state.cursor),
      diagnostics: (error) => diagnostics(state, error),
      track: (work) => track(state, work), close: () => close(state),
      node: (signal) => track(state, runNode(state, ctx, signal)),
    };
  } catch (error) { throw error; }
}

export async function openAgyProcessFixture(artifactPolicy?: ArtifactPolicy): Promise<AgyProcessFixture> {
  const key = JSON.stringify(artifactPolicy ?? null);
  assert.ok(policyKey === undefined || policyKey === key, "Different policies require fresh isolated processes");
  policyKey = key;
  const nativeSpawn = childProcess.spawn;
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  const isolation = await isolateExecution();
  const root = await realpath(isolation.rootDir);
  const state: State = { root, executable: join(root, "bin", "agy-fixture.mjs"), executableSource: "", isolation,
    nativeSpawn, setTimer, clearTimer, children: [], controllers: new Set(), pending: new Set(), lastFailure: undefined,
    observations: [], listeners: new Set(), restorations: [], cursor: 0, closing: false, restored: false };
  try {
    state.restorations.push(isolateEnvironment(root));
    const home = mock.method(os, "homedir", () => root);
    const temp = mock.method(os, "tmpdir", () => root);
    state.restorations.push(() => home.mock.restore(), () => temp.mock.restore());
    syncBuiltinESMExports();
    assert.equal(os.homedir(), root); assert.equal(os.tmpdir(), root);
    await mkdir(dirname(state.executable));
    const source = await readFile(new URL("./fixtures/agy-fixture.mjs", import.meta.url), "utf8");
    assert.ok(!process.execPath.includes("\n"), "Invalid Node executable path");
    state.executableSource = `#!${process.execPath}\n${source}`;
    await writeFile(state.executable, state.executableSource);
    await chmod(state.executable, 0o700);
    process.env.IMA2_AGY_BIN = state.executable;
    installSpawn(state);
    await configure(state, "success");
    return await loadHandle(state, artifactPolicy);
  } catch (error) { await close(state); throw error; }
}

/** Invoke the real node handler/normalizer/persistence boundary; only HTTP framing is synthetic. */
async function runNode(state: State, ctx: RuntimeContext, signal?: AbortSignal) {
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const { runNodeGeneration } = await import("../lib/nodeGeneration.ts");
  const { abortJob } = await import("../lib/inflight.ts");
  const { closeDb } = await import("../lib/db.ts");
  state.restorations.push(closeDb);
  const requestId = "owned-agy-node";
  const cancel = () => { abortJob(requestId); };
  signal?.addEventListener("abort", cancel, { once: true });
  let status = 200;
  let body: Record<string, unknown> | undefined;
  // The handler's consumed Request/Response members, not a mocked execution result.
  const req = { body: { requestId, provider: "agy", prompt: "owned node prompt", mode: "direct",
    searchMode: "off", references: ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="] },
    headers: {}, get: () => undefined } as unknown as Request;
  const res = { status(value: number) { status = value; return this; },
    json(value: Record<string, unknown>) { assert.equal(body, undefined, "one HTTP response"); body = value; return this; },
    setHeader() {}, headersSent: false } as unknown as Response;
  try {
    await runNodeGeneration(req, res, ctx);
    assert.ok(body, "actual node handler produced an envelope");
    return { status, body };
  } finally { signal?.removeEventListener("abort", cancel); }
}
