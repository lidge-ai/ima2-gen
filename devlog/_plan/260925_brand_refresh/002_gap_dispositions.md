# 002 Gap dispositions

Main decisions on 001. IN = folded into the named decade doc; OUT = recorded, not done in this unit (reason).

## A round 1 blockers (reviewer)

| # | Blocker | Disposition |
|---|---|---|
| B1 | star feature exists in bin/lib/star-prompt.ts | IN 030: extract gh + state primitives into lib/githubStar.ts; bin/lib/star-prompt.ts imports them; one state file (config.storage.configDir/state/star-prompt.json) shared by CLI and UI; no localStorage for star state |
| B2 | docs/API.md contract test | IN 030: rows for GET/POST /api/github/star and POST /api/github/star/dismiss in docs/API.md, API.zh-CN.md, API.zh-TW.md |
| B3 | desktop.css shared with settings | IN 020: monochrome accent with explicit switch track/knob pair (track #e8e8ea, knob #111214 when on), focus ring token; .dot/.status/.center kept for settings |
| B4 | unit git-ignored | IN 000: .gitignore allowlist pair for devlog/_plan/260925_brand_refresh/ |

## Brand

| Item | Disposition |
|---|---|
| assets/logo.png consumers (5) | IN 010: overwrite in place |
| package.json files[] lacks assets/logo.png | OUT: npm renders README images from the repository URL; tarball size unchanged |
| electron-builder files[] needs assets/brand/mark.svg | IN 010 |
| knockOutWhite / TRAY_GLYPH old | IN 010 |
| tray.png light on light trays | IN 010: tray.png = favicon tile (dark tile, white glyph) at 32px |
| win32 build/icon.ico never generated (desktop/main.mjs:38) | OUT: pre-existing, Windows desktop builds are not published |
| useBrowserAttentionBadge repaints old glyph | IN 010: badge draws /favicon.svg image then the dot |
| ui/index.html title "Image Gen" | IN 010: "ima2" |
| shared BrandMark, .logo-title--gen gradient, mobile hide at 430px | IN 010 |
| LanSignIn brand + mark, MobileAppBar hardcoded "ima2-gen" | IN 010 (appBar.brand key in 4 locales) |
| site og.png old colorful card | IN 050: regenerate 1200x630 from HTML render (mark + wordmark + tagline) |
| site Hero/WhyBranch iridescent blob imagery | OUT: site art direction change, not requested; chrome/iridescent site look is the reference the user picked the mark against |
| DESIGN.md --chrome row | IN 010 |
| apple-touch-icon / manifest | IN 010 (ui) + 050 (site): 180px apple-touch-icon from favicon tile |
| public/index.html.legacy | OUT: not served |
| desktop.yml path filter lacks assets/** | OUT: CI workflow change outside scope; noted for follow-up |

## Desktop

| Item | Disposition |
|---|---|
| inline style blocked by CSP, duplicate .drag strip | IN 020 |
| running label flicker | IN 020: running row shows url; tag "Ready" is fine if it flickers |
| did-fail-load fallback | IN 020: windows.mjs loads loading page on main-frame did-fail-load while server url set |
| live region, reduced motion | IN 020 |
| titlebar.html "ima2-gen" and chrome tile | IN 020: name "ima2", flat mark image |
| settings "ima2-desktop" version label | IN 020: "ima2 <version>" |
| updater menu item dead when inactive | IN 020: visible only when updaterActive (tests pin label only) |
| desktop-only onboarding / star via IPC | OUT: the desktop window loads the served UI, so the UI onboarding and star dialog already run inside it |
| health polling / degraded state, updater progress UI, dmg background, NSCameraUsageDescription | OUT: behavior work beyond this polish unit |

## UI first run

| Item | Disposition |
|---|---|
| step model, primary initial focus, gate on zero ready lanes (useProviderAvailability), suppress while settings open, dedicated backdrop z-index, PERSISTED_KEYS registration, DIALOG_SURFACES | IN 040 |
| keep ima2.onboardingDismissed key (e2e fixtures) | IN 040 |
| HomeHero "no lane ready" inert text → button | IN 040 |
| GenerateButton with zero lanes | OUT: generation behavior change |
| star trigger choke point | IN 030: subscribe to store history head; node mode not covered (history only reloads) — recorded limitation |

## Site

| Item | Disposition |
|---|---|
| FAQ "Codex desktop app" answer, quickstart (en+ko) desktop step, docs nav desktop page, docs index bullet | IN 050 |
| Node ≥20 badge, site/package.json engines | IN 050 |
| setup option 4 text, stale "cleanup automatically" claim, "up to eight in parallel", "up to 7 references", og "Two lines" | IN 050 |
| Grok defaults on config/providers/api/cli pages (planner grok-4.3, image grok-imagine-image-2.0, timeouts 900000/300000, third model, provider list) | IN 050 |
| zh-TW README link, section number 06→05, docs og:image | IN 050 |
| canonical for FAQ, LangToggle path, BASE_URL for scripts, orphan screenshots, ko section order, per-language doc URLs | OUT: site IA/SEO work beyond this unit; noted |

## README

| Item | Disposition |
|---|---|
| all factual fixes listed (FAQ anchor, 14 refs, arm64, desktop workflow triggers/inputs, Grok defaults, skill ref counts, zh-TW link, Docker heading ownership, stop parenthetical, emoji markers, desktop install) | IN 060 |
| translations: logo block, install incl. desktop, lane count 10, 14 refs, Grok defaults, duplicate CLI links, zh mistranslations (多变的, 满的, 客户, 车道), self-link | IN 060 |
| full section parity for ko/ja (config tables, skills, contributors) | OUT: translation sync beyond polish; the English README stays canonical |
| generated runtime-install tables | never hand-edited |

