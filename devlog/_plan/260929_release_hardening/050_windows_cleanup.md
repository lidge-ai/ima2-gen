# 050 wp4 — Windows test cleanup hardening

The v3.24.1 promotion commit's main CI (run 36567549865) was red on the Windows leg only, with a
different flake on each attempt: attempt 1 `tests/structured-filename-pipelines.test.ts` after-hook
`EBUSY: resource busy or locked, unlink …\sessions.db`; attempt 2 `tests/lan-session.test.ts` hook
`EBUSY … ima2-execution-*\test.db` (temp root from `tests/_executionRouteIsolation.ts`) and
`tests/mcp-media-action.test.ts` "timeout waiting done" (8 s event wait); attempt 3 green. The same
tree was green on dev. A red main blocks the release cut by design, so these flakes stop releases.

Class C2 (tests only, no product change).

## Change

1. Every single-line `rm(…)` / `rmSync(…)` in `tests/` whose options are exactly
   `{ recursive: true, force: true }` becomes `{ recursive: true, force: true, maxRetries: 10, retryDelay: 100 }`.
   Node retries only on EBUSY, EMFILE, ENFILE, ENOTEMPTY and EPERM, with linear back-off
   (at most ~5.5 s, only when the error occurs), so passing runs do not change. Codemod:
   `perl -pi -e 's/(\brm(?:Sync)?\((?:(?!;).)*?)\{ recursive: true, force: true \}/$1\{ recursive: true, force: true, maxRetries: 10, retryDelay: 100 \}/'`
   over `tests/**/*.{ts,mjs,js}`; multi-line calls are listed and fixed by hand if they sit in
   an after/afterEach hook.
2. `tests/mcp-media-action.test.ts` `waitForEvent` default timeout 8000 → 30000 ms (the event
   arrived 1.1 s after the test gave up on the slow runner).
3. A contract test pins that no `rm`/`rmSync` in tests uses bare `{ recursive: true, force: true }`.

## Verifier

`npm test` (full suite, exit 0), `npm run typecheck:tests`, `npm run lint`; PR checks; post-merge
dev CI Windows leg green. Activation of the retry path cannot be forced on macOS; the evidence is
the Node documentation of `maxRetries` plus the Windows CI legs.

## Architect consultation (same Kimi architect, ALIGNED)

- D-W1 codemod scope validated: 260 sites in 151 files, all single-line, none on cpSync or in
  comments. Added: `/g` on the codemod, `git diff --stat` review and an `rg` zero-count gate.
- D-W2 shared helper rejected: Node's own retry is the needed behaviour; a helper would still touch
  every call site and complicate the promise variant.
- D-W3 30 s default accepted; the timeout message includes the value.
- D-W4 pin test builds its needle from pieces so it does not match itself.
