# 050 Phase 5 — Website brand and macOS DMG guide

## File change map

| Path | Action | Change |
|---|---|---|
| site/public/brand-mark.svg | NEW | copy of assets/brand/mark.svg |
| site/src/components/Header.astro | MODIFY | brand link = masked mark (18px) + existing "ima2" chrome text |
| site/src/components/InstallFooter.astro | MODIFY | new "Desktop app for Mac" block before the npm codes: download link `https://github.com/lidge-jun/ima2-gen/releases?q=desktop&expanded=true`; steps: download `ima2-<version>-mac-arm64.dmg`, drag ima2 to Applications, open it (signed and notarized by Apple); note "Apple Silicon Macs only. On Intel Macs, Windows or Linux, use the install script or npm." |
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
