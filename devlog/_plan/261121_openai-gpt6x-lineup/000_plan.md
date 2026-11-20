# 000 Plan: OpenAI GPT-6.x lineup + SVG recheck

Loop-spec (cxc-loop HOTL, satisfy-spec archetype)

- Trigger: user request 2026-11-21 to replace the OpenAI lineup with gpt-6-luna, gpt-6.1-terra, gpt-6.2-sol, gpt-6.2-astra and to re-verify SVG support.
- Goal: both OpenAI lanes (GPT OAuth, OpenAI API key) offer exactly those four ids; every saved legacy id lands on its tier; SVG support matches cited evidence.
- Non-goals: release/tag/release.yml (parent thread owns release), the xAI video planner list (`GROK_PLANNER_MODELS`, executed against xAI), other providers' features, MiniMax PR #431, real-home config edits.
- Verifier: `npm run typecheck`, `typecheck:tests`, `lint`, `test:inventory`, `node scripts/generate-provider-types.mjs --check`, `node scripts/refresh-structure-line-counts.mjs --check`, `build:server`, `build:cli`, `npm --prefix ui run build`, `npm test` (baseline at 80745c49 after builds: 4155 tests, 4152 pass, 0 fail, 3 skipped; branch fast-forwarded to dev bc6fbcde before any commit). All read this unit's targets (tests import the changed modules; ui build compiles ui/src).
- Stop condition: PR to dev merged by merge commit after fresh Terra final review PASS, all checks green and zero blocker findings (user authorization 2026-11-21); no release.
- Memory artifact: this unit + `.codexclaw/goalplans/…/ledger.jsonl` + `.codexclaw/evidence/oauth-live-probe-261121.md`.
- Terminal outcomes: DONE (merged); NEEDS_HUMAN (API-key-only claims stay doc-backed, reported NOT RUN); BLOCKED (checks or review cannot go green after repair loops).
- Escalation: release actions, credential exposure, scope beyond the two OpenAI lanes.
- Resource bounds: none stated; host limits apply. Live calls only on the user's ChatGPT OAuth session (no API key on this host; optional handoff requested).

## Work-phase map (dependency order)

| wp | Doc | Builds on | Closes with |
|---|---|---|---|
| wp0 | 000-001 (this cycle, docs only) | — | roadmap locked |
| wp1 | [010](010_wp1_lineup_swap.md) | wp0 | lineup + migrations + effort/lite fixes, failing-first tests green, docs/i18n synced |
| wp2 | [020](020_wp2_svg.md) | wp1 (new ids exist) | SVG decision applied and documented |
| wp3 | [030](030_wp3_ship.md) | wp2 | gates, screenshot, PR, fresh Terra review, merge |

## Architect consultation record

- Handle: GOAT task `…809816f7-8b8e-4351-a072-7a606f25180b` (codex / gpt-6.1-terra, confirmed in task.create result). Follow-up research: `…5d0682aa-21a8-46f6-98b9-9014930fa7b6` (gpt-6.1-terra).
- D1 (OAuth order luna, terra, sol, astra; luna default): accepted.
- D2 (API lane gated by first-party API evidence): accepted; Aside-read model pages now list `image_generation` under Responses tools for all four ids (001 §2), so the API lane takes the same four ids.
- D3 (migrate old tiers only with approval): amended; the user's request explicitly requires saved legacy ids to migrate, so migration ships for both lanes (map in 010 §1).
- D4 (gate effort per lane/model): accepted in the narrow form the code already uses (coerce `none`→`low` per model) because live 400s prove Sol/Astra 6.2 reject `none` (001 §1).
- D5 (keep SVG/stylesheet defaults until verified): split; stylesheet default moves to gpt-6-luna (doc-backed Chat Completions support), SVG author default handled in wp2.
- D6 (regenerate provider types): accepted.
- Reflection: the GOAT surface only allows `continueFrom` on review-role tasks, so the same-architect reflection is not possible; a fresh Terra review task checks this plan against D1-D6 (disclosed consultation gap).


## Verifier dry run (PLAN-VERIFIER-REAL-01, dev bc6fbcde, 2026-11-21)

typecheck 0 · typecheck:tests 0 · lint 0 · test:inventory 0 · generate-provider-types --check 0 (reads lib/providers/registry.ts → ui/src/generated/providers.ts) · refresh-structure-line-counts --check 0 (reads structure/ line counts of renamed/edited files) · check-devlog-citations 0 (reads this unit) · build:server/build:cli/ui build 0 and npm test 0 fail at 80745c49. Prose-only doc edits (README translations, site pages) are not observed by any gate except the site/structure checks; they are human-review rows.
