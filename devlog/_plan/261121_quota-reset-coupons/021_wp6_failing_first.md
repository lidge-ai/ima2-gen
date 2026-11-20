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
