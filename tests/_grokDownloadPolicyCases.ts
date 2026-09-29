import assert from "node:assert/strict";
import dns from "node:dns";
import promiseDns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { EventEmitter, getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { mock, type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PUBLIC_IMAGE = "https://artifact.fixture.invalid/image";
export const PUBLIC_NEXT = "https://cdn.fixture.invalid/image";
export const LOCAL_ORIGIN = "http://private.fixture.invalid:43210";
export const IMAGE_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
export type Address = { address: string; family: 4 | 6 };
export type Download = (url: string, signal?: AbortSignal, timeoutMs?: number,
  policy?: { trustedProxyOrigin?: string }) => Promise<{ buffer: Buffer; b64: string; mime: string }>;

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** An event-turn drain, never a timeout used as evidence of DNS settlement. */
export async function eventTurn(): Promise<void> {
  try { await new Promise<void>((resolve) => setImmediate(resolve)); }
  catch (error) { throw error; }
}

export function downloadError(status = 502, code = "GROK_IMAGE_DOWNLOAD_FAILED") {
  return (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.equal(Reflect.get(error, "status"), status);
    assert.equal(Reflect.get(error, "code"), code);
    return true;
  };
}

export interface ResponsePlan {
  status?: number;
  headers?: Record<string, string>;
  chunks?: readonly Uint8Array[];
  holdBody?: boolean;
  headerGate?: Promise<void>;
  preheaderError?: Error;
  afterHeaders?: (exchange: Exchange) => void;
}

export interface Exchange {
  url: URL;
  options: http.RequestOptions & { servername?: string };
  request: FixtureRequest;
  response?: Readable & { statusCode: number; headers: Record<string, string> };
  ready: ReturnType<typeof deferred>;
  closed: ReturnType<typeof deferred>;
  reads: number;
  index: number;
}

class FixtureRequest extends EventEmitter {
  destroyed = false;
  constructor(private readonly start: () => void, private readonly onDestroy: () => void) { super(); }
  end() { this.start(); return this; }
  destroy(error?: Error) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.onDestroy();
    queueMicrotask(() => {
      if (error) this.emit("error", error);
      this.emit("close");
    });
    return this;
  }
}

type LookupResult = { error: unknown; address: string | Address[]; family: number | undefined };
async function lookupResult(exchange: Exchange, options: object, host?: string): Promise<LookupResult> {
  assert.equal(typeof exchange.options.lookup, "function", "pinned lookup must be supplied");
  try {
    return await new Promise((resolve) => {
      // Node lookup has overloaded callbacks; this fixture tests both documented shapes.
      const lookup = exchange.options.lookup as (...args: unknown[]) => void;
      lookup(host ?? exchange.url.hostname.replace(/^\[|\]$/g, ""), options,
        (error: unknown, address: string | Address[], family?: number) => resolve({ error, address, family }));
    });
  } catch (error) { throw error; }
}

async function verifyPinnedLookup(exchange: Exchange, expected: Address[]): Promise<void> {
  try {
    const all = await lookupResult(exchange, { all: true });
    assert.ifError(all.error);
    assert.ok(Array.isArray(all.address) && all.address.length > 0);
    assert.deepEqual(all.address, expected, "lookup returns only independently supplied DNS answers");
    for (const item of expected) {
      const single = await lookupResult(exchange, { family: item.family, all: false });
      assert.ifError(single.error);
      assert.equal(single.family, item.family);
      assert.ok(expected.some((entry) => entry.address === single.address));
      const familyAll = await lookupResult(exchange, { family: item.family, all: true });
      assert.ifError(familyAll.error);
      assert.deepEqual(familyAll.address, expected.filter((entry) => entry.family === item.family));
    }
    const absent = [4, 6].find((family) => !expected.some((item) => item.family === family));
    if (absent) {
      assert.ok((await lookupResult(exchange, { family: absent })).error, "no default DNS fallback");
      assert.ok((await lookupResult(exchange, { family: absent, all: true })).error);
    }
    assert.ok((await lookupResult(exchange, { family: 7, all: true })).error);
    assert.ok((await lookupResult(exchange, {}, "unowned.fixture.invalid")).error);
  } catch (error) { throw error; }
}

function responseStream(plan: ResponsePlan, exchange: Exchange) {
  let position = 0;
  const chunks = plan.chunks ?? [IMAGE_BYTES];
  const response = new Readable({ highWaterMark: 1, read() {
    exchange.reads++;
    if (position < chunks.length) this.push(chunks[position++]);
    else if (!plan.holdBody) this.push(null);
  } });
  return Object.assign(response, {
    statusCode: plan.status ?? 200,
    headers: { "content-type": "image/png", ...plan.headers },
  });
}

/** Special timing/event fixture, independent of active route fixtures; never delegates HTTP/DNS. */
export class DownloadNetwork {
  exchanges: Exchange[] = [];
  resolutions: string[] = [];
  order: string[] = [];
  violations: unknown[] = [];
  active = false;
  hosts: Record<string, Address[]> = {};
  resolve?: (hostname: string) => Promise<Address[]>;
  respond: (exchange: Exchange) => ResponsePlan = () => ({});
  private pending = new Set<Promise<void>>();
  private resolved = new Map<string, Address[]>();
  private restores: (() => void)[] = [];

  install() {
    const lookup = mock.method(promiseDns, "lookup", async (hostname: string) => {
      if (!this.active || !Object.hasOwn(this.hosts, hostname)) return this.deny(`DNS ${hostname}`);
      this.resolutions.push(hostname);
      const addresses = this.resolve ? await this.resolve(hostname) : this.hosts[hostname];
      this.resolved.set(hostname, addresses.map((address) => ({ ...address })));
      return addresses;
    });
    const defaultLookup = mock.method(dns, "lookup", () => this.deny("default DNS"));
    // Runtime argument/lookup validation above the EventEmitter boundary is deliberate:
    // this fake implements only the ClientRequest subset the public downloader consumes.
    const fakeRequest: (...args: unknown[]) => FixtureRequest = (...args) => this.open(args);
    const request = fakeRequest as unknown as typeof http.request;
    const httpMock = mock.method(http, "request", request);
    const httpsMock = mock.method(https, "request", request);
    const httpGet = mock.method(http, "get", () => this.deny("unplanned http.get"));
    const httpsGet = mock.method(https, "get", () => this.deny("unplanned https.get"));
    const fetchMock = mock.method(globalThis, "fetch", async () => this.deny("fetch fallback"));
    this.restores = [lookup, defaultLookup, httpMock, httpsMock, httpGet, httpsGet, fetchMock].map((fn) => () => fn.mock.restore());
    syncBuiltinESMExports();
    return this;
  }

  activate() {
    assert.deepEqual(this.violations, [], "Prior network violations prevent fixture activation");
    assert.equal(this.pending.size, 0);
    this.exchanges = []; this.resolutions = []; this.order = [];
    this.active = true; this.resolve = undefined; this.respond = () => ({});
    this.resolved.clear();
    this.hosts = {
      "artifact.fixture.invalid": [{ address: "8.8.8.8", family: 4 }],
      "cdn.fixture.invalid": [{ address: "1.1.1.1", family: 4 }],
      "private.fixture.invalid": [{ address: "127.0.0.1", family: 4 }],
    };
  }

  private deny(message: string): never {
    const error = new Error(`Unowned network attempt: ${message}`);
    this.violations.push(error);
    throw error;
  }

  private open(args: unknown[]) {
    try { return this.openChecked(args); }
    catch (error) { this.violations.push(error); throw error; }
  }

  private openChecked(args: unknown[]) {
    if (!this.active) return this.deny("inactive HTTP");
    const first = args[0];
    const url = first instanceof URL ? first : new URL(String(first));
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (!isIP(hostname) && !Object.hasOwn(this.hosts, hostname)) return this.deny(`HTTP ${hostname}`);
    const options = (typeof args[1] === "object" ? args[1] : {}) as Exchange["options"];
    assert.equal(options.agent, false, "pooling must be disabled");
    assert.ok(!options.method || options.method === "GET");
    const headers = new Headers(options.headers as Record<string, string>);
    for (const forbidden of ["authorization", "cookie", "referer"]) assert.equal(headers.has(forbidden), false);
    const callback = [...args].reverse().find((arg) => typeof arg === "function") as ((res: Readable) => void) | undefined;
    const index = this.exchanges.length;
    const request = new FixtureRequest(() => this.schedule(exchange), () => this.order.push(`destroy:${index}`));
    const exchange: Exchange = { url, options, request, index, reads: 0, ready: deferred(), closed: deferred() };
    request.once("close", () => { this.order.push(`close:${index}`); exchange.closed.resolve(undefined); });
    if (callback) request.once("response", callback);
    this.exchanges.push(exchange); this.order.push(`get:${index}`);
    return request;
  }

  private schedule(exchange: Exchange) {
    const task = this.deliver(exchange).catch((error) => {
      this.violations.push(error);
      exchange.request.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private async deliver(exchange: Exchange) {
    try {
      const hostname = exchange.url.hostname.replace(/^\[|\]$/g, "");
      const family = isIP(hostname);
      const expected = family ? [{ address: hostname, family: family as 4 | 6 }] : this.resolved.get(hostname);
      assert.ok(expected, "DNS must precede HTTP");
      await verifyPinnedLookup(exchange, expected);
      const plan = this.respond(exchange);
      if (plan.preheaderError) { exchange.request.destroy(plan.preheaderError); return; }
      if (plan.headerGate) await plan.headerGate;
      const response = responseStream(plan, exchange);
      exchange.response = response;
      response.once("close", () => this.order.push(`body-close:${exchange.index}`));
      // Deliberately emit even after destroy: the real downloader must close late responses.
      exchange.request.emit("response", response);
      exchange.ready.resolve(undefined);
      plan.afterHeaders?.(exchange);
    } catch (error) { throw error; }
  }

  async finish() {
    try {
      await Promise.all([...this.pending]);
      await eventTurn();
      assert.deepEqual(this.violations, [], "no swallowed fixture/network failures");
      for (const exchange of this.exchanges) {
        assert.equal(exchange.request.destroyed, true, `request ${exchange.index} leaked`);
        if (exchange.response) assert.equal(exchange.response.destroyed, true, `body ${exchange.index} leaked`);
      }
    } finally {
      this.active = false;
      for (const exchange of this.exchanges) { exchange.request.destroy(); exchange.response?.destroy(); }
    }
  }

  restore() { for (const restore of this.restores.reverse()) restore(); syncBuiltinESMExports(); }
}

export function observeProcessErrors(t: TestContext) {
  const events: unknown[] = [];
  const observe = (error: unknown) => { events.push(error); };
  process.on("uncaughtExceptionMonitor", observe);
  process.on("unhandledRejection", observe);
  t.after(() => {
    process.off("uncaughtExceptionMonitor", observe); process.off("unhandledRejection", observe);
    assert.deepEqual(events, [], "late Node errors/rejections are fatal, not ignored");
  });
  return events;
}

export function fakeClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const delays: number[] = [];
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback: () => void, ms: number) => {
    delays.push(ms);
    const timer = set(() => { pending.delete(timer); callback(); }, ms);
    pending.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => {
    pending.delete(timer); clear(timer);
  });
  const advance = async (ms: number) => {
    try { t.mock.timers.tick(ms); await eventTurn(); } catch (error) { throw error; }
  };
  return Object.assign(advance, { pending, delays });
}

export function assertNoCallerListeners(signal: AbortSignal) {
  assert.equal(getEventListeners(signal, "abort").length, 0, "caller abort listeners removed");
}

export function observeAbortSignals(t: TestContext) {
  const signals = new Set<AbortSignal>();
  const original = AbortSignal.prototype.addEventListener;
  t.mock.method(AbortSignal.prototype, "addEventListener", function (this: AbortSignal,
    type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (type === "abort") signals.add(this);
    original.call(this, type, listener, options);
  });
  return signals;
}

export async function isolateDownloadConfig() {
  const root = await mkdtemp(join(tmpdir(), "ima2-download-policy-"));
  const original = process.env.IMA2_CONFIG_DIR;
  try {
    await writeFile(join(root, "config.json"), "{}");
    process.env.IMA2_CONFIG_DIR = root;
    return async () => {
      if (original === undefined) delete process.env.IMA2_CONFIG_DIR;
      else process.env.IMA2_CONFIG_DIR = original;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    };
  } catch (error) { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); throw error; }
}
