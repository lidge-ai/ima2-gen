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

## Concurrent implementation ownership

Sol Hand: backend reference boundary, graph store and two named backend tests.
Sol Maker: UI graph/request types, role labels and named UI/E2E tests.
Main: CLI and its single test, docs, inventory, integration, final gates and PR.
No worker changes Git branches or commits. Backend/UI proof remains pending.
