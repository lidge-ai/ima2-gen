# App Weight Reduction / Code Splitting

**Date**: 2026-04-29
**Status**: implemented / closeout pending archive
**GitHub**: https://github.com/lidge-ai/ima2-gen/issues/36
**Scope**: Reduce perceived app weight after `v1.1.7` without removing shipped features.

## Problem

After `v1.1.7`, the app feels noticeably heavier. Local inspection points to
bundle and packaging growth rather than a new runtime dependency.

Observed facts:

- Current local package version is `1.1.8`.
- Current Vite output emits a single main UI chunk around `685 KB` plus CSS
  around `142 KB`.
- Vite reports the main chunk is larger than `500 KB`.
- `ui/vite.config.ts` has production `sourcemap: true`, producing a roughly
  `2.6 MB` `.js.map` in `ui/dist`.
- `npm pack --dry-run --json` currently reports about `7.25 MB` packed and
  `10.57 MB` unpacked, with screenshots/assets and `ui/dist/*.map` included.
- `v1.1.6..v1.1.7` added about `4.3k` UI LOC, mainly Canvas Mode, prompt import,
  web-search/reasoning controls, gallery layout controls, and store expansion.
- `v1.1.7..v1.1.8` added about `2.4k` more UI LOC, including mobile shell,
  prompt discovery, multimode sequence UI, canvas pan, and alpha controls.

## Diagnosis

The primary issue is not dependency bloat. The primary issue is that feature
surfaces are growing while the frontend still ships as one large app bundle.

Heavy surfaces currently likely load in the initial bundle:

- Canvas Mode and canvas render helpers.
- Prompt Import dialog.
- Prompt Discovery.
- Card News workspace.
- Node Canvas / React Flow surface.
- Settings Workspace.

## Oracle Audit Verdict

Oracle browser `gpt-5-pro` audit result: **NEEDS_FIX** before implementation.

Direction confirmed:

- package diet is a safe first slice;
- code splitting is the real answer for default app weight;
- Canvas runtime work should be handled separately.

Required corrections:

- Phase A reduces package/install weight, not initial browser parse/execute cost.
- Do not lazy-load `Canvas.tsx` wholesale because it is the default classic
  surface; split Canvas Mode internals later.
- Start runtime code splitting with mode-gated surfaces like `NodeCanvas`,
  `CardNewsWorkspace`, and `PromptLibraryPanel`.
- Package asset tightening requires a runtime asset inventory before removing
  broad `assets/`.
- Canvas preview may be downscaled only if final apply/export always recomputes
  from natural source dimensions.
- Verification commands must be root-safe and should not depend on a lingering
  `cd ui`.

See `ORACLE-AUDIT.md`.

## Post-TS Re-Audit Verdict

Oracle browser `gpt-5-pro` re-audit result after TypeScript migration merge:
**NEEDS_FIX**.

The Node/React Flow implementation boundary appears sound because `NodeCanvas`
owns the `@xyflow/react` import and is loaded through a dynamic import from
`App.tsx`. The audit still required stronger bundle tests to prove node-mode
chunks stay out of the default static entry graph, and it flagged top-level
Canvas Mode helper imports in `Canvas.tsx` as remaining default-path weight.

Applied follow-up:

- package lifecycle now builds UI before pack/publish;
- `npm start` uses emitted JS runtime rather than `tsx`;
- app-weight contract fails without a Vite manifest and checks static entry
  imports against lazy chunks;
- package smoke requires representative emitted JS runtime files.

Closeout result:

- release sourcemaps are opt-in;
- package allowlist is tightened;
- Node/Card News/Settings/Prompt Library/Prompt Import surfaces are
  lazy-loaded;
- Canvas Mode internals are behind the lazy `./canvas-mode` feature boundary;
- Phase C runtime safeguards are covered by background cleanup and app-weight
  contracts.

## Desired Outcome

Keep the current product surface, but make the default app path lighter:

1. basic generation screen opens faster;
2. initial parse/execute cost is lower;
3. release package is smaller;
4. Canvas-specific CPU work runs only when needed and is debounced/cached.

## Plan Split

| Phase | File | Goal |
|---|---|---|
| A.1 | `PHASE-A-release-package-diet.md` | Smallest safe first PR: make sourcemaps opt-in and add package contract for no normal `.map` release files. |
| A.2 | `PHASE-A-release-package-diet.md` | Asset allowlist tightening only after runtime asset inventory. |
| B.0 | `PHASE-B-frontend-code-splitting.md` | Establish bundle measurement/manifest/report-only guard. |
| B.1 | `PHASE-B-frontend-code-splitting.md` | Lazy-load lower-risk mode-gated surfaces first: NodeCanvas, CardNewsWorkspace, PromptLibraryPanel. |
| B.2 | `PHASE-B-frontend-code-splitting.md` | Lazy-load Settings and Prompt Import/Dialog subflows. |
| B.3 | `PHASE-B3-canvas-mode-controller-split.md` | Split Canvas Mode internals behind a lazy controller, not the default Canvas surface wholesale. |
| C | `PHASE-C-canvas-runtime-performance.md` | Reduce Canvas Mode CPU spikes with debounce, caching, downscaled preview, and stale-render cancellation. |

Recommended implementation order:

```text
A.1 - complete
A.2 - complete
B.0 - complete
B.1 - complete
B.2 - complete
B.3 - complete
C - complete / verified
```

## Non-Goals

- Do not remove Canvas Mode, Node Mode, Prompt Library, Card News, or ComfyUI.
- Do not change provider/API behavior.
- Do not change saved file formats.
- Do not tune by hiding features behind undocumented flags.

## Closeout Verification

Closeout verification uses root-safe commands:

```bash
node --test tests/canvas-background-cleanup-contract.test.js
node --test tests/canvas-viewport-pan-contract.test.js
node --test tests/app-weight-splitting-contract.test.js
npm run typecheck
npm run ui:build
npm test
npm run prepublishOnly
```

Target metrics are relative, not absolute:

- main initial JS chunk should drop meaningfully from the current `~685 KB`;
- Phase A.1 should stop including `ui/dist/*.map` by default, but should not be
  presented as a runtime speed fix;
- package assets should include only runtime-required assets;
- default generation workflow should not load Node/Card News/Prompt Import code
  until the user opens those surfaces;
- Canvas Mode internals should be split only after lower-risk mode-level splits.

## Open Questions For Audit

1. Which components can be lazily split with the lowest integration risk?
2. Should Node Canvas be lazy-loaded at app mode level, or is React Flow already
   unavoidable in the main chunk due to imports elsewhere?
3. Which assets are actually required at runtime after install?
4. Should release sourcemaps be disabled by default or moved behind
   `VITE_SOURCEMAP=1`?
5. Can Canvas background cleanup preview safely use a downscaled mask preview
   while final apply still uses natural image dimensions?
