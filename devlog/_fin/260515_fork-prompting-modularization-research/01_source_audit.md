---
created: 2026-05-15
tags: [source-audit, fork, dcinside, github]
status: research
---

# Source Audit

## DCInside Article Findings

Source:

- `https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1182644&search_head=120&page=1`

Observed article facts, paraphrased:

- The fork is presented as `ima2-genX`, a local desktop-style studio for ChatGPT/Codex image generation.
- The author says they personally relied heavily on prompt input and changed the app around that workflow.
- The fork adds a Prompt Builder conversation panel inside the app instead of switching between ChatGPT/GPTs and ima2-gen.
- The builder keeps per-image sessions, includes an internal prompt-guide style instruction, emits Korean and English final prompts, and lets the user apply final prompt output directly to the main prompt.
- The fork also adds a waiting animation, prompt library ordering, better zoom/pan, fast history deletion, and multimode grouping in thumbnails.
- The install surface in the post is `npm install -g @damagethundercat/ima2-gen` plus `ima2x serve`.

Implication for upstream:

- The biggest reusable product idea is not "new layout" by itself. It is a closed loop:
  1. rough idea,
  2. prompt-builder conversation,
  3. structured KO/EN final prompt,
  4. apply/insert into composer,
  5. generate,
  6. bind builder session to the generated image for future iteration.

## GitHub Fork Findings

Source:

- `https://github.com/damagethundercat/ima2-gen`

GitHub metadata:

```text
nameWithOwner: damagethundercat/ima2-gen
isFork: true
parent: lidge-ai/ima2-gen
defaultBranch: main
updatedAt: 2026-05-15T01:08:21Z
```

Compare summary from GitHub API:

```text
status: diverged
ahead_by: 17
behind_by: 6
total_commits: 17
```

The fork has broad diffs:

- Backend additions:
  - `lib/promptBuilderClient.ts`
  - `lib/promptBuilderSystemPrompt.ts`
  - `routes/promptBuilder.ts`
- Frontend additions:
  - `ui/src/components/PromptBuilderPanel.tsx`
  - `ui/src/components/ClassicWorkspace.tsx`
  - `ui/src/components/ResultDockPanel.tsx`
  - `ui/src/components/SidebarHistory.tsx`
  - `ui/src/lib/promptBuilderStructuredOutput.ts`
- Tests:
  - `tests/prompt-builder-contract.test.ts`
  - `tests/prompt-builder-ui-contract.test.js`
  - `tests/prompt-builder-structured-output.test.ts`
  - `tests/prompt-builder-inflight-continuity-contract.test.js`
  - `tests/history-composer-restore-contract.test.js`
  - `tests/sidebar-history-performance-contract.test.js`
  - `tests/viewer-workflow-ui-contract.test.js`

## Important File-Level Observations

### Prompt Builder Backend

Fork files:

- `/tmp/ima2-gen-damagethundercat/lib/promptBuilderClient.ts`
- `/tmp/ima2-gen-damagethundercat/lib/promptBuilderSystemPrompt.ts`
- `/tmp/ima2-gen-damagethundercat/routes/promptBuilder.ts`

Core behavior:

- `promptBuilderClient.ts` validates model, messages, attachments, and context.
- Text-only messages use `/v1/chat/completions` through the OAuth proxy.
- Messages with image attachments use `/v1/responses` with `input_image` parts.
- It includes structured error codes such as `PROMPT_BUILDER_BAD_MODEL`, `PROMPT_BUILDER_BAD_MESSAGES`, `PROMPT_BUILDER_UPSTREAM_FAILED`, `PROMPT_BUILDER_EMPTY_RESPONSE`, and `PROMPT_BUILDER_TIMEOUT`.
- It injects current app context: current prompt, inserted prompt blocks, settings, and current result prompt.
- It applies `reasoning_effort: "low"` for text-only chat and a fixed max output token value for Responses.

Risk:

- The file is 534 lines. It combines schema validation, attachment normalization, context formatting, transport selection, SSE parsing, response extraction, error shaping, and request orchestration. Upstream should split these concerns.

### Prompt Builder System Prompt

Fork file:

- `/tmp/ima2-gen-damagethundercat/lib/promptBuilderSystemPrompt.ts`

Core behavior:

- Defines the builder as prompt-enhancement GPT for GPT Image 2.
- Requires a finished output shape with these sections:
  - `Brief Intent Summary:`
  - `Final Prompt - Korean:`
  - `Final Prompt - English:`
  - `Notes:`
- Strongly prefers positive-only prompting.
- Handles reference images, edit prompts, visible text, variations, and safety/style limits.

Upstream relevance:

- This overlaps with our earlier visible text language rule. Do not duplicate contradictory rules. Merge into a single `promptBuilderSystemPrompt` that inherits:
  - exact visible text preservation,
  - no translation/romanization unless requested,
  - Korean/English final prompt alignment,
  - positive-only final prompt rewrite.

### Prompt Builder UI

Fork file:

- `/tmp/ima2-gen-damagethundercat/ui/src/components/PromptBuilderPanel.tsx`

Core behavior:

- Renders message history, image-scope badge, model picker, attachments, send/clear actions.
- Parses assistant output into structured KO/EN prompt cards.
- Offers `Apply to prompt` and `Insert as block`.
- Supports per-turn image/text/file attachments.
- Shows a thinking indicator.

Risk:

- The component is 336 lines. It should be split before adoption.

Suggested split:

```text
ui/src/components/prompt-builder/PromptBuilderPanel.tsx
ui/src/components/prompt-builder/PromptBuilderHeader.tsx
ui/src/components/prompt-builder/PromptBuilderMessageList.tsx
ui/src/components/prompt-builder/PromptBuilderStructuredPromptCard.tsx
ui/src/components/prompt-builder/PromptBuilderComposer.tsx
ui/src/components/prompt-builder/PromptBuilderAttachments.tsx
ui/src/components/prompt-builder/PromptBuilderModelMenu.tsx
ui/src/components/prompt-builder/PromptBuilderScopeBadge.tsx
```

### Store Integration

Fork file:

- `/tmp/ima2-gen-damagethundercat/ui/src/store/useAppStore.ts`

Core behavior added by fork:

- Prompt builder sessions keyed by draft scope or image scope.
- Attachment normalization and persisted session storage.
- Builder draft/model/loading/attachments state.
- `sendPromptBuilderMessage`.
- `applyPromptBuilderMessageToPrompt`.
- `insertPromptBuilderMessageAsBlock`.
- Handoff from draft builder session to generated image scope when a result lands.
- In-flight jobs persist `composerPrompt`, `composerInsertedPrompts`, and `promptBuilderScope`.
- Selecting history restores composer prompt and inserted blocks.

Risk:

- Fork `useAppStore.ts` is 4690 lines. Our current `useAppStore.ts` is already large. A direct port would make the store harder to maintain.

Upstream direction:

- Use a dedicated feature store or reducer module for Prompt Builder.
- Keep only minimal bridge actions in `useAppStore`.
- Put pure normalization/persistence helpers in `ui/src/lib/promptBuilder/`.

### Composer Flow

Fork file:

- `/tmp/ima2-gen-damagethundercat/ui/src/components/PromptComposer.tsx`

Core behavior:

- Adds `variant?: "panel" | "bottom"`.
- Adds visual prompt flow with blocks before/after the main prompt.
- Adds move up/down controls for inserted prompt blocks.
- Adds bottom composer generate button.
- Makes prompt-flow scrolling separate from textarea scrolling.

Risk:

- Direct replacement would disturb current mobile compose sheet and recent UI hardening. Upstream should extract block flow into a component and keep the existing composer shell stable.

### Layout

Fork files:

- `/tmp/ima2-gen-damagethundercat/ui/src/components/ClassicWorkspace.tsx`
- `/tmp/ima2-gen-damagethundercat/ui/src/components/RightPanel.tsx`
- `/tmp/ima2-gen-damagethundercat/ui/src/components/GenerationControlsPanel.tsx`

Core behavior:

- Desktop classic mode uses a stage plus bottom composer.
- Right panel defaults to Prompt Builder and embeds generation controls below it.
- Prompt Library is a tab beside builder.
- Generation controls can render as `panel`, `compact`, or `sidebar`.

Upstream risk:

- Current upstream recently added readiness popup, first-node action, and package/CLI hardening. Layout must preserve those.
- Bottom composer should not be mixed into the backend builder PR. It should be a later UI slice.

### Sidebar History

Fork file:

- `/tmp/ima2-gen-damagethundercat/ui/src/components/SidebarHistory.tsx`

Core behavior:

- Groups multimode items by `sequenceId`.
- Limits rendered sidebar entries to 72.
- Has a gallery card.
- Supports quick delete for single images and sequences.
- Uses lazy image decoding.

Upstream relevance:

- This is useful, but current upstream has shared gallery identity helpers in `ui/src/lib/galleryNavigation.ts`. The fork reimplements local key logic in some places, so upstream should use shared helpers instead.

### Viewer Zoom/Pan

Fork file:

- `/tmp/ima2-gen-damagethundercat/ui/src/components/Canvas.tsx`

Core behavior:

- Adds main viewer zoom/pan state.
- Mouse wheel zooms.
- Double click toggles zoom.
- Pointer drag pans when zoomed.
- Inline controls reset/zoom in/out.
- Adds decorative halftone empty state.

Risk:

- Fork inlines a lot into `Canvas.tsx`; upstream `Canvas.tsx` is currently 231 lines. Adding all fork code inline would push it toward or beyond the 500-line budget.

Upstream direction:

```text
ui/src/hooks/useViewerTransform.ts
ui/src/components/viewer/ViewerTransformFrame.tsx
ui/src/components/viewer/ViewerControls.tsx
ui/src/components/viewer/EmptyHalftoneCanvas.tsx
```

## Regressions To Avoid

Do not port these fork changes directly:

- `ResultActions.tsx` from the fork removes our visible `Generate as first node` button and deletion focus callback. Keep current upstream behavior.
- `HistoryStrip.tsx` from the fork reintroduces local identity logic. Keep upstream `galleryNavigation` helpers.
- `package.json` from the fork renames the package/bin. Keep upstream package and command naming.
- README/site asset changes are distribution-specific and not part of the product implementation plan.
- Large CSS blocks should be split into feature CSS files where possible.

## Test Evidence In Fork

Useful test ideas to carry forward:

- `prompt-builder-contract.test.ts`: backend route, OAuth proxy payloads, chat vs Responses path.
- `prompt-builder-structured-output.test.ts`: parsing structured KO/EN final prompt output.
- `prompt-builder-ui-contract.test.js`: UI wiring, builder panel, structured prompt cards.
- `prompt-builder-inflight-continuity-contract.test.js`: in-flight and image-scope builder handoff.
- `history-composer-restore-contract.test.js`: composer prompt + inserted blocks persisted into history metadata.
- `sidebar-history-performance-contract.test.js`: sidebar render cap and sequence grouping.
- `viewer-workflow-ui-contract.test.js`: zoom/pan controls and quick delete affordances.

These tests are valuable conceptually, but upstream should rewrite them against upstream module names and helper boundaries.

