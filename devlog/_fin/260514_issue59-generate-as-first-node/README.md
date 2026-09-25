---
title: "Issue #59 — Generate As First Node"
status: completed / moved to _fin
created: 2026-05-14
github: https://github.com/lidge-ai/ima2-gen/issues/59
tags: [canvas, node-mode, viewer, ux]
---

# Issue #59 — Generate As First Node

## Closeout Status — 2026-05-16

Implemented locally and moved to `_fin`.

Evidence:

- `ui/src/components/ResultActions.tsx` exposes a visible `result.firstNode`
  action near primary current-image controls.
- `ui/src/store/useAppStore.ts` includes `createRootNodeFromHistoryItem(item)`,
  switches to `uiMode: "node"`, creates a ready root `imageNode`, and schedules
  graph save.
- `tests/current-image-actions-readiness-contract.test.js` covers the action,
  store contract, and i18n labels.

## Goal

Add a More-menu action in both the default viewer and Canvas Mode that sends the
current image/composition into Node Mode as the first/root node.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/59

## Library Assessment

No external library is needed.

This is a state/action integration issue:

- current viewer image is already represented as a `GenerateItem`;
- Canvas Mode can pass `imageOverride={canvasDisplayImage}` into
  `ResultActions`;
- Node Mode already has root-node creation state.

Relevant files:

- `ui/src/components/ResultActions.tsx`
- `ui/src/components/Canvas.tsx`
- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`
- `ui/src/store/useAppStore.ts`
- `ui/src/components/NodeCanvas.tsx`
- `ui/src/components/ImageNode.tsx`

## UX Decision Point

Canvas dirty state must be defined before implementation.

Options:

### Option A — Use latest saved canvas version

Behavior:

- If Canvas Mode is showing a saved canvas version, use that.
- If current canvas has dirty edits, prompt user to save/apply first.

Pros:

- Avoids hidden data loss.
- Avoids silently exporting unsaved composition.

Cons:

- Extra user step.

### Option B — Auto-save current composition before node creation

Behavior:

- Click action saves a canvas version, then creates root node from it.

Pros:

- Smoothest UX.

Cons:

- Has side effects from a menu action.
- More failure states.

### Option C — Use current visible raster snapshot without saving

Behavior:

- Render current composition to a temporary data URL and use it as root node.

Pros:

- Fast and intuitive.

Cons:

- Persistence and history identity become unclear.
- Node graph may contain a non-file-backed image.

Recommendation:

- Start with Option A.
- Add clear disabled/helper state when dirty unsaved Canvas composition is active.

## Preferred Diff Plan

### Store action

Candidate:

- `createRootNodeFromHistoryItem(item: GenerateItem): ClientNodeId`

Responsibilities:

- switch `uiMode` to `node`;
- create root node from the current image/composition;
- select/focus the new root node;
- preserve filename/image/url metadata;
- avoid leaking classic hidden references into the graph.

### UI wiring

Files:

- `ui/src/components/ResultActions.tsx`
- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`

Add menu item:

- label: `Generate as first node`
- visible in default viewer and Canvas Mode;
- disabled when no usable image;
- Canvas dirty-state helper if needed.

### Tests

Candidate:

- `tests/generate-as-first-node-contract.test.js`

Contracts:

- ResultActions contains the menu action.
- Canvas Mode passes current `canvasDisplayImage`.
- store action creates a root node rather than child/reference.
- existing Continue Here behavior remains unchanged.
- dirty Canvas state policy is represented in code/copy.

## Out Of Scope

- Canvas library migration.
- SVG/PPTX export.
- Provider masked edit.
- Background removal changes.
