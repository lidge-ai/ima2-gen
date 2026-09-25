---
created: 2026-05-15
tags: [ima2-gen, fork-research, prompt-builder, composer, gallery, ux]
status: research / modularization plan
sources:
  - https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1182644&search_head=120&page=1
  - https://github.com/damagethundercat/ima2-gen
---

# Fork Prompting Modularization Research

This devlog records how to absorb useful ideas from `damagethundercat/ima2-gen` without directly merging the fork. The fork is a modified distribution (`@damagethundercat/ima2-gen`, command `ima2x`) and has product-level changes that overlap with recent upstream work, so the correct path is selective modular reimplementation.

## Source Summary

Primary public post:

- DCInside post: `[ima2-gen] 마개조 버전 - 프롬프팅 강화`
- The post describes `ima2-genX` as a heavily modified fork focused on prompt workflow and local desktop-studio ergonomics.
- Reported changes include a prompt-centered composer, a prompt-builder conversation panel, per-image builder sessions, Korean/English final prompt output with direct apply actions, waiting animation, prompt-library insertion ordering, improved zoom/pan, faster history deletion, and grouped multimode history thumbnails.
- The post links the fork repo and npm package, and states MIT license. Treat that as public attribution context, not as permission to remove attribution.

Fork repository:

- Repo: `https://github.com/damagethundercat/ima2-gen`
- GitHub metadata checked via `gh repo view`: fork of `lidge-ai/ima2-gen`, default branch `main`, updated `2026-05-15T01:08:21Z`.
- GitHub compare checked via `gh api repos/lidge-ai/ima2-gen/compare/main...damagethundercat:main`: fork is `ahead_by: 17`, `behind_by: 6`, status `diverged`.
- Local inspection clone: `/tmp/ima2-gen-damagethundercat`.

## High-Level Decision

Do not merge the fork branch as-is.

Reasons:

- The fork diverges from current `main` and is already behind six upstream commits.
- It renames package/bin surfaces to `@damagethundercat/ima2-gen` and `ima2x`, which is not desired upstream.
- Several fork diffs conflict with our recent fixes. For example, its `ResultActions.tsx` drops the upstream visible `Generate as first node` button and deletion focus callback, while our `#59/#63/#68` work expects those paths to remain.
- Its implementation grows already-large files: `lib/promptBuilderClient.ts` is 534 lines, `ui/src/store/useAppStore.ts` is 4690 lines, and `ui/src/index.css` is 7977 lines in the fork. We should import the ideas, not the file shape.

Recommended direction:

1. Build a modular prompt-builder backend and UI as a new feature boundary.
2. Introduce prompt composer ordering as a small contract around existing prompt-library insertion.
3. Treat the fork as a configurable `Prompt Studio` workspace profile rather than a replacement UI.
4. Add a desktop classic workspace/bottom composer only after backend builder state is stable.
5. Add sidebar history/grouped multimode history as a pure grouping module plus component.
6. Port viewer zoom/pan as a `useViewerTransform` hook and controls component, not inline inside `Canvas.tsx`.
7. Keep package naming, command names, CLI skill, readiness popup, first-node action, and gallery identity helpers from current upstream.

## Settings And CLI Clarification

The fork should map to browser workspace settings, not to generation defaults. A `Prompt Studio` workspace profile may change composer placement, right-panel content, history presentation, builder surface, and viewer tools. It must not silently change CLI generation behavior.

CLI-safe policy:

- Keep `ima2 gen`, `ima2 edit`, `ima2 multimode`, and `ima2 node generate` stable.
- Add prompt-builder behavior under the existing prompt namespace, preferably `ima2 prompt build`.
- Teach agents through `ima2 capabilities --json` and `ima2 skill` that workspace profile settings are UI-only.
- Do not overload `ima2 defaults` with UI layout settings; use explicit config keys if workspace profile is persisted.

## Proposed Active Lane

This should become a new implementation lane, separate from the recent `#64-#70` hardening pass and the ongoing `#59` first-node action lane.

Suggested GitHub issue title:

```text
Prompt UX: modular prompt builder, composer block ordering, and sidebar history workspace
```

Suggested devlog folder:

```text
devlog/_plan/260515_fork-prompting-modularization-research/
```

This folder is research plus diff-level planning. It is intentionally not a commit plan yet.

## Scope Boundaries

In scope:

- Prompt Builder backend endpoint and model transport.
- Prompt Builder UI and state.
- Structured Korean/English prompt parsing and apply/insert actions.
- Prompt composer block order controls.
- Composer metadata persistence into history sidecars.
- Sidebar history with multimode grouping and quick delete.
- Main viewer zoom/pan/empty-state polish.

Out of scope:

- Package rename to `ima2x`.
- Fork README/site rewrite.
- Fork publish workflow.
- Wholesale CSS transplant.
- Direct merge of `useAppStore.ts`.
- Replacement of current `ResultActions` behavior.
- Canvas SVG/PPTX/masked-edit implementation from `#27/#28/#31`; those remain separate lanes.

## Adoption Order

Recommended implementation order:

1. Prompt Builder backend contract.
2. Prompt Builder frontend store and UI.
3. Prompt Builder CLI contract through `ima2 prompt build`.
4. Workspace profile settings contract.
5. Composer block ordering and metadata restore.
6. Classic workspace/right-panel layout integration.
7. Sidebar history/grouped multimode cards.
8. Viewer zoom/pan and empty-state animation.
9. Visual polish and mobile reconciliation.

This order makes the product value available early while reducing risk. The prompt builder is the core idea from the post; layout and visual polish can follow after the API/state contract is tested.
