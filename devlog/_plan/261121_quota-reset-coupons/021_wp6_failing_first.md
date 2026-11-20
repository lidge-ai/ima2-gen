# WP6 failing-first evidence (partial)

## S6b-A additional baseline (partial)

On the naive baseline, `node --test tests/reset-grok-grpc.test.ts tests/reset-grok-identity.test.ts tests/reset-grok-routes.test.ts` ran 29 tests: 7 pass, 22 fail, 0 skipped. The new long-token varint, redirect-with-sub and non-string-sub cases all failed; the pre-existing per-test results below remain applicable. The sentinel assertions passed. This is not the full requested route and identity matrix.

Base: 87cf2847bbee85ea89d580114425e470ad889d0c. This is **incomplete**: the new reset modules are deliberately unsafe, unconnected test baselines and must not be wired into dispatch or used as an implementation. Fixtures and transports are synthetic; no real consume or redeem was called. Each reset test imports the guard first; all after hooks passed with socket sentinel count 0.

## Per-test baseline

| File / test | Result |
|---|---|
| reset-grok-grpc: two tokens | FAIL: baseline returns empty list |
| reset-grok-grpc: truncated frame, bad varint, missing trailer, conflicting status, nonzero status, HTTP 200 with grpc-status 7 | FAIL: each of six list checks accepts invalid input and each of six redeem checks reports success |
| reset-grok-grpc controls: empty list, field-one redeem, complete success | PASS (3) |
| reset-grok-identity: untrusted host, HTTP scheme | FAIL: returns identity instead of null |
| reset-grok-identity: manual redirect/signal, oversized response, non-success response | FAIL: missing redirect policy, accepts oversize and non-success |
| reset-grok-identity controls: stable sub, missing/malformed sub, missing discovery endpoint | PASS (4) |
| reset-grok-routes: list via buildApp and injected transport | FAIL: 404 instead of 200; transport assertions not reached |
| quota-grok-weekly: product usage and prepaid balance | FAIL: fields dropped |
| quota-grok-weekly: CLI source label | FAIL: source absent |
| quota-grok-weekly: existing percent and period control | PASS |
| reset-auto-redeem: enable from second connection after boot | FAIL: cached disabled flag |
| reset-auto-redeem: starts disabled, three ticks without inspection | PASS |

## Verification

| Check | Result |
|---|---|
| npm run typecheck | exit 0 |
| npm run typecheck:tests | exit 0 |
| npm run lint | exit 0, 93 warnings |
| npm run test:inventory | exit 0 |
| tests/billing-source.test.ts | exit 0, 7 passed |
| npm test, isolated temporary HOME and dispatch disabled | exit 1; 4312 tests, 4286 pass, 23 fail, 3 skipped. 22 failures are the tests above; the remaining failure is `ui-build-receipt-transaction.test.ts`, archive impersonation case, `UI_RECEIPT_BUILD_CHANGED`. |
| ui-build-receipt-transaction.test.ts isolated after full run | exit 0, 17 passed. With the 200 ms delay removed it failed in both full runs (different receipt cases); locally observed flakiness. |

## Missing work

Identity tests do not cover redirect response, timeout, precise deadline, RPC counts, mismatch or refresh/id-token cases. Route tests do not cover confirmation, redeem, reservation, restart, unknown or cross-account cases. Weekly tests do not cover ima2-session precedence or monthly fallback ordering. Auto-redeem tests do not cover credit selection, clock/lead timing, CAS disable/release, revision, scheduler races, restart, expiry, unknown or validation. The route test's later assertions are not reached at baseline. Full user-requested coverage and successful verifier condition are therefore NOT MET.

## WP6 S6b-B additional baseline (32edc8a3)

Command: `node --experimental-transform-types --test tests/quota-grok-weekly.test.ts tests/reset-auto-redeem.test.ts tests/billing-source.test.ts`: 15 tests, 9 pass, 6 fail; socket sentinels passed.

| Test | Baseline |
|---|---|
| ima2 session preferred | FAIL: CLI bearer used first |
| session failure falls back to CLI | FAIL: session not attempted |
| product usage / prepaid balance | FAIL: dropped |
| CLI source label | FAIL: absent |
| observe disable from another connection | FAIL: cached flag skips initial inspection |
| observe enable from another connection | FAIL: cached flag |
| weekly percent / end control | PASS |
| disabled ticks control | PASS |
| billing-source tests (7) | PASS |

## S6b-A2 route baseline

On a9d601d5, `node --experimental-transform-types --test tests/reset-grok-routes.test.ts` ran 10 tests: 1 pass, 9 fail, 0 skipped. The userinfo-unavailable control passes because the route is absent. Listing, confirmation/dispatch, changed identity, all three restart states, both invalid RPC replies and missing-coupon recovery fail because the Grok routes do not exist. The socket sentinel passed (0). Fixtures use only fake transports and a temporary database; no real RPC was sent. Several later assertions are necessarily unreached until the route exists.

### S6b-B implementation verification and coverage gap

The five reservation/settings tests added with the implementation were not run against the naive baseline; they are not failing-first evidence. Final focused run: `node --import tsx --test tests/quota-grok-weekly.test.ts tests/reset-auto-redeem.test.ts tests/billing-source.test.ts`: 20 passed, 0 failed, socket sentinels 0. These include settled target reservation, unknown after restart, disable before send, expired credit, and settings bounds. Missing requested behavioral evidence includes forced concurrent scheduler interleavings, revision mismatch and re-inspection, lead change rescheduling, route GET/PUT integration and disabled zero-fetch counting. This is not a completed acceptance record.

## S6b-B2

Baseline: 0653bd84, with concurrent Grok lane work present in the working tree. All transports were synthetic and the network sentinel was zero. `node --import tsx --test tests/reset-auto-redeem.test.ts tests/reset-settings-routes.test.ts` ran 16 tests, 16 passed, before implementation changes. The new tests below are post-implementation guards, not failing-first evidence:

| Case | First run |
|---|---|
| disabled: zero transport calls over three ticks | PASS, guard |
| enable after boot within one tick | PASS, existing guard |
| lead change reconfigures inspection | PASS, guard |
| disable after claim: abandoned and reservation released, zero send | PASS, existing guard |
| manual claim between inspection and CAS: re-inspect, no stale dispatch | PASS, guard |
| two connections, second inspection paused until first settles | PASS, guard |
| restart inside lead window: one attempt | PASS, guard |
| unknown after restart: no redispatch | PASS, existing guard |
| buildApp GET default, PUT validation 1–60 | PASS, guard |
| buildApp PUT invokes reconfiguration | PASS, guard |
| buildApp LAN token and origin protection | PASS, guard |
| lead change during active inspection | FAIL, failing-first: expected two inspections, observed one (`node --import tsx --test --test-name-pattern='reconfigures again when lead changes during an inspection' tests/reset-auto-redeem.test.ts`, 1 failed). |

After the queued-reconfiguration fix, the complete requested reset/quota glob passed: 128 tests, 0 failures, 0 skipped, sentinel assertions 0. `npm run typecheck` and `npm run typecheck:tests` exited 0; `npm run lint` exited 0 with 93 warnings and 0 errors. These checks ran with a temporary HOME/config/database and dispatch disabled; the concurrently owned Grok lane was present in the working tree. The new failing-first case passed in that run.

## S6c

Base: 793f3b3b. `node --import tsx --test tests/quota-ui-grok.test.ts`: 4 tests, 0 pass, 4 fail, 0 skipped; sentinel 0. The two coupon panel tests fail because the component does not exist, the transport test because its module does not exist, and the settings test because the bounded lead input is absent. Later assertions in those tests were not reached. All transports are synthetic; no redeem was called.

S6c final verification: quota UI, i18n and radius contracts: 47 passed. Typecheck, test typecheck, lint (93 warnings), inventory, structure counts, UI build, server build and CLI build passed. Full `npm test` in a temporary HOME with dispatch disabled: 4,349 tests, 4,343 passed, 3 failed, 3 skipped. The three failures are `ui-build-receipt-transaction.test.ts`: source edits, selected font source, and archive impersonation; all reported `UI_RECEIPT_BUILD_CHANGED`. The file was rerun twice in isolation: 16/17 passed on the first rerun (font source failed), and another case failed on the second rerun. Prior S6b evidence records this receipt test as flaky. An earlier full run exposed three stale test contracts, fixed and rerun separately; a further run had a local listener failure in api-cache-policy, fixed by binding loopback and rerun in isolation. No live coupon or consume request was made. Browser visual QA was not run.
