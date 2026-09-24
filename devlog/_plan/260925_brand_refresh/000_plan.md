# 260925 Brand refresh, onboarding, DMG guide — roadmap

ima2 still ships a colorful clip-art logo that clashes with the monochrome chrome look the site and UI already use, the desktop loading screen is a bare status line, first-run onboarding is a single "go to settings" popup, the site never tells people the macOS app exists, and the README describes a desktop build that no longer matches the published release. This unit replaces the logo everywhere with the approved liquid-metal "2" mark, rebuilds the loading screen and first-run flow, adds a GitHub star prompt that uses the user's own `gh` login, adds a DMG install guide to the site, and polishes every README. Users see one consistent brand and a shorter path from install to first image.

## Loop spec

| Field | Value |
|---|---|
| Loop archetype | satisfy-spec, multi-cycle HOTL (cxc-loop), one PABCD cycle per work-phase |
| Trigger | User request 2026-09-25: pick concept 06, vectorize, apply everywhere, loading + star + onboarding like OpenCodex, site DMG guide, README polish, merge to dev |
| Goal | Brand, loading, onboarding, star prompt, site DMG guide and READMEs shipped to `dev` |
| Non-goals | provider/generation logic, release workflows, version bump, tag, npm publish, desktop signing |
| Verifier | `npm run typecheck`, `npm run typecheck:tests`, `node scripts/run-tests.mjs` subset + full `npm test` before PR, `npm run test:inventory`, `cd ui && npm run build`, `cd site && npm run build`, headless Chromium renders of changed pages read back, PR fast gate on exact head |
| Stop condition | PR merged into `dev` with evidence, post-merge dev CI observed |
| Memory artifact | this unit + `.codexclaw/goalplans/ima2-gen-brand-refresh-onboarding-polish-merged` |
| Expected terminal outcomes | DONE merged; BLOCKED unfixable CI; NEEDS_HUMAN maintainer-only waiver; UNSAFE if release/signing would change |
| Escalation | anything touching release/signing workflows, secrets, or needing a maintainer label |

Resource bounds: tools = local shell, gh (user's login), ima2 server, headless Chromium; write scope = files listed in the decade docs; no token/time budget was set by the user; DeepSeek reviewers unlimited per user.

## Consultation record

Architect proposal step: disclosed gap. The user instructed "너가 쓰기하고 걔는 진짜 대충 검증만" — main writes, DeepSeek (`command-code/deepseek-deepseek-v4.1-flash`) only verifies. Plans are main-authored; DeepSeek performs A-phase audit and diff review.

## Source evidence

- Logo consumers: `README.md:17`, `docs/README.{zh-CN,zh-TW}.md:17`, `desktop/scripts/make-icons.mjs:14` (reads `assets/logo.png`, knocks out white), `desktop/pages/loading.html:12` (`../build/icon.png`).
- UI favicon inline data URL: `ui/index.html:24-28`; sidebar/mobile brand `ui/src/components/Sidebar.tsx:85-89`, `MobileAppBar.tsx:40-41`, `.logo-mark` `ui/src/styles/sidebar.css:120,385`.
- Site: favicon `site/public/favicon.svg` via `site/src/layouts/Base.astro:21,46` and `DocsLayout.astro:33,59`; header brand `site/src/components/Header.astro:14`; install section `site/src/components/InstallFooter.astro`; wrong Node badge `site/src/i18n/strings.ts:134,346` ("Node ≥20" while `package.json` engines is `>=22`).
- Desktop: supervisor snapshot `desktop/lib/server.mjs:103-104` = {state,url,external,pid,lastError}; preload bridge only for file:// pages `desktop/preload.cjs:6`.
- Onboarding: `ui/src/components/OnboardingPopup.tsx` (82 lines) mounted `ui/src/App.tsx:202`; locales `ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json` key `onboarding` at line 347.
- New history items: `addHistoryItemImpl` `ui/src/store/storeHistoryImpl.ts:369` sets `createdAt`.
- Routes registry `routes/index.ts` `configureRoutes`; peer address pattern `lib/apiRequestBudget.ts:38`.
- Desktop release facts: `gh release view desktop-v3.19.0` → assets `ima2-3.19.0-mac-arm64.dmg`, zip, SHA256SUMS; body states Developer ID signed, Gatekeeper passed, stapled notarization; arm64 only. `README.md:453,466` still claims arm64 + x64.
- Star pattern source: OpenCodex `src/github/star-state.ts` (trusted gh dirs, cache TTL 10 min, generation counter, states starred/not-starred/unauthenticated).

## Phase map (dependency ordered)

| wp | Doc | Depends | Closes with |
|---|---|---|---|
| wp0 | this + 010-070 | — | docs audited |
| wp1 | 010_phase1_brand_assets.md | wp0 | icons regenerated + renders |
| wp2 | 020_phase2_desktop_loading.md | wp1 | loading renders in 3 states |
| wp3 | 030_phase3_github_star.md | wp1 | star tests + dialog render |
| wp4 | 040_phase4_onboarding.md | wp3 | onboarding render + ui build |
| wp5 | 050_phase5_site_dmg.md | wp1 | site build + renders |
| wp6 | 060_phase6_readme.md | wp5 | README link/fact check |
| wp7 | 070_phase7_pr_merge.md | wp6 | PR merged to dev |

## SoT sync target

`structure/` architecture docs: add the star route to the route map doc that lists `/api/*` families (located at C of wp3), and `structure/07-devlog-map.md` gets this unit. `DESIGN.md` gets a brand section (mark, favicon, icon, monochrome rule) at C of wp1.

## A round 1 amendments

- Unit tracked through `.gitignore` allowlist pair (lines 95-96).
- Research docs added: 001_gap_reports.md (verbatim DeepSeek lanes), 002_gap_dispositions.md (IN/OUT decisions). Decade docs carry "A round 1 amendments" sections that supersede their first drafts.
- Write scope extends to the files named in those amendment sections.
