---
created: 2026-05-16
status: planning
issue: https://github.com/lidge-ai/ima2-gen/issues/71
tags: [ima2-gen, issue71, prompt-context, prompt-studio, classic, quality-elements, jawdev]
---

# Issue #71 — Classic Prompt Context Injection

Classic도 Agent Mode처럼 app-server가 재현 가능한 workspace/prompt state를 들고, client는 그 state를 조작하는 방향으로 가야 한다. 이번 이슈는 그 전체 전환 중 가장 즉시 체감되는 slice다. 사용자가 현재 보고 있는 이미지의 프롬프트를 한 번에 다음 생성에 주입하고, 별도의 품질 요소를 체크해서 prompt에 안정적으로 넣을 수 있게 만든다.

핵심은 `prompt` 문자열을 몰래 덧붙이는 것이 아니다. `current prompt`, `prompt library block`, `quality element`, `prompt builder output`을 각각 source와 ordering이 있는 prompt context block으로 보존하고, 서버가 최종 prompt를 다시 조립할 수 있어야 한다.

---

## GitHub Issue

- Issue: [#71 Prompt Studio: server-backed Classic prompt context and quality injection](https://github.com/lidge-ai/ima2-gen/issues/71)
- Priority: p1
- Scope: Classic prompt context MVP, current prompt injection, quality element injection, CLI compose contract

## Reference Audit

### cli-jaw prompt injection pattern

`cli-jaw`는 prompt를 단일 문자열로만 다루지 않고 다음 레이어로 나눈다.

- A-1 static system rules
- A-2 user preferences
- memory/task snapshot
- skill/delegation sections
- recent history block
- current user message

ima2-gen에 그대로 memory runtime을 옮길 필요는 없다. 중요한 것은 각 주입 조각이 `source`, `role`, `ordering`, `traceability`를 갖는다는 점이다.

Relevant local reference:

- `/Users/jun/Developer/new/700_projects/cli-jaw/structure/prompt_flow.md`
- `/Users/jun/Developer/new/700_projects/cli-jaw/structure/memory_architecture.md`

### Codex CLI prompt channel pattern

Codex MCP tool schema는 prompt 입력을 다음처럼 분리한다.

- `prompt`: current user prompt
- `base-instructions`: default instruction replacement
- `developer-instructions`: developer role injection
- `compact-prompt`: compaction prompt

ima2-gen image generation은 Codex처럼 임의 developer channel을 user toggle마다 바꾸면 안 된다. 그래도 channel 분리 원칙은 그대로 유효하다. 사용자가 고른 quality element는 inspectable user prompt context로 남기고, fixed developer prompt는 `lib/responsesImageAdapter.ts`의 안전/도구 정책 역할에 머물게 한다.

Relevant local reference:

- `/Users/jun/Developer/codex/codex-cli/codex-rs/mcp-server/src/codex_tool_config.rs`

### ima2-gen current state

현재 Classic은 이미 일부 재료가 있다.

- `ui/src/store/useAppStore.ts`
  - `InsertedPrompt`
  - `composePrompt(mainPrompt, insertedPrompts)`
  - `insertPromptToComposer()`
  - `runGenerate()`, `generateMultimode()`
- `ui/src/components/ResultActions.tsx`
  - current image prompt/reference flow
- `routes/generate.ts`
  - final `prompt` 수신
  - `composerPrompt`, `composerInsertedPrompts` metadata normalization
  - sidecar metadata write
- `lib/responsesImageAdapter.ts`
  - fixed developer prompt + user prompt split
  - image_generation tool `quality` option

문제는 이 재료들이 최종적으로 raw `prompt` 하나로 합쳐진다는 점이다. 현재 이미지 프롬프트와 품질 guidance가 각각 어떤 source에서 왔는지 sidecar/history/CLI가 복원하기 어렵다.

## Product Decision

`quality`라는 단어를 두 의미로 분리한다.

| Concept | Meaning | Persistence | Generation effect |
|---|---|---|---|
| API quality | `low`, `medium`, `high` image_generation tool option | generation defaults + sidecar | Responses image tool option |
| Quality element | semantic prompt guidance: composition, lighting, fidelity, surface detail, text discipline | prompt context manifest | final user text prompt |
| Current prompt injection | current image prompt/composer/revised prompt as source block | prompt context manifest | final user text prompt |

따라서 UI 문구도 분리해야 한다.

- API option: `Quality`
- semantic prompt guidance: `Quality guidance` 또는 `Prompt quality`
- current image reuse: `Use current prompt`

## MVP UX

Classic composer 근처에 compact prompt context strip을 둔다.

### Current Prompt

`Use current prompt` 버튼:

- `currentImage.composerPrompt` 우선
- 없으면 `currentImage.prompt`
- 필요 시 `currentImage.revisedPrompt`
- 한 번 누르면 stable context block 하나를 만든다.
- 다시 누르면 source만 update하고 중복 block을 만들지 않는다.
- chip 표시: `Current prompt: <filename>`

### Quality Guidance

`Quality guidance` menu:

- allowlisted quality element checkbox 목록
- 선택된 항목은 chip으로 표시
- chip 제거 가능
- prompt textarea 자체를 mutate하지 않는다.
- preview에서 최종 prompt에 어떻게 들어가는지 볼 수 있어야 한다.

### Prompt Preview

`Prompt context` disclosure:

- main prompt
- current-image prompt source
- selected quality elements
- final prompt preview
- ignored/unknown quality id warnings

## Prompt Ordering

MVP ordering:

```text
1. prompt-library blocks with placement != after
2. current image prompt block, if enabled
3. main composer prompt
4. quality element guidance block
5. prompt-library blocks with placement == after
```

이 ordering을 pure function contract로 고정한다. UI와 CLI는 같은 output을 내야 한다.

## Data Contract

Suggested types:

```ts
export type PromptContextBlockKind =
  | "library"
  | "current-image"
  | "quality"
  | "builder"
  | "manual";

export type PromptContextPlacement = "before" | "after" | "quality";

export type PromptContextBlock = {
  id: string;
  kind: PromptContextBlockKind;
  name: string;
  text: string;
  placement: PromptContextPlacement;
  source?: {
    type: "prompt-library" | "history-image" | "quality-registry" | "prompt-builder" | "manual";
    id?: string | null;
    filename?: string | null;
  };
  enabled: boolean;
};

export type PromptContextManifest = {
  version: 1;
  mainPrompt: string;
  blocks: PromptContextBlock[];
  qualityElementIds: string[];
  currentImagePromptSource?: {
    filename: string;
    field: "composerPrompt" | "prompt" | "revisedPrompt";
  } | null;
  finalPrompt: string;
  warnings: string[];
};
```

## Quality Element Registry

Add:

```text
lib/promptContext/qualityElements.ts
```

Initial allowlist:

```ts
export const QUALITY_ELEMENTS = [
  {
    id: "prompt-fidelity",
    name: "Prompt fidelity",
    text: "Preserve every explicit subject, action, setting, camera, text, and style constraint from the user prompt. Do not replace the requested subject with a different one.",
  },
  {
    id: "composition",
    name: "Composition",
    text: "Use a deliberate composition with a clear focal point, readable silhouette, balanced negative space, and no accidental cropping of important subject details.",
  },
  {
    id: "lighting-color",
    name: "Lighting and color",
    text: "Use coherent lighting, controlled contrast, natural color harmony, and visible material separation without muddy shadows or blown highlights.",
  },
  {
    id: "surface-detail",
    name: "Surface detail",
    text: "Render crisp edges, clean texture detail, consistent materials, and high-fidelity local detail without noisy artifacts.",
  },
  {
    id: "text-discipline",
    name: "Text discipline",
    text: "Do not add logos, watermarks, captions, UI labels, or random text unless the user explicitly requested readable text.",
  },
] as const;
```

Guardrails:

- IDs are stable.
- Unknown IDs produce warnings.
- Registry text is visible in preview.
- Do not revive the removed old style feature.

## Implementation Plan

### Slice 1 — Pure prompt context module

Add:

```text
lib/promptContext/types.ts
lib/promptContext/qualityElements.ts
lib/promptContext/compose.ts
lib/promptContext/currentImagePrompt.ts
tests/prompt-context-contract.test.js
```

Main API:

```ts
export function buildPromptContext(input: {
  mainPrompt: unknown;
  insertedPrompts?: unknown;
  qualityElementIds?: unknown;
  currentImagePrompt?: unknown;
  currentImagePromptSource?: unknown;
}): PromptContextManifest
```

Behavior:

- Normalize main prompt.
- Normalize existing `composerInsertedPrompts` into `library` blocks.
- Resolve quality element IDs from registry.
- Normalize one current-image prompt block.
- Deduplicate blocks by stable id.
- Produce deterministic `finalPrompt`.
- Return warnings.

### Slice 2 — `/api/generate` server source of truth

Modify `routes/generate.ts` first.

Request:

```ts
{
  prompt: string;
  composerPrompt?: string;
  composerInsertedPrompts?: InsertedPrompt[];
  promptContext?: {
    qualityElementIds?: string[];
    currentImagePrompt?: string;
    currentImagePromptSource?: {
      filename?: string;
      field?: "composerPrompt" | "prompt" | "revisedPrompt";
    };
  };
}
```

Server rule:

- If `promptContext` exists, call `buildPromptContext()`.
- Use `manifest.finalPrompt` as the upstream image prompt.
- Persist `promptContextManifest` in sidecar metadata.
- Include prompt context summary in response if useful.
- If absent, keep current behavior unchanged.

### Slice 3 — Classic UI current prompt injection

Store additions:

```ts
promptContextQualityElementIds: string[];
promptContextCurrentImagePrompt: CurrentImagePromptBlock | null;
setPromptContextQualityElementIds(ids: string[]): void;
togglePromptContextQualityElement(id: string): void;
injectCurrentImagePrompt(item: GenerateItem): void;
clearCurrentImagePrompt(): void;
```

UI:

- Add `Use current prompt` action near current image actions.
- Add selected chip above composer.
- Sending generation includes `promptContext`.

### Slice 4 — Quality guidance UI

Add compact menu, not a large card.

Suggested components:

```text
ui/src/components/prompt-context/QualityGuidanceMenu.tsx
ui/src/components/prompt-context/PromptContextChips.tsx
ui/src/components/prompt-context/PromptContextPreview.tsx
```

Style:

```text
ui/src/styles/prompt-context.css
```

Frontend rules:

- toggles do not mutate `prompt`
- preview uses the same ordering as server pure function
- selected chips remain readable in narrow widths

### Slice 5 — Extend edit, multimode, node

After single generate passes, extend:

- `routes/edit.ts`
- `routes/multimode.ts`
- `routes/nodes.ts`
- `ui/src/lib/api.ts`
- `ui/src/lib/nodeApi.ts`

Do not start with all routes at once.

### Slice 6 — CLI contract

Suggested commands:

```bash
ima2 prompt compose --prompt "..." --quality-element prompt-fidelity --quality-element composition --json
ima2 prompt compose --from-history latest --quality-element surface-detail --json
ima2 gen "..." --quality-element prompt-fidelity --quality-element text-discipline
ima2 gen "..." --current-prompt-from <filename> --quality-element composition
```

Capabilities:

```json
{
  "promptContext": {
    "supported": true,
    "qualityElements": ["prompt-fidelity", "composition", "lighting-color", "surface-detail", "text-discipline"],
    "currentPromptInjection": true
  }
}
```

## PABCD Gates

### P — Planning

This file is the initial P artifact.

Before implementation, add an audit appendix with exact line refs for:

- `useAppStore.ts` prompt paths
- `ResultActions.tsx`
- generation routes
- CLI parser
- `responsesImageAdapter.ts`

### A — Audit

Audit must answer:

- Is the server rebuilding final prompt, or trusting client final prompt?
- Are quality element IDs allowlisted?
- Is `quality` API option still distinct from quality guidance?
- Does current prompt injection dedupe?
- Can sidecar metadata reproduce the final prompt?
- Does CLI compose match UI preview?

### B — Build

Recommended order:

1. Pure module + tests.
2. `/api/generate` only.
3. Classic UI current prompt block.
4. Quality guidance menu/chips/preview.
5. Multimode/edit/node route parity.
6. CLI compose/generate flags.
7. Capabilities JSON.

### C — Check

Required:

```bash
node --test tests/prompt-context-contract.test.js
npm run typecheck
npm run typecheck:tests
npm run ui:build
npm test
git diff --check
```

Manual QA:

- Classic desktop: select image, inject current prompt, toggle quality elements, preview final prompt, generate.
- Narrow viewport: chips/menu do not overlap composer.
- Sidecar: resulting JSON contains `promptContextManifest`.
- CLI: `ima2 prompt compose --json` matches UI preview for equivalent inputs.

### D — Done

Move this folder to `_fin` only when:

- GitHub #71 is implemented and closed.
- UI + CLI use the same quality element IDs.
- Route sidecars persist reproducible prompt context.
- QA evidence is recorded.

## Acceptance Checklist

- [ ] Current image prompt can be injected with one click.
- [ ] Quality guidance can be toggled without editing prompt text.
- [ ] Final prompt preview is inspectable.
- [ ] Server rebuilds prompt context manifest.
- [ ] Generated sidecar persists `promptContextManifest`.
- [ ] CLI can compose the same manifest.
- [ ] Existing prompt library insertion remains compatible.
- [ ] Existing API quality/model/provider/reasoning/web-search behavior remains compatible.
- [ ] Contract tests cover pure module, route, frontend, and CLI.
