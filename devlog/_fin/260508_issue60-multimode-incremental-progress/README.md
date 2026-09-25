# Issue #60 - Multimode 4-image progress and partial output recovery

**GitHub**: https://github.com/lidge-ai/ima2-gen/issues/60  
**Repo**: https://github.com/lidge-ai/ima2-gen  
**Status**: completed / moved to _fin  
**Date**: 2026-05-08  
**Scope**: frontend + backend + contract tests  

## Closeout Status — 2026-05-16

GitHub #60 is closed and this plan is now archived in `_fin`.

Evidence:

- `routes/multimode.ts` saves and sends final images incrementally through
  adapter callbacks.
- `lib/responsesImageAdapter.ts` exposes final and partial image callbacks.
- `ui/src/store/useAppStore.ts` reconciles `kind: "multimode"` and preserves
  canceled/partial sequence state.
- `tests/multimode-backend-contract.test.js` and
  `tests/multimode-ui-contract.test.js` cover the shipped behavior.

## Part 1 - Easy Explanation

Multimode 4-image generation currently looks like it is stuck in `queued` or
`0/4 Generating...`, even when the backend has already moved into
`streaming` or `decoding`.

The fix has two parts:

1. The frontend must ask the server about `multimode` in-flight jobs, not only
   `classic` and `node` jobs, so the UI can show the real phase.
2. The backend must save and send each finished multimode image as soon as it
   arrives from Responses, instead of waiting for all 4 images before sending
   anything.

After this change, the user should see slots fill progressively:

```text
Before:
0/4 images for a long time
then either all images at once or a 400s timeout

After:
1/4 appears when image 1 is ready
2/4 appears when image 2 is ready
...
if the upstream times out after partial output, saved images remain visible
```

No model, quality, size, or max-image limit changes are part of this plan.

## Runtime Evidence

Local `3333` investigation for the reported screenshot showed:

```text
requestId: mm_1778173548690_n2pqs
kind: multimode
model: gpt-5.5
quality: high
size: 2160x3840
maxImages: 4
```

The backend did not remain queued. `/api/inflight?kind=multimode&includeTerminal=1`
showed:

```text
queued -> streaming -> decoding
```

The terminal snapshot later showed:

```json
{
  "status": "error",
  "httpStatus": 504,
  "errorCode": "RESPONSES_IMAGE_TIMEOUT",
  "durationMs": 400010,
  "phase": "decoding"
}
```

Four files observed during the same investigation were confirmed to belong to a
separate classic request:

```text
kind: classic
requestId: req_78ba0481-99c1-4ea8-bbac-8f1e87a44ec0
```

So the issue is not "classic count 4 cannot save files"; it is specifically
multimode progress visibility and buffered multimode output delivery.

## Root Cause

### A. Frontend does not poll multimode in-flight phase

Server-side multimode jobs are registered as:

```ts
kind: "multimode"
```

The frontend local in-flight row also uses:

```ts
{ id: flightId, prompt, startedAt, kind: "multimode" }
```

But the API client and polling scope currently only model:

```ts
kind?: "classic" | "node";
```

and polling chooses:

```ts
const inflightKind: "classic" | "node" =
  get().uiMode === "node" ? "node" : "classic";
```

Result: a local multimode job can stay visually queued or stale because the
client asks `/api/inflight?kind=classic` while the backend truth is under
`kind=multimode`.

### B. Backend buffers final multimode images until the whole stream ends

`lib/responsesImageAdapter.ts::parseStream()` stores each
`image_generation_call` result in an internal `images[]` array and sets phase to
`decoding`, but does not expose that image to the route immediately.

`routes/multimode.ts` only writes files and sends `image` SSE events after
`generateMultimodeViaResponses()` returns. If the upstream stream times out
before the full set is complete, any images already seen inside the adapter are
lost from the route's point of view.

## Part 2 - Diff-Level Plan

### 1. Frontend multimode in-flight polling

#### MODIFY - `ui/src/lib/api.ts`

Add `multimode` to the in-flight kind type.

Before:

```ts
kind?: "classic" | "node";
```

After:

```ts
kind?: "classic" | "node" | "multimode";
```

No endpoint path changes. The existing `/api/inflight?kind=...` API already
accepts arbitrary kind filtering through the server in-flight registry.

#### MODIFY - `ui/src/store/useAppStore.ts`

Add small helpers near existing in-flight utilities:

```ts
type InflightQueryScope = {
  kind: "classic" | "node" | "multimode";
  sessionId?: string;
};

function getInflightQueryScopes(state: AppState): InflightQueryScope[] {
  const base =
    state.uiMode === "node"
      ? [{ kind: "node", sessionId: state.activeSessionId ?? undefined }]
      : [{ kind: "classic" }];

  const hasMultimode = state.inFlight.some((job) => job.kind === "multimode");
  return hasMultimode
    ? [...base, { kind: "multimode" }]
    : base;
}
```

Important: do not gate multimode polling on the current `uiMode`. If a user
starts a multimode job and then switches to Node Mode or Canvas Mode, the local
multimode row still needs `/api/inflight?kind=multimode` reconciliation until
it completes, errors, or is canceled.

Replace single-kind polling in `startInFlightPolling()` with:

```ts
const scopes = getInflightQueryScopes(get());
const responses = await Promise.all(
  scopes.map((scope) =>
    getInflight({
      kind: scope.kind,
      sessionId: scope.sessionId,
      includeTerminal: true,
    }).then((response) => ({ scope, response })),
  ),
);
```

Then build `jobs`, `terminalJobs`, and `scopedActiveServerIds` from all
responses. Scope checks must be per job kind/session, not a single
`inflightKind`.

Replace single-kind reconciliation in `reconcileInflight()` the same way.

Important preservation rule:

```text
Polling one scope must not delete out-of-scope local rows.
```

So `matchesScope` must check whether a local row belongs to any queried scope.

### 2. Adapter callback for final images

#### MODIFY - `lib/responsesImageAdapter.ts`

Extend `GenerateOptions` and `PostResponsesArgs`:

```ts
onFinalImage?: ((image: ParsedImage, index: number) => Promise<void> | void) | null;
```

Pass the callback into `postResponses()` and `parseStream()`.

In `parseStream()`, when a final `image_generation_call` result arrives:

Before:

```ts
images.push({
  b64: data.item.result,
  revisedPrompt: typeof data.item.revised_prompt === "string"
    ? data.item.revised_prompt
    : null,
});
if (requestId) setJobPhase(requestId, "decoding");
```

After:

```ts
const image = {
  b64: data.item.result,
  revisedPrompt: typeof data.item.revised_prompt === "string"
    ? data.item.revised_prompt
    : null,
};
const index = images.length;
images.push(image);
if (requestId) setJobPhase(requestId, "decoding");
await onFinalImage?.(image, index);
```

This must only run for streamed Responses. JSON fallback can still return a
buffered array because it has no incremental transport.

### 3. Multimode route incremental save/send

#### MODIFY - `routes/multimode.ts`

Extract the per-image save/send logic from the current post-return loop into a
small local helper:

```ts
async function persistAndSendImage(image: MultimodeImage, index: number): Promise<void> {
  throwIfJobCanceled(requestId);
  const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
  const filename = `${Date.now()}_${rand}_multimode_${index}.${format}`;
  const meta = { ... };
  const rawBuffer = Buffer.from(image.b64, "base64");
  const embedded = await embedImageMetadataBestEffort(rawBuffer, format, meta, {
    version: ctx.packageVersion,
  });
  await writeFile(join(ctx.config.storage.generatedDir, filename), embedded.buffer);
  await writeFile(join(ctx.config.storage.generatedDir, filename + ".json"), JSON.stringify(meta)).catch(() => {});
  invalidateHistoryIndex();
  const item = { ... };
  images.push(item);
  sendSse(res, "image", item);
}
```

Call this helper from the adapter callback:

```ts
const images: MultimodeRouteItem[] = [];
let latestUsage: Record<string, number> | null = null;
let latestWebSearchCalls = 0;
let latestExtraIgnored = 0;

const generated = await generateMultimodeViaResponses(..., {
  ...,
  onFinalImage: async (image, index) => {
    await persistAndSendImage(image, index);
  },
});
```

After the adapter returns, do not blindly persist already-sent streamed images
again. However, JSON/non-stream fallback still returns buffered `generated.images`
without calling `onFinalImage`, so the route must reconcile by index:

```ts
for (const [index, image] of generated.images.entries()) {
  if (!persistedIndexes.has(index)) {
    await persistAndSendImage(image, index);
  }
}
```

Use a `persistedIndexes: Set<number>` or equivalent route-local guard. This
prevents duplicate writes for streamed images while preserving JSON fallback
outputs.

### 4. Partial timeout semantics

#### MODIFY - `routes/multimode.ts`

In the catch block, if the upstream throws timeout after at least one image was
already persisted:

```ts
if (isResponsesTimeout(err) && images.length > 0) {
  const status = "partial";
  finishStatus = "completed";
  finishHttpStatus = 206;
  finishMeta = {
    sequenceId,
    filenames: images.map((image) => image.filename),
    imageCount: images.length,
    maxImages,
    status,
    partialErrorCode: "RESPONSES_IMAGE_TIMEOUT",
  };
  sendSse(res, "done", {
    ok: true,
    partial: true,
    requestId,
    sequenceId,
    requested: maxImages,
    returned: images.length,
    status,
    elapsed,
    images,
    provider: activeProvider,
    quality,
    size: effectiveSize,
    moderation,
    model: imageModel,
    usage: latestUsage || null,
    webSearchCalls: latestWebSearchCalls || 0,
    webSearchEnabled,
    warnings: qualityWarnings,
    extraIgnored: latestExtraIgnored || 0,
    promptMode: normalizedPromptMode,
    warning: {
      code: "RESPONSES_IMAGE_TIMEOUT",
      message: "The provider timed out after returning partial multimode results.",
    },
  });
  return;
}
```

If zero images were persisted, keep current 504 error behavior.

Do not reference a block-scoped `const generated` from the timeout catch path.
The `await generateMultimodeViaResponses(...)` can throw before assignment, so
partial-timeout metadata must come from route-local accumulators initialized
before the await:

```ts
let latestUsage: Record<string, number> | null = null;
let latestWebSearchCalls = 0;
let latestExtraIgnored = 0;

try {
  const generated = await generateMultimodeViaResponses(...);
  latestUsage = generated.usage || null;
  latestWebSearchCalls = generated.webSearchCalls || 0;
  latestExtraIgnored = generated.extraIgnored || 0;
} catch (e) {
  // partial timeout uses latestUsage/latestWebSearchCalls/latestExtraIgnored
}
```

Do not mark user cancellation as partial success. Cancellation remains canceled,
even if some images were already displayed locally.

#### MODIFY - `ui/src/store/useAppStore.ts`

Current abort/cancel paths can convert a multimode sequence with images into
`status: "partial"`:

```ts
status: current.images.length > 0 ? "partial" : "empty"
```

Replace that behavior for user-driven cancellation:

```ts
status: "canceled"
```

Then ensure the preview cleanup treats `canceled` as non-clean:

```ts
const isCleanFinish = finalStatus === "complete" || finalStatus === "partial";
```

This line can remain unchanged as long as `canceled` is not included. The
visible sequence may keep already displayed images for inspection, but it must
not toast or persist as a clean partial success caused by upstream timeout.

### 5. Frontend sequence state handling

#### MODIFY - `ui/src/types.ts`

Add `canceled` before the store writes that status:

```ts
export type MultimodeSequenceStatus =
  | "pending"
  | "partial"
  | "complete"
  | "empty"
  | "error"
  | "canceled";
```

Update any source-contract test that locks the exact union string.

#### MODIFY - `ui/src/store/useAppStore.ts`

The existing multimode `onImage` handler already updates `multimodeSequences`.
Keep that behavior, but ensure the `done` handler uses the accumulated `images`
array from SSE when the final payload is partial.

If the existing handler replaces the sequence with only final payload images,
make it merge by `sequenceIndex` or filename to avoid losing already displayed
slots.

The partial `done` payload emitted by the backend must keep the normal
multimode `done` envelope shape consumed by the frontend:

```text
elapsed
provider
quality
size
moderation
model
usage
webSearchCalls
webSearchEnabled
warnings
extraIgnored
promptMode
```

If any field is intentionally nullable, harden the frontend at the same time;
do not ship a partial event shape that only contains `images`.

### 6. User-facing text

#### MODIFY - `ui/src/i18n/en.json`
#### MODIFY - `ui/src/i18n/ko.json`

Only add copy if the current UI has no way to represent partial completion.
Use existing `inflight` / multimode keys if present; do not create duplicate
top-level objects.

Candidate copy:

```json
"partial": "Partial"
```

```json
"partial": "일부 완료"
```

### 7. Tests

#### NEW or MODIFY - `tests/multimode-ui-contract.test.js`

Lock frontend source contracts:

```text
- getInflight accepts "multimode".
- startInFlightPolling queries multimode when a local multimode row exists.
- reconcileInflight queries multimode when a local multimode row exists.
- multimode is treated as in-scope for cleanup only when that scope was queried.
```

#### MODIFY - `tests/api-provider-parity.test.ts`

Add a streamed Responses fixture with two final `image_generation_call` events
and a later timeout/error. Assert the adapter invokes `onFinalImage` per final
image before the terminal failure path.

#### MODIFY - `tests/multimode-backend-contract.test.js`

Add source/API contract checks that:

```text
- routes/multimode.ts passes onFinalImage to generateMultimodeViaResponses.
- the route sends "image" SSE inside the per-final-image callback path.
- partial timeout after saved images sends done/partial, not only error.
- zero-image timeout still sends error 504.
- JSON/non-stream fallback images are persisted after return if they were not
  already handled by `onFinalImage`.
```

#### MODIFY - `tests/multimode-ui-contract.test.js`

Add cancellation and mode-switch checks:

```text
- a local multimode row causes kind=multimode polling even after uiMode switches to node.
- `MultimodeSequenceStatus` includes "canceled".
- cancelMultimode and AbortError paths set status=canceled, not partial.
- canceled is not treated as a clean partial success in preview cleanup.
```

#### Existing verification commands

```bash
node --test tests/multimode-ui-contract.test.js tests/multimode-backend-contract.test.js
node --import tsx --test tests/api-provider-parity.test.ts
npm run typecheck
cd ui && npx tsc -b --noEmit
npm run ui:build
npm test
```

## Acceptance Criteria

```text
- A local multimode job no longer stays visually queued when the backend reports streaming/decoding.
- The frontend queries /api/inflight?kind=multimode when local multimode jobs exist.
- Each final Responses image is saved and sent to the frontend as soon as it arrives.
- Multimode slots can fill 1/4, 2/4, 3/4 before the full sequence completes.
- If the upstream times out after at least one saved image, saved partial output remains visible and appears in history.
- If the upstream times out before any image is saved, the existing 504 error behavior remains.
- User cancellation remains canceled, not partial success.
- JSON/non-stream fallback outputs are not dropped.
- Partial timeout `done` keeps the same frontend-consumed envelope fields as a
  normal multimode success.
- Tests/typecheck/build pass.
```

## Non-Goals

```text
- Change default model, quality, size, maxImages, timeout, or moderation.
- Force classic Count=4 into multimode.
- Add a new queue system.
- Add retry/resume for timed-out multimode stages.
- Persist adapter-internal partial state before an image_generation_call final result.
- Close #60 before implementation and verification.
```

## External Review Package

Ask GPT Pro to review this plan with the repository URL, not with an unrelated
conversation URL.

Prompt marker:

```text
IMA2_GEN_ISSUE60_MULTIMODE_INCREMENTAL_PLAN_REVIEW_260508
```

### Pro review 1 - NEEDS_FIX

`agbrowse web-ai query --vendor chatgpt --model pro --new-tab` returned
`NEEDS_FIX` on 2026-05-08.

Blockers raised:

```text
1. JSON fallback would lose images if only streamed onFinalImage outputs are persisted.
2. Partial timeout done payload must keep the normal multimode done envelope.
3. User cancellation currently can become status=partial and must be separated.
4. Multimode polling must continue even after mode switch, not only when uiMode !== node.
```

This README has been revised to address all four points before re-review.

### Pro review 2 - NEEDS_FIX

Second `agbrowse` review returned `NEEDS_FIX` with two remaining blockers:

```text
1. Add "canceled" to MultimodeSequenceStatus in ui/src/types.ts and cover tests/rendering.
2. Do not reference a block-scoped `generated` from a timeout catch path when
   the await can throw before assignment.
```

This README has been revised to add the `ui/src/types.ts` diff and to replace
catch-path `generated?.*` usage with route-local accumulators.

### Pro review 3 - PASS

Third `agbrowse` review returned:

```text
PASS
```

Reviewer summary:

```text
No blocker-level corrections. The revised plan is implementation-ready: it
covers Issue #60's stated failure area around frontend progress/SSE handling
and classic vs multimode in-flight reconciliation, while also resolving the R2
blockers by adding canceled to MultimodeSequenceStatus/tests and replacing
catch-path generated?.* reads with pre-await route-local accumulators.
```

Required review question:

```text
Given https://github.com/lidge-ai/ima2-gen and issue #60, review the diff-level
plan in this file. Is the proposed frontend multimode inflight polling and
backend onFinalImage incremental save/send design correct? Reply PASS or
NEEDS_FIX first, then list only blocker-level corrections.
```
