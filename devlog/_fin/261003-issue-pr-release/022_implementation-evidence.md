# wp2 first implementation evidence

This records the first implementation before the prepared-execution retry-budget correction. See024 and025 for the later scope and verification.

Implementation frozen for main verification on 2026-10-04 (Asia/Seoul). Main owns git, FSM, delivery, source-of-truth docs and canonical gates.

## RED before production edits

Command: `node --experimental-test-module-mocks --import tsx --test tests/oauth-job-timeout.test.ts`
Node v24.17.0; exit 1. Isolated child: tests 2, pass 0, fail 2, cancelled 0.
- `planner budget reduces render time`: `job must settle at total 100ms, not render 160ms`; actual false, expected true (test line 67).
- `noncooperative response body rejects late after deadline`: `body must not extend job deadline`; actual false, expected true (test line 88).
Only existing runtime modules were imported. Held baseline promises were released in finally; both failures terminated. Neither was a missing-module failure. Tool output chunk d97765 records the run.

## Boundaries and necessity

Assets: generation results, provider call budget and private error reasons. Entrypoints: runOAuthImageJob and Responses transport. Boundary: local job/cancellation state to remote provider I/O. An uncooperative remote response must not occupy a job indefinitely; a caller's arbitrary abort reason must not be echoed. Tests replace the provider module and deny real network. Auth/session/key handling is unchanged. Must-pass: sanitized 499/504 taxonomy, no request after abort, late rejection observed, persisted partials retained, API behavior unchanged.

Existing owners inspected: oauthImages, responsesTransport, oauthProxy/runtime, oauthRateLimit, their OpenAI operation callers and adjacent tests. Existing request timers and legacy createOAuthGenerationTimeout cannot enforce a composed job deadline or preserve cancellation causes. Config-only changes would still reset the budget for each call. The approved small dependency-free helper owns this missing lifetime; existing provider/parse/backoff implementations remain real in tests.

## Initial GREEN and acceptance mapping (before review repair)

The original two runtime regressions passed after the lifetime/transport fix (exit 0, child tests 2/pass 2/fail 0). After the approved 023 consumer amendment, job expectations use canonical OAUTH_IMAGE_TIMEOUT; request-only/API expectations remain RESPONSES_IMAGE_TIMEOUT. The RED tests first assert settlement at the deadline, so their original failure was cumulative time/uncooperative I/O rather than error-code spelling.

After function extraction and final tests, this exact focused/adjacent command passed:

```sh
node --experimental-test-module-mocks --import tsx --test tests/oauth-job-timeout.test.ts tests/responses-api-abort-compat.test.ts tests/oauth-rate-limit-retry.test.ts tests/oauth-rate-limit-lane.test.ts tests/oauth-image-lane-contract.test.ts tests/responses-adapter-safety.test.ts tests/oauth-proxy-error-safety.test.ts
```

Exit 0. Outer runner reported 36/pass36/fail0/cancelled0/skipped0; four of those are isolated child wrappers. Actual behavioral cases total 79:

| File | Real cases | Result |
|---|---:|---|
| oauth-job-timeout.test.ts | 29 | pass29/fail0 |
| responses-api-abort-compat.test.ts | 6 | pass6/fail0 |
| oauth-rate-limit-retry.test.ts | 19 | pass19/fail0 |
| oauth-rate-limit-lane.test.ts | 3 | pass3/fail0 |
| oauth-image-lane-contract.test.ts | 9 | pass9/fail0 |
| responses-adapter-safety.test.ts | 6 | pass6/fail0 |
| oauth-proxy-error-safety.test.ts | 7 | pass7/fail0 |

The last run's output includes the original cumulative-time and noncooperative-body cases passing, and `classic execution never retries job deadline; node classifier preserves it` passing. No tests skipped or cancelled. Child wrappers are not counted as additional behavior cases.

Static checks:

```sh
npm run typecheck && npm run typecheck:tests
npx eslint lib/oauthJobDeadline.ts lib/oauthImages.ts lib/responsesTransport.ts lib/oauthProxy/runtime.ts lib/oauthRateLimit.ts
node scripts/classify-tests.mjs
npm run test:inventory
```

All exited 0. Inventory generator reported 250 runtime / 299 contract tests (549 total). The first static pass found one unused destructured `scope` in postResponses; removed it and both typechecks plus targeted production ESLint passed fresh. Project ESLint does not include tests (initial combined invocation warned they were ignored); test typing is verified by typecheck:tests, not claimed as linted. No structure generator or canonical npm test was run by this worker.

## Acceptance activation ledger

All names below are actual executed test names, not proposed scenarios. Unless another file is named, the owner is oauth-job-timeout.test.ts.

| Accepted row | Executed proof |
|---|---|
| Cumulative planner/render time | `planner budget reduces render time`: entered planner at0, render at60, settled504 at100; original RED becomes GREEN |
| Planner second attempt | `planner retry shares deadline`: empty first plan, second entered, same100ms limit, only2 planner calls |
| Readiness deadline | `readiness deadline before any upstream call`: 504, zero calls, timers/listeners clear |
| Earlier readiness503 | `readiness status before any upstream call`: status timer20/job100, 503, zero calls after advancing1000 |
| Readiness cancellation | `readiness cancel before any upstream call`: 499, shared readiness later resolves harmlessly, no backend calls |
| Direct render deadline | `direct mode timeout has no planner`: only images/generations, one call |
| User cancel before admission | `user cancel before is sanitized and stops requests`: 499, request count0 |
| User cancel during planning | `user cancel planner is sanitized and stops requests`: entered planner,499, one call |
| User cancel during render | `user cancel render is sanitized and stops requests`: entered render,499, one call |
| User cancel during backoff | `user cancel backoff is sanitized and stops requests`: actual429 and observed8–10ms retry timer before abort,499,no second call |
| Admitted backoff deadline | `admitted backoff timeout preserves job cause and sends no retry`: injected delayed sleep entered, job100 expiry,504,count1 |
| Budget shortfall retains original429 | oauth-rate-limit-retry: `never waits past the job deadline`, `stops before the total wait cap instead of trimming the wait` |
| Non-cooperative body/late rejection | `noncooperative response body rejects late after deadline`: settled before releasing body; reject late and drain; node:test reports no unhandled rejection |
| Completed partials | `completed images survive timeout`: image/index0 retained, timeout error |
| First-error forward order | `first error follows planner order: early400first=true`: slot1 delivery proves slot0 error collected BEFORE deadline; image index1 and400 retained |
| First-error reverse order | `first error follows planner order: early400first=false`: slot2 error-body barrier plus event-loop drain BEFORE deadline; slot0 timeout remains first; image index1 retained |
| Queued fourth render | `queued fourth render never calls upstream after abort`: four slots, only3 calls, all slots settle with empty images and timeout |
| Success cleanup | `job timer and listener cleanup after success`: tracked handles empty and parent listener baseline restored |
| Failure cleanup | `job timer and listener cleanup after error`: same cleanup through upstream500 |
| Cancel cleanup | `job timer and listener cleanup after cancel`: same cleanup through499 |
| Readiness-success cleanup | `job timer and listener cleanup after ready`: shared readiness resolves; status timer cleared |
| Disabled timeout | `disabled OAuth timeout 0/-1/NaN/Infinity still accepts cancellation` (four separately named cases): no timers, parent cancel499 |
| Missing local config | `absent job-local timeout uses global config`: distinct global137ms captured for job/request, parent abort cleans both |
| Positive fractional timeout | `fraction rounds to 1ms and disposing detaches parent`: 0.5→1, timer fires canonical timeout; disposal prevents later parent/timer abort |
| First abort precedence | `OAuth first abort wins: timeoutFirst=true/false` (two cases): canonical first reason preserved |
| Actual outer classic retry | `classic execution never retries job deadline; node classifier preserves it`: real prepareOpenaiExecution.execute, real classifier/normalizer, upstream count1 after extra1000ms (callback coverage is provided by the direct job tests below) |
| Node consumer decision | Same actual classic error passed to the actual classifier/normalizer imported by nodeGeneration; nonRetryable true and canonical504. Does not claim full node-route runtime QA |
| API callback timeout | responses-api-abort-compat: `API awaits persistence callback after timeout`: outer promise pending after fake100ms; released callback yields image |
| API callback cancel | responses-api-abort-compat: `API awaits persistence callback after cancel`: same pending proof after external abort |
| API negative timeout | responses-api-abort-compat: `API negative timeout retains scheduling and original 504 message`: supplied delay-1, original RESPONSES code/message |
| API catch precedence | responses-api-abort-compat: `API external cancellation retains catch-time precedence`: local timeout then user cancel then fetch rejection;499 |
| Standalone request timeout | responses-api-abort-compat: `standalone OAuth planner/render request timeout keeps RESPONSES code` (two cases) |
| Pre-abort vs entered-error boundary | oauth-rate-limit-retry: `a pre-aborted signal rejects before entering a non-rate-limit request` asserts499/count0; `an entered request preserves its non-rate-limit error after cancellation` asserts original boom/count1 |
| Existing API/error redaction | All6 responses-adapter-safety cases; all7 oauth-proxy-error-safety cases |
| Existing generation surfaces | All9 oauth-image-lane-contract cases and3 oauth-rate-limit-lane cases |

## Implementation shape and limits

One dependency-free helper has explicit cancel/request-timeout/job-timeout reasons. Only createOAuthJobDeadline selects job-timeout. The request lifetime uses request-timeout and preserves typed parent reasons. OAuth network/readiness/body waits race the common signal and observe late settlement. API keeps original timer scheduling, combined-signal behavior, catch-time mapping and non-raced callbacks.

Job render-slot startup and ordered result collection were extracted within oauthImages.ts to meet the requested function limit without changing partial-result assembly. Transport response reading and lifetime/error helpers stay within responsesTransport.ts. No classifier, normalizer, route or provider API changed.

TypeScript AST inspection: every changed/new runtime function is below50 lines. File lines/max function: oauthJobDeadline73/18, oauthImages368/41, responsesTransport345/38, oauthProxy/runtime149/30, oauthRateLimit214/33, oauth-job-timeout352/24, responses-api-abort-compat102/17. All are below500 lines.

No production credentials, paid calls, git/branch commands, goals/FSM, subagents, app/process changes, or external writes occurred. Test-child processes and fake clocks were scoped to the test harness.

Remaining verification belongs to main: independent code review, actual HTTP route QA, server/CLI build, canonical full gates and hosted CI. Local evidence does not prove packaged desktop/native behavior. Remote upstream completion after cancellation is unknowable; already-started local persistence callbacks remain awaited by design. A node-specific full execution test is not claimed: its shared retry classifier is directly asserted on the actual propagated error.


## Latest frozen source fingerprints

| File | SHA-256 |
|---|---|
| `lib/oauthJobDeadline.ts` | `effe93186eae656de3961a98d005b89c448e41dbd5f3b9e5e6878456bdeed956` |
| `lib/oauthImages.ts` | `178eb141f739a649a4ea7bbfa5a22847ff8feb13d38e1e4b895ee735b3ac4fdb` |
| `lib/responsesTransport.ts` | `cb0b64f795f32d5753ab9185b6ba5960f44464c08d150b69cf6632ad7b02b7ed` |
| `lib/oauthProxy/runtime.ts` | `9d3d729b7b0ebb078b58b6786f24c4d588d4601e31db71b62a9a36d29e62ef47` |
| `lib/oauthRateLimit.ts` | `70af0c0c797fc181e75200e7745a91d6dc1d5287d17e8b58441da25d8d23837c` |
| `tests/oauth-job-timeout.test.ts` | `fc529fe64741e7a19a9bf0780806ba54ec1f3116092a57ec6580748655e0a621` |
| `tests/responses-api-abort-compat.test.ts` | `b2245fdc0cd881bdd49234a648bf9101d6bc80fb4452a8a9fd054e4156ade8a8` |
| `tests/oauth-rate-limit-retry.test.ts` | `48f498c20b82b5dec2c46674d410ba18ce7c1e9cb40881ca648f7f56031f2df9` |
| `docs/migration/runtime-test-inventory.md` | `496026e291d4303c196b1de5ab28a64e89a58b38a78683722f98a62981d5509f` |

| `tests/inflight-cancel-contract.test.ts` | `8e40048f04487c1c3de7dc3ec6e838f44632ae6b66345de77f069377018b716f` |
| `tests/multimode-backend-contract.test.ts` | `6a5ff47e1511e9209af20a6f8c665dc5feb070c4c6ee7d15330c1bd60dd7c538` |

## Review repair freeze — 2026-10-04

Main's canonical suite exposed two stale static source contracts after helper extraction. Updated only their anchors while retaining producer-to-consumer checks:
- inflight-cancel-contract now asserts postResponses → transportLifetime(ctx,provider,signal), requestResponses receives lifetime.signal, OAuth lifetime receives parent, and API combines controller.signal with parent. It no longer requires the obsolete local name fetchSignal.
- multimode-backend-contract now asserts postResponses delegates res/args/lifetime.wait to readResponses; that helper calls parseStream once with onPartialImage/onFinalImage. All other multimode assertions remain.

Independent review found the classic progress callback was unused, so the `writes===0` assertion was vacuous. Removed that assertion and callback; retained actual classic request-count and classifier assertions. Added real runtime callback cases:
- `OAuth deadline awaits already-entered image persistence callback`: real runOAuthImageJob callback enters and blocks; deadline100 fires while callback remains pending; finally release persists once and returns the completed image. Tracked timers end empty.
- `late noncooperative render after deadline never invokes image callback`: render promise ignores abort; deadline settles canonical504 before render release; finally release supplies a successful late image; callback remains uncalled and timers end empty.

Both use fake timers, entered deferred barriers, event-loop continuation drain and finally release. No production edits were needed; the five runtime SHA-256 fingerprints above were checked unchanged.

Fresh repair verification:
```sh
node --experimental-test-module-mocks --import tsx --test tests/inflight-cancel-contract.test.ts tests/multimode-backend-contract.test.ts tests/oauth-job-timeout.test.ts
npm run typecheck:tests
npm run test:inventory
```
All exited0. Actual cases: inflight3 + multimode4 + OAuth31 = **38 passed**, zero failures/cancellations/skips. Outer runner reports8 cases because OAuth is one isolated wrapper; its child reports31/pass31/fail0. Both new callback cases passed. Test typecheck and inventory passed. OAuth test file is now386 lines (still below500); no new test file or inventory registration was required in this repair.

Main owns the refreshed canonical full-suite run and review confirmation. Worker did not run the broad suite. Runtime/test edits are frozen again; evidence and021 rationale are complete.
