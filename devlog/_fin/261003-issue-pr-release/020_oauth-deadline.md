# 020 — One deadline for a GPT OAuth image job (#351)

Status: implementation in progress. The approved [023 consumer amendment](023_timeout-consumers.md) supersedes ALL whole-job timeout codes and the initial boolean abort-constructor sketch below: job deadlines use OAUTH_IMAGE_TIMEOUT; standalone request timeouts retain RESPONSES_IMAGE_TIMEOUT. API preservation and local persistence boundaries remain mandatory.
Date: 2026-10-03. Baseline: origin/dev `862e0bd73f59a3b419503a9dec39b6f83ef2bed6`, verified with `git ls-remote`.
Issue: https://github.com/lidge-ai/ima2-gen/issues/351 (OPEN, no comments at inspection).
This document alone is the delegated write scope. Main owns roadmap, git, FSM, delivery and other docs.

## Outcome and scope

Bound planner, planner retry, every render and rate-limit waits by one deadline created at `runOAuthImageJob` entry. An elapsed job deadline is 504 / `OAUTH_IMAGE_TIMEOUT`; user cancellation remains 499 / `GENERATION_CANCELED`. Readiness waits must also observe that signal. API-key and other providers retain their existing timeout policy. No paid provider calls are needed to implement or verify this unit.

| Action | Path | Purpose |
|---|---|---|
| NEW | `lib/oauthJobDeadline.ts` | Dependency-free deadline, typed abort cause and abortable-await helpers |
| MODIFY | `lib/oauthImages.ts` | Own one lifetime around the existing job body; share its timeout with retry budget |
| MODIFY | `lib/responsesTransport.ts` | Preserve abort reason, interrupt readiness/request/body waits and retain timeout taxonomy |
| MODIFY | `lib/oauthProxy/runtime.ts` | Optional signal for readiness; clear readiness timer/listener after settlement |
| MODIFY | `lib/oauthRateLimit.ts` | Preserve deadline reason during backoff; refuse work after abort |
| NEW | `tests/oauth-job-timeout.test.ts` | Fake-clock runtime regression, denied real network and mocked backend |
| MODIFY | `docs/migration/runtime-test-inventory.md` | Regenerate inventory after new test exists |
| MODIFY (main-owned) | `structure/03-server-api.md` | Record actual OAuth plan/render path and deadline boundary |

Excluded: #338 persistent queue, lease/recovery/drain; #150 adapter architecture; UI; migrations; dependency changes; release machinery. No new directory or public provider contract. Treat this as C3 behavior across existing OAuth boundaries; main applies its release C4 gates separately.

## Baseline and competing explanations

- `lib/oauthImages.ts:179-190,245-270`: only the backoff budget has a deadline. Signals already flow to both planning attempts and render calls (`:207,218`). H1, absent job-level timer, is supported by the source. Falsifier: a caller-created generation deadline wrapping every invocation; the inspected `openaiOperations.ts:83,212,291` calls only pass `options.signal`.
- H2, signal lost between planner/render, is rejected for this path: all those calls receive `job.signal`. It still needs a runtime propagation test after implementation.
- H3, erroneous timeout classification, does not explain the current cumulative duration, but is a real integration hazard: `responsesTransport.ts:231-238,334-337` treats any external abort as cancel. Its combiner (`:161-172`) drops `signal.reason`.
- `oauthRateLimit.ts:141-149,197-213`: the budget explicitly bounds waits only and maps every aborted wait to cancellation.
- `oauthProxy/runtime.ts:70-90`: readiness races its own status timer, without an abort input or timer cleanup. `responsesTransport.ts:186,285` waits before creating request timers.
- `oauthImages.ts:279-337`: three workers settle render slots, deliver images in planner order, throw a single-image error, and preserve multi-image successes plus `error`/`originalIndexes`.
- No runtime reproduction was executed in this docs-only delegation. The tests below must establish red before applying production changes.

## Behavior decisions for the architect

1. Start lifetime on entry to `runOAuthImageJob`, before plan/direct selection. Reference compression before that entry is outside this issue's execution boundary; no route refactor is proposed.
2. Resolve the configured timeout as `ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs`. Finite positive values create a timer; zero, negatives and non-finite values disable it, matching the existing legacy helper in `oauthProxy/runtime.ts:45-55`. Round a positive fraction up to 1ms minimum. Missing values use existing config, never a new hard-coded 400s policy. API-key transport keeps its current `|| 400 * 1000` behavior.
3. A controller stores a typed, sanitized cause. First abort wins: later deadline cannot replace earlier user cancellation, nor can later cancellation relabel timeout. Arbitrary user-provided reasons are not echoed into client messages.
4. Deadline ownership is at the job. Request timers remain as standalone transport protection, but OAuth uses the same normalization. Composed signals preserve reasons. Job timeout is installed first, so repeated requests cannot refresh its budget.
5. Readiness uses the shared signal; an earlier status timeout still yields existing 503 `OAUTH_UNAVAILABLE`. Job deadline or cancel interrupts readiness immediately and prevents subsequent fetch. Clear status timer on every outcome, without cancelling the shared readiness promise itself.
6. Retain retry-budget behavior: a requested wait that would reach the deadline is rejected immediately with the original rate-limit error, as existing tests expect. If an admitted wait is aborted by deadline, return 504. Do not rewrite every 429 into timeout.
7. A completed image remains a completed image. A multi-image result retains saved/streamed successes and original indexes; remaining slots receive typed abort errors. Preserve existing first-error ordering and single-image throw behavior. Do not start another upstream call once aborted.
8. Awaiting local `onFinalImage` persistence is not force-cancelled: racing disk writes would let the route finish while writes still mutate history. Deadline bounds provider/readiness/backoff execution, not an uncooperative local disk callback. The architect must retain this explicit boundary or separately design cancellable persistence; do not claim hard real-time preemption of all JavaScript or file I/O.
9. No automatic retries after timeout. An upstream may have completed remotely before abort; this unit does not promise idempotent cancellation or refunds.

## NEW `lib/oauthJobDeadline.ts` — complete proposed content

The helper imports no runtime context, config, storage or provider clients. This keeps `oauthRateLimit.ts` a leaf of the provider stack.

```ts
export class OAuthJobAbort extends Error {
  readonly name = "AbortError";
  readonly status: number;
  readonly code: string;
  constructor(timeout: boolean) {
    super(timeout ? "OAuth image generation timed out" : "Generation canceled");
    this.status = timeout ? 504 : 499;
    this.code = timeout ? "RESPONSES_IMAGE_TIMEOUT" : "GENERATION_CANCELED";
  }
}

export function normalizeOAuthTimeout(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 0;
}

export function oauthAbortError(signal?: AbortSignal | null): OAuthJobAbort {
  return signal?.reason instanceof OAuthJobAbort ? signal.reason : new OAuthJobAbort(false);
}

export function throwIfOAuthAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw oauthAbortError(signal);
}

export function createOAuthJobDeadline(timeoutMs: number, parent?: AbortSignal | null) {
  const controller = new AbortController();
  const onCancel = () => controller.abort(oauthAbortError(parent));
  if (parent?.aborted) onCancel();
  else parent?.addEventListener("abort", onCancel, { once: true });
  const duration = normalizeOAuthTimeout(timeoutMs);
  const timer = duration && !controller.signal.aborted
    ? setTimeout(() => controller.abort(new OAuthJobAbort(true)), duration)
    : undefined;
  return {
    signal: controller.signal,
    timeoutMs: duration,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onCancel);
    },
  };
}

// Observe late resolution/rejection even if abort wins; never leak a rejection.
export async function withOAuthAbort<T>(run: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  throwIfOAuthAborted(signal);
  if (!signal) return run();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(oauthAbortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => { throwIfOAuthAborted(signal); return run(); }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
```

Use ordinary `setTimeout`/`clearTimeout`; Node test fake timers can replace them. Do not use `AbortSignal.timeout`, whose timer is not driven by the selected fake-clock harness.

## MODIFY `lib/oauthImages.ts`

Add imports of `config` from `../config.js` and `createOAuthJobDeadline`, `throwIfOAuthAborted` from `./oauthJobDeadline.js`.

Before (`:179-181`):
```ts
function rateLimitBudgetFor(job: OAuthImageJob): OAuthRateLimitBudget {
  return createOAuthRateLimitBudget(job.ctx?.config?.oauth?.generationTimeoutMs ?? 400 * 1000);
}
```
After: delete this helper; the wrapper creates the budget using the exact normalized deadline duration.

Before (`:262,267`):
```ts
export async function runOAuthImageJob(job: OAuthImageJob): Promise<OAuthImageJobResult> {
  // existing direct-mode comment and direct declaration
  const budget = rateLimitBudgetFor(job);
```
After: rename this existing implementation to `runOAuthImageJobWithinDeadline(job: OAuthImageJob, budget: OAuthRateLimitBudget): Promise<OAuthImageJobResult>` and delete its local budget initialization. Retain all other body logic, including partial-result construction. Add this exported wrapper:
```ts
export async function runOAuthImageJob(job: OAuthImageJob): Promise<OAuthImageJobResult> {
  const lifetime = createOAuthJobDeadline(
    job.ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs,
    job.signal,
  );
  try {
    throwIfOAuthAborted(lifetime.signal);
    const boundedJob = { ...job, signal: lifetime.signal };
    const budget = createOAuthRateLimitBudget(lifetime.timeoutMs);
    return await runOAuthImageJobWithinDeadline(boundedJob, budget);
  } finally {
    lifetime.dispose();
  }
}
```
The worker's existing catch resolves every slot; do not break its loop and leave unresolved promises. The retry entry check below ensures post-abort slots fail locally without sending requests.

## MODIFY `lib/responsesTransport.ts`

Add `config` from `../config.js`; import `OAuthJobAbort`, `normalizeOAuthTimeout`, `oauthAbortError`, `throwIfOAuthAborted`, `withOAuthAbort` from `./oauthJobDeadline.js`.

Exact substitutions:

| Before | After |
|---|---|
| `getEndpoint(ctx, provider, _scope)` signature | Append `signal?: AbortSignal | null` parameter |
| `await waitForOAuthReady(ctx);` inside getEndpoint | `await waitForOAuthReady(ctx, signal);` |
| `await getEndpoint(ctx, provider, scope)` | `await getEndpoint(ctx, provider, scope, signal)` |
| Entire `combineAbortSignals` helper (`:161-173`) | Delete; use `AbortSignal.any(...)` at both call sites (Node >=22) |
| `postResponses` timeout expression (`:187`) | `provider === "api" ? (ctx?.config?.oauth?.generationTimeoutMs || 400 * 1000) : normalizeOAuthTimeout(ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs)` |
| `postOAuthImages` readiness (`:285`) | `await waitForOAuthReady(ctx, signal);` |
| `postOAuthImages` timeout expression (`:286`) | `normalizeOAuthTimeout(ctx.config?.oauth?.generationTimeoutMs ?? config.oauth.generationTimeoutMs)` |
| Both timer declarations | `const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new OAuthJobAbort(true)), timeoutMs) : undefined;` |

For BOTH request functions, immediately after selecting `fetchSignal` add `throwIfOAuthAborted(fetchSignal)` INSIDE the existing try. Wrap the exact existing request expression with `withOAuthAbort(() => <existing request expression>, fetchSignal)`; the original init continues carrying `signal: fetchSignal`. Wrap response consumption similarly: `res.text()`, `parseStream(...)` and `parseJson(...)`. In `postResponses`, apply these abortable wrappers ONLY when `provider !== "api"`; retain the API-key await expressions unchanged. This covers transport promises or bodies that ignore cancellation without allowing later rendering work. Never wrap irreversible `onFinalImage` persistence here: OAuth planning uses maxImages=0 and image rendering consumes JSON.

Replace BOTH `if (err.name === "AbortError") { ... }` blocks with:
```ts
if (err.name === "AbortError") {
  const aborted = oauthAbortError(fetchSignal);
  throw makeError(aborted.message, {
    status: aborted.status, code: aborted.code, cause: err.raw,
  });
}
```
Preserve the `isKnownResponsesError` branch, redacted 502 fallback and timer cleanup. A genuine AbortError with no aborted signal previously mapped to timeout; retain that compatibility explicitly by using `fetchSignal.aborted ? oauthAbortError(fetchSignal) : new OAuthJobAbort(true)` for the `aborted` declaration above. Readiness typed errors occur before the try and already contain the public status/code; they must not become NETWORK_FAILED.

## MODIFY `lib/oauthProxy/runtime.ts`

Import `throwIfOAuthAborted`, `withOAuthAbort` from `../oauthJobDeadline.js`. Change signature to `waitForOAuthReady(ctx: RouteRuntimeContext = {}, signal?: AbortSignal | null)` and put `throwIfOAuthAborted(signal)` at entry, before the early return. Existing callers remain valid.

Replace only this block (`:81-86`):
```ts
if (ctx.oauthReadyPromise) {
  await Promise.race([
    ctx.oauthReadyPromise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
```
with:
```ts
if (ctx.oauthReadyPromise) {
  const ready = ctx.oauthReadyPromise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await withOAuthAbort(() => Promise.race([
      ready,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]), signal);
  } finally {
    clearTimeout(timer);
  }
}
throwIfOAuthAborted(signal);
```
Keep sync-session refresh, ready/disabled/failed handling and final 503 check unchanged. No facade export change is needed: `oauthProxy/index.ts:23` already re-exports this function.

## MODIFY `lib/oauthRateLimit.ts`

Import `oauthAbortError`, `throwIfOAuthAborted` from `./oauthJobDeadline.js`. Update the leaf-module comment to acknowledge this dependency-free abort helper. Delete `canceledError(cause)` (`:132-134`). Replace each of its three calls (`:197,210,213`) with `oauthAbortError(signal)`; keep their surrounding `signal?.aborted` conditions. Add `throwIfOAuthAborted(signal)` immediately inside the retry loop, BEFORE the try that invokes `request()`. Do not move the non-rate-limit-error passthrough at `:195`.

Replace budget comment “It bounds only the waits: each request keeps its own transport timeout.” with “The job owner also applies this deadline to readiness and transport with its shared signal.” Keep `deadlineAt`/shortfall semantics and clock injection unchanged.

## NEW `tests/oauth-job-timeout.test.ts` — complete core regression content

This fixture stubs the backend BEFORE dynamic runtime imports and refuses all real fetches. It uses the existing isolated child helper. It neither opens a route server nor reads/writes a real job DB. Code is proposed, not yet typechecked. Extend this same file with the exact additional cases below before claiming completion.

```ts
import assert from "node:assert/strict";
import { before, after, describe, it, mock } from "node:test";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { plannerSse, imagesJson } from "./_oauthNativeFixture.ts";
import type { OAuthImageJob } from "../lib/oauthImages.ts";

if (executionTestProcess(import.meta.url)) describe("OAuth job deadline", { concurrency: false }, () => {
  let run: typeof import("../lib/oauthImages.ts").runOAuthImageJob;
  let base: OAuthImageJob;
  let upstream: (path: string, init: RequestInit) => Promise<Response>;
  const originalFetch = globalThis.fetch;
  before(async () => {
    globalThis.fetch = async () => { throw new Error("Unexpected real network call"); };
    mock.module("../lib/codexBackend/index.js", { namedExports: {
      oauthFetch: (_ctx: unknown, path: string, init: RequestInit) => upstream(path, init),
    } });
    mock.module("../lib/inflight.js", { namedExports: { setJobPhase() {} } });
    const { config } = await import("../config.ts");
    ({ runOAuthImageJob: run } = await import("../lib/oauthImages.ts"));
    base = {
      ctx: { config: { ...config, oauth: { ...config.oauth, generationTimeoutMs: 100, statusTimeoutMs: 1000 } },
        oauthReadyState: "ready", oauthTransport: "proxy", oauthUrl: "http://fixture.invalid" },
      scope: "deadline-test", model: "gpt-6-luna", mode: "auto", reasoningEffort: "low",
      webSearchEnabled: false, developerPrompt: "test", userText: "test", directPrompt: "test",
      images: [], maxImages: 1,
    };
  });
  after(() => { mock.restoreAll(); globalThis.fetch = originalFetch; });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }
  function held(signal?: AbortSignal | null): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const fail = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    });
  }
  function expectCode(code: string, status: number) {
    return (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "code"), code);
      assert.equal(Reflect.get(error, "status"), status);
      return true;
    };
  }

  it("planner time reduces render time; no fresh 100ms budget", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const planning = deferred<void>(), rendering = deferred<void>(), plan = deferred<Response>();
    upstream = async (path, init) => {
      if (path === "/v1/responses") { planning.resolve(); return plan.promise; }
      rendering.resolve(); return held(init.signal);
    };
    const outcome = assert.rejects(run(base), expectCode("RESPONSES_IMAGE_TIMEOUT", 504));
    await planning.promise;
    t.mock.timers.tick(60);
    plan.resolve(plannerSse(["render"]));
    await rendering.promise;
    t.mock.timers.tick(40);
    await outcome;
    assert.equal(Date.now(), 100);
  });

  it("readiness observes deadline without an upstream request", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    upstream = async () => { assert.fail("fetch after readiness timeout"); };
    const job = { ...base, ctx: { ...base.ctx, oauthReadyState: "starting" as const,
      oauthReadyPromise: new Promise<void>(() => {}) } };
    const outcome = assert.rejects(run(job), expectCode("RESPONSES_IMAGE_TIMEOUT", 504));
    t.mock.timers.tick(100);
    await outcome;
  });

  it("user cancel before deadline stays 499", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const started = deferred<void>(), user = new AbortController();
    upstream = async (_path, init) => { started.resolve(); return held(init.signal); };
    const outcome = assert.rejects(run({ ...base, signal: user.signal }), expectCode("GENERATION_CANCELED", 499));
    await started.promise;
    t.mock.timers.tick(25);
    user.abort(new Error("private user detail"));
    t.mock.timers.tick(75);
    await outcome;
  });

  it("multimode retains completed images and timeout error", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const delivered = deferred<void>();
    upstream = async (path, init) => {
      if (path === "/v1/responses") return plannerSse(["first", "second"]);
      const body = JSON.parse(String(init.body)) as { prompt: string };
      return body.prompt === "first" ? imagesJson("fixture-b64") : held(init.signal);
    };
    const outcome = run({ ...base, maxImages: 2, onFinalImage: () => { delivered.resolve(); } });
    await delivered.promise;
    t.mock.timers.tick(100);
    const result = await outcome;
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.originalIndexes, [0]);
    expectCode("RESPONSES_IMAGE_TIMEOUT", 504)(result.error);
  });
});
```

`starting` is verified in `lib/runtimeContext.ts:9`; `oauthReadyPromise` is `Promise<void> | null` at `:35`, and the callback permits void at `lib/responsesParse.ts:19`. Mock-module interception must be confirmed by the entered-planner/render barriers; do not remove the network denial if module resolution differs under tsx. The fake-ready test deliberately allows deadline to precede continuation: its operation precheck must prevent a later fetch.

## Additional test-file edits (same NEW file, complete insertions)

Inside the suite, add these runtime bindings, initialize them in `before` after backend mocks, and add the cases below. This is one new test file, not another fixture or inventory entry.

```ts
let deadlineTools: typeof import("../lib/oauthJobDeadline.ts");
let retryTools: typeof import("../lib/oauthRateLimit.ts");
// Append to before():
deadlineTools = await import("../lib/oauthJobDeadline.ts");
retryTools = await import("../lib/oauthRateLimit.ts");
```

```ts
it("backoff abort retains timeout cause and sends no retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const lifetime = deadlineTools.createOAuthJobDeadline(100);
  const waiting = deferred<void>();
  let calls = 0;
  const limited = Object.assign(new Error("limited"), { rateLimit: "transient" });
  const outcome = assert.rejects(retryTools.withOAuthRateLimitRetry(async () => {
    calls++; throw limited;
  }, {
    signal: lifetime.signal, budget: retryTools.createOAuthRateLimitBudget(100),
    config: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 10, maxTotalWaitMs: 50 },
    random: () => 0.5,
    // Simulate a delayed wake after an admitted wait, without real sleeping.
    sleep: async (_ms, signal) => { waiting.resolve(); await held(signal); },
  }), expectCode("RESPONSES_IMAGE_TIMEOUT", 504));
  await waiting.promise;
  t.mock.timers.tick(100);
  await outcome;
  assert.equal(calls, 1);
  lifetime.dispose();
});

it("normalizes disabled timeout values and disposes listeners/timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(deadlineTools.normalizeOAuthTimeout(value), 0);
    const life = deadlineTools.createOAuthJobDeadline(value);
    t.mock.timers.tick(1000);
    assert.equal(life.signal.aborted, false);
    life.dispose();
  }
  assert.equal(deadlineTools.normalizeOAuthTimeout(0.5), 1);
  const user = new AbortController();
  const life = deadlineTools.createOAuthJobDeadline(100, user.signal);
  life.dispose();
  user.abort();
  t.mock.timers.tick(1000);
  assert.equal(life.signal.aborted, false);
});

it("first abort wins in both orders", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const timeoutFirst of [true, false]) {
    const user = new AbortController();
    const life = deadlineTools.createOAuthJobDeadline(100, user.signal);
    if (timeoutFirst) t.mock.timers.tick(100);
    user.abort();
    t.mock.timers.tick(100);
    assert.equal(deadlineTools.oauthAbortError(life.signal).status, timeoutFirst ? 504 : 499);
    life.dispose();
  }
});

it("pre-cancelled job never calls the backend", async () => {
  const user = new AbortController(); user.abort();
  upstream = async () => { assert.fail("backend reached after cancellation"); };
  await assert.rejects(run({ ...base, signal: user.signal }), expectCode("GENERATION_CANCELED", 499));
});

it("queued fourth render fails locally after deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const full = deferred<void>();
  let renders = 0;
  upstream = async (path, init) => {
    if (path === "/v1/responses") return plannerSse(["a", "b", "c", "d"]);
    if (++renders === 3) full.resolve();
    return held(init.signal);
  };
  const outcome = run({ ...base, maxImages: 4 });
  await full.promise;
  t.mock.timers.tick(100);
  const result = await outcome;
  assert.equal(renders, 3);
  assert.deepEqual(result.images, []);
  expectCode("RESPONSES_IMAGE_TIMEOUT", 504)(result.error);
});
```

## Verification and acceptance table

| Case | Activation / assertion | Required evidence |
|---|---|---|
| Slow planner + render | Core test above: 60+40ms, 504 at 100ms | Fails baseline, passes patch; fake clock only |
| Readiness | Pending ready promise, deadline before 503 status limit | Zero backend calls, 504; earlier status limit still 503 |
| User cancellation | Before entry, during planner/render, during readiness/wait | 499, no secret reason echo, no subsequent calls |
| Backoff deadline | Extend same test file: first 429 admits a wait, advance clock to deadline during wait | 504; retries stop; existing budget-shortfall test still returns original 429 |
| Partial results | Two renders, first success and second held | First image/index retained, `error` is timeout |
| Queued renders | Four+ prompts, concurrency three, abort before fourth | No fourth upstream call; all slot promises settle |
| Timeout normalization | Table over undefined/config default, 0, -1, NaN, Infinity, 0.5 | Disable nonpositive/nonfinite; positive rounds up; API unchanged |
| Cleanup | Success/failure/cancel, then advance fake clock far past deadline | No extra aborts/calls; parent listener removed; readiness timer cleared |
| Ordering | Deadline then later cancel; cancel then later deadline | First cause remains authoritative |
| Non-cooperative body | Mock Response body holds, signal aborts | Deadline settles request; late rejection observed, no unhandled rejection |
| Existing contracts | Existing lane, rate-limit and Responses safety suites | No regressions, including error redaction and partial output |
| Source/static | typecheck, typecheck:tests, targeted ESLint | New code obeys actual signatures; no added production dependency |

The table includes audit follow-ups beyond the complete tests above. Cover them with existing suites where available; otherwise record and add exact test content in this document before B. Do not claim those follow-ups passed from the core tests alone. Tests may use helper imports and fake timers; do not replace clock advancement with wall-clock sleeps. For backoff, use an entered-wait barrier (spy on injected sleep or timer scheduling), not a guessed number of microtask flushes.

Activation commands (implementation phase only):
```sh
node --experimental-test-module-mocks --import tsx --test tests/oauth-job-timeout.test.ts
node --experimental-test-module-mocks --import tsx --test tests/oauth-rate-limit-retry.test.ts tests/oauth-rate-limit-lane.test.ts tests/oauth-image-lane-contract.test.ts tests/responses-adapter-safety.test.ts tests/oauth-proxy-error-safety.test.ts
npm run typecheck
npm run typecheck:tests
npx eslint lib/oauthJobDeadline.ts lib/oauthImages.ts lib/responsesTransport.ts lib/oauthProxy/runtime.ts lib/oauthRateLimit.ts tests/oauth-job-timeout.test.ts
node scripts/classify-tests.mjs
npm run test:inventory
```
Inventory registration is generated, not a manual list: `scripts/classify-tests.mjs:17-35` discovers `tests/*.test.ts`; `scripts/run-tests.mjs:9-12` likewise discovers it for the canonical suite. Regeneration adds `tests/oauth-job-timeout.test.ts` under runtime imports and increments total/runtime counts in `docs/migration/runtime-test-inventory.md`. No package-script edit is needed. Run red before production patches, then green and adjacent suites; do not claim a regression test works from green alone.

Main-owned SoT patch after implementation: append to the image-generation paragraph at `structure/03-server-api.md:88`: “GPT OAuth plans with the selected GPT model and renders with gpt-image-2. One job deadline spans readiness, planner attempts, renders and rate-limit waits. Expiry is RESPONSES_IMAGE_TIMEOUT (504); user cancellation is GENERATION_CANCELED (499). Completed multimode images survive a later timeout.” Correct the preceding stale statement that OAuth renders through the hosted Responses image_generation tool while retaining the API-key description.

## Audit handoff and current proof limits

The code blocks are executable design candidates, not installed implementation or passing evidence. The independent architect must settle callback/persistence timing scope, verify readiness literals and mock loading, and review partial-result/error precedence before B. No change to #338 or #150 is part of this design. Source anchors are baseline anchors and must be refreshed at implementation P if main's train changes these owners.

## Accepted ARCH-03 reflection correction

In postResponses, `provider === "api"` MUST retain its original timer scheduling, fetch/body waiting and AbortError classification/message/precedence. Do not wrap its parseStream/onFinalImage path in withOAuthAbort. Only the OAuth branch uses normalized conditional timers, typed abort causes, preflight abort checks and abortable network/body waits. postOAuthImages is OAuth-only and uses the new behavior throughout. This provider-conditional instruction supersedes the earlier table entries saying BOTH request paths unconditionally. Add API compatibility assertions (negative timeout still schedules existing behavior; external cancel remains existing 499 mapping) alongside existing responses-adapter-safety tests.

Architect 01a1020f-23c4-7fa0-a5e4-1e627cd5e059 returned ARCH-03 ALIGNED with this correction; main accepts. Callback persistence and first-error partial-result boundaries are retained. Before wp2 B, map remaining activation rows to named existing tests or exact new fixtures; no unverified row can pass C.
