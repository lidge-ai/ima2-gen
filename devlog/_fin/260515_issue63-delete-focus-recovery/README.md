---
title: "Issue #63 — Restore Viewer Focus After Delete"
status: completed / moved to _fin
created: 2026-05-15
github: https://github.com/lidge-ai/ima2-gen/issues/63
tags: [gallery, viewer, keyboard, accessibility, ux]
---

# Issue #63 — Restore Viewer Focus After Delete

## Closeout Status — 2026-05-16

GitHub #63 is closed and this plan is now archived in `_fin`.

Evidence:

- `ResultActions` accepts `onAfterDeleteFocus` and invokes it after normal or
  permanent delete completion.
- Classic viewer and Canvas Mode pass focus restoration callbacks from their
  focusable result surfaces.
- `tests/gallery-viewer-navigation-contract.test.js` covers the regression.

## Goal

After the user deletes the currently viewed image by clicking the visible delete
button, keyboard navigation should continue immediately. The user should not
need to click empty viewer space before `ArrowLeft`, `ArrowRight`, `Home`, or
`End` work again.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/63

## User Report

The reporter frequently moves through images and deletes some of them. After
clicking the delete button, focus stays in the action area, so arrow-key
navigation is not immediately usable until they click a blank area again.

## Current Code Evidence

Keyboard movement is already supported globally in classic mode:

- `ui/src/hooks/useGalleryViewerNavigation.ts`

The focused viewer also supports scoped navigation and delete/backspace:

- `ui/src/components/Canvas.tsx`
- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`
- `ui/src/components/canvas-mode/useCanvasModeShortcuts.ts`

The store already chooses the next visible image after deletion:

- `ui/src/lib/galleryShortcuts.ts`
- `ui/src/store/useAppStore.ts`

The missing behavior is focus recovery after button-driven deletion:

- `ui/src/components/ResultActions.tsx`

`ResultActions` calls `trashHistoryItem(actionImage)` and
`permanentlyDeleteHistoryItemByClick(actionImage)`, but does not hand focus
back to the result viewer after the async action completes.

## Decision

Do not change the deletion model.

Keep these existing safety boundaries:

- normal delete remains explicit by button click or focused viewer
  `Delete`/`Backspace`;
- permanent delete remains explicit by More menu click or focused viewer
  `Shift+Delete`/`Shift+Backspace`;
- no global `Delete` shortcut is added;
- no store-level focus side effect is added.

Add a UI-level focus recovery callback instead. The viewer owns its focusable
container, so the viewer should provide the callback to `ResultActions`.

## Diff-Level Plan

### 1. `ui/src/components/ResultActions.tsx`

Add an optional prop:

```ts
onAfterDeleteFocus?: () => void;
```

Wrap delete actions in local async handlers:

```ts
const deleteToTrash = async () => {
  await trashHistoryItem(actionImage);
  onAfterDeleteFocus?.();
};

const deletePermanently = async () => {
  await permanentlyDeleteHistoryItemByClick(actionImage);
  onAfterDeleteFocus?.();
};
```

This keeps all deletion rules in the store and only handles focus recovery at
the UI boundary.

### 2. `ui/src/components/Canvas.tsx`

Add a ref for the classic result viewer container and pass a callback:

```ts
const resultContainerRef = useRef<HTMLDivElement>(null);
const restoreResultFocus = useCallback(() => {
  window.requestAnimationFrame(() => resultContainerRef.current?.focus());
}, []);
```

Then attach:

```tsx
<div ref={resultContainerRef} className="result-container visible" ...>
  <ResultActions onAfterDeleteFocus={restoreResultFocus} />
</div>
```

Use `requestAnimationFrame` so focus lands after React has applied the
replacement image selected by `trashHistoryItem(...)`.

### 3. `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`

Apply the same pattern for Canvas Mode because it also renders `ResultActions`
and has its own focusable viewer container.

### 4. Contract Test

Extend:

- `tests/gallery-viewer-navigation-contract.test.js`

Required assertions:

- `ResultActionsProps` contains `onAfterDeleteFocus`;
- normal delete awaits `trashHistoryItem` and calls `onAfterDeleteFocus?.()`;
- permanent delete awaits `permanentlyDeleteHistoryItemByClick` and calls
  `onAfterDeleteFocus?.()`;
- `Canvas.tsx` owns a viewer ref and passes `onAfterDeleteFocus`;
- `CanvasModeWorkspace.tsx` owns a viewer ref and passes `onAfterDeleteFocus`;
- existing contract that global navigation does not bind `Delete` remains.

## Verification

Targeted:

```bash
node --test tests/gallery-viewer-navigation-contract.test.js
cd ui && npx tsc -b --noEmit
npm run ui:build
git diff --check
```

Broader, if the patch stays small and targeted tests pass:

```bash
npm test
```

## Employee Verification Request

Ask a frontend/read-only reviewer to verify:

- focus recovery is UI-owned and not store-owned;
- keyboard deletion safety boundaries remain unchanged;
- Canvas and Canvas Mode are both covered;
- the contract test actually protects the reported issue.

## Out Of Scope

- Changing deletion confirmation semantics.
- Adding global `Delete` shortcut behavior.
- Changing history replacement selection.
- Changing gallery modal pagination or virtualized date grid.
