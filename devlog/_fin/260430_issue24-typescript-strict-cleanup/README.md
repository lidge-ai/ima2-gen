# Issue #24 — TypeScript Migration (done)

**Status:** done / shipped on main. GitHub #24 is closed.
**GitHub:** https://github.com/lidge-ai/ima2-gen/issues/24
**Primary PRD (closed):** `devlog/_fin/260429_typescript-migration/` (phases 0–7).

## STATUS 2026-05-08 — Closed

Current `main` has root and UI TypeScript checks on strict mode:

- `tsconfig.json`: `strict: true`
- `ui/tsconfig.app.json`: `strict: true`
- `ui/tsconfig.node.json`: `strict: true`
- CI runs `npm run typecheck`, `npm run typecheck:tests`, `build:server`, `build:cli`, and UI build.

The older notes below are preserved as historical context from the phased
migration cleanup, but the original #24 planning/tracking issue is complete.

## STATUS 2026-04-30 — Partial / tracking

- Shipped: TypeScript migration phases 0-6 are on `main` (`accf797`, `3d8f85d`, `e06dec0`, `631f298`, `e8d58da`) and the primary plan is archived in `_fin/260429_typescript-migration/`.
- Remains: GitHub #24 is OPEN for strict-mode cleanup and leftover JS artifact strategy; keep this folder in `_plan`.

## What already shipped

The phased TypeScript migration described in `_fin/260429_typescript-migration/` is in `main`:

- Phase 0 — `accff97 feat(ts): phase 0+ tsconfig overlays, ts toolchain, express.d.ts`
- Phase 1 — types
- Phase 2 — `3d8f85d feat(ts): phase migrate lib/ to TypeScript`
- Phase 3 — `e06dec0 feat(ts): phase 3 migrate routes/ to TypeScript`
- Phase 4 — `6ff8ee1 feat(ts): phase 4 migrate server.ts and config.ts`
- Phase 5 — `631f298 feat(ts): phase 5 migrate bin/ CLI to TypeScript`
- Phase 6 — `e8d58da feat(ts): phase 6 test infra, package files, gitignore, structure docs`
- Phase 7 — pending: strict-mode cleanup, leftover JS files, sweep `lib/oauthProxy.js`/`routes/edit.js` duplicates.

## What this ticket still tracks

Strict-mode cleanup work that does NOT need a separate PRD; it follows
`_fin/260429_typescript-migration/phase-7-cleanup-strict.md`. No new diff-level
plan is required here. Open a new issue if a strict-mode change requires its
own PRD.

## STATUS 2026-04-30 (15:33 KST) — Safe sub-portion shipped, full strict deferred

### Shipped this pass

- `tsconfig.json`:
  - Removed `allowJs`, `checkJs`, `allowSyntheticDefaultImports`-no-op state.
  - `include` tightened from `.{js,ts}` globs to `.ts`-only.
  - `noImplicitOverride: true` flipped (0 errors).
- `tsconfig.bin.json` / `tsconfig.build.json`: already `.ts`-only and `allowJs: false` — no change required.
- `package.json#prepublishOnly`: already starts with `npm run typecheck` — no change required.

### Verification
- `npm run typecheck` PASS
- `npm run build:server` PASS
- `npm run build:cli` PASS

### Deferred — needs its own subticket

Flipping `strict: true` (with `strictNullChecks` + `noImplicitAny`) surfaces **1370 type errors** across `lib/`, `routes/`, `bin/`, `server.ts`, `config.ts`. That is not a "small fix" — it is a multi-day cleanup pass. Phase-7 strict flip stays parked here and should land as a dedicated subticket (e.g. `#24` Phase-7a/b/c) so each strict flag can be flipped, fixed, and shipped independently.

Recommended order when resuming:
1. `noImplicitOverride: true` ✅ done
2. `strictNullChecks: true` (largest single bucket)
3. `noImplicitAny: true`
4. `noUncheckedIndexedAccess: true` (do last; usually produces the most noise)
5. Final `strict: true` flag on, after the four above are clean.
