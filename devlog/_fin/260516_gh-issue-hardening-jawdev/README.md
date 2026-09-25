---
title: "GH Issue Hardening Closeout — Jawdev Matrix"
status: completed
created: 2026-05-16
project_root: /Users/jun/Developer/new/700_projects/ima2-gen
tags: [github, devlog, jawdev, hardening, closeout]
sources:
  - https://github.com/lidge-ai/ima2-gen/issues/27
  - https://github.com/lidge-ai/ima2-gen/issues/28
  - https://github.com/lidge-ai/ima2-gen/issues/31
  - https://github.com/lidge-ai/ima2-gen/issues/59
  - https://github.com/lidge-ai/ima2-gen/issues/64
  - https://github.com/lidge-ai/ima2-gen/issues/65
  - https://github.com/lidge-ai/ima2-gen/issues/66
  - https://github.com/lidge-ai/ima2-gen/issues/67
  - https://github.com/lidge-ai/ima2-gen/issues/68
  - https://github.com/lidge-ai/ima2-gen/issues/69
  - https://github.com/lidge-ai/ima2-gen/issues/70
---

# GH Issue Hardening Closeout — Jawdev Matrix

## Objective

Audit GitHub issues that are represented in `devlog`, harden any remaining
implementation notes so another agent can execute without guesswork, and move
completed plans out of `_plan`.

This closeout uses the 2026-05-16 GitHub issue snapshot plus current local code
and tests. The audit separated:

- completed implementation that should live in `_fin`;
- open Canvas feature work that should remain in `_plan`;
- research ledgers that are complete as research but not new implementation
scope.

## Prompt-To-Artifact Mapping

| Request fragment | Artifact / action |
|---|---|
| "gh에 올라온 다른 이슈들도" | GitHub issue snapshot reviewed with `gh issue list` and `gh issue view`. |
| "devlog에 써져있는거면" | `_plan` folders matched against GitHub issue numbers and moved when complete. |
| "더 상세하게 자료조사해서 하드닝" | Remaining open #27/#28/#31 plans now include implementation boundaries, references, risks, and tests. |
| "완료한거면 완료 처리" | Completed folders moved to `_fin`; completion evidence recorded here and in the relevant closeout folders. |
| "어떤 경우에도 구현가능하도록 jawdev식" | Each remaining open issue has concrete files, policy decisions, test gates, and out-of-scope lines. |

## Issue Matrix

| Issue | GitHub read | Devlog result | Implementation read |
|---|---|---|---|
| #27 Canvas SVG export | open | stays `_plan/260430_issue27-canvas-svg-export` | Not implemented. Plan is hardened and ready. |
| #28 Canvas PPTX export | open | stays `_plan/260430_issue28-canvas-pptx-export` | Not implemented. Plan is hardened and ready. |
| #31 Provider masked edit | open | stays `_plan/260430_issue31-provider-masked-edit` | Groundwork exists, true provider-backed mask still gated. |
| #59 Generate as first node | closed during closeout | moved `_fin/260514_issue59-generate-as-first-node` | Implemented and closed with evidence comment. |
| #64 CLI/Skill discovery | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #65 Provider readiness UI | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #66 CLI destructive safety | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #67 Package/release hardening | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #68 Gallery UX hardening | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #69 Multimode UX hardening | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #70 Prompt import CLI wrappers | closed during closeout | moved under `_fin/260515_issue64-70-hardening-pabcd` | Implemented and closed with evidence comment. |
| #47 Inflight reload reconcile | closed | moved `_fin/260429_issue47-inflight-reload-reconcile` | Completed on main. |
| #48 Prompt import search UX | closed | moved `_fin/260429_issue48-prompt-import-search-ux` | Completed on main. |
| #60 Multimode incremental progress | closed | moved `_fin/260508_issue60-multimode-incremental-progress` | Completed on main. |
| #62 CLI skill capabilities | closed | moved `_fin/260513_issue62-cli-skill-capabilities` | Completed on main. |
| #63 Delete focus recovery | closed | moved `_fin/260515_issue63-delete-focus-recovery` | Completed on main. |

## Completion Evidence

### #59 — Generate Current Image As First Node

Files:

- `ui/src/components/ResultActions.tsx`
- `ui/src/store/useAppStore.ts`
- `ui/src/i18n/en.json`
- `ui/src/i18n/ko.json`
- `tests/current-image-actions-readiness-contract.test.js`

Evidence:

- `ResultActions` renders a visible `result.firstNode` button near primary
  current-image actions.
- Store action `createRootNodeFromHistoryItem(item)` creates a ready root
  `imageNode`, switches `uiMode` to `node`, keeps prompt/model/size metadata,
  and schedules graph save.
- Existing Continue Here / reference flow remains separate.

### #64 — CLI/Skill Discovery

Files:

- `lib/capabilities.ts`
- `bin/ima2.ts`
- `bin/commands/capabilities.ts`
- `bin/commands/config.ts`
- `skills/ima2/SKILL.md`
- `docs/CLI.md`
- `tests/cli-capabilities-contract.test.js`
- `tests/cli-config-keys-contract.test.js`
- `tests/cli-skill-command-contract.test.js`

Evidence:

- Capabilities expose valid `modes`, `moderation`, `providers`,
  `configKeys.writable`, and `configKeys.envOverrides` by allowlist.
- Top-level help documents `--server`, `IMA2_SERVER`, discovery file,
  config/generated dirs, Card News, and log level.
- `ima2 config keys --json` gives agents writable keys and env overrides.
- Skill text includes inflight, multimode SSE, history import, and server
  recovery guidance.

### #65 — Provider Readiness UI

Files:

- `ui/src/components/ProviderReadinessPopup.tsx`
- `ui/src/components/GenerateButton.tsx`
- `ui/src/components/SettingsWorkspace.tsx`
- `ui/src/components/ProviderSelect.tsx`
- `ui/src/store/useAppStore.ts`
- `ui/src/index.css`
- `tests/current-image-actions-readiness-contract.test.js`

Evidence:

- Readiness is an on-demand modal, not a persistent marketing panel.
- Generate row and Settings both open the readiness popup.
- The popup reuses provider availability state and shows provider, model,
  reasoning, and web-search readiness without secrets.

### #66 — Destructive CLI Safety + Doctor/Status

Files:

- `bin/lib/destructive-confirm.ts`
- `bin/ima2.ts`
- `bin/commands/config.ts`
- `bin/lib/doctor-checks.ts`
- `tests/cli-destructive-safety-contract.test.js`
- `tests/cli-doctor-status-contract.test.js`

Evidence:

- `ima2 reset` and `ima2 config rm` use centralized destructive confirmation.
- Non-TTY destructive paths require `--yes`.
- Doctor/status output includes generated dir, advertised server, Card News,
  packaged skill health, and `better-sqlite3` native binding checks.

### #67 — Package / Release Hardening

Files:

- `LICENSE`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/publish-dry-run.mjs`
- `scripts/release.sh`
- `scripts/release-preview.sh`
- `tests/package-smoke.test.js`

Evidence:

- `LICENSE` is included in `files[]` and package lint required files.
- `npm run publish:dry-run` uses `npm publish --dry-run --ignore-scripts`.
- CI runs the publish dry-run gate.
- Release scripts refuse staged or dirty worktrees before release work.
- Package smoke asserts publish dry-run and required package files.

### #68 — Gallery UX Hardening

Files:

- `ui/src/components/GalleryModal.tsx`
- `ui/src/lib/galleryNavigation.ts`
- `ui/src/components/gallery/GalleryLoadControls.tsx`
- `ui/src/components/gallery/GalleryDateGrid.tsx`
- `tests/gallery-navigation-ux-contract.test.js`
- `tests/gallery-load-older-contract.test.js`
- `tests/history-strip-duplicate-contract.test.js`

Evidence:

- Gallery identity uses `filename || image`, shared with HistoryStrip.
- Gallery delete calls store delete logic, removes stale item refs, and restores
  focus to the modal scroll area.
- Date/favorites/session views have explicit load-older controls and virtualized
  date rows.

### #69 — Multimode UX Hardening

Files:

- `ui/src/components/MultimodeSequencePreview.tsx`
- `ui/src/store/useAppStore.ts`
- `ui/src/lib/api.ts`
- `ui/src/types.ts`
- `tests/multimode-ui-contract.test.js`

Evidence:

- Cancel affordance is tied to the active sequence/request, not only global
  active generation count.
- Partial images with explicit indexes map to exact slots; index-less partials
  are consumed one time through `loosePartials.shift()`.
- Status copy distinguishes generating, not returned, empty, canceled, partial,
  and error states.

### #70 — Prompt Import JSON / Preview CLI

Files:

- `bin/commands/prompt.ts`
- `docs/CLI.md`
- `skills/ima2/SKILL.md`
- `tests/cli-prompt-import-contract.test.js`

Evidence:

- `ima2 prompt import json <file|@file|-> [--folder <id>] [--dry-run]`
  posts JSON export payloads to `/api/prompts/import`.
- `ima2 prompt import preview <file|@file|-> [--filename <name>] [--json]`
  posts local source preview payloads to `/api/prompts/import/preview`.
- Existing curated/discovery/folder import paths remain intact.

## Remaining Open Implementation Notes

### #31 Provider-Backed Masked Edit

Start only after provider contract is verified.

Implementation gates:

- keep `IMA2_OAUTH_MASKED_EDIT_ENABLED` default off until smoke proves support;
- never silently degrade masked edit into full-image edit;
- keep source image and mask as matching PNG bytes;
- default clean edit path must avoid merged annotation raster leakage;
- optional future guided-edit path must be explicit and include guide-removal
  prompt policy.

Test gates:

- `tests/edit-mask-api-contract.test.js`
- `tests/oauth-masked-edit-contract.test.js`
- `tests/oauth-proxy-edit-mask-contract.test.js`
- `tests/canvas-edit-mask-flow-contract.test.js`

### #27 Canvas SVG Export

Recommended first implementation: direct SVG serializer.

Implementation gates:

- add `ui/src/lib/canvas/svgExport.ts`;
- embed source image as `<image>`;
- serialize pen/freehand/arrow/box/memo annotations;
- map normalized coordinates into natural image pixel units;
- escape text and avoid local filesystem paths;
- do not mutate canvas state or require saved versions.

Test gate:

- add `tests/canvas-svg-export-contract.test.js`.

### #28 Canvas PPTX Export

Recommended first implementation: browser-side `pptxgenjs`.

Implementation gates:

- add `pptxgenjs`;
- add `ui/src/lib/canvas/pptxExport.ts`;
- create one 16:9 slide;
- preserve source image aspect ratio;
- reuse #27 SVG overlay where possible;
- use native shapes/text as a phase-2 refinement.

Test gate:

- add `tests/canvas-pptx-export-contract.test.js`.
- manually open exported deck in PowerPoint, Keynote, or LibreOffice/Google
  Slides fallback.

## Verification Commands

Focused closeout checks:

```bash
node --test tests/current-image-actions-readiness-contract.test.js
node --test tests/cli-config-keys-contract.test.js
node --test tests/cli-prompt-import-contract.test.js
node --test tests/cli-destructive-safety-contract.test.js
node --test tests/cli-doctor-status-contract.test.js
node --test tests/gallery-navigation-ux-contract.test.js
node --test tests/gallery-load-older-contract.test.js
node --test tests/multimode-ui-contract.test.js
node --test tests/package-smoke.test.js
```

Full gate:

```bash
npm run typecheck
npm run typecheck:tests
cd ui && npx tsc -b --noEmit
npm run build:server
npm run ui:build
npm test
```
