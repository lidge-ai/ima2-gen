# 050 Phase 5 — Website brand and macOS DMG guide

## File change map

| Path | Action | Change |
|---|---|---|
| site/public/brand-mark.svg | NEW | copy of assets/brand/mark.svg |
| site/src/components/Header.astro | MODIFY | brand link = masked mark (18px) + existing "ima2" chrome text |
| site/src/components/InstallFooter.astro | MODIFY | new "Desktop app for Mac" block before the npm codes: download link `https://github.com/lidge-ai/ima2-gen/releases?q=desktop&expanded=true`; steps: download `ima2-<version>-mac-arm64.dmg`, drag ima2 to Applications, open it (signed and notarized by Apple); note "Apple Silicon Macs only. On Intel Macs, Windows or Linux, use the install script or npm." |
| site/src/i18n/strings.ts | MODIFY | `install.desktop.*` en + ko; `install.badge.node` → "Node ≥22" in both languages (package.json engines is >=22) |
| site/src/pages/docs/quickstart.astro (+ ko) | MODIFY if it lists install paths | add the desktop option (re-verified at this phase's P) |

## Accept criteria

- `cd site && npm run build` exit 0.
- Headless renders of dist/index.html and dist/ko/index.html install section at 1280x720 and 390x844 read back; header mark visible.
- `gh release list` shows a `desktop-v*` release (link target has content).


## A round 1 amendments (002)

Definite edits (re-verify lines at P):
- site/src/pages/docs/quickstart.astro and site/src/pages/ko/docs/quickstart.astro: desktop DMG option first; Node 22 requirement line; setup option 4 = "Web setup"; delete the "stale process cleanup automatically" claims.
- site/src/pages/docs/desktop.astro + site/src/pages/ko/docs/desktop.astro NEW; site/src/i18n/docs.ts DOCS_NAV entry; docs index bullet (en+ko).
- site/src/i18n/strings.ts: faq.install.a1 (en+ko) now points to the Mac app; install.badge.node ≥22; install.tag 05; parallel count and "up to 7 references" corrected against config.ts/lib/imageModels.ts; og text "three commands"; install.link.zhTw.
- site/package.json engines node >=22.
- Grok facts on docs/reference/config.astro, docs/concepts/providers.astro, docs/reference/api.astro, docs/reference/cli.astro (+ko): planner default grok-4.3 (config.ts:10), image default grok-imagine-image-2.0, planner timeout 900000, generation timeout 300000, three image models, full --provider list.
- site/src/layouts/DocsLayout.astro: og:image.
- site/public/og.png regenerated (1200x630 headless render: mark, wordmark, one-line tagline), site/public/apple-touch-icon.png + link in Base.astro/DocsLayout.astro.

## wp5 P re-verification (HEAD dd9c6f0f) — final edit list

Verified facts (code is the source): Grok planner default `grok-4.3` (config.ts:29), selectable `grok-4.6`, `grok-4.5` and GPT planners (config.ts:41-48); planner timeout 900000, search timeout 300000, video plan total 1500000, image default `grok-imagine-image-2.0`, generation timeout 300000 (config.ts:376-399); Grok image models `grok-imagine-image-2.0`, `grok-imagine-image`, `grok-imagine-image-quality` (lib/providers/registry.ts:77-79); video references up to 14 (registry.ts:87); server parallel cap `IMA2_MAX_PARALLEL` default 24 (config.ts:162); `ima2 setup` option 4 is "Web setup" (bin/ima2.ts:104); install scripts contain no process-cleanup code; desktop release `desktop-v3.19.0` ships `ima2-3.19.0-mac-arm64.dmg` (Developer ID signed, notarized, arm64 only).

Correction: `faq.install.q1` asks about the *Codex* desktop app (OpenAI Codex), not the ima2 desktop app; left unchanged.

Edits:
1. site/public/brand-mark.svg (copy of assets/brand/mark.svg), site/public/apple-touch-icon.png (copy of ui/public), Base.astro + DocsLayout.astro `<link rel="apple-touch-icon">`; DocsLayout `og:image`.
2. Header.astro: mask-rendered mark before the chrome "ima2" text (`aria-hidden`).
3. InstallFooter.astro: "Mac app" block first (download link to releases filtered on desktop tags, 3 steps, Apple Silicon note), zh-TW README link; strings `install.desktop.*`, `install.link.zhTw` (en+ko), `install.badge.node` "Node ≥22", `install.tag` "05 · Get going"/"05 · 시작하기"; meta.og.desc "Two lines to install" → three commands or the Mac app (en+ko).
4. strings: video "up to 7 references" → 14 (en+ko), parallel copy → "Several candidates per Classic run, capped by IMA2_MAX_PARALLEL (24 by default)".
5. docs: NEW pages/docs/desktop.astro + pages/ko/docs/desktop.astro; DOCS_NAV Getting Started gains `desktop`; docs index (en+ko) bullet + 7→14; quickstart (en+ko) Mac app section first, Node 22 line, option 4 Web setup, cleanup claims removed (both places).
6. Grok facts in docs/reference/config.astro, docs/concepts/providers.astro, docs/reference/api.astro, docs/reference/cli.astro, docs/concepts/modes.astro (+ko twins): planner default grok-4.3 with grok-4.5/4.6 selectable; timeouts; three image models, default 2.0; full --provider list from bin/commands/gen.ts PROVIDER_VALUES; add IMA2_GROK_SEARCH_TIMEOUT_MS and IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS rows.
7. site/public/og.png regenerated 1200x630 from an HTML render (mark, wordmark, one line).
8. site/package.json engines node >=22.
Verifier: `cd site && npm run build` exit 0; Playwright renders of dist (served statically) index + ko install section at 1280x800 and 390x844, docs/desktop page; og.png read back; `rg -n "grok-4\.5\)|up to 7|Node ≥20|cleanup automatically" site/src` returns nothing.
