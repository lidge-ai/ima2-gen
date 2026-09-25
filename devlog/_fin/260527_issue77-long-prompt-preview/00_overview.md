---
created: 2026-05-27
status: phase 1 verified / pending commit
tags: [ima2-gen, issue-77, preview, long-prompt, frontend, jawdev]
github_issue: https://github.com/lidge-ai/ima2-gen/issues/77
---

# Issue 77 Long Prompt Preview Layout

GitHub #77 reports that generation succeeds and downloaded files are intact,
but the web UI preview becomes clipped or nearly invisible as prompt text grows.
The report uses macOS Chrome, OAuth, model 5.5, 1536x2048 output, and a
reference image. The prompt can be extremely large, around 35,350 tokens.

This is a frontend layout bug, not an image-generation failure.

## Current Interpretation

Issue #75 already capped the Prompt Studio bottom composer so long input text
cannot consume the stage. #77 is a separate result-viewer path: after generation,
the selected image prompt is rendered as `.result-prompt` below the preview in
the same flex column as the image, metadata, and actions.

When that prompt is very long, the prompt metadata can consume the viewer column
height and push or squeeze the image preview. The result image itself remains
downloadable and uncorrupted.

## Phase Plan

| Phase | Scope | Commit gate |
|---:|---|---|
| 1 | Clamp/fold result prompt metadata and reserve preview height so long prompts cannot hide the image. | Contract test, type/build checks, Computer Use smoke, employee verification, GitHub report, commit/push. |

## Non-Goals

- Do not change provider payloads, generation semantics, reference-image
  handling, or output image files.
- Do not remove prompt copy behavior. The visible prompt summary can be folded,
  but the full prompt must still be copyable.
- Do not redesign the full Classic or Prompt Studio workspace.

## Verification Policy

The phase must run fresh local checks and a rendered browser smoke. Minimum gate:

```bash
node --test tests/issue77-long-prompt-preview-contract.test.js
npm run typecheck
npm run typecheck:tests
cd ui && npx tsc -b --noEmit
cd ui && npm run build
```

Because the report is visual, the phase also requires Computer Use verification
in Chrome with a very long prompt-like result displayed in the local app.

## Phase 1 Verification Snapshot

Implemented with a shared `ResultPromptSummary` component plus scoped
`styles/result-preview.css`, keeping the prompt copy affordance while making
the prompt a bounded scrollable summary. The image sizing override is scoped to
`.result-preview-frame .result-img` so Canvas Mode annotation images keep their
existing sizing rules.

Passed local checks:

```bash
node --test tests/canvas-annotation-contract.test.js tests/issue77-long-prompt-preview-contract.test.js tests/prompt-studio-ui-contract.test.js
npm run ui:build
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm test
```

Computer Use and Chrome 9222 visual smoke used a 35,350-token-like prompt
fixture at `http://127.0.0.1:5173/`. Result preview remained visible and the
prompt summary scrolled:

| Viewport | Image | Frame | Prompt |
|---|---:|---:|---:|
| Desktop 1440x900 | 495x661 | 1026x661 | 720x108, `overflow-y: auto` |
| Mobile 390x844 | 350x467 | 350x467 | 350x101, `overflow-y: auto` |
| Narrow 320x740 | 280x373 | 280x400 | 280x89, `overflow-y: auto` |

After reviewer feedback, the result image override was narrowed and rechecked:

- Classic scoped smoke: image 431x574, frame 1026x574, prompt 720x96 with
  `overflow-y: auto`; no global `.result-img` override remained in
  `result-preview.css`.
- Canvas Mode smoke after opening Canvas: frame class stayed
  `canvas-annotation-frame`, not `result-preview-frame`; image 407x542 with no
  result-preview ancestor.
