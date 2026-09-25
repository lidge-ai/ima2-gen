# 0.09.45 — Mobile generation settings drawer (PLAN)

**Date:** 2026-04-28
**Status:** Plan — owner approved; entering /pabcd A next
**Closes:** [Issue #33](https://github.com/lidge-ai/ima2-gen/issues/33) (primary)
**Investigation:** [INVESTIGATION.md](./INVESTIGATION.md)
**Oracle session:** `mobile-ui-overhaul-scope` (gpt-5-pro, 2026-04-28 17:44 KST, 8m34s)

## STATUS 2026-04-30 — Partial

- Shipped: `549ad8f feat(mobile): add mobile UI shell with app bar, compose sheet, and settings toggle` provides the baseline mobile shell/settings entry.
- Remains: #33 is still OPEN, and real-phone settings IA follow-up is split to `260429_issue37-mobile-settings-workspace/`; keep this folder in `_plan`.

## Delivery model (owner decision 2026-04-28 18:01)
4 plans / 1 PR. Each version (0.09.45 / .46 / .47 / .48) gets its own folder + PLAN.md for devlog hygiene, but all four ship in a single branch / single PR. Commits stay version-prefixed for revert granularity.

- 0.09.45 (this) = primary, closes #33.
- [0.09.46 Mobile classic layout](./PHASE-46-classic-layout.md) — sidebar/history/composer
- [0.09.47 Mobile overlays](./PHASE-47-overlays.md) — modals + settings nav
- [0.09.48 Mobile node + card-news](./PHASE-48-node-cardnews.md) — node + card-news mobile

## Resolved owner questions
1. **Phase split** — ✅ 4-way file split, one PR.
2. **No new dependencies** — ✅ Inline SVG only.
3. **iPad 768 portrait** — ✅ Keep as "mobile" bucket; verified, not changed.
4. **HT-2 (Safari fixed-in-transformed)** — ✅ Pre-emptively lift mobile toggle out of `<aside>` to `App.tsx`-level render. No conditional verification gate.
5. **Commit 3 separation** — kept as its own commit for clean revert.

---

## Part 1 — Plain explanation (non-developer)

모바일에서 이미지 크기·해상도(quality)·moderation 같은 생성 설정이 드로어 안에 숨어 있는데, 그 드로어가 (1) 열기 버튼이 안 보이고 (2) 안쪽 버튼들이 너무 작아서 못 누르며 (3) iPhone 노치/홈 인디케이터에 가려진 채로 그려집니다. 추가로 iOS 키보드가 올라오면 입력창이 가려지고, 백드롭(반투명 검은 영역)을 눌러도 닫히지 않는 버그까지 있어요.

이 PR은 그걸 한 방에 고칩니다 — *오직 RightPanel(생성 설정 드로어)만*. 사이드바·갤러리·모달·노드 모드·카드뉴스 모드는 손대지 않아요. 그것들은 후속 0.09.46/47에서 따로 다룹니다.

성공 조건: iPhone SE/14에서 우상단 톱니바퀴 아이콘 → 한 번 탭 → 드로어 → Size·Quality·Moderation 다 편하게 누르고 닫을 수 있다. 데스크톱은 1픽셀도 안 바뀐다.

---

## Part 2 — Diff-level spec

### Goal
Close #33: Size, Quality, Moderation, Format, Count, Custom-size editor, drawer-close — all reachable + usable on phone viewports. Desktop RightPanel behavior unchanged.

### Non-goals (DO NOT TOUCH in this PR)
- Sidebar collapse to app bar (deferred → 0.09.46)
- HistoryStrip safe-area + horizontal behavior (deferred → 0.09.46)
- Composer/keyboard fallback beyond `interactive-widget` hint (deferred → 0.09.46)
- Modals: Gallery, CustomSizeConfirm, MetadataRestore, PromptDetail (deferred → 0.09.47)
- SettingsWorkspace nav mobile (deferred → 0.09.47)
- Hover-only Gallery actions (deferred → 0.09.47)
- Card-news / node-mode mobile audit (separate ticket / 0.09.48)
- Backend / API / store changes — UI-only PR
- New runtime dependencies (lucide-react, vaul, react-spring-bottom-sheet → all rejected)
- Mobile breakpoint shift (keep `max-width: 800px`; iPad portrait remains "mobile" on purpose, just verified)

### Acceptance criteria
- [ ] On 375×667 (iPhone SE) and 393×852 (iPhone 14): floating settings toggle is obvious — round 44px button, settings icon, top-right with safe-area inset.
- [ ] Tapping toggle opens the drawer (existing behavior, but with proper backdrop).
- [ ] Tapping the backdrop **closes** the drawer (currently broken; see HT-1).
- [ ] Inside drawer: Quality, Size, Format, Moderation, Count buttons all ≥44px tall, font ≥12px, no horizontal overflow.
- [ ] SizePicker quick-grid + slot-grid + ratio-row + custom W×H inputs all reflow without overflow at 360px viewport width.
- [ ] Custom-size numeric inputs render at 16px font (no iOS zoom-on-focus).
- [ ] Toggle + drawer respect `env(safe-area-inset-*)` on notched iPhones.
- [ ] `viewport-fit=cover` and `interactive-widget=resizes-content` set in `<meta viewport>`.
- [ ] Desktop ≥801px: RightPanel + toggle visually unchanged (chevron `<`/`>`, 20px collapsed width, no icon swap, no safe-area padding).
- [ ] iPad portrait 768×1024: behaves as mobile (drawer); 801×1024: behaves as desktop. Both verified.
- [ ] `prefers-reduced-motion: reduce`: drawer transition disabled.
- [ ] `tsc --noEmit` clean.
- [ ] `npm run ui:build` succeeds.
- [ ] No new console warnings/errors at runtime.

---

### File touch list (closed set)

```text
ui/index.html                                 # viewport meta
ui/src/index.css                              # mobile @media block expansion + toggle decouple
ui/src/App.tsx                                # render lifted mobile toggle here (HT-2)
ui/src/components/RightPanel.tsx              # remove inline mobile toggle, keep desktop chevron
ui/src/components/MobileSettingsToggle.tsx    # NEW — extracted toggle component (mobile-only render)
ui/src/components/SizePicker.tsx              # custom-size row class + separator span
ui/src/i18n/ko.json                           # add panel.openSettings only (closeSettings already exists)
ui/src/i18n/en.json                           # add panel.openSettings only (closeSettings already exists)
```

**Seven files touched, one new file.** No new runtime dependencies. Inline SVG only. The new file is the extracted `MobileSettingsToggle` component (decision HT-2: rendered from `App.tsx`, not inside the transformed `<aside>`).

---

### Hidden traps (HT) — must be addressed or explicitly punted

| ID    | Trap                                                                                                                   | This PR? | Action |
|-------|------------------------------------------------------------------------------------------------------------------------|----------|--------|
| HT-1  | `.right-panel-backdrop { pointer-events: none }` at `index.css:3149` makes outside-tap close **dead**                  | YES      | Flip to `pointer-events: auto` only when drawer open; add real `var(--scrim)` bg |
| HT-2  | Mobile toggle inside transformed `<aside>` — Safari fixed-descendant containing-context risk                           | YES      | **Pre-emptive lift**: render `<button class="right-panel-toggle">` from `App.tsx` (mobile only), not inside `RightPanel`'s `<aside>`. Decoupled from drawer transform. |
| HT-3  | Z-index stack: drawer 50 / mobile toggle 55 / Prompt Library 50 / compose sheet 55 / PromptDetail 60 / Gallery 110 / errors 220+ | YES      | Document order in CSS comment. Mobile toggle drops to **55** (not 60) so PromptDetailModal at 60 always wins. A-audit fix. |
| HT-4  | Safe-area without `viewport-fit=cover` is no-op                                                                        | YES      | Update `<meta viewport>` first |
| HT-5  | `interactive-widget=resizes-content` is an iOS hint, not a full keyboard fix                                           | PARTIAL  | Set the meta now; `visualViewport` JS fallback deferred → 0.09.46 |
| HT-6  | `@media (max-width: 800px)` catches iPad portrait (768px)                                                              | YES      | Don't change; just add 768/801 verification cases |
| HT-7  | `.custom-size-input { font-size: 12px }` (`index.css:2783`) triggers iOS focus zoom                                    | YES      | Mobile-only override to `16px` + `min-height: 44px` |
| HT-8  | SizePicker custom row uses inline `<span style>` for "x" separator (`SizePicker.tsx:222`)                              | YES      | Replace inline style with `.size-picker__dimension-separator` class |
| HT-9  | Hover-only Gallery favorite/delete opacity (`index.css:2642`, `5064`)                                                  | NO       | Real debt → punt to 0.09.47 |
| HT-10 | Global `touch-action` rules would break React Flow pan/zoom in node mode                                               | NO       | Don't add any `touch-action` rules; keep CSS scoped to `.right-panel` and `.size-picker` selectors |

---

### Pseudo-diff plan (per file)

#### 1. `ui/index.html` (line 5)

```diff
- <meta name="viewport" content="width=device-width, initial-scale=1.0" />
+ <meta
+   name="viewport"
+   content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
+ />
```

Rationale: enables `env(safe-area-inset-*)` and reflows on iOS keyboard.

---

#### 2. `ui/src/i18n/ko.json` + `en.json` (under `panel` key)

A-audit found `panel.closeSettings` already exists (`ko.json:187-193`, `en.json:187-193`). Only `panel.openSettings` is new.

```diff
  "panel": {
    "open": "열기",
    "close": "닫기",
+   "openSettings": "세부 설정 열기",
    "closeSettings": "세부 설정 닫기",
    ...
  }
```

en.json: add only `"openSettings": "Open settings"`. Existing `"closeSettings"` stays as-is (no copy change).

---

#### 3a. `ui/src/components/MobileSettingsToggle.tsx` (NEW — full file)

Extracted toggle so it renders **outside** the transformed drawer `<aside>` (HT-2). Mobile-only.

```tsx
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";

function SettingsSlidersIcon() {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="14" y2="6" />
      <circle cx="17" cy="6" r="2.2" />
      <line x1="4" y1="12" x2="8" y2="12" />
      <circle cx="11" cy="12" r="2.2" />
      <line x1="14" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="14" y2="18" />
      <circle cx="17" cy="18" r="2.2" />
    </svg>
  );
}

export function MobileSettingsToggle() {
  const open = useAppStore((s) => s.rightPanelOpen);
  const toggle = useAppStore((s) => s.toggleRightPanel);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const uiMode = useAppStore((s) => s.uiMode);
  const { t } = useI18n();
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 800px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Hide on desktop, in settings workspace, and in card-news mode.
  // (Z-index resolution for PromptDetailModal collision: the toggle uses z=55 in CSS,
  //  below PromptDetailModal's z=60. See A-audit finding.)
  if (!isMobile || settingsOpen || uiMode === "card-news") return null;

  const label = open ? t("panel.closeSettings") : t("panel.openSettings");

  return (
    <button
      type="button"
      className="mobile-settings-toggle"
      aria-expanded={open}
      aria-controls="right-panel-body"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <SettingsSlidersIcon />
    </button>
  );
}
```

#### 3b. `ui/src/App.tsx` (mount lifted toggle)

```diff
  import { TrashUndoToast } from "./components/TrashUndoToast";
  import { CardNewsWorkspace } from "./components/card-news/CardNewsWorkspace";
+ import { MobileSettingsToggle } from "./components/MobileSettingsToggle";
  ...
        <CustomSizeConfirmModal />
        <TrashUndoToast />
        <Toast />
        <ErrorCard />
        <GalleryModal />
        <MetadataRestoreDialog />
+       <MobileSettingsToggle />
        {uiMode === "card-news" ? <PromptLibraryPanel /> : null}
      </>
```

#### 3c. `ui/src/components/RightPanel.tsx` (drop mobile branch)

```diff
- <button
-   type="button"
-   className="right-panel-toggle"
-   aria-expanded={open}
-   aria-controls="right-panel-body"
-   onClick={toggle}
-   title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
- >
-   {isMobile ? (open ? t("panel.close") : t("panel.open")) : open ? ">" : "<"}
- </button>
+ {/* Desktop toggle only — mobile toggle is rendered from App.tsx via <MobileSettingsToggle /> (HT-2) */}
+ {!isMobile && (
+   <button
+     type="button"
+     className="right-panel-toggle"
+     aria-expanded={open}
+     aria-controls="right-panel-body"
+     onClick={toggle}
+     title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
+   >
+     {open ? ">" : "<"}
+   </button>
+ )}
```

`isMobile` state and matchMedia hook in RightPanel are kept (they still drive `drawerOpen`, backdrop, and the conditional mobile classes on `<aside>`).

Backdrop: no JS change. CSS HT-1 fix flips `pointer-events: auto`, then existing `onClick={toggle}` on `.right-panel-backdrop` fires correctly.

No store changes.

---

#### 4. `ui/src/components/SizePicker.tsx` (around line 222 — custom W/H row)

Identify the existing inline-style separator. Replace with semantic class:

```diff
- <div className="option-row" /* custom W×H row */>
-   <input ... className="custom-size-input" />
-   <span style={{ ... }}>x</span>
-   <input ... className="custom-size-input" />
- </div>
+ <div className="option-row size-picker__custom-row">
+   <input ... className="custom-size-input" />
+   <span className="size-picker__dimension-separator">×</span>
+   <input ... className="custom-size-input" />
+ </div>
```

(Also bump the separator glyph from ASCII `x` to `×` — typographically correct, no functional change.)

No state, no logic touched.

---

#### 5. `ui/src/index.css` — mobile block expansion

**Existing block to extend:** `@media (max-width: 800px) { ... }` starting at line 3010.

All new rules are *additions*, not replacements. Existing rules (sidebar 50dvh, history-strip flex-row, etc.) stay untouched in this PR.

```css
/* ── Insert just before the closing brace of @media (max-width: 800px) ── */

  /* HT-1: backdrop must accept pointer events when drawer is open */
  .right-panel-backdrop {
    pointer-events: auto;
    background: var(--scrim);
    backdrop-filter: blur(2px);
  }

  /* Drawer body: safe-area + breathing room */
  .right-panel {
    width: min(380px, calc(100vw - 16px));
    height: 100dvh;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    overscroll-behavior: contain;
  }
  .right-panel-body {
    padding: 16px 14px calc(16px + env(safe-area-inset-bottom));
    gap: 12px;
  }

  /* Floating toggle (HT-2: rendered from App.tsx, NOT inside drawer transform) */
  .mobile-settings-toggle {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top));
    right: calc(12px + env(safe-area-inset-right));
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 1px solid var(--border);
    box-shadow: 0 10px 28px var(--shadow-soft);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    backdrop-filter: blur(10px);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    /* z=55: above drawer (50), below true modals (PromptDetailModal=60, Gallery=110, …). A-audit fix. */
    z-index: 55;
  }
  .mobile-settings-toggle:hover,
  .mobile-settings-toggle:focus-visible {
    color: var(--accent-bright);
    border-color: var(--border-strong);
  }

  /* Tabs: 44px tap target */
  .right-panel-tabs__button {
    min-height: 44px;
    font-size: 12px;
  }

  /* Generic option buttons inside drawer: 44px tap */
  .right-panel .option-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 8px;
  }
  .right-panel .option-btn,
  .right-panel .size-picker__ratio,
  .right-panel .size-picker__replace,
  .right-panel .size-picker__save,
  .right-panel .count-picker__step {
    min-height: 44px;
    padding: 10px 8px;
    font-size: 12px;
    line-height: 1.2;
    white-space: normal;
  }

  /* SizePicker reflow */
  .right-panel .size-picker__ratio-row {
    grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
    gap: 8px;
  }
  .right-panel .size-picker__custom-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .right-panel .size-picker__dimension-separator {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 12px;
    text-align: center;
  }
  .right-panel .size-picker__preview {
    flex-wrap: wrap;
  }

  /* HT-7: prevent iOS zoom on focus */
  .right-panel .custom-size-input {
    min-height: 44px;
    font-size: 16px;
  }

  /* CountPicker stepper */
  .right-panel .count-picker__custom {
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 8px;
  }
```

`prefers-reduced-motion` already covered by existing `@media (prefers-reduced-motion: reduce) { .right-panel { transition: none; } }` at `index.css:1719`. No change.

---

### Implementation order (B-phase commits — 0.09.45 portion)

> Reminder: this is *one* of four version-prefixed commit groups in the bundled PR. 0.09.46/47/48 commits ship in the same PR; see their PLAN.md files for their commit lists.

1. **Commit 45.1** — `docs(plan): 0.09.45 mobile generation settings drawer` — this PLAN.md + INVESTIGATION.md.
2. **Commit 45.2** — `feat(ui): extract MobileSettingsToggle (HT-2 lift)` — NEW `MobileSettingsToggle.tsx` + `App.tsx` mount + `RightPanel.tsx` desktop-only branch.
3. **Commit 45.3** — `i18n(ui): add panel.openSettings key` — `ko.json` + `en.json` (existing `panel.closeSettings` left untouched per A-audit).
4. **Commit 45.4** — `fix(ui): semantic class for SizePicker custom row` — `SizePicker.tsx` only (no CSS yet, just `.size-picker__custom-row` + `.size-picker__dimension-separator` rename). Visually identical on desktop.
5. **Commit 45.5** — `fix(ui): mobile drawer 44px controls + safe-area + backdrop fix` — single `index.css` edit (the big block above; includes HT-1 backdrop and `.mobile-settings-toggle`).
6. **Commit 45.6** — `fix(ui): viewport-fit cover + interactive-widget hint` — `index.html` only.

Each commit independently revertable. Last commit before pushing the bundled PR also runs `npm run ui:build` + `tsc --noEmit` (logged but no code change).

---

### Verification matrix (mandatory before C-phase)

| # | Area | Viewport / device | Must verify |
|---|------|-------------------|-------------|
| V1 | Desktop regression | 1440×900 | RightPanel toggle = chevron, 20px collapsed; no safe-area padding; no icon |
| V2 | Small phone | 375×667 (iPhone SE) | Toggle 44px; drawer opens; Quality/Size/Moderation all ≥44px; no overflow |
| V3 | Modern iPhone | 393×852 (iPhone 14) | Toggle respects top/right safe-area; backdrop closes; CostEstimate visible |
| V4 | Android phone | 412×915 (Pixel 7) | Tap targets ≥44px; no clipped Korean labels; drawer width ≤380px |
| V5 | Landscape phone | 844×390 | Drawer scrolls internally; toggle outside notch; no impossible-to-close state |
| V6 | iPad portrait (mobile bucket) | 768×1024 | Mobile drawer renders correctly |
| V7 | iPad portrait (desktop bucket) | 801×1024 | Desktop layout, no mobile rules applied |
| V8 | iOS keyboard | Real iOS Safari + composer focus | Composer remains visible (best-effort with `interactive-widget`); document any residual issue |
| V9 | A11y | Lighthouse mobile + keyboard nav | Toggle has accessible name; `aria-expanded` toggles; focus visible; no contrast regression |
| V10 | Overlay stack | Drawer open + open Gallery / CustomSizeConfirm / ErrorCard | True modals appear above drawer + toggle |
| V11 | Locale | KO + EN | Long labels (`moderation.lowSub`, custom-size confirmation) wrap, no cropping |
| V12 | Theme | dark + light | Toggle icon contrast, drawer scrim contrast |
| V13 | Reduced motion | macOS `prefers-reduced-motion: reduce` | Drawer transition disabled |

V1, V2, V3, V6, V7 are blocking. V4-V5, V8-V13 are required-for-C-phase.

---

### Dependency stance (from Oracle)
- **lucide-react**: rejected for this PR. Single inline SVG suffices. Reconsider if a future visual-system PR replaces ≥6 icons.
- **vaul / react-spring-bottom-sheet**: rejected. Side drawer pattern stays — controls list is too dense for a bottom sheet, and it would fight the iOS keyboard.

---

### Rollback plan
All six commits are scoped and revertable individually. CSS changes are additions inside an existing `@media` block; reverting commit 4 alone restores the previous mobile behavior. Commit 5 (viewport meta) is the only one with implications outside the drawer — revert independently if any third-party iframe regresses.

---

## Status
All owner questions resolved (see "Resolved owner questions" at top).
Next step: `cli-jaw orchestrate A` — audit this plan + 0.09.46 + 0.09.47 + 0.09.48 as a bundle.
