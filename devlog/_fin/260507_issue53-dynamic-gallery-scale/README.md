# Issue #53 - Gallery Scale: Favorites Cursor, Index, and Virtualization

**GitHub**: https://github.com/lidge-ai/ima2-gen/issues/53
**Repo**: https://github.com/lidge-ai/ima2-gen
**Status**: done / shipped on main
**Date**: 2026-05-07

## Context

#53 was split from #52 after a Windows/Edge user reported that the 500-image
gallery cap makes older images and favorites beyond the first page unreachable.

The first implementation pass already shipped:

- server-side `favoritesOnly` before pagination;
- cursor-based "Load older" behavior for the normal gallery;
- history merge behavior so older pages append without dropping fresh rows;
- real in-flight generation cancellation for #54.

The remaining #53 question is not "how do we let the user manually raise a
cap?" If the gallery is properly virtualized, a manual cap selector is not the
right product surface.

The remaining question is how to make large history browsing safe:

```text
Favorites pagination
→ server history index/cache
→ virtualized gallery rows
→ large libraries become browsable without a visible manual cap knob
```

## Product Decision

Do not add a visible "Gallery cap: 500 / 1000 / 2000 / 5000" selector.

Reason:

- Before virtualization, a larger visible cap can create DOM and memory pressure.
- After virtualization, a user-facing cap selector is mostly unnecessary; the
  gallery can page data behind a virtualized view while rendering only visible
  rows.
- The user wants old images and favorites to be reachable, not another setting
  to manage.

Keep each server request bounded. The UI can fetch cursor pages as needed, but
the browser should never render thousands of tiles at once.

## GPT Pro Review So Far

Pro agreed on the major safety constraints:

- do not blindly raise the 500 per-request/global cap;
- favorites need their own cursor path;
- repeated cursor pages are only safe if bounded and guarded before index/cache;
- existing retention paths that slice to `HISTORY_LIMIT` must not drop
  explicitly loaded older rows;
- session/grouped views need their own pagination and should not reuse date-view
  controls;
- `@tanstack/react-virtual` is the right later dependency for this React UI;
- future 5000-scale browsing is gated on index/cache plus virtualization.

Jun correction on 2026-05-07:

```text
If virtualization is the real solution, manual cap adjustment is unnecessary.
```

This plan is revised around that correction.

Invalidated Pro gate after revision:

```text
IMA2_GEN_53_NO_CAP_GATE_260507_1003

PASS
```

This `PASS` is invalid for implementation gating. The browser automation captured
an intermediate Thinking response as if it were complete, then follow-up
packaging polluted the thread. Jun explicitly rejected using this Pro result.

Implementation should not proceed from Pro validation. The plan is now being
reviewed by employees instead:

```text
Phase 1: Favorites cursor + retention/stale safety
Phase 2: Server history index/cache
Phase 3: @tanstack/react-virtual gallery
Phase 4: Session/grouped pagination
```

## Employee Review

### Ryo backend/API review - NEEDS_FIX

Ryo agreed with the overall no-manual-cap direction but found backend planning
gaps that must be fixed before implementation:

- `isFavorite` cannot be stored as a global history index field because
  favorites are browser-scoped (`gallery_favorites.browser_id + filename`).
- History index/cache invalidation must name the actual generated-history writer
  and remover paths, including card news and canvas versions.
- `historyIndex.ts` must define TTL and singleflight rebuild behavior.
- Verification must include backend cursor/favorite/index contracts, not only
  frontend source contracts.

### Nijika frontend/UX review - NEEDS_FIX

Nijika agreed with the no-manual-cap direction and Phase 1 value, but found
frontend plan gaps:

- Session/grouped view should not merely hide load controls. It needs quiet
  helper copy explaining that session pagination is coming and users can switch
  to Date view to load older images.
- The test plan must explicitly cover favorites cursor state, retention guards,
  query/session load-control gating, session helper i18n, and Phase 3
  virtualization contracts.

### Employee re-review - PASS

After applying Ryo and Nijika's NEEDS_FIX feedback, both employees re-reviewed
the plan read-only and returned PASS.

- Ryo PASS: backend/API/data-flow risks are addressed in the plan, including
  browser-scoped favorite overlay, TTL/singleflight history index behavior,
  explicit invalidation wiring, and backend tests.
- Nijika PASS: frontend/UX/test risks are addressed in the plan, including no
  manual cap selector, Favorites cursor UX, session helper copy, retention/stale
  safety, and Phase 3 virtualization contracts.

## Revised Diff-Level Plan

### Phase 1 - Favorites Cursor and Retention Safety

Goal: finish the reachability problem without adding a cap selector.

#### MODIFY - `ui/src/store/useAppStore.ts`

Add separate favorites pagination and a unified retention floor:

```ts
favoriteHistoryNextCursor: HistoryCursor | null,
favoriteHistoryHasMore: boolean,
favoriteHistoryLoadingOlder: boolean,
loadOlderFavoriteHistory(): Promise<void>,

loadedHistoryRetainLimit: number,
```

Expected behavior:

- Favorites mode fetches `favoritesOnly=1` with cursor support.
- Favorite pages merge into the same `history` cache by filename.
- Normal history and favorite history cursors stay independent.
- Explicitly loaded normal/favorite rows raise `loadedHistoryRetainLimit`.
- History insertion/merge paths that currently use `.slice(0, HISTORY_LIMIT)`
  retain at least `loadedHistoryRetainLimit`.
- No unlimited background loading. Each user action loads one bounded cursor
  page, or a small explicitly bounded sequence if the UI later needs it.

Define load request context:

```ts
type GalleryLoadCursorKind = "normal" | "favorites";

type GalleryLoadContext = {
  openGeneration: number;
  favoritesOnly: boolean;
  groupBy: "date" | "session";
  scope: "all" | "session" | "favorites";
  cursorKind: GalleryLoadCursorKind;
};
```

Use this context to ignore stale results after modal close, filter switch, group
switch, scope switch, or overlapping load requests.

#### MODIFY - `ui/src/components/GalleryModal.tsx`

Keep the current Date/All "Load older" path.

Because `GalleryModal.tsx` is already at the existing line-count contract limit,
do not add the new load-more/session-hint UI inline. First extract the
load-more controls and/or session pagination hint into a small colocated
component, then wire `GalleryModal.tsx` to that component.

Suggested new component:

```text
ui/src/components/gallery/GalleryLoadControls.tsx
```

The implementation should update tests to assert this extraction boundary
instead of simply increasing the `GalleryModal.tsx` line-count allowance.

Add Favorites mode equivalent:

```text
Load older favorites
```

This must call the favorites cursor path, not the normal cursor path.

While `groupBy === "session"`, hide or disable all load controls until grouped
cursor pagination exists:

- normal Load older;
- Load older favorites;
- any future auto-load/infinite-load trigger.

Show a quiet helper text in Session/grouped view so the missing load controls do
not look like a bug:

```text
Session pagination is coming. Switch to Date view to load older images.
```

This helper should be localized, e.g. `gallery.sessionPaginationHint`.

#### MODIFY - `ui/src/i18n/en.json`
#### MODIFY - `ui/src/i18n/ko.json`

Add labels under the existing gallery namespace only.

Required additions include:

- `gallery.loadOlderFavorites`
- `gallery.sessionPaginationHint`

#### ADD/MODIFY - `tests/gallery-load-older-contract.test.js`

Add coverage:

- favorites mode has its own next cursor;
- Favorites load-more calls `favoritesOnly=1`;
- normal and favorites cursors do not overwrite each other;
- stale/overlapping loads cannot merge into the wrong mode;
- loaded older favorites raise `loadedHistoryRetainLimit`;
- old `.slice(0, HISTORY_LIMIT)` retention paths are replaced or guarded;
- all load controls are hidden/disabled in Session/grouped views.
- Session/grouped view renders `gallery.sessionPaginationHint`.
- When a query is active, load-more controls stay hidden or disabled so search
  remains scoped to loaded history unless server search is added later.

### Phase 2 - Server History Index/Cache

Goal: make repeated cursor pages cheap enough for large libraries.

#### NEW - `lib/historyIndex.ts`

Create a process-local generated-history index with TTL/invalidation:

```ts
getHistoryIndex(ctx): Promise<HistoryIndexSnapshot>
invalidateHistoryIndex(reason: string): void
```

Index fields:

```text
filename
createdAt
mtimeMs
metadata summary needed for gallery cards
```

Favorite state is not a global index field. It is overlaid per request from
`gallery_favorites` using `browser_id`, or served from a separate
browser-scoped favorite-set cache. The generated asset snapshot and favorite
overlay/cache must invalidate independently.

This index is not a thumbnail cache and not a persistent generated asset
database. It is a process-local history row snapshot used to avoid repeated full
filesystem metadata scans while `/api/history` pages remain bounded.

Rebuilds must be singleflighted so concurrent `/api/history` requests do not
trigger duplicate full filesystem scans. TTL is only a fallback for missed
external filesystem changes; explicit invalidation is the correctness path.
Initial TTL should be conservative, for example 2-5 seconds.

Invalidation candidates:

- new generation saved;
- delete/trash/permanent delete;
- favorite toggle;
- restore/import where applicable.

Explicit invalidation wiring must cover the actual generated-history writers and
removers:

- `routes/generate.ts` after successful generated image + sidecar write;
- `routes/multimode.ts` after each successful generated image + sidecar write;
- `routes/edit.ts` after successful edited image + sidecar write;
- `routes/nodes.ts` after node image persistence completes;
- `lib/localImportStore.ts` after import image + sidecar write;
- `lib/canvasVersionStore.ts` after canvas version image + sidecar write, even
  though UI hides `canvasVersion` rows;
- `lib/cardNewsGenerator.ts` after card image/manifest writes because
  `listHistoryRows()` includes card-news set rows;
- `lib/assetLifecycle.ts` after trash, permanent delete, and restore;
- `routes/history.ts` favorite toggle invalidates only the browser-scoped
  favorite overlay/cache, not the global asset snapshot, unless implementation
  deliberately combines both with correct browser scoping.

#### MODIFY - `routes/history.ts`

Use the index snapshot before slicing cursor pages.

Keep request size bounded. No `/api/history` request should ask for 5000 rows.

### Phase 3 - Virtualized Gallery

Goal: remove the need for a user-visible cap by rendering only visible rows.

Recommended dependency:

```text
@tanstack/react-virtual
```

Reason:

- cli-jaw uses `@tanstack/virtual-core` for direct DOM virtualization;
- ima2-gen Gallery is React, so `@tanstack/react-virtual` is the better fit.

Likely row model:

```ts
type GalleryVirtualRow =
  | { type: "header"; label: string }
  | { type: "tiles"; items: HistoryItem[] };
```

The UI should render only visible rows plus overscan, not thousands of tile
components at once.

Virtualization must replace current mounted-ref scroll assumptions:

- build a filename-to-virtual-row-index map;
- use the virtualizer's `scrollToIndex` when opening the gallery, changing
  selection, loading pages, or switching filters;
- keep stable row keys, not default index-only keys.

After this phase, large history browsing should work through virtualized cursor
pagination rather than a visible manual cap selector.

### Phase 4 - Session/Grouped Pagination

Goal: avoid mixing date-view pagination with session-grouped data.

Until implemented:

- Session/grouped view does not show load controls.
- It can keep the current safe bounded behavior.

When implemented:

- add grouped cursor support to the existing `groupBy=session` API path;
- add separate grouped next cursor state;
- ensure virtualized row mapping supports session headers and loose images.

## 5000-Scale Gate

Do not expose 5000-scale browsing as first-class behavior until all of these are
true:

- server history index/cache exists and invalidates on generation save,
  delete/trash/permanent delete, restore/import, and favorite toggle;
- no single `/api/history` request asks for 5000 rows;
- Date view and Favorites view are virtualized;
- Session view is either virtualized with grouped cursor support or remains
  bounded/disabled for large browsing;
- mounted DOM stays proportional to visible rows plus overscan;
- Windows 11 Edge and Chrome manual checks pass with 5000 generated entries,
  many favorites, hidden `canvasVersion` rows, mixed dates/sessions, stable
  selection/keyboard/delete/favorite behavior, and no repeatable gallery-render
  long tasks over the 50 ms browser long-task threshold.

## Questions for Next GPT Pro Gate

1. Is removing the manual 500/1000/2000 cap selector the right product decision
   if virtualization is the real large-gallery solution?
2. Is Phase 1 enough to finish #53 reachability before index/cache, or should
   Phase 2 index/cache come first?
3. Is `@tanstack/react-virtual` the correct dependency for Phase 3?
4. Are there remaining risks in current selection, visible-domain filtering,
   Favorites mode, hidden `canvasVersion` rows, or Session grouping?

## Verification Plan Draft

```bash
node --test tests/gallery-load-older-contract.test.js
node --import tsx --test tests/history-tombstone.test.ts
node --test tests/gallery-navigation-ux-contract.test.js
node --test tests/gallery-shortcuts-visible-domain-contract.test.js
npm run typecheck
cd ui && npx tsc -b --noEmit
npm run ui:build
npm test
```

Backend tests to add or extend:

- `tests/history-tombstone.test.ts`: `favoritesOnly` cursor pagination returns
  older favorites across cursor pages with no duplicates.
- `tests/history-tombstone.test.ts`: `/api/history?limit=9999` is clamped to
  `config.history.maxPageCap`.
- Phase 2 `tests/history-index.test.ts`: index invalidates on all
  generated-history writers/removers including card news and canvas versions.
- Phase 2 `tests/history-index-favorites.test.ts`: favorite overlay remains
  browser-scoped and never leaks through the global history index.

Frontend/source-contract tests to add or extend:

- `tests/gallery-load-older-contract.test.js`: store exposes
  `favoriteHistoryNextCursor`, `favoriteHistoryLoadingOlder`, and
  `loadOlderFavoriteHistory`.
- `tests/gallery-load-older-contract.test.js`: Favorites load-more calls
  `getHistory({ limit: HISTORY_LIMIT, cursor, favoritesOnly: true })`.
- `tests/gallery-load-older-contract.test.js`: Gallery reads
  `favoriteHistoryNextCursor` from the store and renders a localized
  `gallery.loadOlderFavorites` command only when `favoritesOnly && !showSessions
  && !query.trim()`.
- `tests/gallery-navigation-ux-contract.test.js` or
  `tests/gallery-load-older-contract.test.js`: Gallery load controls are
  extracted to a small colocated component, and `GalleryModal.tsx` remains under
  the existing line-count contract.
- `tests/gallery-load-older-contract.test.js`: store uses
  `loadedHistoryRetainLimit` and no longer has raw retention patterns like
  `[item, ...s.history].slice(0, HISTORY_LIMIT)` for explicitly loaded rows.
- `tests/gallery-session-scope-contract.test.js`: Gallery references
  `gallery.sessionPaginationHint`, and `en.json` / `ko.json` both define it.
- Phase 3 `tests/gallery-virtualization-contract.test.js`: package includes
  `@tanstack/react-virtual`, Gallery uses `useVirtualizer`, virtual rows use
  stable keys, selection scroll uses `scrollToIndex`, and date-group tile
  rendering no longer maps every loaded item into mounted DOM nodes.

Manual/browser checks after implementation:

```text
Open gallery with >500 generated entries.
Use Load older in Date/All view.
Switch to Favorites.
Use Load older favorites.
Verify current selected image remains stable.
Verify no horizontal overflow and no large scroll jank on Edge/Chrome.
```
