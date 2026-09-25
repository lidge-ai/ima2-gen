# 260925 README production pass and v3.21.0 release — roadmap

The GitHub README opens with an auto-generated "Contract / Value" table (Node engine, npm toolchain, SDK ranges) above the logo, then a 160px icon, a plain tagline and three default shields. Below that it runs 500 lines of fully expanded reference material, and its screenshots mix an old UI ("gpt-image-2 studio 5.5"), real-person composites and a joke prompt. This unit rebuilds the README header and structure at OpenCodex quality, replaces the screenshots with fresh captures of the current dark UI on neutral demo content, applies the same shape to the four translations, merges to `dev`, and ships everything as v3.21.0: npm `latest`, GitHub Release, signed desktop DMG and the Pages site. Readers get a first screen that shows the product and how to install it; the brand refresh from 260925_brand_refresh reaches users.

## Loop spec

| Field | Value |
|---|---|
| Loop archetype | satisfy-spec, multi-cycle HOTL (cxc-loop), one PABCD cycle per work-phase |
| Trigger | User 2026-09-25 12:23: "readme 좀 더 예쁘게 개선해줘 opencodex 만큼 … 배포까지 완료해줘 … 완전 프로덕션 급으로" with a screenshot of the contract table above the logo |
| Goal | README + translations at OpenCodex quality on `dev`, then v3.21.0 published to npm, GitHub Releases (npm and desktop) and Pages |
| Non-goals | product code, provider behavior, workflow or release script changes, site redesign |
| Verifier | README contract tests, `npm run docs:runtime:check`, `npm run typecheck`, README link checker, headless GFM render read back; hosted PR fast gate + dev CI; registry and `gh release view` readbacks; Pages run + live fetch |
| Stop condition | npm latest 3.21.0, v3.21.0 + desktop-v3.21.0 public, Pages live |
| Memory artifact | this unit + `.codexclaw/goalplans/make-the-ima2-gen-readme-production-grade-at-ope` |
| Expected terminal outcomes | DONE; BLOCKED on an approval gate outside reach; NEEDS_HUMAN for reviewer-only action; UNSAFE on ref divergence |
| Escalation | ruleset bypass, force push to main/dev/preview, tag rewrite |

Resource bounds: local shell, gh (user's login, admin), local ima2 CLI and an isolated demo server, headless Chromium, DeepSeek read-only reviewers (`command-code/deepseek-deepseek-v4.1-flash`, user-authorized unlimited). Write scope: README.md, docs/README.{ko,ja,zh-CN,zh-TW}.md, assets/brand/banner*, assets/screenshots/readme-*, this unit, .gitignore allowlist, structure/07-devlog-map.md. External writes authorized by the user: push, PRs, merges to dev and main, release.yml dispatch, pending-deployment approvals, desktop tag, pages dispatch. No token or time budget was stated.

## Consultation record

Architect proposal: main-authored under the user's standing instruction that DeepSeek only verifies. DeepSeek audits each plan at A and the diff at C.

## Source evidence

- Contract table: `README.md:3-12` between `<!-- runtime-install:generated:start/end -->`; writer `scripts/generate-runtime-install-contract.mjs:7-18,54` replaces the region wherever the markers sit and requires exactly one pair per doc; docs list `:10` includes all five READMEs, AGENTS.md and structure/06.
- Header today: `README.md:15-31` (160px logo, tagline, 3 shields, blockquote links).
- Screenshot problems: `assets/screenshots/node-graph-branching.png` (old sidebar "gpt-image-2 studio 5.5", real-person composites), `classic-generate-darkmode.png` (joke prompt), `video-result-gallery.png` (film-character composite), `multimode-sequence.png`, `settings-workspace.png`, `settings-oauth-generation.png` dated 2026-04.
- OpenCodex reference header: `/Users/jun/Developer/new/700_projects/opencodex/README.md:1-80` (full-width banner, h3 tagline, centered badges, 2-line install, platform download badges, two-column showcase table, centered language bar, collapsed desktop details).
- Brand assets: `assets/brand/mark-chrome.png` (476x512), `mark.svg`, `icon-1024.png`; UI fonts `ui/public/fonts/ClashDisplay-700.woff2`, `Satoshi-*`, `IBMPlexMono-*`.
- Isolation: `config.ts:55` `IMA2_CONFIG_DIR`, `:136` `IMA2_PORT`, `:255` `IMA2_OAUTH_PROXY_PORT`.
- Release path: `.github/workflows/release.yml` (cut from main, `expected_sha`, preview proof, stable tag), `publish.yml` (npm-stable environment), `desktop.yml` (`desktop-v*` tag, desktop-production environment), `pages.yml` (dispatch with `release_sha`, `release_version`). Runbook precedent `devlog/_plan/260923_desktop_v3170_release/010_wp1_release_runbook.md`.
- Current refs: origin/dev `01b53406` (#287 merged, CI/CodeQL/Desktop green), origin/main `e78bbbaa` = v3.20.0.

## Phase map

| wp | Doc | Depends | Closes with |
|---|---|---|---|
| wp1 | this + 010 + 020 | — | roadmap audited |
| wp2 | 010_wp2_readme.md | wp1 | README PR merged to dev, dev CI green |
| wp3 | 020_wp3_release.md | wp2 | npm, releases, Pages verified |

## SoT sync target

`structure/07-devlog-map.md` lists this unit. `structure/06-infra-operations.md` keeps its generated block untouched. No architecture change.


## A round 1 (wp1)

DeepSeek NEAR-PASS. Blocker folded into 020: the release needs two `npm-stable` approvals (release.yml `tag` job, then publish.yml stable job), dev stays frozen until the atomic main/dev/tag push, and Pages waits for the registry. Constraints carried into wp2: keep exactly one runtime-install marker pair per README; keep the asserted strings from prompt-studio-docs-contract (:45-46), cli-feature-parity-contract (:148-153), studio-surface-docs-contract (:46-48) and model-default-projection-contract (:83-90); keep the translation filenames the site links to.
