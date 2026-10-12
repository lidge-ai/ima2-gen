# C verification repair: keep the budget across caller retries

Observed on d1f16e93: actual prepareOpenaiExecution classic request receives an upstream500 at60ms, starts its existing retry, remains pending at100ms, and times out at160ms. The job timer prevented retries AFTER expiry but did not preserve remaining time when an earlier transient error allowed another attempt. Probe: .codexclaw/wp2-retry-budget-probe.test.ts and .log. No production mutation was needed to reproduce it.

H1 deadline classification remained retryable was falsified: final error is canonical OAUTH_IMAGE_TIMEOUT, already nonretryable. H2 a new runOAuthImageJob on early-error retry resets the timer was confirmed by actual60→160 timeline. H3 planner latency caused the gap was falsified: direct mode used no planner. This gap must close before #351 is considered resolved.

## Bounded design amendment

MODIFY lib/providers/adapters/openaiExecution.ts only. Add one private generic `withPreparedOAuthBudget(ctx, request, run)` that returns the public no-argument execute closure. It owns an initially-unset monotonic deadlineAt, initialized synchronously on FIRST execute with `performance.now() + normalizedDuration`, or Infinity for disabled timeout. Every invocation uses `deadlineAt - performance.now()`, checks existing parent cancellation before exhausted-budget handling, creates an invocation-local deadline signal, awaits run(signal), and disposes in finally. API returns `() => run(request.signal)` unchanged and unbudgeted. No whole-executor Promise.race, shared request mutation or epoch/performance timestamp mixing.

Preserve classic prepare-time scalar capture: keep prepareOpenaiClassic and its existing destructuring at prepare time. Change only generateOne's private signature to accept a per-invocation signal and pass it to generateViaResponses. Its public execute uses withPreparedOAuthBudget with an async callback returning the same single result. It does NOT re-run preparation per invocation. References, request.signal and ctx retain their existing live semantics.

For node/edit/multimode switch cases, replace each existing async execute closure with withPreparedOAuthBudget wrapping an async callback that invokes the same existing executeOpenai* function on `{ ...request, signal }`. This retains their existing invocation-time field reads and uses a fresh request clone per invocation. Node's external retry loop reuses this prepared closure. Concurrent calls share absolute expiry while their signals remain invocation-local. A newly prepared execution starts a new job. Keep functions below50 lines and current public types/signatures.

This extends023's job-timeout creation rule to exhaustion of the already-started prepared-job budget. Standalone request timers/API behavior stay unchanged. Direct compatibility callers of runOAuthImageJob still receive its existing one-call deadline.

## Exact verification additions

NEW tests/oauth-execution-deadline.test.ts, executionTestProcess + real prepareOpenaiExecution, real deadline helper/classifier/normalizer, mocked backend/no real network. Record file in021 before implementation.

- Classic first500 at60 then held retry: response remains held until100, then OAUTH_IMAGE_TIMEOUT504 at100; calls2, later time produces no third call.
- Node first execute fails500 at60; second execute of same prepared closure uses40ms remaining and ends at100. An execute after expiry sends zero additional requests.
- A new prepared closure after expiry starts a fresh100ms budget; preparation itself does not start timer.
- Concurrent executions of one prepared OAuth batch retain one absolute expiry.
- API preparation keeps original per-request retry timing and cancellation/persistence behavior; existing API compatibility suite must remain green.

RED must assert the100ms requirement on the current code and release/tick held work in finally so baseline terminates. Then implement, run focused/new+existing suites and actualHTTPQA. Main implements this bounded verification correction; prior worker is closed. Architect reflection and independent audit of this amendment are recorded before production edits; main remains in C to repair the observed acceptance failure and will refresh all affected receipts/CI at the new head.

## Review correction and RED evidence

The original re-prepare-per-execute proposal was rejected because it would lose classic scalar capture. The callback-based design above preserves it without mutating shared requests. Clock uses performance.now; new fake-clock tests explicitly mock performance.now alongside Date/timers. Add an independent wall-clock jump case (Date.now changes while monotonic elapsed stays controlled) so Date adjustments cannot extend remaining time.

Before production changes, tests/oauth-execution-deadline.test.ts ran at d1f16e93: six child cases, four failed for classic/node retry reset, request after expiry and concurrent expiry; two controls passed for fresh prepare and API timing. No tests canceled. .codexclaw/wp2-execution-budget-red.log contains the observed failures. Held work was released by finally timer advancement.

Architect ALIGNED and independent audit PASS accepted the callback-based capture-preserving design before production edits. Implementation now uses performance.now and invocation-local signals; API keeps request.signal live on each internal attempt. New regression suite has13 cases including both wall-clock directions, parent-cancel precedence, awaited persistence, classic scalar capture in both providers and API live-signal compatibility. New suite and existing OAuth/job/API/route parity suites passed; full gates and independent interdiff review remain pending. RED evidence covers4 budget failures and2 controls before production edits; additional controls were added during verification, not claimed RED.

The first broad run found one test-oracle mismatch: provider-execution-boundary expected original AbortSignal identity for OAuth, which contradicts the approved invocation-local deadline signal. Update only the OAuth branch in tests/_executionBoundaryProbe.ts to require a distinct real AbortSignal with matching initial abort state; preserve strict original identity for every other provider. Add a real active-parent-cancel test to oauth-execution-deadline.test.ts proving derived upstream abort,499/sanitization and parent-listener cleanup. This replaces identity with stronger behavior evidence; no production change is needed for that mismatch.
