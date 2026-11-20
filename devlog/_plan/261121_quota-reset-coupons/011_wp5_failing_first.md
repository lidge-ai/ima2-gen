# WP5 failing-first evidence — partial implementation

Status: INCOMPLETE. This is a handoff, not approval to proceed to commit 3. The baselines deliberately lack required safety properties and must not be used for real redemption. The route, identity and confirmation modules, route tests, recovery and auto-redeem fencing tests, and most UI and client scenarios specified in 010 are not present. The real transport is not registered with the application. Do not interpret these results as a complete safety suite.

Base a66306d303ef2de21a78a8411d33d71f6eb5e089. All reset test files import the test guard first. Tests use only fake dispatches; each reset file's after hook asserted sentinel count zero. The guard control verifies the real transport is rejected before a socket. No consuming endpoint was called.

## Baseline results

Combined direct invocation of the six added files: 23 tests, 9 controls pass, 14 behavioral assertions fail, none skipped. Results below are individual cases, not suite summaries.

| File | Test | Baseline |
|---|---|---|
| quota-codex-windows | classifies the primary window by duration and gives it a stable id | FAIL: 5h vs 7d |
| quota-codex-windows | keeps missing utilization unknown | FAIL: 0 vs null |
| quota-codex-windows | keeps invalid duration unknown instead of assigning a positional label | FAIL: 5h vs null |
| quota-codex-windows | renders nonstandard durations exactly | FAIL: 5h vs 90m |
| quota-codex-windows | projects additional windows without duplicate ids | FAIL: 0 vs 4 |
| quota-codex-windows | rounds a known positional primary percentage | PASS |
| quota-codex-windows | returns no windows when limits are absent | PASS |
| quota-codex-credits | exposes balance and reset credit counts including usable now | FAIL: credits omitted |
| quota-codex-credits | retains an omitted observation only for the same account | FAIL: credits omitted |
| quota-codex-credits | maps codex plan names to display names | FAIL: prolite vs Pro 100 |
| quota-codex-credits | preserves a known email | PASS |
| quota-ui-credits | shows unknown NovelAI charge without a numeric meter value | FAIL: renders 0 meter and no dash |
| quota-ui-credits | renders a known NovelAI charge | PASS |
| reset-codex-client | projects the list count and display fields | FAIL: unprojected fields |
| reset-codex-client | classifies an unrecognized response as unknown | FAIL: raw response |
| reset-codex-client | sends one request id and no credit id | PASS |
| reset-operation-ledger | rejects a second unresolved claim for the same account | FAIL: second claim succeeds |
| reset-operation-ledger | fences a paused or wrong owner before sending | FAIL: wrong owner transitions |
| reset-operation-ledger | cannot send a row already abandoned by recovery | FAIL: abandoned row transitions |
| reset-operation-ledger | migrates twice and records a settled operation | PASS |
| reset-guard | blocks real transport before a socket | PASS |
| reset-guard | counts fake calls independently | PASS |
| reset-guard | keeps consume URLs in the transport module | PASS |

## Verifiers

- `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run test:inventory`: exit 0. Lint reported 93 warnings, 0 errors.
- `npm test`, isolated temporary HOME and unset IMA2_CONFIG_DIR: exit 1; 4244 tests, 4226 pass, 15 fail, 3 skipped. Fourteen failures are the behavioral assertions listed above; an existing `mcp-character-route` test also failed with 404 vs 400 under the full concurrent run. The complete `tests/mcp-character-route.test.ts` reran separately and passed (exit 0), so the full run does not establish that all existing tests pass.
- Earlier full run with global IMA2_CONFIG_DIR additionally failed two health assertions because those tests expect their own temporary HOME; the final run removed that override. An intermediate run also exposed stale structure counts and missing temp-cleanup retries; those were corrected before the final run.
- Per-function automated length report: NOT RUN. New files are below 500 lines; `lib/db.ts` is 399 lines by wc. Existing `server.ts` was not changed.
- Remaining planned reset, route, principal, replay, identity-change, recovery, revision, settings, watcher, full UI, locale-parity and report-driven tests: NOT RUN / NOT IMPLEMENTED.


## S2b partial follow-up (2026-11-21)

Status remains INCOMPLETE. Added naive recovery/owner-unknown ledger seams and five ledger behavioral tests; these are deliberately unsafe and not an implementation. Locale checks use nested dictionary lookup and compare the interpolation variables of all present quota feature keys across four locales.

| Test | Baseline |
|---|---|
| stale claimed becomes abandoned | FAIL: remains claimed |
| stale claimed releases reservation | FAIL: reservation remains |
| stale sending becomes unknown/recovered | FAIL: remains sending |
| owner unknown origin persists across reopening | FAIL: null, expected owner |
| stale account revision rejects claim | FAIL: claim succeeds |
| en, ko, zh-Hans, zh-Hant required reset labels | FAIL each: missing credits.balance |
| locale key and interpolation parity | FAIL: no reset quota translations |
| existing ledger and UI controls | PASS |

Direct ledger: 9 tests, 1 pass, 8 fail (five added); UI: 7 tests, 1 pass, 6 fail (five added). Ledger after hook sentinel count 0. No fake consume dispatch added or real consume call made.

| Verifier | Result |
|---|---|
| npm run typecheck | 0 |
| npm run typecheck:tests | 0 |
| npm run lint | 0 |
| npm run test:inventory | 0 |
| npm test (temporary HOME, IMA2_CONFIG_DIR unset) | 1: 4254 tests, 4227 pass, 24 fail, 3 skipped; all 24 are failing-first tests from this work and S2 |

NOT IMPLEMENTED: identity and confirmation baselines; quotaReset route registration and all buildApp route tests, including principal exposure, confirmation, replay, access control, identity switching, restart and acknowledgement; UI balance, zero/unknown counts, confirmation, remount behavior. The locale test establishes cross-locale parity over present keys and a small required subset, not an exhaustive product-key inventory. These gaps prevent COMPLETE status and require follow-up before implementation commit 3.
