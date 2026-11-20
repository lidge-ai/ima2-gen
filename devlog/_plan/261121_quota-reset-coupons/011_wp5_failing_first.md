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
