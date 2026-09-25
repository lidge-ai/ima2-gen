# Issue #57 — History strip duplicate tiles after multi-image generation

Status: done / shipped on main
GitHub: https://github.com/lidge-ai/ima2-gen/issues/57
Date: 2026-05-07

## Companion plans

- [02_visible_text_language_prompt_plan.md](./02_visible_text_language_prompt_plan.md) — prompt fidelity follow-up for exact visible text in the requested language/script.

## Problem

Users report that after multi-image generation, the history strip sometimes shows duplicate tiles even though the generated files appear to be distinct. The duplicates disappear after browser refresh.

This points to a temporary frontend `history` state duplication, not duplicate files on disk.

## Root-cause hypothesis

Two writers can insert the same saved filename into frontend history:

1. The generation completion path calls internal `addHistory(...)` for every returned image.
2. The in-flight polling loop independently calls `/api/history?since=...` every 1.5s and prepends newly saved files.

The polling path has a partial duplicate filter, but it computes `existing = get().history` before `set(...)`. The generation completion helper `addHistory(...)` has no duplicate guard at all. If polling observes the saved files before the completion handler finishes adding them, the same filename can be prepended twice.

Refresh fixes the UI because `hydrateHistory()` replaces client state from server history.

## Diff plan

### MODIFY `ui/src/store/useAppStore.ts`

#### 1. Add a small shared dedupe helper near `historyKey(...)`

Before:

```ts
function historyKey(item: Pick<GenerateItem, "filename" | "image">): string {
  return item.filename ?? item.image;
}
```

After:

```ts
function historyKey(item: Pick<GenerateItem, "filename" | "image">): string {
  return item.filename ?? item.image;
}

function withoutHistoryDuplicate(
  history: GenerateItem[],
  item: Pick<GenerateItem, "filename" | "image">,
): GenerateItem[] {
  const key = historyKey(item);
  return history.filter((existing) => historyKey(existing) !== key);
}
```

Rationale: use the same identity everywhere (`filename` first, data URL fallback).

#### 2. Make polling merge dedupe against current state inside the `set` callback

Before:

```ts
const existing = get().history;
const fresh = arr.filter(
  (a) => !existing.some((e) => e.filename === a.filename),
);
if (fresh.length > 0) {
  set((s) => {
    const nextCurrent = s.currentImage ?? fresh[0];
    ...
    return {
      history: [...fresh, ...s.history].slice(
        0,
        Math.max(HISTORY_LIMIT, s.history.length + fresh.length),
      ),
      currentImage: nextCurrent,
    };
  });
}
```

After:

```ts
if (arr.length > 0) {
  set((s) => {
    const seen = new Set(s.history.map(historyKey));
    const fresh = arr.filter((item) => {
      const key = historyKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) return {};
    const nextCurrent = s.currentImage ?? fresh[0];
    ...
    return {
      history: retainHistoryItems(
        [...fresh, ...s.history],
        Math.max(HISTORY_LIMIT, s.history.length + fresh.length),
      ),
      currentImage: nextCurrent,
      loadedHistoryRetainLimit: Math.max(
        s.loadedHistoryRetainLimit,
        s.history.length + fresh.length,
      ),
    };
  });
}
```

Rationale: the current state must be read at mutation time, not before async work races with `addHistory(...)`.

#### 3. Make internal `addHistory(...)` replace existing matching filename/image instead of blindly prepending

Before:

```ts
const state = get();
const history = retainHistoryItems(
  [withThumb, ...state.history],
  state.loadedHistoryRetainLimit + 1,
);
```

After:

```ts
const state = get();
const historyWithoutDuplicate = withoutHistoryDuplicate(state.history, withThumb);
const history = retainHistoryItems(
  [withThumb, ...historyWithoutDuplicate],
  state.loadedHistoryRetainLimit + 1,
);
```

Rationale: whichever writer wins last should leave one item for a filename, not two.

When replacing an existing matching history item, do not drop server-enriched fields that may have arrived from `/api/history` first. The upsert must either preserve existing `requestId`, `createdAt`, `sessionId`, `kind`, `refsCount`, and `isFavorite` when the incoming item does not define them, or ensure the generation completion item carries the same `requestId` and metadata before replacement.

#### 4. Update public `addHistoryItem(...)` to reuse the same helper

Before:

```ts
const exists = s.history.some(
  (h) => item.filename && h.filename === item.filename,
);
if (exists) return;
```

After:

```ts
const historyWithoutDuplicate = withoutHistoryDuplicate(s.history, item);
```

Then prepend `withDefaults` to `historyWithoutDuplicate`. For trash restore/import flows this keeps replacement behavior consistent with generation and avoids stale duplicate variants.

#### 5. Preserve requestId on local generation completion items

`routes/generate.ts` already returns top-level `requestId`, and `routes/multimode.ts` returns top-level `requestId` in the final done payload. Frontend types and item construction should preserve it before dedupe/upsert.

Planned changes:

- Add `requestId?: string` to `GenerateSingleResponse`.
- Add `requestId?: string` to `GenerateMultiResponse`.
- When building classic `GenerateItem`s, set `requestId: res.requestId ?? flightId`.
- When building multimode final `GenerateItem`s, set `requestId: image.requestId ?? res.requestId ?? flightId`.
- Do not use `requestId` as the dedupe key: one requestId can legitimately map to multiple filenames for Count > 1 and multimode. The visual/history identity remains filename-first.

### MODIFY `ui/src/components/HistoryStrip.tsx`

#### Add render-level duplicate guard

Before:

```ts
const visibleHistory = useMemo(
  () => history.filter((item) => !item.canvasVersion),
  [history],
);
```

After:

```ts
const visibleHistory = useMemo(() => {
  const seen = new Set<string>();
  return history.filter((item) => {
    if (item.canvasVersion) return false;
    const key = getHistoryItemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}, [history]);
```

Rationale: store-level dedupe is the real fix; render-level dedupe prevents duplicate React keys from making the strip visually unstable if an old state shape gets restored.

Also update the rendered React key to use the same identity helper:

```tsx
key={getHistoryItemKey(item)}
```

Rationale: dedupe identity and React reconciliation identity should match.

### ADD/MODIFY tests

#### ADD `tests/history-strip-duplicate-contract.test.js`

Contract checks:

- `addHistory(...)` must call `withoutHistoryDuplicate(...)` before prepending.
- polling history merge must dedupe inside the `set((s) => ...)` callback.
- `HistoryStrip` must dedupe `visibleHistory` by `getHistoryItemKey(...)`.
- classic Count > 1 path still calls `addHistory(...)` for each image, so the helper is the dedupe boundary.
- multimode done path still calls `addHistory(...)` for each final image, so the helper is also the dedupe boundary there.
- classic and multimode completion items preserve `requestId` while deduping by filename.
- the dedupe helper must not use `requestId` as item identity, because one request can produce multiple distinct filenames.

#### RUN existing related tests

```bash
node --test tests/history-strip-duplicate-contract.test.js
node --test tests/gallery-navigation-ux-contract.test.js tests/gallery-shortcuts-visible-domain-contract.test.js
cd ui && npx tsc -b --noEmit
npm run ui:build
npm test
```

## Non-goals

- Do not change server file naming or generated-file writes.
- Do not disable in-flight polling.
- Do not infer duplicates by prompt; repeated prompts are valid.
- Do not dedupe by `requestId`; Count > 1 and multimode can produce multiple valid filenames under one requestId.
- Do not hide real server duplicates if filenames differ.

## Employee review questions

1. Is the root cause consistent with the current `useAppStore.ts` generation, polling, and history hydration code?
2. Is deduping by `historyKey(filename ?? image)` the right identity boundary for history strip display?
3. Should `addHistoryItem(...)` replace existing matching items, or should it keep the old early-return behavior?
4. Are there any server-side changes needed for #57, or is this safely frontend-only?
