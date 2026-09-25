---
created: 2026-06-08
updated: 2026-09-22
tags: [ima2-gen, structure-docs, devlog, roadmap]
---

# Devlog Map

This document maps the `devlog/` folder structure and explains how to navigate planning, in-progress, and completed work.

## Folder Structure

```
devlog/
├── _plan/                                # Active planning and research
├── _fin/                                 # Completed work (archived)
│   └── 260608_sse-multiplexing/          # SSE architecture, audits, and risk summary
└── _artifacts/                           # Supporting artifacts
```

## Naming Convention

Devlog entries use decade-range numbering within each initiative:

| Range | Purpose |
|-------|---------|
| 00–09 | Research, specs, architecture docs |
| 10–19 | Phase 1 implementation |
| 20–29 | Phase 2 implementation |
| 30–39 | Phase 3 implementation |

Initiative documents live together inside their `_plan/` or `_fin/` unit folder; completed
architecture and audit records are not kept as loose top-level duplicates.

## Active Plans (`_plan/`)

Files in `_plan/` are work-in-progress. They use the format `YYMMDD_<topic>` to aid chronological sorting. Each plan typically maps to a GitHub issue or a standalone initiative.

Current active units are listed below. The authoritative full ledger is
`devlog/_plan/README.md` §현재 Active Lane; external-blocked follow-ups and `_future`
handoffs also remain outside `_fin`.

Deferred items live in `_plan/_future/` (canvas exports, masked edit, batch
matrix, storyboard planner skill).

## Completed Work (`_fin/`)

When an initiative is fully shipped and merged, its plan folder moves to `_fin/`. Each `_fin/` entry typically contains a `README.md` with a summary, plus phase-specific logs.

### Key Completed Milestones

| Archive | Description |
|---------|-------------|
| `260908_post_314_cleanup` | Post-3.14.0 cleanup: hygiene residuals, dependabot closure, NovelAI V5 battery quota lane (#193), adapter-owned execution (#150), and the v3.15.0 release (2026-09-08, b96a11ed) |
| `260905_production_readiness` | WP00–WP13 production-readiness round: provider execution contracts, selection consistency, job lifecycle, LAN security, diagnostics, installers, and the v3.14.0 release (2026-09-06, #219, 36aa6fce) |
| `260825_novelai_provider_lane` | NovelAI (`nai`) image provider lane — tenth core lane; ZIP-archive responses, persistent-token auth, text-to-image only |
| `260428_issue33-mobile-overhaul-logs` | Mobile shell redesign |
| `260429_app-weight-reduction` | Code splitting and bundle diet |
| `260429_issue45-cli-feature-parity` | CLI ↔ server API parity |
| `260430_issue24-typescript-strict-cleanup` | TypeScript strict migration |
| `260508_issue60-multimode-incremental-progress` | Multimode per-slot progress |
| `260516_agent-mode-codex-rs-workspace` | Agent Mode implementation |
| `260602_gemini-vertex-api-provider` | Gemini/Vertex provider integration |
| `260604_500-line-split` | Source file ≤500-line enforcement |
| `260608_sse-multiplexing` | Single SSE EventBus architecture, implementation audits, and integrated risk summary |
| `260621_issue95-generation-request-log` | Generation request log (#95) |
| `260627_preview-deploy-pipeline` | npm preview OIDC publish pipeline |
| `260629_grok-video-15-1080p` | Grok Video 1.5 1080p contract (v2.0.5) |
| `260711_production-hardening` | WP0~WP10 hardening and final closeout gates |
| `260715_oauth_fallback_reference_retention` | OAuth retry reference preservation shipped in v2.0.19/v2.0.20 |
| `260716_mcp-model-presets` | Capability-aware MCP preset projection and validation |
| `260716_mcp-model-surface-ui` | Provider/model selectors, Settings MCP controls, Higgsfield browse surface and preset UI |
| `260717_ux_refinement` | i18n, mobile focus, composer feedback, MCP states, inflight popup, Assets and Element `@` UX polish |
| `260726_model-defaults-ui-cleaning` | Grok 4.5 and GPT-5.6 Luna defaults, public docs synchronization, empty/i18n cleanup, shared dropdown and responsive control hardening |

Snapshot note, 2026-06-28: WP6 docs code-grounding complete — `devlog/_fin/260628_wp6_docs_code_grounding/`; automated line-count refresh + API/CLI contract tests landed on `dev` (`6383fc4`..`183a78a`).

Snapshot note, 2026-07-07: devlog hardening — 6 shipped units and 1 loose doc
moved to `_fin/`, 11 stale `_plan` duplicates of `_fin`/`_future` copies removed
after byte-diff verification, active-lane table rewritten 1:1 against the
folder listing (`devlog/_plan/260707_gpt56-oidc-devlog-hardening/030_wp3`).

Snapshot note, 2026-07-10: GPT-5.6/OIDC hardening shipped at `v2.0.14`, with
signed preview/stable publications and live Luna/Terra `medium` generation.
Archive is deferred because a Windows global update exposed package-local
Codex PATH and `.cmd` execution defects; the corrective release remains active.

Snapshot note, 2026-07-17: `260715_subscription-mcp-providers/120_restart_recovery`
closed the restart defect with bound 0600 credentials, post-listen restore, truthful
transport states, shutdown coordination, isolated test receipts, and independent Sol
review. The nested unit remains in `_plan` because its parent MCP initiative is active;
it moves to `_fin` only when that parent closes.

Snapshot note, 2026-07-17: completed-unit sweep moved production hardening, OAuth
fallback reference retention, MCP model presets, MCP model surface UI, and UX
refinement to `_fin`. The byte-identical `_plan` duplicate of the already archived
PR/rebase review was removed. Eight units with concrete implementation, verification,
or release work remain in `_plan`; `devlog/_plan/README.md` is the 1:1 active ledger.

Snapshot note, 2026-07-17: the loose SSE architecture and risk-summary files at the
`devlog/` root were byte-identical to the copies already preserved in
`devlog/_fin/260608_sse-multiplexing/`. The root duplicates were removed and archive
cross-references were normalized to the completed unit.

Snapshot note, 2026-07-26: `260726_model-defaults-ui-cleaning` moved to `_fin`
after full local gates and five-viewport render evidence. The active-lane table
is empty again; GitHub parity and CI receipts live in the archived closeout.

## Cross-References

| Document | Relation |
|----------|----------|
| `[[00-structure-hub]]` | Parent hub — reading order and document map |
| `[[05-node-mode]]` | Node mode devlog entries reference graph session changes |
| `[[06-infra-operations]]` | Build/test infra devlog entries |

## How to Use

1. Check `_plan/` for active work before starting a new initiative — there may be prior research.
2. When finishing an initiative, move its `_plan/` entry to `_fin/` with a `README.md` summary.
3. Keep related architecture, audit, and evidence documents inside the owning unit folder.

## Active units

| Unit | Status | Open issue |
|---|---|---|
| `260925_brand_refresh/` | Monochrome "2" mark everywhere (assets/brand, desktop icons, UI/site favicon), desktop loading screen from real supervisor status, three-step first-run onboarding, one-time GitHub star prompt via the user's gh, site Mac app guide, README polish with corrected facts. Gap audit in 001/002. | — |
| `260925_readme_release/` | OpenCodex-grade README header and structure (banner, showcase table, collapsed reference), fresh dark-theme screenshots from an isolated demo runtime, translations aligned, then the v3.21.0 npm/GitHub/desktop/Pages release. | — |
| `260922_macos_arm64_release/` | Desktop release phases 1–4: Apple Silicon-only DMG/ZIP, exact root-version `desktop-v<version>`, fail-closed signing/notarization, packaged darwin/arm64 updater, exact Draft assets/checksums, and `desktop-production` approval before publication. Environment setup, live tagged notarization and a two-version update remain out of scope. | — |
| `260917_issue_pr_triage_release/` | Triage of every open issue and PR on 2026-09-17 plus the 3.16.1 cut. Roadmap in 000_plan.md; 010 fixes the grok `--help` defect, 020 gates the dependabot pair, 030 records the PR #229 decision, 050 sequences the release. | #244, #150 |
| `260902_studio_surfaces/` | NovelAI dual-prompt UI, configurable Prompt Builder backend, Canvas vectorize entry, docs upgrade, and release train. | — |

`260909_grok_native_oauth/` shipped in v3.16.0 and moved to `_fin/` on 2026-09-17;
its receipt is `devlog/_fin/260909_grok_native_oauth/070_release_v3160.md`.

Open issue #150 (Provider Adapter v1 RFC) is tracked in `_plan/README.md` but
has no owning devlog unit yet — its scope is architectural and cross-cutting.
