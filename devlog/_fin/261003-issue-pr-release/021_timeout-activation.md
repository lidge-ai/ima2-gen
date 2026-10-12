# wp2 activation fixtures and API compatibility

The approved 023 consumer amendment is authoritative for timeout identity: whole-job expiry is OAUTH_IMAGE_TIMEOUT504, standalone request/API timeout remains RESPONSES_IMAGE_TIMEOUT504.

Consumes 020 on dev be63eb0e; production OAuth owners are unchanged from the initial baseline. Previous D: dependencies are verified and merged; next direction is one OAuth job deadline. Post-merge platform CI remains tracked before the next merge. This document concretizes the remaining 020 rows before B and supersedes its incorrect hypothetical first-error fixture ordering.

## Exact test ownership

NEW tests/oauth-job-timeout.test.ts: core fixtures and four runtime cases from020 plus the cases below. MODIFY tests/responses-adapter-safety.test.ts: API-only compatibility cases. If a test file would exceed500 lines, split cohesive API compatibility tests into NEW tests/responses-api-abort-compat.test.ts using the same existing public postResponses entry and isolated process helper; inventory generator discovers both. No shared production API exported only for tests.

Use existing executionTestProcess isolation and module-mock flags. Deny real network. Use fake setTimeout/Date and explicit entered-stage deferred barriers. Await node:timers/promises setImmediate only to drain continuations, never a wall-clock sleep. Existing fixtures plannerSse/imagesJson are reused. A deferred helper exposes resolve/reject so held baseline bodies can be released in finally after assertions; a RED test must terminate rather than hang.

## API-key invariants

Parameterize actual postResponses(provider:"api") over timeout and external cancel. Fetch returns an already-buffered SSE response containing response.output_item.done/image_generation_call/result. onFinalImage signals entered and awaits a deferred persistence promise. Once entered, fire the100ms timeout or parent.abort(); drain one event-loop turn; assert the outer promise has NOT settled. Resolve persistence in finally, await result, assert one image. This fails if shared parseStream is wrapped in an abort race.

Negative timeout: wrap fake setTimeout to record the supplied delay and schedule negative values at1ms for deterministic clock execution. ctx.config.oauth.generationTimeoutMs=-1. Fetch signals entered and awaits its signal. Assert scheduled delays include -1, tick1, assert status504/codeRESPONSES_IMAGE_TIMEOUT/message "Responses image generation timed out". OAuth normalization must not affect this API branch.

Existing API catch-time precedence: hold fetch rejection; fire the API timer, then external parent.abort(), then reject fetch with DOMException("aborted","AbortError"). Assert499/GENERATION_CANCELED/"Generation canceled". OAuth first-abort semantics must not silently change API precedence.

## OAuth reachable cases

| Named runtime test | Setup/trigger | Observable oracle |
|---|---|---|
| planner budget reduces render time | planner held60ms, renderer entered, tick40 | job504 exactly at100ms; no new render budget |
| planner retry shares deadline | first planner returns no call, second planner entered, tickremaining | same job504; no render request afterabort |
| readiness job deadline | starting state+held readinesspromise, statusTimeout1000/job100 |504, zero upstreamcalls |
| earlier readiness status timeout | starting+held readiness; statusTimeout20/job100; timer-entered barrier |503/OAUTH_UNAVAILABLE at20, later tick1000 causes no reclassification/call |
| direct mode timeout | direct maxImages1, held render |504 at100, no planner |
| user cancel scenarios | pre-aborted, duringplanner, duringrender, duringbackoff |499; no later call; private reason not echoed |
| admitted backoff timeout | transient429; injected sleep signals entered then holds |504 when jobexpires, requestcount1 |
| retry budget shortfall | requestedwait cannot fit remainingbudget | retain original429 as existing tests require |
| noncooperative response body | direct response.text returns held deferred; enter body then tick100 | outer promise settles504 before bodyrelease; finally reject body late and observe no unhandled rejection |
| completed images survive timeout | two prompts, one successcallback barrier and one held |successoriginalIndexes preserved, timeouterror retained |
| first-error planner ordering | slot0 processed400 BEFORE tick100; slot1success; slot2held |error400 with imageindex1; reverse slot0held/slot2early400 returns504 with index1 |
| cleanup across outcomes | success, upstreamfailure, cancel, readinesssuccess and readiness503 |trackedtimerhandles empty; parent abortlistenercount back tobaseline; later tick no calls |
| zero/negative/nonfinite OAuth timeout | explicit0,-1,NaN,Infinity |no jobtimer, parentcancellation still499 |
| positive fraction |0.5ms |normalized1ms |

First-error fixtures need explicit barriers showing each early error was processed; a response resolving after a deadline cannot be expected to replace the timeout already selected by withOAuthAbort.

## Cleanup instrumentation

Wrap fake setTimeout/clearTimeout and track handles. The timeout callback deletes its own handle before running the real callback; clearTimeout deletes its handle before delegating. Capture getEventListeners(parent.signal,"abort").length before entry and after settlement. For readiness-success, start held readiness, signal timer creation, set state ready and resolve shared promise; verify no dangling status timer. This exercises actual wrapper/readiness cleanup rather than only calling helper.dispose directly.

## Main/worker boundary and verification

Worker owns only the020 runtime files, named tests and generated inventory; may add cohesive helper/test split if500-line contract requires, but must first record the exact file and responsibility here. Main owns structure/03-server-api.md, structure line-count regeneration, changelog/PR/git and external gates. Preserve all existing partial-result fields and API-key behavior. New/modified functions stay under50 lines; the old large job body may be split into cohesive collect/render helpers without changing ordered-slot behavior and with tests covering that flow. No scheduler architecture or broad cleanup.

Observe red before production changes for planner+render cumulative timeout and noncooperative body. Then green named tests and adjacent OAuth rate-limit/lane/Responses-safety suites, both typechecks, lint, inventory, server/CLI build and canonical npm test. Source/model/provider calls are mocked; no paid generation. C must contain reachable activation evidence and independent code review. Main will capture the actual command outputs; proposed code is not proof.

## Accepted architect reflection

WP2-ARCH-01..05 ALIGNED (architect01a1020f-23c4-7fa0-a5e4-1e627cd5e059). Clarifications folded before independent A: reverse first-error fixture waits for slot2 response/body handling and drains continuations before the deadline; it cannot await the blocked ordered collector or slot1 onFinalImage while slot0 remains held. Forward case may use slot1 delivery to prove slot0 error already collected.

Retain EVERY020 additional test, explicitly queued-fourth/no-new-call afterabort and both first-abort orders. Add readiness-cancellation case (starting+held shared readiness, parentabort→499, no fetch/status timer leak) and absent job-local timeout case (ctx config timeout undefined uses configured global timeout; fake-clock capture proves that value, then abort/cleanup without waiting in real time). These supplement the table rather than replacing prior acceptance rows. No module responsibility changes.

## Independent A audit amendment

Reviewer01a10240-30ec-7c03-8bb7-390950c02ed5 found the existing oauth-rate-limit-retry.test.ts pre-aborted non-rate-limit case contradicted the new entry guard. Accept and MODIFY that test explicitly: (a) signal aborted BEFORE invocation asserts GENERATION_CANCELED499 and request-call count0; (b) request enters, then aborts its parent and throws a non-rate-limit boom, asserting the original boom is preserved by the existing catch bypass. Both cases replace the ambiguous old pre-abort/boom expectation; no behavior assertion is dropped. Add this file to worker write scope. This clarifies tests for the already-approved flow, not a new production design decision.

## Implementation split record (before file creation)

Use NEW `tests/responses-api-abort-compat.test.ts` for the four cohesive API transport compatibility scenarios and standalone OAuth request-timer contract. Keep existing Responses safety cases untouched. The new OAuth job suite has the separately mocked backend and fake-clock job activation cases; mixing both isolation setups would complicate restoration and exceed the 500-line limit. Production function-length splits stay within current owners: `responsesTransport.ts` gets response-reading and lifetime/error helpers; `oauthImages.ts` gets render-slot startup and ordered collection helpers. No new production surface or scheduler is introduced.

## Independent review / canonical-suite test repair

Main authorized two additional existing source-contract tests after the full suite found stale implementation anchors. `tests/inflight-cancel-contract.test.ts` now traces the actual postResponses signal into transportLifetime, the resulting lifetime.signal into requestResponses, and both OAuth/API parent-signal producers. `tests/multimode-backend-contract.test.ts` now traces postResponses → readResponses with unchanged args/wait and then parseStream with onPartialImage/onFinalImage. No runtime source is changed to satisfy source text.

Replace the classic test's unused progress callback/count assertion with actual runOAuthImageJob callbacks: `OAuth deadline awaits already-entered image persistence callback` holds persistence across deadline and proves pending→release→success; `late noncooperative render after deadline never invokes image callback` releases a late successful render after timeout and proves zero callback invocations. Both use entered barriers, fake clock and finally cleanup. The classic test retains meaningful upstream count1 and real classifier/normalizer assertions.
