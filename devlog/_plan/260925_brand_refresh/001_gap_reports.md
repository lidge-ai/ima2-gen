# 001 Gap reports (DeepSeek read-only explorers + A-round-1 review)

Verbatim outputs from `command-code/deepseek-deepseek-v4.1-flash` read-only lanes dispatched 2026-09-25 at HEAD 91791fe6. Dispositions live in 002.

## brand

Read-only scan complete. Gaps, with evidence:

**Brand asset + packaging**

1. `assets/logo.png` has five code consumers that must keep resolving after the swap: `README.md:17`, `docs/README.zh-CN.md:17`, `docs/README.zh-TW.md:17`, `desktop/electron-builder.yml:37`, `desktop/scripts/make-icons.mjs:14`. Fix: keep the path (overwrite in place) or update all five.
2. `package.json:73-88` `files[]` omits `assets/logo.png` and any `assets/brand/`, so the published tarball carries READMEs pointing at a file the package does not contain. Fix: add `assets/logo.png` + `assets/brand/` to `files[]` and to the `lint:pkg` mustInclude list at `package.json:32`.
3. `desktop/electron-builder.yml:42` claims make-icons "needs assets/logo.png", but the planned tray template reads `assets/brand/mark.svg`, which is absent from `files[]` (`:25-45`) — the packaged boot self-heal (`desktop/lib/icons.mjs:17`) then regenerates from a missing input. Fix: add `assets/brand/mark.svg` and correct the comment.
4. `desktop/scripts/make-icons.mjs:17-23,41` runs `knockOutWhite` (cutoff 240) because the current logo has a white background; on an alpha chrome tile it erases the white highlights. Fix: drop the knockout and resize the icon directly.
5. `desktop/scripts/make-icons.mjs:25-37` `TRAY_GLYPH` is a hand-written old-brand SVG (frame + sparkle + node) rendered at `:45-46`; the menubar icon stays old unless replaced by the new mark.
6. `desktop/lib/icons.mjs:4` pins the four generated filenames and `:26` maps darwin→`trayTemplate.png`; introducing new names or a `brand-mark` asset requires updating this list or the packaged app warns and falls back.

**UI / web surface**

7. `ui/index.html:24-28` inline data-URL favicon is the old circle-in-tile mark; switching to `/favicon.svg` needs a file in `ui/public/` (today only `fonts/`) so Vite copies it into `ui/dist`, which `server.ts:272` serves.
8. `ui/src/hooks/useBrowserAttentionBadge.ts:40-77` repaints the old mark (dark rounded rect + stroked circle + dot) over the favicon whenever results are unseen — absent from the plan's file map, so the badge would silently restore the retired glyph. Fix: draw the new mark or rasterize `/favicon.svg`.
9. `ui/src/styles/sidebar.css:120-133` `.logo-mark` pill plus `:385-395` `.logo-mark::after` dot are the mark in CSS; the class is shared by `ui/src/components/MobileAppBar.tsx:41` and hidden at `ui/src/styles/responsive-layout.css:358`. Fix: one mask definition valid at both sizes.
10. `tests/browser-attention-badge-contract.test.js:29-33` pins `link[rel~="icon"]`, `createElement("canvas")`, `renderBadgeFavicon`, and `tests/ui-radius-scale-contract.test.ts:256` strips `href="data:image/svg+xml…"` (a no-op once the favicon is a file link).
11. No apple-touch-icon and no web manifest exist for either surface (`ui/index.html:24-28`, `site/src/layouts/Base.astro:44-46`; only `skills/ima2-uiux/references/favicon-logo.md:18,31-32` mentions them). Fix: state out-of-scope explicitly or add 180px + manifest.

**Desktop shell**

12. `desktop/pages/loading.html:12` loads `../build/icon.png`, which is gitignored (`desktop/.gitignore:4`) and exists only after `npm run icons`; a static mark in `desktop/pages/**` (packaged at `desktop/electron-builder.yml:41`) survives a bare `electron .`.
13. `desktop/pages/loading.html:5` CSP is `style-src 'self'` while `:11` already uses an inline `style=` attribute; the rewrite must move it into the new stylesheet or CSP silently drops it.
14. `desktop/pages/desktop.css:91` `.logo` rule becomes dead once the loading page is rewritten; `desktop/pages/settings.html:36,40` copy references the menubar/Dock icon behaviors.
15. `desktop/lib/titlebar.html:28` shows the chrome tile (`../build/icon.png`) in the titlebar; decide tile vs flat mark there, since `desktop/lib/windows.mjs:41` feeds window icons from the same generated set.

**Site**

16. `site/public/og.png` (1200x630) is still the colorful splash + "IMA2-GEN" wordmark and is every page's card via `site/src/layouts/Base.astro:20,38-44`; no plan step regenerates it.
17. `site/public/favicon.svg:1-5` is the old mark, consumed by `site/src/layouts/Base.astro:46` and `site/src/layouts/DocsLayout.astro:59`.
18. `site/src/components/Header.astro:15` is text-only "ima2" and `site/src/components/SiteFooter.astro:14` sets a 180px "IMA2" outline wordmark; the plan adds the mark to the header only.
19. `site/src/components/Hero.astro:9-11,45,47,71` and `site/src/components/WhyBranch.astro:10` build the page from `site/public/fx/{blob-splash,blob-cluster,blob-ribbon,iridescent}.webp` — the retired colorful language remains the site's dominant visual. Decide and record.
20. There is no existing DMG surface to extend: `site/src/components/InstallFooter.astro:19-26` and `site/src/components/Hero.astro:14-16` list npm plus three scripts, and the only `dmg`/desktop hit in `site/src` is the FAQ string at `site/src/i18n/strings.ts:166`.
21. `site/src/pages/docs/quickstart.astro:22-43` lists install paths without the desktop app, and its Korean twin `site/src/pages/ko/docs/quickstart.astro` needs the identical edit (install copy is duplicated per language).
22. `site/src/i18n/strings.ts:134,346` says Node ≥20 while `package.json:89-91` requires `>=22`; the file holds en and ko in one object, so both entries change together.
23. `site/public/install-mac.sh:1-14` presents npm/Node setup as the macOS path with no DMG cross-link, so the two macOS stories will diverge once the guide lands.

**README / docs**

24. `README.md:453` "dmg + zip (arm64, x64)" and `:466` "both arm64 and x64" contradict `desktop/electron-builder.yml:83-86` and `tests/desktop-release-contract.test.ts:30-36`.
25. `docs/README.ko.md:17` and `docs/README.ja.md:17` carry no logo `<img>` at all (line 17 is the npm badge), so the five READMEs are inconsistent before the mark swap.
26. `docs/README.{ko,ja}.md` have no desktop section at all (`rg -i 'desktop|dmg|arm64'` returns nothing), so the arm64/DMG facts stay English-only.
27. `README.md:444-468` documents `dist:win`/`dist:linux` installers and an x64 verification story while `desktop/scripts/desktop-build-policy.mjs:6` builds macOS arm64 only.
28. `DESIGN.md:75` describes `--chrome` as "Metallic gradient for logo"; the brand section must revise this row or the design SoT contradicts the monochrome mark.
29. `bin/ima2.ts:99` prints "ima2-gen — GPT Image 2 Generator" and there is no ASCII art or image output anywhere under `bin/`; that string is the only CLI brand lever.
30. Product naming differs across five surfaces: `ui/index.html:10` "Image Gen", `ui/src/i18n/en.json:1276` "Image Generator" (ko/zh-Hans/zh-Hant at `:1276`), `desktop/electron-builder.yml:5` productName "ima2", `site/src/i18n/strings.ts:7` "ima2-gen — Local AI Studio…".

**Wiring for the new features**

31. `ui/src/App.tsx:201-202` already stacks `<ProviderReadinessPopup />` and `<OnboardingPopup />`; adding a star dialog on top of a 3-step onboarding means three first-run dialogs can overlap, and `ui/src/components/OnboardingPopup.tsx:9,29-33` (DISMISS_KEY + all-unauthenticated gate) is the only existing suppression.
32. New onboarding/star keys must exist in all four dictionaries or `tests/i18n-dictionary-contract.test.ts:20-32` fails, and any literal English in new `.tsx` fails `tests/i18n-coverage-contract.test.ts:32-36`.
33. A new route family needs registration in `routes/index.ts` (pattern at `:5-6`) plus rows in `docs/API.md:1059`, `docs/API.zh-CN.md`, `docs/API.zh-TW.md`, which `tests/model-default-projection-contract.test.ts:84` treats as a source of truth.
34. New source and test files must be registered by regenerating `npm run test:inventory` (`package.json:26`; `scripts/classify-tests.mjs:52-59` exits 1 when stale) and `structure/01-file-function-map.md` (`scripts/refresh-structure-line-counts.mjs:12`, invoked by `package.json:33`).
35. `gh` is not a shipped dependency — the only binaries electron-builder knows to sign are the extensionless sidecars at `desktop/electron-builder.yml:61-66` — so the star route must degrade cleanly when `gh` is missing on Windows/Linux hosts.

**Gates and leftovers**

36. `.github/scripts/pr-screenshot.cjs:28-36` counts every `ui/**` change plus image files under `assets/`, so committing the mark as `assets/brand/*.png` triggers `screenshot-gate`; per AGENTS.md the screenshot must ride the orphan `pr-assets` branch, not the PR branch.
37. Screenshot staleness is narrower than it looks: `assets/screenshots/classic-generate-lightmode.png` (embedded at `README.md:34`) shows the icon rail with no `.logo-mark`; the mark-bearing header is `ui/src/components/Sidebar.tsx:85-90`, so check which of `README.md:34,189,219,225,242,244,250,264,266` and `site/src/components/LatestCapabilities.astro:11` actually render it.
38. `integrations/comfyui/**` has no logo surface — `integrations/comfyui/ima2_gen_bridge/nodes.py:237` exposes only the display name "Ima2 Generate" and the bridge README carries no image. Nothing to update.
39. `Dockerfile` has no `LABEL` block (`Dockerfile:23-28` is ENV only) while `Dockerfile:42` copies all of `assets/`, so a new mark ships unchanged; add OCI labels only if image branding is wanted.
40. `public/index.html.legacy:54,63,497` still holds `.logo`/`.logo-dot` markup for the retired brand and is not served (`server.ts:272` serves `ui/dist` only) — delete it or keep it knowingly.

Two of these are outside the current plan's file map and would ship stale brand: **item 8** (attention-badge favicon repaints the old glyph) and **item 16** (`site/public/og.png` social card).

## desktop

Read-only audit complete. Findings below, ordered by area; every claim is anchored to the current tree.

**Loading page: status data it cannot get**

1. `desktop/lib/server.mjs:104` — `snapshot()` returns only `state/url/external/pid/lastError`, and `desktop/lib/ipc.mjs:11-32` + `desktop/preload.cjs:7-26` forward no log channel, so a redesigned loading screen has no phase, timing, or last-log-line to render. → Add `phase`/`startedAt`/`recentLog` to the snapshot and forward `supervisor.on("log")` (`server.mjs:113` already emits it).
2. `desktop/lib/server.mjs:13` + `:123` — `probeHealth` runs only at start; nothing monitors a running server, so a hung server has no state for the loading screen to show. → Poll health and expose a `degraded`/`reconnecting` state.
3. `desktop/pages/loading.html:11` — inline `style="height: calc(100% - 38px)"` is refused by the CSP at `loading.html:5` (no `'unsafe-inline'`; `titlebar.html:5` had to add it for the same reason). → Move the rule into `desktop.css`.
4. `desktop/pages/loading.html:10` + `desktop/pages/desktop.css:21` — a second 38px `.drag` strip is drawn inside a view that already begins below the 38px titlebar (`windows.mjs:23`, `titlebar.mjs:8`). → Drop `.drag` and the height offset from the loading page.
5. `desktop/pages/loading.js:10` — `running: "Server ready — opening…"` is overwritten by navigation in the same status tick (`windows.mjs:102`), so it is at best a sub-frame flicker. → Delete the label or hold it through a minimum-display fade.
6. `desktop/lib/windows.mjs:81-90` — no `did-fail-load` handler and no `bridge-missing` guard at `loading.js:1`, so a server that is up but erroring leaves Chromium's error page with no way back. → Load `loading.html` on failed load and guard the bridge call.
7. `desktop/pages/loading.html:13` has no `role="status"`/`aria-live`, and `desktop/pages/desktop.css:84` animates forever with no `prefers-reduced-motion` guard. → Add the live region and the media query.
8. `desktop/lib/windows.mjs:40` paints `#111214` while `desktop/pages/titlebar.html:7,11` uses `#18191c`/`#e6e7ea` and `desktop/pages/desktop.css:3,6` uses `#111214`/`#e8e8ea`. → One shared palette token set; today the title strip visibly differs from the page under it.

**Brand assets and packaging**

9. `desktop/pages/loading.html:12` + `desktop/pages/desktop.css:91` — the loading logo is `../build/icon.png` presented as a 72px plate with `border-radius: 18px`; a bare monochrome mark is not a square plate. → Ship a dedicated mark asset under `desktop/pages/` and drop the plate radius.
10. `desktop/electron-builder.yml:41` ships `desktop/pages/**` and `:44-45` ships `icon.png`/`tray*.png`, and both referenced paths exist in the packaged app — the risk is only for new files: anything placed in `desktop/build/` (other than those globs) or `assets/brand/` is absent at runtime (`:37` ships only `assets/logo.png`). → Add explicit globs for the new asset path.
11. `desktop/pages/settings.html:5` declares no `img-src` while `loading.html:5` and `titlebar.html:5` both need `img-src 'self' file:`, and `loading.html:5` has no `connect-src` so a redesign cannot poll the server directly. → Add `img-src 'self' file:` to Settings and keep status on the IPC bridge.
12. `desktop/scripts/make-icons.mjs:25-37` — `TRAY_GLYPH` is a hardcoded SVG of the old logo's motifs (rect + chart + sparkles), so the macOS menubar icon never follows the new brand. → Replace the glyph with the monochrome "2" template art.
13. `desktop/scripts/make-icons.mjs:17-23,43-45` — `knockOutWhite` (cutoff 240) alpha-punches near-white liquid-metal highlights, `tray.png` is a light resize that vanishes on light Windows/Linux trays, and `icon.png` is a full-bleed resize with no macOS icon-grid margin. → Key out only the plate, emit dark/light tray variants, and compose the mark into a padded 1024 plate.
14. `desktop/scripts/make-icons.mjs:14` hardcodes `assets/logo.png`, and `desktop/lib/icons.mjs:4` requires exact filenames, so renaming or adding brand art either regenerates from a stale file or forces the userData fallback (`icons.mjs:17`). → Point both at the new brand source and update `electron-builder.yml:37,42` together.
15. `desktop/main.mjs:38` joins `build/icon.ico` on win32, which `make-icons.mjs:39-48` never writes and `electron-builder.yml:44-45` never ships. → Generate `icon.ico` or reuse the PNG.
16. `.github/workflows/desktop.yml:48-57` filters `desktop/**` but not `assets/**`, so a logo-only change never enters the desktop build path. → Add the logo and new brand asset to the filter.

**Settings styling and desktop copy**

17. `desktop/pages/desktop.css:8` `--accent: #7c9cff` drives the focus ring (`:53`), switch-on (`:64`) and primary button (`:77`, foreground `#0b0d16`), while `:58,69,76` hardcode `#3a3c45`/`#26282f`/`#2e3138` outside the token block. → Define a monochrome accent plus matched foreground and promote the hardcoded grays to tokens so the sweep is complete.
18. `desktop/pages/desktop.css:9,10,82` — `--danger`, `--ok` and `#f5c542` stay saturated and would be the only non-monochrome chrome left. → Decide explicitly whether status colors survive the refresh.
19. `desktop/pages/titlebar.html:29` says "ima2-gen" while `desktop/main.mjs:21` sets `ima2`, `desktop/lib/windows.mjs:59` titles the window "ima2", `desktop/pages/settings.html:12` says "ima2 Desktop" and `desktop/lib/tray.mjs:28` says "ima2". → Pick one display name across all five.
20. `desktop/pages/settings.js:51` prints `ima2-desktop ${info.appVersion}` with the root version (3.19.0) while `desktop/package.json:3` is `0.1.0`. → Label the value as the ima2 app version.

**First-run in the desktop shell**

21. `desktop/lib/settings.mjs:6-19` has no first-run key and `:21-33` silently drops unknown keys, so an onboarding-complete marker saved from a page is discarded and onboarding would reappear every launch. → Add the key to `DEFAULT_SETTINGS` and `BOOL_KEYS`.
22. `desktop/lib/windows.mjs:20-31,116` exposes only `showMain`/`showSettings`, and `desktop/pages/` has no onboarding page. → Add `showOnboarding()` plus `pages/onboarding.html` (already covered by `electron-builder.yml:41`).
23. `desktop/main.mjs:95-96` gates first run only on `startHidden`, with no onboarding branch around `supervisor.start`. → Branch on the new first-run flag.
24. `desktop/preload.cjs:6` and `desktop/lib/ipc.mjs:6` expose the bridge to `file:` pages only, so a 3-step onboarding placed in the served UI at `http://127.0.0.1:<port>` cannot reach the shell at all. → Keep onboarding inside `desktop/pages/` and add its IPC channels.
25. `tests/desktop-updater.test.ts:181` asserts `await supervisor.start` precedes `void updater.checkForUpdates()` in `main.mjs`; inserting first-run work between them fails the suite. → Update the assertion with the new ordering.

**GitHub star prompt**

26. `desktop/` has no star prompt, while `bin/lib/star-prompt.ts:39-72` already implements gh detection and starring and ships via `electron-builder.yml:29`. → Reuse `isGhInstalled`/`starRepo`/`starPromptStatePath` from the built `bin/lib/star-prompt.js`.
27. `desktop/lib/server.mjs:139` passes `IMA2_CONFIG_DIR` only when the setting is non-empty, while the CLI state path derives from `config.storage.configDir` (`bin/lib/star-prompt.ts:12`), so the two can keep separate state files and prompt twice. → Resolve `main.mjs:60`'s configDir into the same state path.
28. `bin/lib/star-prompt.ts:40-63` uses `spawnSync` with 3/5/10s timeouts; calling it from Electron main freezes menus and windows. → Use an async spawn for the desktop path.
29. `desktop/preload.cjs:7-26` and `desktop/lib/ipc.mjs:11-32` expose no star surface, and the only existing escape hatch is `openUrl` (`main.mjs:67`). → Add `file:`-guarded star channels with the browser fallback when `gh` is absent.

**Tray and menu labels**

30. `desktop/lib/tray.mjs:3-8`, `desktop/pages/loading.js:8` and `desktop/pages/settings.js:6` hold three independent copies of the same state copy. → One shared status-copy module.
31. `desktop/lib/tray.mjs:53-63` repeats labels and accelerators already owned by `desktop/lib/menu.mjs:41,49,58,61,66` ("Open ima2" ⌘O, "Settings…" ⌘,, "Quit ima2" ⌘Q). → Centralize labels and accelerators.
32. `desktop/lib/menu.mjs:37,84-86` — About uses the bare `about` role with no `app.setAboutPanelOptions`, and Help links only GitHub/Documentation, leaving no home for the install guide or a star entry. → Set about-panel options and add install-guide/star items.
33. `desktop/lib/menu.mjs:39` and `desktop/lib/tray.mjs:60` enable "Check for Updates…" from `actions.updaterActive`, which is false off arm64 macOS (`updater.mjs:55`), so Windows/Linux builds show a permanently dead item. → Hide the item when inactive.
34. `tests/desktop-updater.test.ts:180` pins the literal label `Check for Updates…`. → Update the assertion if the copy changes.

**macOS packaging and updater UI**

35. `desktop/electron-builder.yml:103-104` — `LSUIElement: false` alongside a user-visible `NSCameraUsageDescription: "ima2 does not use the camera."`. → Remove the key or write real copy.
36. `desktop/electron-builder.yml:106-109` — `dmg.contents` sets no `background`, so the DMG window the new install guide describes is plain. → Add a branded background if the guide shows one.
37. `desktop/lib/updater.mjs:20-42` — dialogs carry no icon, release-notes link, or download progress, and nothing broadcasts updater state (`main.mjs:81-84` only sends `desktop:status`). → Add a `desktop:update` event with progress and link the release notes.
38. `desktop/lib/updater.mjs:75` returns `false` silently when a check is already in flight, and `:104-105` with `desktop/lib/app-lifecycle.mjs:33-38` silently does nothing when `prepareForUpdateInstall` returns false, so "Restart and Install" can appear to work and not. → Surface "already checking" and an error dialog on the false path.
39. `desktop/pages/settings.html:51-52` keeps the Auto-update switch enabled where the updater is inactive (`settings.js:50` disables only the button), and its sub-copy "Download new versions in the background; prompt when ready" is wrong when the switch is off (`updater.mjs:85-88` asks first). → Disable or hide the row and correct the copy.

No files were modified; all reads were `rg`/`sed`/`cat` plus one network fetch of electron-builder's hook definitions to confirm `beforeBuild` is a real hook (it is, `packages/app-builder-lib/src/configuration.ts:1017`), so `desktop/build/ensure-icons.mjs` does run before file collection.

## ui

Audit complete. All evidence below is read-only inspection of `@codex/brand-refresh`; no files were modified and no state-changing git/npm commands were run. Key structural facts: `onboarding` i18n is 4 keys per locale, no locale is missing any key today, there is no star/rate/feedback prompt or GitHub server route anywhere, and the onboarding/readiness modals sit at `z-index: 100`, below the gallery modal.

1. **[onboarding]** [OnboardingPopup.tsx](ui/src/components/OnboardingPopup.tsx:66) renders one title+body+2 buttons; there is no step index, per-step copy, or back/next state → add a step model with `onboarding.step{n}.title/body` and a progress affordance.
2. **[onboarding]** [OnboardingPopup.tsx:72](ui/src/components/OnboardingPopup.tsx:72) puts `data-modal-initial-focus` on the *skip* button (`:75` is the primary) → first-run Enter currently opts out; move initial focus to the primary CTA.
3. **[onboarding]** [OnboardingPopup.tsx:38](ui/src/components/OnboardingPopup.tsx:38) `/ :51` — Escape routes through `useModalFocus` into `dismiss()`, which writes the permanent flag; an accidental Escape kills the guide forever with no reset → separate snooze from permanent dismissal and add a reset control (see item 28).
4. **[onboarding]** [OnboardingPopup.tsx:56](ui/src/components/OnboardingPopup.tsx:56) has no backdrop `onClick`, while [ProviderReadinessPopup.tsx:57](ui/src/components/ProviderReadinessPopup.tsx:57) closes on outside pointer → pick one behavior for the new shell and apply it to both.
5. **[onboarding]** [OnboardingPopup.tsx:29-35](ui/src/components/OnboardingPopup.tsx:29) gates only on oauth+grok+gemini(+vertex), so a user who can already generate via MiniMax/Atlas/Nai/Comfy/openai-key still gets the first-run popup ([useKeyStatus.ts:9](ui/src/hooks/useKeyStatus.ts:9) exposes those lanes) → gate on `useProviderAvailability()` having zero ready lanes.
6. **[onboarding]** [OnboardingPopup.tsx:9](ui/src/components/OnboardingPopup.tsx:9) — `ima2.onboardingDismissed` is absent from `PERSISTED_KEYS` ([persistenceRegistry.ts:2-31](ui/src/store/persistenceRegistry.ts:2)) → register it (append-only per the comment at `:28-30`) so reset/registry contracts cover the new onboarding state.
7. **[stacking]** OnboardingPopup is mounted unconditionally at [App.tsx:202](ui/src/App.tsx:202) regardless of `settingsOpen` ([App.tsx:173](ui/src/App.tsx:173)) → a 3-step overlay will stack on Settings; suppress it while settings is open (or make the steps own the Settings transition).
8. **[stacking]** [SettingsWorkspace.tsx:202](ui/src/components/SettingsWorkspace.tsx:202) opens ProviderReadinessPopup from inside Settings, so readiness + onboarding + Settings can co-render → define a single modal precedence rule before adding a third surface.
9. **[stacking]** `.modal-backdrop` is `z-index: 100` ([toast-modal.css:255](ui/src/styles/toast-modal.css:255)) which is *below* `.gallery-backdrop` 110 ([gallery-modal.css:96](ui/src/styles/gallery-modal.css:96)) and below metadata dialogs 230/245 ([toast-modal.css:668](ui/src/styles/toast-modal.css:668), `:401`) → a new onboarding/star modal inheriting `.modal-backdrop` can be hidden behind the gallery; give it a dedicated backdrop layer.
10. **[tests]** `OnboardingPopup.tsx` is a registered dialog surface ([a11y-modal-contract.test.ts:11-20](tests/a11y-modal-contract.test.ts:11)) requiring `role="dialog"`, `aria-modal`, `aria-labelledby`, `useModalFocus`, and no local `keydown` listener → every new dialog file (3-step shell, star prompt) must be added to `DIALOG_SURFACES`.
11. **[tests]** The dismiss key is load-bearing outside the component: [appServer.ts:210](ui/e2e/fixtures/appServer.ts:210), [j6Selection.ts:177](ui/e2e/fixtures/j6Selection.ts:177), [package-published-ui-smoke.mjs:12](scripts/package-published-ui-smoke.mjs:12), and 11 e2e specs pass `dismissOnboarding` → keep the key name or migrate the fixture once.
12. **[tests]** [j1-first-run.spec.ts:6-7](ui/e2e/j1-first-run.spec.ts:6) explicitly disclaims onboarding behavior, so no journey spec owns this surface → add a first-run journey that asserts the 3 steps and the star prompt.
13. **[dead-css]** [ProviderReadinessPopup.tsx:57](ui/src/components/ProviderReadinessPopup.tsx:57) applies `provider-readiness-backdrop`, which has no rule anywhere in the repo → define it or drop it while touching this popup.
14. **[i18n]** [en.json:347-352](ui/src/i18n/en.json:347) (and [ko.json:347](ui/src/i18n/ko.json:347), [zh-Hans.json:347](ui/src/i18n/zh-Hans.json:347), [zh-Hant.json:347](ui/src/i18n/zh-Hant.json:347)) hold exactly `title/body/login/skip` → 3-step copy must be added to all four files in the same change.
15. **[i18n]** I diffed all four dictionaries: key sets are already identical (no missing keys today), so the refresh's real risk is new English fallbacks/key drift → add every new string (onboarding steps, star prompt, brand name) to all four locales.
16. **[brand]** [MobileAppBar.tsx:43](ui/src/components/MobileAppBar.tsx:43) hardcodes `"ima2-gen"` although `appBar.*` keys exist ([en.json:48-52](ui/src/i18n/en.json:48)) → add an `appBar.brand` key in all four locales.
17. **[brand]** [LanSignIn.tsx:67](ui/src/components/LanSignIn.tsx:67) hardcodes the same string, and this component imports the four JSON dicts directly ([LanSignIn.tsx:10-11](ui/src/components/LanSignIn.tsx:10)) → any brand key must exist in all four files it imports, and the brand mark must be added here too.
18. **[brand]** LanSignIn renders before `App` ([main.tsx:29](ui/src/main.tsx:29), `:49`) and shows no logo at all — only a muted 13px text line ([lan-sign-in.css:22](ui/src/styles/lan-sign-in.css:22)) → render the new mark on the LAN sign-in screen.
19. **[brand]** [HomeHero.tsx:62](ui/src/components/home/HomeHero.tsx:62) hardcodes an uppercase `IMA2` wordmark, [Sidebar.tsx:88-89](ui/src/components/Sidebar.tsx:88) splits `ima2`/`gen`, and the mobile bar says `ima2-gen` → pick one wordmark source for the refresh.
20. **[brand]** `.logo-mark` is still a CSS placeholder pill+dot ([sidebar.css:120-129](ui/src/styles/sidebar.css:120), `:385-395`) and is duplicated at [Sidebar.tsx:86](ui/src/components/Sidebar.tsx:86) and [MobileAppBar.tsx:41](ui/src/components/MobileAppBar.tsx:41) → build one shared `BrandMark` component and use it in both places.
21. **[brand]** [sidebar.css:68-71](ui/src/styles/sidebar.css:68) gives `.logo-title--gen` a 3-stop light/dark gradient (`#c8ccd8 → #6f7484 → #e8eaf1`) → the old colorful treatment must be replaced for a monochrome refresh.
22. **[brand]** [responsive-layout.css:358-361](ui/src/styles/responsive-layout.css:358) hides `.logo-mark` entirely below 430px → the new mark vanishes on the narrowest phones; keep a reduced mark instead of `display: none`.
23. **[brand]** [index.html:10](ui/index.html:10) still titles the app `Image Gen` and [index.html:25-28](ui/index.html:25) inlines the old SVG favicon (dark square + ring + dot) → update both, and cross-check [site/public/favicon.svg](site/public/favicon.svg:1).
24. **[brand, cross-lane]** Desktop icons derive from the old logo: [make-icons.mjs:14](desktop/scripts/make-icons.mjs:14) reads `assets/logo.png` and is consumed by [loading.html:12](desktop/pages/loading.html:12) → regenerating `icon.png` is part of replacing `assets/logo.png`.
25. **[brand, cross-lane]** Name variants already coexist: [loading.html:13](desktop/pages/loading.html:13) says `Starting ima2 server…` while [titlebar.html:29](desktop/pages/titlebar.html:29) says `ima2-gen` → fix the product name in one pass with the UI.
26. **[first-run]** [HomeHero.tsx:74-78](ui/src/components/home/HomeHero.tsx:74) with [en.json:385](ui/src/i18n/en.json:385) renders `no lane ready — open Settings` as inert text → make it an actionable control calling `openSettings("providers")`.
27. **[first-run]** [GenerateButton.tsx:22-27](ui/src/components/GenerateButton.tsx:22) keeps Generate enabled with zero providers, so a new user gets a server error toast via `handleError` ([storeGenImpl.ts:413](ui/src/store/storeGenImpl.ts:413)) → intercept when no lane is ready and route to sign-in/readiness instead.
28. **[first-run]** [SettingsWorkspace.tsx:21-25](ui/src/components/SettingsWorkspace.tsx:21) defines only `providers/workspace/general` → there is no home for an onboarding reset or first-run re-entry; add a row (natural fit: `general`).
29. **[first-run/mobile]** [MobileSettingsToggle.tsx:38](ui/src/components/MobileSettingsToggle.tsx:38) returns null in `home` mode and [MobileAppBar.tsx:36](ui/src/components/MobileAppBar.tsx:36) returns null unless `uiMode === "classic"`, leaving only [NavRail.tsx:217-219](ui/src/components/NavRail.tsx:217) → verify the onboarding "connect" CTA reaches sign-in from home/card-news/agent/assets on mobile.
30. **[first-run]** [storePersistence.ts:118-129](ui/src/store/storePersistence.ts:118) defaults `uiMode` to `classic` with no stored value → onboarding copy and screenshots must match the classic surface, not home.
31. **[star]** No rate/star/feedback prompt exists in the UI: `rg -i 'star|feedback|rate'` over `ui/src` (minus json/css) matches only `rateLimited`/`generated*`/`startedAt`; the closest neighbour is the gallery favorite star ([FavoriteStarButton.tsx:22-33](ui/src/components/controls/FavoriteStarButton.tsx:22), `styles/favorite-star.css`) → the prompt is net-new and must not reuse the ★ glyph or favorites labeling. A prior OpenCodex memory note records the same concern ("consent/star prompts must not be answered on the user's behalf"); treat that as cross-project precedent, not ima2-gen evidence.
32. **[star]** Successful generations enter history through several paths, not one: [storeGraphSave.ts:387](ui/src/store/storeGraphSave.ts:387) `addHistory` (+ `unseenGeneratedCount` at `:431`), callers [storeGenImpl.ts:191](ui/src/store/storeGenImpl.ts:191)/`:364`/`:409`, [storeVideoImpl.ts:233](ui/src/store/storeVideoImpl.ts:233)/`:356`, [storeAssetGenImpl.ts:96](ui/src/store/storeAssetGenImpl.ts:96)/`:189`, plus single-item [storeHistoryImpl.ts:369](ui/src/store/storeHistoryImpl.ts:369) (`:313`, `:398`), [ResultActions.tsx:131](ui/src/components/ResultActions.tsx:131)/`:162`, [AgentWorkspace.tsx:272](ui/src/components/agent/AgentWorkspace.tsx:272) → the star trigger needs one choke point, not a per-caller hook.
33. **[star]** [storeNodeGenImpl.ts:288-289](ui/src/store/storeNodeGenImpl.ts:288) marks node results ready without ever calling `addHistory`/`addHistoryItem`, so node-mode history only appears via the server reload path ([storeHistoryImpl.ts:405](ui/src/store/storeHistoryImpl.ts:405)) → a history-based star trigger never fires for node-mode users.
34. **[star]** There is no GitHub/star route (`routes/` has no such module) and no `gh` invocation in `bin/`, `lib/`, or `routes/` → "star using the user's gh login" requires a new server capability plus a client contract.
35. **[star/security]** The existing privileged-op precedent deliberately refuses browser calls: [admin.ts:28-40](routes/admin.ts:28) rejects any request carrying an `Origin` header and requires the boot nonce from the advertise file → a UI-initiated star fetch cannot reuse that pattern; decide between a copyable `ima2 star` CLI command and a new origin-allowed, consent-gated route.
36. **[star/security]** LAN guests traverse authenticated routes ([localAccessPolicy.ts:9-18](lib/localAccessPolicy.ts:9) plus [localLanAccess.ts](lib/localLanAccess.ts:1) and [lanSessionStore.ts](lib/lanSessionStore.ts:1)) → a host `gh` action must be host-only, and that gate has to be stated before the endpoint exists.
37. **[star]** No persistence key exists for star-prompt state; the correct home is `PERSISTED_KEYS` ([persistenceRegistry.ts:2-31](ui/src/store/persistenceRegistry.ts:2), append-only per `:28-30`) → a raw `localStorage.setItem` like [OnboardingPopup.tsx:40](ui/src/components/OnboardingPopup.tsx:40) would bypass the reset/registry contract.

Scope note: items 24 and 25 touch `desktop/`, which may belong to another lane; everything else is inside `ui/`, `tests/`, and repo-root i18n/asset references. One deviation from the stated tool restriction: I ran a single read-only `node` snippet (heredoc, no file written) to flatten and compare the four dictionaries' key sets, because a manual `rg`/`sed` diff of nested JSON would not settle key parity reliably. Nothing was created, edited, or deleted.



## site

Audit complete — read-only; no files were modified. All findings are from live repo evidence in this worktree (`codex/brand-refresh`).

**Desktop app absent/wrong (highest impact for this refresh)**

1. [strings.ts](site/src/i18n/strings.ts:166) (`faq.install.a1`, mirrored at [:378](site/src/i18n/strings.ts:378) ko) answers "Can I run it through the Codex desktop app?" with "No — it runs through the Codex CLI", but a signed/notarized app exists ([README.md:444](README.md:444), [desktop/electron-builder.yml](desktop/electron-builder.yml)) — rewrite the Q/A to offer the DMG as an install path.
2. [quickstart.astro:21](site/src/pages/docs/quickstart.astro:21) (ko [:21](site/src/pages/ko/docs/quickstart.astro:21)) has only npm and one-click shell installs — add a macOS DMG/download step for `ima2-3.19.0-mac-arm64.dmg` (Apple Silicon only per [desktop/electron-builder.yml](desktop/electron-builder.yml)).
3. [docs.ts:27](site/src/i18n/docs.ts:27) `DOCS_NAV` has no Desktop entry and `site/src/pages/docs/` contains no desktop page — add `docs/desktop` (en+ko) covering DMG install, Gatekeeper, and tray/menubar settings.
4. [index.astro:45](site/src/pages/docs/index.astro:45) "What it does" never mentions the desktop app, though the repo ships installers ([README.md:444-466](README.md:444)) — add a bullet with a link to the new desktop page.
5. [LatestCapabilities.astro:12](site/src/components/LatestCapabilities.astro:12) shows no desktop/onboarding card at all while the refresh adds a loading screen and 3-step first-run onboarding — add a card (or extend `latest.skills`) so the new surfaces are represented.

**Version / install facts**

6. [strings.ts:134](site/src/i18n/strings.ts:134) badge says `Node ≥20` (ko [:346](site/src/i18n/strings.ts:346)), but the package requires `>=22` ([package.json:90](package.json:90)), the README badge says `>=22` ([README.md:21](README.md:21)), the installers enforce `MIN_NODE=22` ([install-mac.sh:19](site/public/install-mac.sh:19)) — change both badge strings to `Node ≥22`.
7. [site/package.json:17](site/package.json:17) declares `engines.node >=20` — bump to `>=22` so the site build matches the repo floor.
8. [quickstart.astro:21](site/src/pages/docs/quickstart.astro:21) never states the Node floor (only the badge does); [docs/FAQ.md:26-28](docs/FAQ.md:26) documents "22 or newer" — add the requirement line to the docs.
9. [quickstart.astro:59](site/src/pages/docs/quickstart.astro:59) (ko [:59](site/src/pages/ko/docs/quickstart.astro:59)) lists `ima2 setup` option 4 as "API Key — paste your OpenAI API key (paid)", but the CLI prints "4) Web setup" ([bin/ima2.ts:104](bin/ima2.ts:104)) — fix both lists (the site copied the obsolete [setup-wizard-4way.png](site/public/screenshots/setup-wizard-4way.png)).
10. [strings.ts:32](site/src/i18n/strings.ts:32) hero CTA and [:171](site/src/i18n/strings.ts:171) install answer are `npm install -g ima2-gen && ima2 serve`, skipping `ima2 setup` that [InstallFooter.astro:19](site/src/components/InstallFooter.astro:19) and README show — add `ima2 setup` or state it is optional.
11. [FAQPage.astro:39](site/src/components/FAQPage.astro:39) prints only `npm install -g ima2-gen` + `ima2 serve` — align with the three-command flow.
12. [FAQPage.astro:44-53](site/src/components/FAQPage.astro:44) lists only macOS and Windows PowerShell one-click scripts while `install-linux.sh` is offered in [Hero.astro:16](site/src/components/Hero.astro:16) and [InstallFooter.astro:26](site/src/components/InstallFooter.astro:26) — add a Linux/WSL row.
13. [quickstart.astro:43](site/src/pages/docs/quickstart.astro:43) (ko [:43](site/src/pages/ko/docs/quickstart.astro:43)) claims the scripts "handle stale process cleanup automatically", and [:66](site/src/pages/docs/quickstart.astro:66) repeats it for the Windows script, but the scripts contain no kill/taskkill logic and README says the opposite ([README.md:91](README.md:91), [:113](README.md:113)) — delete the cleanup claim from both pages.
14. [strings.ts:181](site/src/i18n/strings.ts:181) (ko [:393](site/src/i18n/strings.ts:393)) says "Up to eight in parallel from a single Classic run"; the real cap is `limits.maxParallel` default 24 ([config.ts:162](config.ts:162), [docs/FAQ.md:381](docs/FAQ.md:381)) and multimode defaults to 4 ([useAppStore.ts:259](ui/src/store/useAppStore.ts:259)) — restate with the verified number.
15. [SiteFooter.astro:8-21](site/src/components/SiteFooter.astro:8) and [InstallFooter.astro:8-36](site/src/components/InstallFooter.astro:8) omit 正體中文 although [docs/README.zh-TW.md](docs/README.zh-TW.md) exists and README links it ([README.md:27](README.md:27)) — add the zh-TW link (new `install.link.zhTw` key).

**Stale product facts in docs pages**

16. [config.astro:47](site/src/pages/docs/reference/config.astro:47) (ko [:47](site/src/pages/ko/docs/reference/config.astro:47)) documents `IMA2_GROK_IMAGE_MODEL_DEFAULT` default as `grok-imagine-image-quality`; the code default is `grok-imagine-image-2.0` ([config.ts:396](config.ts:396)) — update the default (README [:362](README.md:362) and [docs/README.ko.md:268](docs/README.ko.md:268) are stale too).
17. [providers.astro:80](site/src/pages/docs/concepts/providers.astro:80) (ko [:80](site/src/pages/ko/docs/concepts/providers.astro:80)) labels `grok-imagine-image-quality` "Default Grok image model ('Grok+' / Best)" — same drift; retitle it and add `grok-imagine-image-2.0`.
18. [providers.astro:79-80](site/src/pages/docs/concepts/providers.astro:79) and [api.astro:64-66](site/src/pages/docs/reference/api.astro:64) list only two Grok image models; the registry has three including `grok-imagine-image-2.0` ([registry.ts:77](lib/providers/registry.ts:77)) — add the third model to both pages and the ko mirror.
19. [providers.astro:155-157](site/src/pages/docs/concepts/providers.astro:155) describes a two-button "Grok / Grok+" picker, which cannot represent three image models — update the picker description after the model list is corrected.
20. [config.astro:46](site/src/pages/docs/reference/config.astro:46) (ko [:46](site/src/pages/ko/docs/reference/config.astro:46)) documents `IMA2_GROK_PLANNER_TIMEOUT_MS` default `60000`; the code default is `900_000` ([config.ts:380](config.ts:380)) — update both.
21. [config.astro:49](site/src/pages/docs/reference/config.astro:49) (ko [:49](site/src/pages/ko/docs/reference/config.astro:49)) documents `IMA2_GROK_GENERATION_TIMEOUT_MS` default `120000`; code default is `300_000` ([config.ts:398](config.ts:398)) — update both.
22. [config.astro:45-50](site/src/pages/docs/reference/config.astro:45) omits `IMA2_GROK_SEARCH_TIMEOUT_MS` (300000) and `IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS` (1500000) that exist in [config.ts:384-392](config.ts:384) and README — add the missing rows.
23. [config.astro:45](site/src/pages/docs/reference/config.astro:45) and 5 other site pages state the planner default is `grok-4.5`, while `DEFAULT_GROK_PLANNER_MODEL` is `grok-4.3` ([config.ts:29](config.ts:29)); README/CLI.md agree with the site — resolve which is authoritative ([config.ts:29](config.ts:29) vs [docs/CLI.md:247](docs/CLI.md:247)) then align the site ([providers.astro:26](site/src/pages/docs/concepts/providers.astro:26), [:142](site/src/pages/docs/concepts/providers.astro:142), [api.astro:88](site/src/pages/docs/reference/api.astro:88), [cli.astro:67](site/src/pages/docs/reference/cli.astro:67)).
24. [cli.astro:59](site/src/pages/docs/reference/cli.astro:59) (ko [:59](site/src/pages/ko/docs/reference/cli.astro:59)) lists `gen --provider <oauth|api|grok|grok-api|agy|gemini-api|runway|higgsfield>`, omitting `atlascloud|minimax|nai|comfy` that the CLI resolves ([registry.ts:158-237](lib/providers/registry.ts:158)) and [api.astro:65](site/src/pages/docs/reference/api.astro:65) already lists — extend the list.
25. [strings.ts:95](site/src/i18n/strings.ts:95) (ko [:305](site/src/i18n/strings.ts:305)), [docs/index.astro:53](site/src/pages/docs/index.astro:53) and [ko/docs/index.astro:52](site/src/pages/ko/docs/index.astro:52) say video takes "up to 7 references", while Ref2V accepts 2–14 ([imageModels.ts:243](lib/imageModels.ts:243)) and the docs' own providers page says 2–14 ([providers.astro:178](site/src/pages/docs/concepts/providers.astro:178)) — change all four to 14 / "2–14".

**Screenshots, i18n parity, meta, links**

26. [LatestCapabilities.astro:12](site/src/components/LatestCapabilities.astro:12) pairs the Agent-skills card with `screenshots/settings-oauth-generation.png`, whose alt ([strings.ts:90-91](site/src/i18n/strings.ts:90), ko [:300-301](site/src/i18n/strings.ts:300)) claims `ima2 skill ls` output — capture a real `ima2 skill ls` screenshot or change the alt/copy.
27. [LocalAndOAuth.astro:17](site/src/components/LocalAndOAuth.astro:17) uses `settings-oauth-generation.png` with alt "Settings workspace…" ([strings.ts:126](site/src/i18n/strings.ts:126)) while the unused [site/public/screenshots/settings-workspace.png](site/public/screenshots/settings-workspace.png) exists — point the page at the matching file.
28. Eight screenshots are orphaned and never referenced by any page: `canvas-mode-cleanup.png`, `classic-generate-lightmode.png`, `settings-grok-connected.png`, `settings-workspace.png`, `settings.png`, `setup-wizard-4way.png`, `style-sheet-editor.png`, `video-result-gallery.png` ([site/public/screenshots](site/public/screenshots)) — reference them (e.g. style sheet, onboarding) or delete them; `setup-wizard-4way.png` shows the obsolete option-4 text.
29. [providers.astro:98](site/src/pages/docs/concepts/providers.astro:98) enumerates "Gemini API provider" before "Grok pipeline", but the ko page moves it to [:143](site/src/pages/ko/docs/concepts/providers.astro:143) after an extra h2 "Grok 청구 & 계정 전환" ([:135](site/src/pages/ko/docs/concepts/providers.astro:135)) that does not exist in EN — sync the section order and headings (ko file is 173 lines vs en 217).
30. [ko/docs/reference/api.astro:171](site/src/pages/ko/docs/reference/api.astro:171) orders "공통 에러 코드" before "키 관리" while EN has "Keys & auth" then "Common error codes" ([api.astro:150](site/src/pages/docs/reference/api.astro:150)) — reorder ko to match.
31. [DocsLayout.astro:49-57](site/src/layouts/DocsLayout.astro:49) emits og:title/description/url but no `og:image`, which [Base.astro:41](site/src/layouts/Base.astro:41) does provide — add `og:image` (`/ima2-gen/og.png`) to the docs layout.
32. [Base.astro:19](site/src/layouts/Base.astro:19) derives canonical from language only, so both FAQ pages ([faq/index.astro:11](site/src/pages/faq/index.astro:11), [ko/faq/index.astro:11](site/src/pages/ko/faq/index.astro:11)) declare `<link rel=canonical>` and `og:url` pointing at the landing pages — add a path/canonical prop and pass `/faq/`.
33. [LangToggle.astro:10-11](site/src/components/LangToggle.astro:10) hardcodes the landing page, so switching language on `/faq` or `/ko/faq` (which use `Header`) drops the user on the home page — derive the counterpart URL from the current path, as [DocsLayout.astro:27-29](site/src/layouts/DocsLayout.astro:27) already does.
34. [quickstart.astro:66](site/src/pages/docs/quickstart.astro:66) hardcodes `/ima2-gen/install-windows.ps1` instead of `import.meta.env.BASE_URL`; the same absolute-path assumption appears in [Hero.astro:14-16](site/src/components/Hero.astro:14), [InstallFooter.astro:24-26](site/src/components/InstallFooter.astro:24) and [FAQPage.astro:47-51](site/src/components/FAQPage.astro:47) — centralize the script base URL so a custom domain (noted in [astro.config.mjs:3-4](site/astro.config.mjs:3)) does not break them.
35. [strings.ts:11-12](site/src/i18n/strings.ts:11) og text promises "Two lines to install" while the documented flow is three commands ([InstallFooter.astro:19](site/src/components/InstallFooter.astro:19)) — reword both en/ko og descriptions.
36. [strings.ts:8-9](site/src/i18n/strings.ts:8) en `meta.desc` names modes and providers, but the ko counterpart ([:218-219](site/src/i18n/strings.ts:218)) is a shorter, differently scoped sentence — restore content parity between the two descriptions.
37. [strings.ts:31](site/src/i18n/strings.ts:31) hero sub and [:8-9](site/src/i18n/strings.ts:8) meta list only Grok/GPT paths, while the product ships Gemini/Antigravity, AtlasCloud, MiniMax, NovelAI and ComfyUI ([README.md:32](README.md:32), [providers.astro:17-19](site/src/pages/docs/concepts/providers.astro:17)) — add a "multiple providers" mention to the marketing copy.
38. [strings.ts:129](site/src/i18n/strings.ts:129) install section tag is `06 · Get going` (ko [:341](site/src/i18n/strings.ts:341)) while the previous section is `04` ([:116](site/src/i18n/strings.ts:116)) and no `05` exists — either renumber to `05` or insert the missing section (a natural slot for the desktop DMG block).
39. [favicon.svg:1-5](site/public/favicon.svg:1) is a generic dark ring-and-dot monogram with no relation to the new liquid-metal "2" mark, and [Header.astro:15](site/src/components/Header.astro:15) sets the brand as plain text — regenerate the favicon from the new mark (and confirm [og.png](site/public/og.png) keeps the new wordmark, which it currently does).
40. [docs.ts:59-71](site/src/i18n/docs.ts:59) points Korean readers at English-only `docs/API.md`, `docs/CLI.md` and `docs/PROMPT_STUDIO.md` even though `PROMPT_STUDIO.ko.md` and `FAQ.ko.md` exist in [docs/](docs) — add per-language external URLs to the nav model.

No broken internal links were found: every `docsPath`/`siteHref` slug in `DOCS_NAV` and every inline `d('…')` target resolves to an existing `site/src/pages/{docs,ko/docs}/**` page, and all referenced `site/public/*` assets exist.

## readme

Audit complete. Findings below; every item is `path:line` evidence plus a one-line fix.

## README.md

1. `README.md:411` — links `docs/FAQ.md#what-should-i-share-when-oauth-image-generation-returns-no-image`; the real heading is `docs/FAQ.md:296` "What should I share when GPT OAuth image generation returns no image?" → change the anchor to `#what-should-i-share-when-gpt-oauth-image-generation-returns-no-image`.
2. `README.md:128` — "up to 7 references (video)" contradicts `lib/imageModels.ts:243` `MAX_REF2V_REFERENCES = 14` and `lib/providers/registry.ts:87` `video: 14` → write "up to 14 references (video)".
3. `README.md:453` — `npm run dist:mac # dmg + zip (arm64, x64)`; `desktop/electron-builder.yml:85-88` declares `arch: [arm64]` for both dmg and zip → change the comment to `(arm64 only)`.
4. `README.md:466` — "verifies … for both arm64 and x64" contradicts `desktop/electron-builder.yml:91-93` ("Distribution is Apple Silicon only for now") → drop x64 from the sentence.
5. `README.md:458` — "on `desktop-v*` tag pushes, desktop PRs, or manual dispatch"; `.github/workflows/desktop.yml:6-22` has only `workflow_dispatch` and `push` (tags `desktop-v*`, branch `dev`), no `pull_request` → replace "desktop PRs" with "pushes to `dev`".
6. `README.md:463` — `gh workflow run desktop.yml … -f publish=false`; the only declared input is `platform` (`.github/workflows/desktop.yml:8-13`) → remove `-f publish=false` or add the input to the workflow.
7. `README.md:466` — "publishing a manual build requires `platform=all`" depends on the same nonexistent `publish` input → restate against the actual `platform` choices.
8. `README.md:358` and `README.md:173` — `IMA2_GROK_PLANNER_MODEL` default `grok-4.5`; `config.ts:29` `DEFAULT_GROK_PLANNER_MODEL = "grok-4.3"` → change both to `grok-4.3`.
9. `README.md:362` — `IMA2_GROK_IMAGE_MODEL_DEFAULT` default `grok-imagine-image-quality`; `config.ts:396` default is `grok-imagine-image-2.0` → change the default column.
10. `README.md:364` — `IMA2_GROK_GENERATION_TIMEOUT_MS` default `120000`; `config.ts:399` is `300_000` → change to `300000`.
11. `README.md:185` — Grok model picker listed as `grok-imagine-image` / `grok-imagine-image-quality`, omitting the current default `grok-imagine-image-2.0` (`lib/providers/registry.ts:77`, `config.ts:396`) → add `grok-imagine-image-2.0`.
12. `README.md:151` — "list reference modules (35 files)"; `skills/ima2-front/references` holds 37 files → change to 37 (and align `skills/ima2-front/SKILL.md` copy).
13. `README.md:143` — "18 reference files" for UI/UX; `skills/ima2-uiux/references` holds 21 → change to 21.
14. `README.md:392-394` — "Useful references" lists Korean/Japanese/Simplified Chinese READMEs but not `docs/README.zh-TW.md` → add the zh-TW entry.
15. `README.md:46-70` — the `### Docker` heading at line 46 owns everything after it, so the lane-catalog defaults and `ima2 gen`/`ima2 video` examples at lines 55-64 read as Docker content → promote lines 55-70 into their own `### CLI quickstart` subsection before Docker.
16. `README.md:104-108` — "Stop the running server with Ctrl+C, then:" is broken by the parenthetical `(or from another terminal: \`ima2 stop\`)` before the code block → move the parenthetical after the code block.
17. `README.md:24,26` — 🌐 and 📖 are used as blockquote markers; the family style forbids emoji markers → drop both emoji or replace with bold labels.
18. `README.md:444-470` — the Desktop section documents only contributor build steps; `desktop-v3.19.0` ships `ima2-3.19.0-mac-arm64.dmg`/`.zip`, so a first-time reader has no download/install path → add a short "Install the macOS app" block naming the release asset and the arm64-only constraint.
19. `README.md:16-18` — the logo `<img src="assets/logo.png">` is the mark the brand refresh replaces, and nothing in the five files mentions the new monochrome "2" mark or the new loading screen / onboarding / star prompt → point the block at the new asset and add whatever onboarding/star copy the refresh introduces.

## docs/README.ko.md

20. `docs/README.ko.md:28` — "core lane 8개" lists 8 lanes; the registry has 10 (`oauth`, `api`, `grok`, `grok-api`, `agy`, `gemini-api`, `atlascloud`, `minimax`, `nai`, `comfy` per `lib/providers/registry.ts`) → say 10 and include NovelAI and ComfyUI.
21. `docs/README.ko.md:92-99` — "## 최근 주요 변경" is a release-notes section unique to this file and placed between `### 업데이트` and `### 설정`, breaking the quick-start flow → move it to `CHANGELOG.md` or the end of the file.
22. `docs/README.ko.md:130-131` — provider intro claims only OAuth/API-key/Grok support; NovelAI, Gemini API, Antigravity and the MCP lanes are missing → mirror `README.md:167-176`.
23. `docs/README.ko.md:144` — QuotaCard described only as `$used/$limit`; `README.md:185` now prefers the weekly credits percentage from `GET /v1/billing?format=credits` → update the Korean text.
24. `docs/README.ko.md:215-225` and `:231-242` — Server table omits `ima2 stop` and `ima2 service`; Client table omits `ima2 models`, `ima2 defaults set|reset`, `ima2 vectorize`, `ima2 prompt build` → add the missing rows from `README.md:275-296`.
25. `docs/README.ko.md:48-53` — Quick Start shows only video examples, and the `NO_DEFAULT_MODEL` fail-closed rule (`README.md:66`) is absent, so `ima2 gen` looks like it works without a default → add the `ima2 models` / `ima2 defaults set image` sequence and the fail-closed note.
26. `docs/README.ko.md:256-277` — config table omits `IMA2_REASONING_EFFORT`, `IMA2_PROMPT_BUILDER_BACKEND`/`MODEL`, the five `IMA2_API_*` rows, `NOVELAI_API_KEY`, the `IMA2_NAI_*` rows and the Grok timeout rows → sync with `README.md:332-369`.
27. `docs/README.ko.md:229` and `:246` — the same `CLI.md` link is given twice in one section → keep one.
28. `docs/README.ko.md:16-30` — no logo block (README/zh have one at `README.md:17`, `docs/README.zh-CN.md:17`) and no Developer-docs link (`README.md:26`) → add both for parity.

## docs/README.ja.md

29. `docs/README.ja.md:102` — "動画最大7" contradicts `docs/README.ja.md:123` ("Ref2V(2-14…)") and `lib/imageModels.ts:243` → write 14.
30. `docs/README.ja.md:111` — heading is a stale sentence ("画像生成は OAuth と API key をサポートします") that no other language uses → rename to the "Provider Paths" equivalent.
31. `docs/README.ja.md:113-119` — provider bullets list only `grok-api`, `agy`, `gemini-api`; `oauth`, `api`, `grok` and `nai` are missing, leaving the section detached from its own intro → restore the full lane list.
32. `docs/README.ja.md:26` — "8 つの core lane" → same fix as item 20 (10 lanes, include NovelAI/ComfyUI).
33. `docs/README.ja.md:131` — "画像生成と Prompt Builder の既定値は `gpt-5.6-luna`" conflates the image default with Prompt Builder backend selection (`README.md:191-196`) → split the two claims.
34. `docs/README.ja.md:233-250` — the shortest config table of the five: missing `IMA2_MAX_PARALLEL`, `IMA2_GROK_PLANNER_MODEL`, both Grok model defaults, `IMA2_REASONING_EFFORT`, the `IMA2_API_*` rows and the NovelAI rows → sync with `README.md:332-369`.
35. `docs/README.ja.md:20` — carries 🌐 but drops the 📖 docs line, so the Japanese file advertises no developer-docs site while `README.md:26` does → add the docs link and drop both emoji.
36. `docs/README.ja.md:262` — FAQ and recover-images links only; `docs/PROMPT_STUDIO.md` (present in every other file) is missing → add it.
37. `docs/README.ja.md:206` and `:223` — duplicate `CLI.md` link in one section (same as ko) → keep one.

## docs/README.zh-CN.md

38. `docs/README.zh-CN.md:123` — "最多 7 个参考文献（视频）" → 14, per `lib/imagemodels`-backed cap (`lib/imageModels.ts:243`).
39. `docs/README.zh-CN.md:34` — alt text describes video playback ("视频播放，图库侧边栏显示生成的图像和视频") but the image is `classic-generate-light.png`, a light-mode classic screenshot → rewrite the alt text (same defect at `docs/README.zh-TW.md:34`).
40. `docs/README.zh-CN.md:168,175,330,333` — planner default `grok-4.5`, Grok image default `grok-imagine-image-quality`, planner timeout `60000`, generation timeout `120000`; ground truth is `grok-4.3` (`config.ts:29`), `grok-imagine-image-2.0` (`config.ts:396`), `900000` (`config.ts:386`), `300000` (`config.ts:399`) → correct all four.

Two additional zh-CN items worth fixing alongside: `docs/README.zh-CN.md:309` uses `|多变的|` as the config table header ("Variable" mistranslated as "changeable") and `:268` renders the CLI reference link as `[满的CLI参考](CLI.md)`; `:93` and `:246` both render `### 设置`, producing colliding anchors, and `:360-362` lists `README.zh-CN.md` (a self-link) while omitting `README.zh-TW.md`.

## docs/README.zh-TW.md

Same four factual defects as zh-CN, at `docs/README.zh-TW.md:323,324,325,327` (planner model, planner timeout, Grok image default, Grok generation timeout), plus `:123` ("最多 7 張影片參考"), `:135-136`/`:144` ("30 多份參考文件" is fine, but "18 份參考文件" should be 21 and "(35 files)" should be 37), `:32` ("8 個 core lane" → 10), and `:93`/`:240` both rendering `### 設定`. Its config header at `:307` is correct (`| 環境變數 |`), unlike zh-CN.

Two translation-style items: `docs/README.zh-TW.md:260` renders the CLI "Client" heading as `### 客戶` ("customer") and `:266` translates "lanes" as `車道` ("road lane"); zh-CN has the same class of error at `:266`/`:272`.

## Cross-file

All four translations lack the `### Desktop app (Electron)` section (`README.md:444-470`) and therefore the DMG/arm64 guidance; `docs/README.ko.md` and `docs/README.ja.md` additionally lack the Docker section (`README.md:46`, present at `docs/README.zh-CN.md:46` and `docs/README.zh-TW.md:46`), the Agent Skills section (`README.md:133`, present at zh-CN/zh-TW), and the Contributors section (`README.md:472`, present at zh-CN/zh-TW). The only logo reference in the docs set is `README.md:17` plus `docs/README.zh-CN.md:17`/`docs/README.zh-TW.md:17` — ko and ja ship no mark at all, so the brand swap has to touch five files, not one. And the site has `locales: ['en','ko']` only (`site/astro.config.mjs:11`), so `docs/README.ja.md:20` and both zh files pointing at `…/ko/` as their "Live site" link is the only working target today; a ja/zh site locale would need to exist before those links can be localized.

## reviewer

Audit complete. I verified every cited path/line with `rg` against the working tree (HEAD `91791fe6`), plus the contract tests and ignore rules that the plan's own verifier commands will exercise.

## Blockers

1. **The star feature already exists in-repo and wp3 reinvents it.** `bin/lib/star-prompt.ts` owns the repo literal (`:9`), gh presence+auth detection (`isGhInstalled`, `:36`), the star write (`gh api -X PUT /user/starred/<repo>`, `:57`), once-only persisted state (`starPromptStatePath`/`markPrompted`, `:11,30`), and is wired at `bin/ima2.ts:45` with coverage in `tests/star-prompt.test.ts`. `030_phase3_github_star.md` instead declares `lib/githubStar.ts` NEW (trusted gh resolution, star write, second repo constant `STAR_REPO`) and sources the pattern from OpenCodex `src/github/star-state.ts`. Nothing in 000/030 mentions the existing module, so the plan ships two star paths and two state stores (`~/.ima2/state/star-prompt.json` vs localStorage `ima2.starPrompt.v1`) that can prompt the same user twice. Decide the owner (extract/share the gh primitives, or state why the CLI path is not reused) before wp3.

2. **`docs/API.md` is a required file and is missing from the change map.** `tests/api-docs-contract.test.js:38` collects every `app.<verb>("/api/...")` literal from `routes/*.ts` and asserts `docs/API.md` documents it; a new `routes/github.ts` fails `npm test` until that doc is updated. `030`'s map lists only `routes/index.ts`, and 000's SoT sync points at `structure/03-server-api.md`, which that test does not enforce (`tests/studio-surface-docs-contract.test.ts:95` checks only specific tokens).

3. **`desktop/pages/desktop.css` is shared with the settings window, so the accent change regresses it.** `--accent` (`:8`) also drives `.switch input:checked + span` (`:64`) with a `#fff` knob (`:60`) and `input:focus` (`:53`). With `#e8e8ea`, the five toggles at `desktop/pages/settings.html:26,33,37,41,45` become a white knob on a near-white track. `020`'s map presents this as a loading-screen change and only reasons about `button.primary` contrast; the switch/focus consumers and the unchanged `.dot`/`.status` rules (`settings.html:18`) are unaddressed.

4. **The roadmap itself is git-ignored, so wp7 merges without it.** `git check-ignore` resolves `devlog/_plan/260925_brand_refresh/000_plan.md` to `.gitignore:13` (`devlog/_plan/*`). Every other active unit carries an explicit allowlist pair (`.gitignore:77-94`, 17 such lines), and 000 wants this unit recorded in `structure/07-devlog-map.md`. No decade doc lists the `.gitignore` edit, and 000's "write scope = files listed in the decade docs" excludes it — plain `git add -A` drops the unit silently.

## Non-blocking notes

- `tests/a11y-modal-contract.test.ts:10-21` is an explicit dialog registry. The new `ui/src/components/StarPrompt.tsx` is not listed in wp3's map; add it so the modal's role/aria/`useModalFocus` claims are actually enforced.
- `npm run test:inventory` (in the plan's verifier) rewrites the tracked `docs/migration/runtime-test-inventory.md`, and `scripts/classify-tests.mjs:24` classifies anything importing `../lib/` as runtime. `tests/github-star.test.ts` will make that file stale, so it is a required write too.
- The loopback test in wp3 duplicates existing owner code and is incomplete: `lib/localAccessPolicy.ts` already has `isLocalBind` (`:42`) and `literalHost` (`:60`), which normalizes `::ffff:` forms including the hex-compressed IPv4-mapped case (`::ffff:7f00:1`) that the plan's literal set misses; `server.ts:243 isLoopbackHost` exists too. Also worth stating explicitly in 030 that cross-site POSTs are already refused for all `/api/*` by `checkBrowserRequest` (`lib/localAccessPolicy.ts:129`) via `server.ts:265` — the hole documented at `routes/admin.ts:9-19` — so the star POST's only listed gate (loopback) is not the interesting one.
- 030's HTTP contract leaves `starRepository`'s `gh_unavailable` result unmapped (only 409 `GH_UNAUTHENTICATED` and 502 `GH_FAILED` are defined), and the lib table's "gh missing → unauthenticated" then disagrees with the lib shape's `gh_unavailable`.
- StarPrompt-only branches have no test triggers in 030's table: localStorage `dismissed|starred`, suppression while onboarding is open, the `history[0]` change with `createdAt >= mountedAt`, star-count fetch failure, Escape. Field names check out (`createdAt` at `storeTypes.ts:49`, `mediaType` used at `GalleryModal.tsx:178`).
- `site/src/components/Header.astro:14` cites the `.frame` wrapper; the brand anchor is `:15`.
- 020's "loading.html (after)" block omits the `<link rel="stylesheet" href="loading.css">` the new file needs under `style-src 'self'`, and the plan should state that `.dot`/`.status`/`.center`/`.logo` in `desktop.css` must survive for `settings.html`. Removing the inline `style=` is correct: `style-src 'self'` has no `'unsafe-inline'`.
- 030/040 say new CSS is "imported the way sibling modal styles are"; the actual sites are `ui/src/index.css:279,283` (main.tsx imports only a subset), so name `index.css` for `star-prompt.css` and `onboarding.css`.
- 050's conditional resolves positively: `site/src/pages/docs/quickstart.astro:22-40` already lists install commands, and the ko twin is `site/src/pages/ko/docs/quickstart.astro` (a separate tree, not a sibling file). State it as a definite edit.
- 040 and 060 depend on a "ui gap report" and a "readme gap report" that exist nowhere in the tree; name the artifact or drop the dependency. 060 alone has no file-change map and introduces a link-check script with no path or owner.
- 010: the kit already contains `mark-chrome-512.png`, so "resize mark-chrome.png to height 512" is redundant. Do not hand-edit the generated runtime-install tables in the five READMEs (`tests/runtime-install-projection.test.ts:9`).
- Verified accurate as written: `ui/index.html:24-28`, `sidebar.css:120,385`, `server.mjs:103-104`, `preload.cjs:6`, `make-icons.mjs:14`, `loading.html:12`, `Sidebar.tsx:85-89`, `MobileAppBar.tsx:40-41`, `App.tsx:202`, `storeHistoryImpl.ts:369`, `en.json:347`, `strings.ts:134,346`, `apiRequestBudget.ts:38`, `electron-builder.yml:91`, `Base.astro:21,46`, `DocsLayout.astro:33,59`, `README.md:17,453,466`, `docs/README.{zh-CN,zh-TW}:17`, `desktop/lib/ipc.mjs:13-25`, `DEFAULT_SETTINGS.port`. Naming is conforming: `260925_brand_refresh` matches `_plan/README.md`'s `YYMMDD_<kebab-slug>`, and `000_plan.md` + `NN0_<phase>` matches the 260917/260922 units.

VERDICT: GO-WITH-FIXES (blockers=4)

