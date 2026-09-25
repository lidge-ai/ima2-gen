# TypeScript Migration Follow-Up — Strict + Tests + Runtime Artifacts

**Issue:** [#24 — TypeScript migration: investigate phased conversion path](https://github.com/lidge-ai/ima2-gen/issues/24)
**Status of #24:** Closed on 2026-05-08 after re-checking current `main`: root and UI TypeScript configs are strict, and CI enforces typecheck/build gates. This folder is archived historical planning context.
**Out of scope:** UI/React TS work (UI is already 100% TS), framework swap, bundler rewrite.

> **GPT Pro verification:** see [`_gpt-pro-verification.md`](./_gpt-pro-verification.md) (session `01KQSRCN626PGR4NYAV117TM2V`). Key revisions accepted from review:
>
> 1. **Reorder phases**: do test-runner infra (`tsconfig.tests.json` + `classify-tests.mjs`) and runtime-test conversion **before** strict flags. → see P07 (will be promoted to early phase) and the new "Phase 1 / Phase 2" sketch in the verification doc.
> 2. **Expand strict order**: insert `alwaysStrict`, `noImplicitThis`, `strictBindCallApply`, `strictBuiltinIteratorReturn` as discrete steps in addition to the flags already covered by P01/P02/P05/P06. Final order: `alwaysStrict → useUnknownInCatchVariables → noImplicitThis → strictBindCallApply → noImplicitAny → strictFunctionTypes → strictNullChecks → strictPropertyInitialization → strictBuiltinIteratorReturn → strict:true → noUnusedLocals/Parameters`.
> 3. **Defer P11 (dist/ outDir migration) to after strict:true lands.** GPT Pro flagged it as a packaging-risk item that should not be bundled with type-safety work. Keep co-located emit during P00–P09. Do P11 last as a separate packaging migration, gated by `npm pack --dry-run --json` audit.
> 4. **CI matrix**: add Node 24 alongside Node 22 (Node 20 EOL 2026-04-30). Update P00.
> 5. **Standard verify gate (every phase exit)**: `typecheck → typecheck:tests → ui:build → build:server → build:cli → test → lint:pkg → test:package-install`; add `check:lines` from P04 onward, `pack:dry-run` from P11.
>
> Existing P00–P11 phase files remain accurate at the diff level; the README order below reflects the revised sequence.

---

## 0. Current state (verified 2026-05-04)

| Surface | Files | TS | JS | Notes |
|---|---|---|---|---|
| `lib/` | 50 | 50 | 0 (gitignored emit) | source 100% TS |
| `routes/` | 17 | 17 | 0 (gitignored emit) | source 100% TS |
| `bin/` | 30 | 30 | 0 (gitignored emit) | source 100% TS |
| Root | `server.ts`, `config.ts`, `types/express.d.ts` | TS | gitignored emit | |
| `ui/` | 141 | 141 | 0 | fully TS (Vite/React) |
| `tests/` | 124 | 0 | 124 `.test.js` | runs via `node --import tsx --test` |
| `scripts/` | — | — | 5 `.mjs` + 4 sh/ps1 | tiny orchestration |

**tsconfig.json (current):** `strict:false`, `noImplicitAny:false`, `strictNullChecks:false`, `noUnusedLocals:false`, `noUnusedParameters:false`. ON: `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`.

**Build pipeline:** `tsc -p tsconfig.build.json` emits `.js` next to each `.ts` (`outDir:"."`); `tsc -p tsconfig.bin.json` does the same for `bin/`. `prepack` runs `ui:build && build:server && build:cli` so npm tarball ships only the `.js` artifacts (TS source not in `files[]` except `server.ts`/`config.ts` carried as references).

**CI:** `.github/workflows/ci.yml` runs ubuntu+windows on Node 22: `npm ci` → ui install/build → `npm test` → `lint:pkg` (ubuntu only). **No `typecheck` step. No `build:server`/`build:cli` step.** Strict-mode regressions are currently invisible to CI.

**Strict-flag pain measured (per flag, in isolation):**

| Flag | tsc errors |
|---|---|
| `strictFunctionTypes` | 0 ✅ |
| `noUnusedLocals` | 5 |
| `noUnusedParameters` | 8 |
| `useUnknownInCatchVariables` | 152 (one shape: `err.message/.code/.status`) |
| `strictNullChecks` | 291 |
| `strictPropertyInitialization` | ~0 (no class fields) |
| `noImplicitAny` | **1,205** |

**Type debt:** 222 `: any`, 10 `as any`, **0** `@ts-ignore` / `@ts-expect-error` (clean).

**Large-file split candidates (>500 lines):**

| File | LOC | Strict-mode errors |
|---|---|---|
| `lib/oauthProxy.ts` | **1,003** | 60 noImplicitAny, 21 `: any` |
| `routes/nodes.ts` | 455 | borderline |
| `bin/ima2.ts` | 444 | borderline |
| `bin/commands/prompt.ts` | 421 | borderline |
| `routes/prompts.ts` | 379 | 46 strictNullChecks, 30 noImplicitAny |
| `routes/promptImport.ts` | 354 | 46 noImplicitAny |
| `lib/responsesImageAdapter.ts` | 352 | 43 noImplicitAny |

Full inventory: `_inventory.md` (in this folder).

---

## 1. Phase map

```
P00 ──┬──> P01 ──> P02 ──┬──> P03 ──> P05 ──> P06 ──> P09 ──> P11
      │                  │
      └──> P07 ──────────┘                ┌──> P08 (parallel after P00)
                                          │
                                          └──> P10 (independent)
P04 (preceding any "deep" oauthProxy work in P05/P06)
```

| # | Phase | Effort | Depends on |
|---|---|---|---|
| **P00** | CI hardening: add `typecheck` + `build:server` + `build:cli` jobs | XS | — |
| **P01** | Strict easy-wins: `strictFunctionTypes`, `noUnusedLocals`, `noUnusedParameters` | XS | P00 |
| **P02** | Catch-clause helper + `useUnknownInCatchVariables` | S | P01 |
| **P03** | `RuntimeContext` interface (replaces `ctx: any = {}`) | S | P02 |
| **P04** | Split `lib/oauthProxy.ts` (1003 → 8 files, barrel re-export) | M | P00 (logically independent) |
| **P05** | `strictNullChecks` rollout (291 errors, 10 hot files) | M | P03, P04 |
| **P06** | `noImplicitAny` rollout (1,205 errors, 4 sub-phases by directory) | L | P03, P04 |
| **P07** | Convert ~38 high-value tests (.js → .ts) — runtime + integration only | M | P00 |
| **P08** | (Optional) Split borderline files: `routes/nodes.ts`, `routes/prompts.ts`, `routes/promptImport.ts`, `lib/responsesImageAdapter.ts`, `bin/ima2.ts`, `bin/commands/prompt.ts` | M | P00 |
| **P09** | Flip `strict: true` and remove individual `false` overrides | XS | P05, P06 |
| **P10** | Scripts: add `// @ts-check` headers to `scripts/*.mjs` | XS | — |
| **P11** | Build artifact layout: move `outDir` → `dist/`, fix `bin/ima2.ts:177` `serverPath` resolution | M | P09 (decoupled from strict work) |

**XS** ≤ 1 PR, ~30 min coding.
**S** ≤ 1 PR, half day.
**M** 1–3 PRs, 1–3 days.
**L** 4+ PRs, sustained — but each sub-phase is independently mergeable.

---

## 2. Sub-agent / employee usage policy (per user directive)

- **Sub-agents allowed:** `claude-opus-4.7`, `gpt-5.5` only.
- **Employees allowed:** any (`Frontend`, `Backend`, `Data`, `Docs`).
- **Verification:** GPT Pro via `agbrowse web-ai query --vendor chatgpt --model pro --inline-only` — required at **gate reviews** (after P03, P04, P06, P11).
- **Research tools:** `context7`, web search, GPT Pro consult — use freely on ambiguous decisions.

Per-phase recommended dispatcher is listed in each phase file.

---

## 3. Acceptance criteria (issue #24)

Reproduced verbatim with how this plan satisfies each:

| #24 criterion | This plan |
|---|---|
| Produce a phased migration PRD before broad implementation | ✅ This folder + per-phase diff specs |
| No large mechanical conversion without approval | ✅ Each phase has its own approval gate (P-A-B-C-D friendly) |
| Preserve ES Module imports/exports | ✅ No CJS introduced; barrel re-exports keep import paths stable |
| Keep CI green at every phase | ✅ P00 adds `typecheck` + build steps so green is enforceable |
| Avoid mixing TS migration with unrelated feature work | ✅ Each phase is single-purpose |

---

## 4. Files in this folder

| File | Purpose |
|---|---|
| `README.md` | This file |
| `_inventory.md` | Verified inventory (sub-agent claude-opus-4.7) |
| `P00-ci-hardening.md` | Add typecheck + build to CI |
| `P01-strict-easy-wins.md` | strictFunctionTypes / noUnusedLocals / noUnusedParameters |
| `P02-catch-clauses.md` | errInfo() helper + useUnknownInCatchVariables |
| `P03-runtime-context.md` | RuntimeContext interface |
| `P04-split-oauthproxy.md` | Split lib/oauthProxy.ts (1003 LOC) |
| `P05-strict-null-checks.md` | strictNullChecks rollout |
| `P06-no-implicit-any.md` | noImplicitAny — 4 sub-phases |
| `P07-test-migration.md` | Convert ~38 high-value tests |
| `P08-split-borderline.md` | Optional splits |
| `P09-strict-true.md` | Final flag flip |
| `P10-scripts-ts-check.md` | // @ts-check polish |
| `P11-dist-outdir.md` | outDir → dist/, runtime path fix |
| `_gpt-pro-verification.md` | GPT Pro review of this plan (filled at end) |

---

## 5. Execution etiquette

- **One phase per PR.** PR title format: `ts-migration: P0X — <goal>`.
- **Each PR runs locally:** `npm run typecheck && npm test && npm run build:server && npm run build:cli && npm run ui:build && npm run lint:pkg && npm run test:package-install`.
- **Rollback unit:** single revert commit per phase. Phase files keep work atomic.
- **Strict flag flips:** `tsconfig.json` only. Never bypass with `// @ts-ignore` to land a flag flip; either fix the code or defer the flag.
- **Barrel re-exports stay stable forever** — do not break public import paths within `lib/`, `routes/`, `bin/`.
