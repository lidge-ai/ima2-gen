import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { after, before, describe, mock, test, type TestContext } from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import type { OpenaiRequest } from "../lib/providers/adapters/openaiExecution.ts";
import type { RuntimeContext } from "../lib/runtimeContext.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function held(signal?: AbortSignal | null): Promise<Response> {
  assert.ok(signal);
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
function observe<T>(promise: Promise<T>) {
  let settled = false;
  const outcome = promise.then(value => { settled = true; return { value }; },
    error => { settled = true; return { error: error as unknown }; });
  return { outcome, settled: () => settled };
}
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  t.mock.method(performance, "now", () => Date.now());
}
function timeout(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal(Reflect.get(error, "code"), "OAUTH_IMAGE_TIMEOUT");
  assert.equal(Reflect.get(error, "status"), 504);
}
function request(surface: "classic" | "node" | "multimode", provider: "oauth" | "api" = "oauth", signal = new AbortController().signal): OpenaiRequest {
  const base = { provider, requestId: undefined, signal,
    prompt: "synthetic", rawPrompt: "synthetic", references: [], nai: {},
    options: { model: provider === "api" ? "gpt-6.1-terra" : "gpt-6-luna", quality: "high", size: "1024x1024",
      moderation: "low", mode: "direct", reasoningEffort: "low", webSearchEnabled: false } as const };
  if (surface === "multimode") return { ...base, surface, providerUrl: null, maxImages: 1 };
  return surface === "classic"
    ? { ...base, surface, providerUrl: null, background: null, backgroundConstraint: undefined, comfy: {} }
    : { ...base, surface, sourceImage: null, contextMode: "parent-plus-refs", searchMode: "off", partialImages: 0 };
}

if (executionTestProcess(import.meta.url)) describe("prepared OAuth execution deadline", { concurrency: false }, () => {
  let prepare: typeof import("../lib/providers/adapters/openaiExecution.ts").prepareOpenaiExecution;
  let ctx: RuntimeContext;
  let upstream: (path: string, init: RequestInit) => Promise<Response>;
  const originalFetch = globalThis.fetch;
  before(async () => {
    mock.module("../lib/inflight.js", { namedExports: { setJobPhase() {}, isJobCanceled: () => false } });
    mock.module("../lib/codexBackend/index.js", { namedExports: {
      oauthFetch: (_ctx: unknown, path: string, init: RequestInit) => upstream(path, init),
    } });
    globalThis.fetch = async (input, init) => upstream(String(input), init ?? {});
    const { config } = await import("../config.ts");
    const { requireRuntimeContext } = await import("../lib/runtimeContext.ts");
    ({ prepareOpenaiExecution: prepare } = await import("../lib/providers/adapters/openaiExecution.ts"));
    ctx = requireRuntimeContext({ apiKey: "sk-synthetic-fixture", oauthReadyState: "ready", oauthTransport: "proxy",
      oauthUrl: "http://fixture.invalid", config: { ...config, oauth: { ...config.oauth, generationTimeoutMs: 100 } } });
  });
  after(() => { mock.restoreAll(); globalThis.fetch = originalFetch; });

  for (const surface of ["classic", "node"] as const) {
    test(`${surface} retry after a transient error uses only the remaining budget`, async t => {
      clock(t);
      const firstEntered = deferred<void>(), secondEntered = deferred<void>(), first = deferred<Response>();
      let calls = 0;
      upstream = async (_path, init) => {
        calls++;
        if (calls === 1) { firstEntered.resolve(); return first.promise; }
        secondEntered.resolve(); return held(init.signal);
      };
      const execution = await prepare(ctx, request(surface));
      let work = observe(execution.execute());
      await firstEntered.promise;
      t.mock.timers.tick(60); first.resolve(new Response("{}", { status: 500 }));
      if (surface === "node") { await work.outcome; work = observe(execution.execute()); }
      await secondEntered.promise;
      try {
        t.mock.timers.tick(40); await turn();
        assert.equal(work.settled(), true, "retry must end at job 100ms, not receive another 100ms");
        const result = await work.outcome; assert.ok("error" in result); timeout(result.error);
        assert.equal(calls, 2);
      } finally { t.mock.timers.tick(1000); await work.outcome; }
    });
  }

  test("expired prepared node execution cannot send another request", async t => {
    clock(t);
    let calls = 0;
    const entered = deferred<void>();
    upstream = async (_path, init) => { calls++; entered.resolve(); return held(init.signal); };
    const execution = await prepare(ctx, request("node"));
    const first = observe(execution.execute());
    await entered.promise; t.mock.timers.tick(100); await first.outcome;
    const retry = observe(execution.execute());
    try {
      await turn(); assert.equal(calls, 1, "exhausted job must refuse before upstream");
      assert.equal(retry.settled(), true);
      const result = await retry.outcome; assert.ok("error" in result); timeout(result.error);
    } finally { t.mock.timers.tick(1000); await retry.outcome; }
  });

  test("preparation does not start time and a new prepared job has a fresh budget", async t => {
    clock(t);
    let calls = 0;
    let entered = deferred<void>();
    upstream = async (_path, init) => { calls++; entered.resolve(); return held(init.signal); };
    const firstExecution = await prepare(ctx, request("node"));
    t.mock.timers.tick(20);
    const first = observe(firstExecution.execute()); await entered.promise;
    t.mock.timers.tick(80); await turn(); assert.equal(first.settled(), false);
    t.mock.timers.tick(20); await first.outcome;
    entered = deferred<void>();
    const secondExecution = await prepare(ctx, request("node"));
    const second = observe(secondExecution.execute()); await entered.promise;
    try {
      t.mock.timers.tick(80); await turn(); assert.equal(second.settled(), false);
      t.mock.timers.tick(20);
      const result = await second.outcome; assert.ok("error" in result); timeout(result.error);
      assert.equal(calls, 2);
    } finally { t.mock.timers.tick(1000); await second.outcome; }
  });

  test("concurrent calls of the same prepared batch share its absolute expiry", async t => {
    clock(t);
    const firstEntered = deferred<void>(), secondEntered = deferred<void>();
    let calls = 0;
    upstream = async (_path, init) => {
      calls++; (calls === 1 ? firstEntered : secondEntered).resolve(); return held(init.signal);
    };
    const execution = await prepare(ctx, request("classic"));
    const first = observe(execution.execute()); await firstEntered.promise;
    t.mock.timers.tick(60);
    const second = observe(execution.execute()); await secondEntered.promise;
    try {
      t.mock.timers.tick(40); await turn();
      assert.equal(first.settled(), true); assert.equal(second.settled(), true);
      for (const result of await Promise.all([first.outcome, second.outcome])) {
        assert.ok("error" in result); timeout(result.error);
      }
      assert.equal(calls, 2);
    } finally { t.mock.timers.tick(1000); await Promise.all([first.outcome, second.outcome]); }
  });

  for (const wallJump of [-1_000_000, 1_000_000]) {
    test(`wall-clock jump ${wallJump} does not alter the monotonic budget`, async t => {
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
      let monotonic = 0, wall = 0, calls = 0;
      t.mock.method(performance, "now", () => monotonic);
      t.mock.method(Date, "now", () => wall);
      const firstEntered = deferred<void>(), secondEntered = deferred<void>(), first = deferred<Response>();
      upstream = async (_path, init) => {
        calls++;
        if (calls === 1) { firstEntered.resolve(); return first.promise; }
        secondEntered.resolve(); return held(init.signal);
      };
      const execution = await prepare(ctx, request("node"));
      const attempt = observe(execution.execute()); await firstEntered.promise;
      monotonic = 60; wall = wallJump; t.mock.timers.tick(60);
      first.resolve(new Response("{}", { status: 500 })); await attempt.outcome;
      const retry = observe(execution.execute()); await secondEntered.promise;
      try {
        monotonic = 100; t.mock.timers.tick(40); await turn();
        assert.equal(retry.settled(), true, "epoch clock must not change remaining 40ms");
        const result = await retry.outcome; assert.ok("error" in result); timeout(result.error);
      } finally { monotonic = 1100; t.mock.timers.tick(1000); await retry.outcome; }
    });
  }

  test("known parent cancellation wins before an expired retry can send work", async t => {
    clock(t);
    let calls = 0;
    const entered = deferred<void>(), parent = new AbortController();
    upstream = async (_path, init) => { calls++; entered.resolve(); return held(init.signal); };
    const execution = await prepare(ctx, request("node", "oauth", parent.signal));
    const first = observe(execution.execute()); await entered.promise;
    t.mock.timers.tick(100); await first.outcome;
    parent.abort(new Error("private cancellation detail"));
    await assert.rejects(execution.execute(), error => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "code"), "GENERATION_CANCELED");
      assert.equal(Reflect.get(error, "status"), 499);
      assert.doesNotMatch(error.message, /private/); return true;
    });
    assert.equal(calls, 1);
  });

  test("active parent cancellation reaches the derived signal and removes its listener", async t => {
    clock(t);
    const parent = new AbortController(), entered = deferred<AbortSignal>();
    const before = getEventListeners(parent.signal, "abort").length;
    upstream = async (_path, init) => {
      assert.ok(init.signal); entered.resolve(init.signal); return held(init.signal);
    };
    const execution = await prepare(ctx, request("node", "oauth", parent.signal));
    const work = observe(execution.execute()), signal = await entered.promise;
    assert.notEqual(signal, parent.signal); assert.equal(signal.aborted, false);
    parent.abort(new Error("private caller detail"));
    const result = await work.outcome; assert.ok("error" in result);
    assert.ok(result.error instanceof Error);
    assert.equal(Reflect.get(result.error, "code"), "GENERATION_CANCELED");
    assert.equal(Reflect.get(result.error, "status"), 499);
    assert.equal(signal.aborted, true); assert.doesNotMatch(result.error.message, /private/);
    assert.equal(getEventListeners(parent.signal, "abort").length, before);
  });

  test("prepared deadline still awaits an entered persistence callback", async t => {
    clock(t);
    const entered = deferred<void>(), persist = deferred<void>();
    upstream = async () => Response.json({ data: [{ b64_json: "synthetic-image" }] });
    const execution = await prepare(ctx, request("multimode"), {
      onFinalImage: async () => { entered.resolve(); await persist.promise; },
    });
    const work = observe(execution.execute()); await entered.promise;
    try {
      t.mock.timers.tick(100); await turn();
      assert.equal(work.settled(), false, "outer budget must not race local persistence");
    } finally { persist.resolve(); }
    const result = await work.outcome; assert.ok("value" in result);
    assert.ok(result.value.kind === "sequence"); assert.equal(result.value.value.images.length, 1);
  });

  for (const provider of ["oauth", "api"] as const) {
    test(`${provider} classic keeps scalar capture at preparation`, async t => {
      clock(t);
      const bodies: Array<{ model: string; input: unknown }> = [];
      upstream = async (_path, init) => {
        bodies.push(JSON.parse(String(init.body)) as { model: string; input: unknown });
        return new Response("{}", { status: 500 });
      };
      const input = request("classic", provider);
      input.options = { ...input.options, mode: "auto" };
      const execution = await prepare(ctx, input);
      input.prompt = "mutated-caller-prompt";
      input.options = { ...input.options, mode: "direct", model: "mutated-model" };
      await assert.rejects(execution.execute());
      assert.equal(bodies.length, 2);
      for (const body of bodies) {
        assert.equal(body.model, provider === "api" ? "gpt-6.1-terra" : "gpt-6-luna");
        assert.match(JSON.stringify(body.input), /synthetic/);
        assert.doesNotMatch(JSON.stringify(body.input), /mutated-caller-prompt/);
      }
    });
  }

  test("API still observes the live caller signal on each internal attempt", async t => {
    clock(t);
    const input = request("classic", "api"), nextParent = new AbortController();
    const aborted: boolean[] = [];
    upstream = async (_path, init) => {
      aborted.push(init.signal?.aborted === true);
      if (aborted.length === 1) {
        input.signal = nextParent.signal; nextParent.abort();
        return new Response("{}", { status: 500 });
      }
      throw new DOMException("aborted", "AbortError");
    };
    const execution = await prepare(ctx, input);
    await assert.rejects(execution.execute(), error => {
      assert.ok(error instanceof Error); assert.equal(Reflect.get(error, "status"), 499); return true;
    });
    assert.deepEqual(aborted, [false, true]);
  });

  test("API preparation retains the existing per-attempt timeout policy", async t => {
    clock(t);
    const firstEntered = deferred<void>(), secondEntered = deferred<void>(), first = deferred<Response>();
    let calls = 0;
    upstream = async (_path, init) => {
      calls++;
      if (calls === 1) { firstEntered.resolve(); return first.promise; }
      secondEntered.resolve(); return held(init.signal);
    };
    const execution = await prepare(ctx, request("classic", "api"));
    const work = observe(execution.execute()); await firstEntered.promise;
    t.mock.timers.tick(60); first.resolve(new Response("{}", { status: 500 })); await secondEntered.promise;
    try {
      t.mock.timers.tick(40); await turn(); assert.equal(work.settled(), false);
      t.mock.timers.tick(60);
      const result = await work.outcome; assert.ok("error" in result);
      assert.ok(result.error instanceof Error); assert.equal(Reflect.get(result.error, "status"), 504);
      assert.equal(calls, 2);
    } finally { t.mock.timers.tick(1000); await work.outcome; }
  });
});
