# WP1 graph foundation evidence

Original source commits retained with author and `-x` provenance:

- `36b46b8ddcb50785b7a42ea9671ecc1a38705d98` -> `11d0e72f` (CLI graph compatibility).
- `c33990941967d0979a37736914a5fd02801f5714` -> `2366e823` (multiple parents core).

## CLI regression

`node --import tsx --test tests/cli-session-graph.test.ts` against the still-old
emitted CLI produced 2 passes and 4 failures: flat graph load, new-session first
save, missing-session diagnostic and version-conflict path. `npm run build:cli`
then emitted the imported source; the same six tests passed, 0 failures.
Additional malformed null/array file cases were added at the real CLI boundary
and passed after a small root-shape guard. Existing legacy nested graphs still pass.

Direct `.codexclaw/pr256-cli-probe.mjs --expect-fixed` returned exit 0, graph
version 7 and the synthetic node JSON on stdout, empty stderr. Only owned health
and session GETs occurred; child exited and fixture server closed. No provider
request or credential access was needed.

Independent CLI Sol review found that the legacy 200/null-session fixture did
not exercise the real HTTP 404 path. Added actual `SESSION_NOT_FOUND` response
coverage for load/save, preserving established exit code 5, exact stderr, empty
stdout, no PUT and no output file. Now seven CLI tests pass. Inventory was
regenerated with the existing script; final regeneration follows worker edits.

## Concurrent implementation ownership

Sol Hand: backend reference boundary, graph store and two named backend tests.
Sol Maker: UI graph/request types, role labels and named UI/E2E tests.
Main: CLI and its single test, docs, inventory, integration, final gates and PR.
No worker changes Git branches or commits. Backend/UI proof remains pending.

Backend delivery: 13 real route cases and three SQLite cases pass. Red proof
showed extra images absent from API/OAuth requests, invalid inputs reaching
dispatch, element inputs stealing base and reversed DB edges. Green proof uses
actual synthetic blue/red/green image bytes in provider payloads, bounded
extra-plus-user refs, missing input refusal and parent-only no-read behavior.
Existing provider-node suite also passes all 30 cases, preserving legacy behavior.
Source: `.codexclaw/evidence/260922-wp1-backend-graph-hardening.md`.

UI delivery: focused graph/cardinality/cycle/disconnect tests (56) and UI build
pass; hosted E2E remains pending. Element refs do not affect image parent roles.
Source: `.codexclaw/evidence/wp1-ui-multi-parent-receipt.md`.

First integrated full suite: 3,632 pass, 3 fail, 7 skip. All three failures are
obsolete source-token checks for the replaced batch parent map and child-rewrite
variables. Replacing them with actual batch behavior tests is in progress; this
result is not a passing integration gate. Main server/test typechecks, emitted
server/CLI builds and UI build pass on this integrated source.

After replacing the three obsolete source-token assertions with real store batch
invocations, integrated `npm test` passed: 3,636 pass, 0 fail, 7 existing skips
(3,643 tests, 335 suites). Batch tests exercise fresh selected/unselected child
lineage, secondary parent identity, image/video paths and partial failure with
independent continuation. Their fixture records zero network calls or leaked work.
Both typechecks, server/CLI/UI builds, inventory, line-count checker and diff
integrity pass. Local logs: `.codexclaw/pr256-wp1-full-tests.log` and
`.codexclaw/pr256-wp1-ui.log`. Independent final backend/UI review and hosted
Playwright evidence remain pending before merge.

Main found the original white edge-label text had a near-white dark-theme accent
background. It now uses existing paired accent/accent-ink and surface/text tokens;
hosted screenshots will verify the rendered result. No new theme token added.
