# PR 256: reviewable Node Studio contributions

PR #256 combines graph fixes, node controls, portable templates, media processing,
server workflows and fashion presets. This unit extracts those changes into
ordinary, independently reviewed PRs. Verified contributions land on `dev`;
contributions with unresolved blockers remain reviewable drafts with concrete
findings. The original contributor's authorship stays visible.

## Loop contract

- Archetype: satisfy-spec, sequential delivery with independent Sol reviews.
- Trigger: maintainer requested splitting #256 and deciding with Sol which PRs to merge.
- Goal: account for every original feature, publish reviewable slices, merge safe slices into `dev`.
- Non-goals: `main`, release/publication, credentials, original fork workflow approval,
  unrelated refactoring, original PR closure, native GitHub stacks.
- Verifiers: canonical Node tests, server/test typechecks, inventory and structure
  checks, UI build and hosted Playwright; each observes its actual source below.
- Stop: every slice has a published delivery/disposition and fresh proof, final
  remote `dev` and clean local state verified.
- Artifacts: this numbered unit, GitHub PR bodies, local `.codexclaw` evidence.
- Outcomes: DONE only after accounting/delivery; unresolved defects mean draft,
  not merge. External blockers are recorded precisely. No fabricated green checks.
- Escalation: new authority, missing access, or changes beyond contributor scope.
- Resources: repository/`gh`/existing toolchain only; user permitted unlimited Sol
  delegation count. No user token/time limit; scoped calls and bounded concurrency.

## Frozen inputs

| Input | Revision |
|---|---|
| Current dev | `203fa69d0cad38c9f1d18dfc9b546e48524a14c0` |
| Contributor head | `e3a731cbd2ba4600e8cf06951126486860ff5fa2` |
| Common ancestor | `5f33e44a7886580330ee03ea58a71a4d842014e5` |
| Source | https://github.com/lidge-ai/ima2-gen/pull/256 |

The source delta contains 53 commits and 83 files. Read source by immutable SHA;
do not overwrite complete files from the fork where dev already changed them.
Cherry-pick isolated commits with `-x`; partial extraction commits retain
TuanTicker as original author, existing co-author trailers, and a full
`Original-Commit` SHA. Main's subsequent hardening uses separate commits.

## Existing owners

```text
bin/commands/session.ts       CLI graph client
lib/sessionStore.ts          SQLite graph normalization
lib/nodeGeneration.ts        provider admission and node generation
routes/nodeTemplates.ts      template API
ui/src/components/           NodeCanvas and ImageNode
ui/src/store/                graph, generation, video and session slices
ui/src/lib/                  graph derivation and reference storage
tests/                       canonical node:test contracts
ui/e2e/                      hosted-only isolated Playwright fixtures
structure/                   current architecture and file inventory
```

Reuse these owners and the existing devlog convention. Do not introduce a parallel
provider stack or general workflow framework. API model selection from #257 and
macOS signing from #258 must remain intact.

## Baseline evidence

On the frozen dev: `npm run typecheck`, `npm run typecheck:tests`,
`npm run test:inventory`, and `node scripts/refresh-structure-line-counts.mjs --check`
all exited 0. `npm test` executed 3,628 tests: 3,621 passed, 0 failed, 7 skipped
(local `.codexclaw/pr256-baseline-tests.log`). `npm --prefix ui run build` exited 0,
with the existing bundle-size warning (`.codexclaw/pr256-baseline-ui.log`).
Post-merge dev CI run 35719863699 finished successfully on the frozen dev SHA.

`scripts/run-tests.mjs` reads all `tests/*.test.[cm]?[jt]s` files; typecheck uses
`tsconfig.json`, test typecheck includes `tests/**/*.test.ts` and JS contracts.
UI build runs TS, E2E typecheck and Vite. PR Fast Gate executes backend full tests
and an independent hosted frontend E2E job against the PR merge SHA, recording
both contributor head and tested merge identity. Windows E2E is intentionally not
run: `ui/e2e/fixtures/appServer.ts` requires disposable GitHub-hosted Linux.

## Dependency roadmap

| Cycle | Deliverable | Actual prerequisites | Executable design |
|---|---|---|---|
| WP0 | source-accounted roadmap | frozen source and baseline | this document and 008 |
| WP1 | CLI graph compatibility and ordered multiple parents | WP0 | 010_graph_foundations.md |
| WP2 | image lightbox, film action icon and copyable node identity | existing Node UI, WP1 integration | 020_node_ui.md |
| WP3 | safe structured upstream diagnostics | existing parser | 030_safe_diagnostics.md |
| WP4 | portable template import/export | existing store and WP1 graph | 040_portable_templates.md |
| WP5 | durable node references | WP1 graph contract | 050_node_reference_persistence.md |
| WP6 | bounded normalized media merge | existing generated-file boundary | 060_media_merge.md |
| WP7 | generic workflow execution and history | WP1, WP5, WP6; WP4 for template examples | 070_workflow_runtime.md |
| WP8 | fashion specialization and final source accounting | WP4, WP5, WP7 | 080_fashion_and_delivery.md |

This is a dependency DAG delivered in the table's serial order; the goalplan's
serial dependency edges prevent concurrent branch mutation, not artificial
architectural dependencies. Each cycle revalidates its prewritten design on the
latest integrated tree. Complete original diffs are referenced by pinned Git
source/commit and exact path selectors in each decade doc, with mandatory
before/after corrections stated there; no moving fork head is an implementation
specification. The 83-path ledger is [008_source_accounting.md](008_source_accounting.md).

## Consultation

Native V1 subagents, requested `gpt-5.6-sol`, no history fork:

- Architect `01a0c8f6-5a61-7e73-8d9f-b95a6785e1ac`: dependency/source extraction proposal.
- Explorer `01a0c8f6-5bb3-71f1-b068-f7cbabb18c20`: frontend grouping and concrete blockers.
- Explorer `01a0c8f8-5ead-7993-b5ab-ea1b7f379603`: diagnostics and media boundaries.

These are requested model IDs; downstream served-model telemetry is not yet observed.
Main accepted ARCH-256-01 graph owners/ordered refs, ARCH-256-03 portable boundary,
ARCH-256-04 separate process boundary, and ARCH-256-05/06 generic/durable separation.
ARCH-256-02 is amended: raw text is rejected after the security counterexample;
structured code/type only. ARCH-256-07 remains specialization after generic runtime.
Basic independent UI is extracted into WP2. Durable references move before runtime
so their migration/order behavior is independently tested. Kernel/history may be
two ordinary PRs within WP7; each must compile/test on its own base.
Concrete plan revision: these eight decade docs plus source ledger, written
2026-09-22. Same-architect reflection and independent audit follow before lock.

Architect reflection: initially MISALIGNED on runtime PR boundaries, generic role
placement, attribution and missing-outfit policy. Main accepted all four and
amended 000/008/070/080. Same handle rechecked and returned ALIGNED on 2026-09-22,
including the final-reference-to-provider correction in 010. No residual material
architecture gaps; independent A audit is the next gate.

## Delivery policy

Each PR gets its own source review, tests and CI. No tip-only testing or admin
bypass. Merge uses the reviewed head SHA and stops on unresolved High/Critical
findings. Unready advanced features remain concrete draft PRs, including exact
blockers and tests needed for promotion. Sequential PRs target current `dev`;
only a deferred dependency requires an explicitly documented manual chain.

## Continuity

WP0 P: source frozen, scope/authority and clean baseline verified; consultation in progress.

WP0 A: independent Sol reviewer Halley (`01a0c907-d478-7b70-ad5d-e1cd7355ed48`)
returned GO-WITH-FIXES (one blocker): WP2 omitted the copy-ID introduction commit.
Main accepted it and added only the copy-ID/header/style/locale hunks from
450aa45b before the drag/truncation follow-ups. No other material gaps were found.
Roadmap topology checker confirmed all 83 paths and 11 numbered documents.

WP0 B/D direction: roadmap locked after the accepted correction. The next cycle
executes 010 on current dev: graph/CLI contracts, ordered parent references and
actual provider input tests. No original feature is declared implemented here.
The rejected hypothesis is that a small "multiple parents" label describes the
whole PR; source inspection shows independent storage/process/runtime boundaries.
This direction must change if per-slice extraction cannot compile or a verified
dependency contradicts the ledger; amend the relevant design before proceeding.
