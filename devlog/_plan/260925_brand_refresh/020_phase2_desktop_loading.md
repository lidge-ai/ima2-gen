# 020 Phase 2 — Desktop loading screen with real status

Only facts the shell really has: `supervisor.snapshot()` = {state, url, external, pid, lastError} (desktop/lib/server.mjs:103-104), `getSettings().port`, `getInfo().appVersion` (desktop/lib/ipc.mjs:13-25). Provider and gallery rows from the concept are dropped because the shell cannot observe them.

## File change map

| Path | Action | Change |
|---|---|---|
| desktop/pages/loading.html | MODIFY | new markup below; removes the inline `style=` attribute |
| desktop/pages/loading.js | MODIFY | state table below, elapsed timer, version footer |
| desktop/pages/loading.css | NEW | page styles |
| desktop/pages/desktop.css | MODIFY | `--accent` #7c9cff → #e8e8ea; `button.primary` text #0b0d16 stays dark on the light accent |

## loading.html body (after)

```html
<div class="drag"></div>
<main class="boot">
  <img class="boot__mark" src="brand-mark.png" alt="" />
  <h1 class="boot__word">ima2</h1>
  <p class="boot__tag" id="tag">Starting your local studio</p>
  <ol class="boot__steps">
    <li id="row-server" data-state="active"><span class="ic" aria-hidden="true"></span><span class="t">Local server</span><span class="d" id="server-detail"></span></li>
    <li id="row-open" data-state="wait"><span class="ic" aria-hidden="true"></span><span class="t">Open workspace</span><span class="d" id="open-detail"></span></li>
  </ol>
  <div id="error" class="error-box" hidden></div>
  <div class="actions" id="actions" hidden>(restart / logs / settings buttons, ids unchanged)</div>
</main>
<footer class="boot__foot" id="foot"></footer>
```

## loading.js state table

| state | row-server | row-open | tag |
|---|---|---|---|
| starting | active, "port N · Ns" | wait | Starting your local studio |
| running | done, url (external: "Using the server already running at url") | active, "Opening…" | Ready |
| stopped | error, "Stopped" | wait | Server stopped |
| error | error, first line of lastError | wait | Server failed to start |

Error box + actions only for stopped/error (same as today). Elapsed timer runs only while starting and is cleared on any other state.

## Accept criteria (render grounding)

- A harness page in `.concepts/` (not shipped) stubs `window.ima2Desktop` and loads the real loading.html/js/css; headless Chromium screenshots for starting, running and error are read back.
- CSP unchanged (`script-src 'self'`, `style-src 'self'`); no inline style or script added.


## A round 1 amendments (002)

- loading.html links `loading.css` after `desktop.css`; no `.drag` strip and no inline style (the view already starts below the 38px titlebar view, desktop/lib/titlebar.mjs:8).
- `#tag` gets `role="status" aria-live="polite"`; spinner and pulse animations sit behind `@media (prefers-reduced-motion: no-preference)`.
- desktop.css tokens: `--accent: #e8e8ea`, `--accent-ink: #111214`, `--switch-off: #3a3c45`; `.switch input:checked + span { background: var(--accent) }` and `.switch input:checked + span::after { background: var(--accent-ink) }`; `button.primary { color: var(--accent-ink) }`; focus outline uses `--accent`. `.dot`, `.status`, `.center`, `.error-box` stay for settings.html; `.logo` removed only if no page uses it.
- desktop/pages/titlebar.html: name "ima2", image = `brand-mark.png` (flat chrome mark) instead of `../build/icon.png`.
- desktop/pages/settings.js:51: `ima2 ${info.appVersion}`.
- desktop/lib/windows.mjs: `content.webContents.on("did-fail-load", (_e, code, _d, url, isMainFrame) => { if (isMainFrame && code !== -3) void content.webContents.loadFile(LOADING_PAGE); })` — activation: harness cannot run Electron here; verified by code read + existing desktop tests; recorded as not render-verified.
- desktop/lib/menu.mjs:39 and tray.mjs:60: "Check for Updates…" item gets `visible: Boolean(actions.updaterActive)`; label literal unchanged for tests/desktop-updater.test.ts:180.
Verifier additions: `node --import tsx --test tests/desktop-*.test.ts` exit 0.

## wp2 P re-verification (HEAD fa851b0c)

- `.drag` stays in desktop.css: settings.html:10 uses it (settings window has no titlebar view). Only loading.html stops using it.
- desktop.css `main { padding: 0 28px 28px }` applies to settings; loading uses `<main class="boot">` and loading.css resets padding.
- titlebar lives at desktop/pages/titlebar.html (not lib/): img → `brand-mark.png` (238x256, rendered height 16px, width auto, no radius), title text "ima2". Its CSP already allows `img-src 'self' file:`.
- tests/desktop-updater.test.ts:180 pins only `Check for Updates…[\s\S]*actions.checkForUpdates()`; adding `visible` keeps the match.
- Status colours: `--ok`/`--danger` and the starting amber stay (functional status, not brand); the loading page itself uses monochrome row icons and keeps red only for the error row.
- Verification: harness `.concepts/qa/loading-harness.html` (git-excluded) iframes nothing; it loads the real pages/loading.html via file:// with a preload-like stub script injected by Playwright (`page.addInitScript` defining window.ima2Desktop with getStatus/onStatus/getSettings/getInfo), rendering starting, running(external), error. Screenshots read back.
