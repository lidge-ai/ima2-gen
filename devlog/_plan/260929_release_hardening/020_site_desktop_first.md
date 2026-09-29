# 020 wp2 — Desktop-first landing page

Depends on: 000 (merges after 010 so the release SHA carries both). Class C3
(site-only, several components). Surface owners: dev-frontend, dev-uiux-design.

Today the first screen offers an npm command and a web UI screenshot; the desktop
installers appear only in the install section near the bottom and in a small banner.
After this change the first screen offers a one-click download for the visitor's OS,
the screenshot sits inside a desktop window frame, and a new section right under the
hero says what the app does that a browser tab cannot. npm stays one line below the
download button.

## Design decisions

| ID | Decision |
|---|---|
| S1 | Hero primary CTA = "Download for {OS}" resolved by the existing `desktopRelease.ts`; fallback label "Download the desktop app" linking to the desktop releases page when the API or OS detection fails (mobile included). |
| S2 | npm stays in the hero as a secondary line ("Prefer the terminal?") with the same CodeCopy and the one-click details. |
| S3 | Hero screenshot framed as a desktop window (CSS title bar, three dots, title "ima2"); same image, no new asset. |
| S4 | New section `DesktopApp.astro` (`id="desktop"`) right after Hero: four facts that match shipped code, a CSS tray menu built from the real tray labels, a platform line and a link to all downloads. |
| S5 | Header gets a "Download" pill linking to `#desktop`. |
| S6 | One download mounter for every `[data-desktop-download]` root (hero and install section); idempotent per root. |

Facts used in S4 and their source:
- bundled server, no Node/npm: `desktop/lib/server.mjs` (bundled root), install docs step1-3.
- tray + keep running on close + start at login/hidden: `desktop/lib/tray.mjs` lines 94-110, `desktop/lib/settings.mjs` BOOL_KEYS.
- attaches to or takes over a CLI server: `desktop/lib/startup-decision.mjs` line 33, setting `existingServer`.
- updates itself: `desktop/lib/updater.mjs` (update dialogs "Restart and Install").

## File changes

1. NEW `site/src/scripts/desktopDownload.ts` — moves the `<script>` body of
   `InstallFooter.astro` (lines 70-119) into
   `export function mountDesktopDownloads(): void` that iterates
   `document.querySelectorAll<HTMLElement>('[data-desktop-download]')`, skips roots with
   `data-mounted`, sets it, then runs the same logic per root. The platform list
   (`[data-platform]`) is optional per root; primary link, label and detected line
   work as today. Exports `interface DownloadLabels`.
2. MODIFY `site/src/components/InstallFooter.astro` — script becomes
   `import { mountDesktopDownloads } from '../scripts/desktopDownload'; mountDesktopDownloads();`;
   labels object unchanged; section gains nothing else.
3. NEW `site/src/components/HeroDownload.astro` — props `lang`; renders
   `<div class="hero-download" data-desktop-download data-labels=…>` with
   `<a class="hero-dl" data-dl-primary href={RELEASES_PAGE}>` (label span `data-dl-primary-label`, arrow),
   `<p class="hero-dl-detected" data-dl-detected hidden>`, and a meta row: platform
   note `hero.dl.platforms` + link `hero.dl.others` to `#install`. Styles: solid
   light button (`background: var(--text); color: var(--bg)`), 15px display font,
   48px min height, focus-visible ring; full width under 480px.
4. MODIFY `site/src/components/Hero.astro` —
   - import HeroDownload; replace `<CodeCopy command={t(lang, 'hero.cta.cmd')} />` with
     `<HeroDownload lang={lang} />`, then `<p class="npm-label">{t(lang, 'hero.npm.label')}</p>`
     and the same CodeCopy; one-click details stay.
   - `.shot-frame` gains `app-window` and a title bar
     `<div class="app-titlebar" aria-hidden="true"><span class="app-dots"><i></i><i></i><i></i></span><span class="app-title">ima2</span></div>` before the Screenshot.
   - styles for `.npm-label`, `.app-titlebar`, `.app-dots i` (10px circles #ff5f57 #febc2e #28c840), `.app-title`.
5. NEW `site/src/components/DesktopApp.astro` — `<section class="std desktop-app" id="desktop">`:
   section tag, h2 (`desktop.h.before` + em `desktop.h.em`), lede, `<ul class="desktop-facts">`
   of four `{title, body}` items (keys `desktop.f1.t/b` … `desktop.f4.t/b`), a
   platform line `desktop.platforms`, a link `desktop.all` to `#install`; right column
   `<figure class="tray-mock" aria-label={t(lang,'desktop.tray.aria')}>` listing
   Show Status, Open ima2, Open in Browser, Open Generated Folder, Start at Login (checked),
   Restart Server, Check for Updates…, Settings…, Quit ima2 with separators, plus a
   status line "Running on 127.0.0.1:3333". Two columns ≥ 900px, one column below.
6. MODIFY `site/src/pages/index.astro` and `site/src/pages/ko/index.astro` — import
   DesktopApp, render `<DesktopApp lang={lang} />` right after `<Hero …/>`.
7. MODIFY `site/src/components/Header.astro` — after the nav, a
   `<a class="nav-download" href={`${homeHref}#desktop`}>{t(lang, 'header.nav.download')}</a>`
   pill inside `.right` before LangToggle; hidden under 480px only if the row overflows
   (check in C).
8. MODIFY `site/src/i18n/strings.ts` — en + ko keys: `header.nav.download`,
   `hero.eyebrow` (en "Desktop app + CLI · Image + Video", ko "데스크톱 앱 + CLI · 이미지 + 비디오"),
   `hero.npm.label`, `hero.dl.platforms`, `hero.dl.others`, `desktop.tag`,
   `desktop.h.before`, `desktop.h.em`, `desktop.lede`, `desktop.f1.t`…`desktop.f4.b`,
   `desktop.platforms`, `desktop.all`, `desktop.tray.aria`, `desktop.tray.status`.
   Korean copy follows the house register already in strings.ts (해요체 없이 짧은 평서문).
9. MODIFY `CHANGELOG.md` Unreleased: "Site leads with the desktop app".

## Acceptance

| Check | How | Observable |
|---|---|---|
| build | `npm --prefix site run build` | exit 0, `site/dist/index.html` and `site/dist/ko/index.html` contain `id="desktop"` and `data-desktop-download` twice |
| desktop render | headless Chrome 1440x900 on `astro preview` | hero shows the download button above the npm line, window frame visible, section under hero |
| mobile render | 390x844 | button full width, no horizontal scroll, header fits |
| download resolution | live API in the browser | button label "Download for Mac (Apple Silicon)" on a Mac UA and href ends with `-mac-arm64.dmg` |
| API failure fallback | block api.github.com in the page | button keeps "Download the desktop app" and links to the releases page |
| ko parity | same checks on `/ko/` | Korean labels, no English leftovers in new keys |

The verifier `astro build` reads every component above (they are imported by the pages).


## Audit fold-back (Kimi reviewer 01a0ecad-2765, VERDICT: PASS, 6 non-blocking)

- N1: DesktopApp renders `<div class="section-tag">{t(lang,'desktop.tag')}</div>` so the key has a consumer.
- N2: tray mock status line is "Server running · 127.0.0.1:3333" (`desktop/lib/tray.mjs` statusLine).
- N3: tray mock adds "Open Server Log"; items are `<ul><li>`, separators `aria-hidden`.
- N6: `.nav-download` is hidden under 480px (mobile keeps the hero button, which is full width).

