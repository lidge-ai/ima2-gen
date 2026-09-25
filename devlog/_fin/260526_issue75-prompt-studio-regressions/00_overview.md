---
created: 2026-05-26
status: active / phase implementation
tags: [ima2-gen, issue-75, prompt-studio, multimode, gallery, jawdev]
github_issue: https://github.com/lidge-ai/ima2-gen/issues/75
---

# Issue 75 Prompt Studio Regressions

GitHub #75 bundles several user-visible Prompt Studio regressions from
v1.1.13. The common problem is not one backend failure; it is state coupling in
Classic Prompt Studio: selecting history changes the composer, keyboard
navigation walks a different list than the visible recent rail, long composer
content steals viewer space, and gallery mutations pull the viewport back to
the focused image.

## User Reports

1. Concurrent multimode generations can finish out of order and make arrow
   navigation feel scrambled.
2. Prompt Studio recent history renders a bounded left list, but arrow keys can
   keep moving beyond that visible list. The gallery entry scrolls away.
3. Long prompts in the bottom composer reduce the default image viewer until
   the image appears clipped.
4. Multimode and 1:1 Direct both change composer state, but when both are on
   Direct is visually hard to see and badges can clip.
5. Gallery favorite toggles and tab changes jump to the focused image instead
   of preserving the current gallery viewport.
6. The top-left model quick menu cannot adjust reasoning effort.
7. README/FAQ do not explain some workspace features or multimode prompting
   clearly enough.
8. Selecting an existing image, and sometimes generation flow, can silently
   refill the prompt composer with the image prompt.

## Phase Plan

| Phase | Scope | Commit gate |
|---:|---|---|
| 1 | Prompt Studio selection/navigation stability: visible recent domain, fixed gallery entry, gallery viewport preservation, no automatic composer restore in Prompt Studio. | Contract tests, typecheck/build, Computer Use smoke, employee verification, GPT Pro verification. |
| 2 | Viewer/composer layout: preserve image fit with long prompts and make pan/zoom affordance obvious without requiring zoom first. | UI build, visual smoke at desktop/mobile/narrow, employee verification, GPT Pro verification. |
| 3 | Mode and quick-settings polish: simultaneous multimode/direct state, reasoning effort in model quick menu. | UI contract tests, typecheck/build, Computer Use smoke, employee verification, GPT Pro verification. |
| 4 | Manual and public support docs: feature map, multimode prompt recipes, issue #75 closeout notes. | Docs contracts, `npm run test:inventory`, employee verification, GPT Pro verification. |

## Non-Goals

- Do not redesign Prompt Studio as a new workspace.
- Do not change image generation semantics or provider payloads in this lane.
- Do not make hidden model/provider fallbacks.
- Do not remove explicit actions that intentionally import a prompt, such as
  prompt-library insert or "continue from this image" controls.

## Verification Policy

Each phase must run fresh local checks and must not rely only on code review.
The expected phase gate is:

```bash
npm run typecheck
npm run typecheck:tests
npm test
cd ui && npx tsc -b --noEmit
cd ui && npm run build
```

Prompt Studio UI phases also require Chrome/Computer Use smoke against the
running Vite/bin server on port 3333, plus one jaw employee verification and
one `agbrowse web-ai` GPT Pro focused review before commit and push.
