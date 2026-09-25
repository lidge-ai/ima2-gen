import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import type { Express, RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RuntimeContext } from "../lib/runtimeContext.ts";
import { assertOwned, isolateExecution } from "./_executionRouteIsolation.ts";
import { bounded, drain, installTrackedWrites, PromiseTracker, SettlementTimeout } from "./_executionTrackedWrites.ts";
import { listenOwnedLoopback, type ImageTransportFixture } from "./_grokImageTransportFixture.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

export type Surface = "classic" | "node" | "multimode" | "edit";
export interface UpstreamCall {
  url: string; method: string; headers: Headers; body: string;
  /** Exact request bytes: multipart image uploads do not survive the text decode in `body`. */
  raw?: Uint8Array | undefined;
  signal: AbortSignal | undefined;
}
export interface RecordedEvent { event: string; data: Record<string, unknown> }
export interface RouteCase {
  requestId: string; generatedDir: string; ctx: RuntimeContext;
  calls: readonly UpstreamCall[]; events: readonly RecordedEvent[];
  readonly imageTransportCalls: ImageTransportFixture["calls"];
  readonly imageResolutions: ImageTransportFixture["resolutions"];
  post(body: Record<string, unknown>, headers?: Record<string, string>): Promise<Response>;
  waitFor(predicate: (event: RecordedEvent) => boolean, timeoutMs?: number): Promise<RecordedEvent>;
  waitTerminal(timeoutMs?: number): Promise<RecordedEvent>;
  waitSettled(timeoutMs?: number): Promise<void>;
  trackWork<T>(work: Promise<T>): Promise<T>;
  cancel(): void;
}
interface RunOptions {
  upstream: (call: UpstreamCall) => Response | Promise<Response>;
  context?: Partial<Omit<RuntimeContext, "config" | "rootDir">>;
}
export interface RouteHarness {
  run(surface: Surface, options: RunOptions, body: (fixture: RouteCase) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

const endpoints: Record<Surface, string> = {
  classic: "/api/generate", node: "/api/node/generate", multimode: "/api/generate/multimode", edit: "/api/edit",
};
const imageHosts = Object.fromEntries(["cdn.x.ai", "fixture.invalid", "artifact.fixture.invalid"].map(
  (hostname) => [hostname, [{ address: "8.8.8.8", family: 4 as const }]]));

export function responsesSse(events: readonly unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  });
}

function journal() {
  const events: RecordedEvent[] = [];
  const listeners = new Set<(event: RecordedEvent) => void>();
  const cancellations = new Set<() => void>();
  function waitFor(predicate: (event: RecordedEvent) => boolean, timeoutMs = 5000): Promise<RecordedEvent> {
    const found = events.find(predicate);
    if (found) return Promise.resolve(found);
    let listener: (event: RecordedEvent) => void;
    let cancel: () => void;
    const work = new Promise<RecordedEvent>((resolve, reject) => {
      listener = (event) => { if (predicate(event)) resolve(event); };
      cancel = () => reject(new Error("Route fixture closed with pending event waiter"));
      listeners.add(listener); cancellations.add(cancel);
    });
    return bounded(work, timeoutMs).finally(() => { listeners.delete(listener); cancellations.delete(cancel); });
  }
  return { events, waitFor, append(event: RecordedEvent) {
    events.push(event);
    for (const listener of listeners) listener(event);
  }, close() { for (const cancel of cancellations) cancel(); } };
}

/** Registration stays real; only observe the actual promise returned by each POST handler. */
function trackPostHandlers(app: Express, handlers: PromiseTracker): void {
  const post = app.post.bind(app);
  // These four registrations use a literal path and ordinary handlers, not nested middleware arrays.
  app.post = ((path: string, ...callbacks: RequestHandler[]) => post(path, ...callbacks.map((callback) =>
    ((req, res, next) => {
      const result = callback(req, res, next);
      if (result instanceof Promise) handlers.track(result);
      return result;
    }) satisfies RequestHandler))) as Express["post"];
}

async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await bounded(closed);
}

async function loadRuntime(rootDir: string) {
  const { config } = await import("../config.ts");
  for (const key of ["configDir", "dbPath", "generatedDir", "trashDir", "generationRequestLogFile"] as const) {
    assertOwned(rootDir, config.storage[key]);
  }
  (await import("../lib/logger.ts")).configureLogger({ level: "silent" });
  const runtime = await import("../lib/runtimeContext.ts");
  const db = await import("../lib/db.ts");
  try {
    const inflight = await import("../lib/inflight.ts");
    const bus = await import("../lib/eventBus.ts");
    const registrations = {
      classic: (await import("../routes/generate.ts")).registerGenerateRoutes,
      node: (await import("../routes/nodes.ts")).registerNodeRoutes,
      multimode: (await import("../routes/multimode.ts")).registerMultimodeRoutes,
      edit: (await import("../routes/edit.ts")).registerEditRoutes,
    };
    return { config, runtime, inflight, db, bus, registrations };
  } catch (error) { db.closeDb(); throw error; }
}

async function normalizeCall(input: string | URL | Request, init?: RequestInit): Promise<UpstreamCall> {
  const request = new Request(input, init);
  const raw = new Uint8Array(await request.arrayBuffer());
  return { url: request.url, method: request.method, headers: request.headers,
    body: new TextDecoder().decode(raw), raw, signal: init?.signal ?? (input instanceof Request ? input.signal : undefined) };
}

export async function openRouteHarness(): Promise<RouteHarness> {
  const isolation = await isolateExecution();
  let restoreWrites: (() => void) | undefined;
  let modules: Awaited<ReturnType<typeof loadRuntime>>;
  // The `grok` lane reads ~/.progrok/auth.json. Seed an isolated HOME once per harness so
  // no case can reach the developer's real xAI session or its live token endpoint.
  const grokAuth = seedGrokAuth();
  try {
    restoreWrites = await installTrackedWrites();
    modules = await loadRuntime(isolation.rootDir);
  } catch (error) {
    try { restoreWrites?.(); } finally { grokAuth.cleanup(); await isolation.close(); }
    throw error;
  }
  let sequence = 0;
  let cleanup: (() => Promise<void>) | undefined;
  let closed = false;
  async function run(surface: Surface, options: RunOptions, body: (fixture: RouteCase) => Promise<void>) {
    assert.ok(!closed && !cleanup, "Harness is closed, active, or retaining unsettled work");
    const requestId = `execution-${++sequence}`;
    const generatedDir = join(isolation.rootDir, requestId);
    let server: Server | undefined;
    let unsubscribe: (() => void) | undefined;
    let setupComplete = false;
    const inactiveFetch = globalThis.fetch;
    try {
    await mkdir(generatedDir);
    modules.inflight._resetForTests();
    const calls: UpstreamCall[] = [];
    const violations: unknown[] = [];
    const upstream = async (call: UpstreamCall) => {
      calls.push(call);
      try { return await options.upstream(call); }
      catch (error) {
        // Only the exact known abort reason is expected; cancellation cannot hide fixture failures.
        if (!(call.signal?.aborted && error === call.signal.reason)) violations.push(error);
        throw error;
      }
    };
    globalThis.fetch = async (input, init) => {
      let call: UpstreamCall;
      try { call = await normalizeCall(input, init); }
      catch (error) { violations.push(error); throw error; }
      return upstream(call);
    };
    isolation.imageTransport.activate({ hosts: imageHosts, respond: upstream });
    const ctx = modules.runtime.createTestRuntimeContext({
      apiKey: "sk-execution-fixture", oauthReadyState: "ready", oauthUrl: "http://oauth-fixture.invalid",
      grokAuthHomeDir: grokAuth.homeDir, ...options.context,
      rootDir: isolation.rootDir,
      config: { ...modules.config, storage: { ...modules.config.storage, generatedDir } },
    });
    const entries = journal();
    unsubscribe = modules.bus.subscribe((entry) => { if (entry.jobId === requestId) entries.append(entry); });
    const handlers = new PromiseTracker();
    const app = express();
    app.use(express.json({ limit: "16mb" }));
    trackPostHandlers(app, handlers);
    modules.registrations[surface](app, ctx);
    server = listenOwnedLoopback(() => app.listen(0, "127.0.0.1"));
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${endpoints[surface]}`;
    const waitSettled = async (timeoutMs = 5000) => {
      const start = Date.now();
      let handlerError: unknown;
      try { await handlers.drain(timeoutMs); } catch (error) {
        if (error instanceof SettlementTimeout) throw error;
        handlerError = error;
      }
      await drain(Math.max(1, timeoutMs - (Date.now() - start)));
      await isolation.imageTransport.drain(Math.max(1, timeoutMs - (Date.now() - start)));
      if (handlerError) throw handlerError;
    };
    const cancel = () => { modules.inflight.abortJob(requestId); };
    cleanup = async () => {
      if (modules.inflight.listJobs().some((job) => job.requestId === requestId)) cancel();
      let failure: unknown;
      try { await waitSettled(); } catch (error) {
        if (error instanceof SettlementTimeout) throw error; // Keep traps, root, subscription and server.
        failure = error;
      }
      await isolation.imageTransport.deactivate();
      entries.close(); unsubscribe?.();
      await closeServer(server);
      modules.inflight._resetForTests();
      await rm(generatedDir, { recursive: true, force: true });
      cleanup = undefined;
      globalThis.fetch = inactiveFetch;
      assert.deepEqual(violations, [], "Unmatched upstream calls (even if caught by the route)");
      assert.deepEqual(isolation.imageTransport.violations, [], "Unmatched pinned image transport calls");
      assert.deepEqual(isolation.violations, [], "Unmatched isolation boundary calls");
      if (failure) throw failure;
    };
    setupComplete = true;
      await body({ requestId, generatedDir, ctx, calls, events: entries.events,
        imageTransportCalls: isolation.imageTransport.calls, imageResolutions: isolation.imageTransport.resolutions,
        post: (payload, headers = {}) => isolation.fetchOwned(server!, url, { method: "POST",
          headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ ...payload, requestId }) }),
        waitFor: entries.waitFor, waitTerminal: (timeoutMs) => entries.waitFor((event) => event.event === "done" || event.event === "error", timeoutMs),
        waitSettled, cancel,
        trackWork: <T>(work: Promise<T>): Promise<T> => {
          handlers.track(work.then(() => undefined, () => undefined));
          return work;
        },
      });
    } finally {
      if (setupComplete) await cleanup?.();
      else {
        await isolation.imageTransport.deactivate();
        unsubscribe?.();
        try { if (server?.listening) await closeServer(server); }
        finally {
          globalThis.fetch = inactiveFetch;
          modules.inflight._resetForTests();
          await rm(generatedDir, { recursive: true, force: true });
        }
      }
    }
  }
  return { run, async close() {
    if (closed) return;
    let failure: unknown;
    try { await cleanup?.(); await drain(); }
    catch (error) {
      if (error instanceof SettlementTimeout) throw error;
      failure = error;
    }
    try { modules.db.closeDb(); restoreWrites?.(); }
    finally { grokAuth.cleanup(); await isolation.close(); closed = true; }
    if (failure) throw failure;
  } };
}
