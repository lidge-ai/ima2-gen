# Issue #52 - Windows Gallery Feedback Split Plan

**GitHub**: https://github.com/lidge-ai/ima2-gen/issues/52
**Status**: done / archived to `_fin`
**Date**: 2026-05-06
**External review**: ChatGPT Pro via `agbrowse web-ai`, repo-link-only prompt

## Problem

Issue #52 bundles four related but differently sized reports from a Windows
11 / Edge / ima2-gen 1.1.10 user:

1. Gallery "Open folder" opens Documents instead of the generated image folder.
2. Gallery history is capped at 500 images, so older images and favorites past
   that cap are unreachable.
3. Queued/generating rows only show truncated prompts; the user also asks about
   canceling queued/generating work.
4. Home/End gallery navigation exists, but PgUp/PgDn partial navigation does
   not.

## Local Findings

### A. Windows Open Folder

`routes/storage.ts` calls `openDirectory(ctx.config.storage.generatedDir)` for
`POST /api/storage/open-generated-dir`.

`lib/openDirectory.ts` currently passes a manually quoted Windows argument to
Explorer:

```ts
spawnImpl(command, isWin ? [`"${dir}"`] : [dir], ...)
```

`tests/open-directory.test.ts` currently locks that behavior by asserting the
quoted argument.

Root-cause hypothesis: `child_process.spawn(command, args)` already passes each
entry as a single argument. Manual shell-style quotes can become literal quote
characters in the Explorer argument, causing Explorer to fail path resolution
and fall back to Documents.

### B. Gallery 500 Cap / Favorites

The cap is real in both client and server:

```ts
// ui/src/store/useAppStore.ts
const HISTORY_LIMIT = 500;
```

```ts
// config.ts
history.maxPageCap default = 500
```

`routes/history.ts` paginates rows and then marks `isFavorite`, so a favorite
outside the first 500 normal rows cannot be recovered by the current
client-side `favoritesOnly` filter.

`lib/historyList.ts` scans generated files and reads metadata before sorting,
so simply raising 500 to a much larger number is likely to increase latency and
memory usage on large galleries.

### C. In-Flight Prompt / Cancel

`ui/src/components/InFlightList.tsx` truncates prompts to 28 characters and
renders no `title`, tooltip, or full prompt affordance.

`ui/src/lib/api.ts` exposes `cancelInflight(requestId)`, and `routes/health.ts`
has `DELETE /api/inflight/:requestId`, but the route only calls:

```ts
finishJob(requestId, { canceled: true })
```

Generation adapters use internal timeout `AbortController`s. The inflight
delete route does not reach those controllers, so a visible Cancel button would
currently overpromise true upstream cancellation.

### D. PgUp / PgDn

`ui/src/hooks/useGalleryViewerNavigation.ts` maps only:

```ts
ArrowLeft, ArrowRight, Home, End
```

`ui/src/lib/galleryShortcuts.ts` supports only:

```ts
previous, next, first, last
```

PgUp/PgDn are not implemented.

## Pro Review Result

Initial ChatGPT Pro review returned:

```text
NEEDS_FIX
```

Interpretation: the root-cause analysis is plausible, but #52 should not be
treated as one large implementation. The safe plan is to patch small
correctness items immediately, then split larger gallery performance and true
cancel support into follow-up issues.

Key Pro guidance:

- Fix Windows open-folder first; this is the highest-confidence bug.
- Do not blindly raise the 500 cap. Use existing `cursor` support and add
  favorites-first/favorites-only retrieval.
- Add prompt hover/accessible full prompt now.
- Do not add a visible Cancel button unless backend abort propagation is real.
- Add PgUp/PgDn as fixed-step visible-gallery navigation.
- Thumbnail cache, indexing, date folding, configurable large limits, and real
  generation cancellation should be separate follow-ups.

Final short-form Pro gate returned:

```text
PASS
```

Approved reduced implementation scope:

```text
1. Windows Explorer raw path fix.
2. InFlightList full-prompt title/aria.
3. PgUp/PgDn fixed-step gallery navigation.
4. Create/link follow-up issues for gallery cap/favorites/performance and true
   cancellation before closing #52.
```

## Same-Day Patch Set for #52

### 1. Fix Windows Open Folder

#### MODIFY - `lib/openDirectory.ts`

Before:

```ts
const child = spawnImpl(command, isWin ? [`"${dir}"`] : [dir], {
  detached: !isWin,
  stdio: "ignore",
  windowsHide: !isWin,
});
```

After:

```ts
const child = spawnImpl(command, [dir], {
  detached: !isWin,
  stdio: "ignore",
  windowsHide: !isWin,
});
```

#### MODIFY - `tests/open-directory.test.ts`

Replace the Windows quoted-path contract:

```ts
assert.equal(calls[1].args[0], `"${dir}"`);
```

with:

```ts
assert.equal(calls[1].args[0], dir);
```

Rename the test from "quotes path with spaces" to "passes path with spaces as
one raw arg".

Add or update a regression case covering a Windows path with spaces and
non-ASCII characters.

### 2. Add In-Flight Full Prompt Hover

#### MODIFY - `ui/src/components/InFlightList.tsx`

Keep compact visible text, but expose the full prompt:

```tsx
const fullPrompt = f.prompt.trim().replace(/\s+/g, " ");

<li
  key={f.id}
  className="in-flight-item"
  data-phase={f.phase ?? "queued"}
  title={fullPrompt || phaseLabel}
  aria-label={`${phaseLabel}: ${fullPrompt || t("inflight.noPrompt")}`}
>
```

#### MODIFY - `ui/src/i18n/en.json`

Merge into the existing `inflight` object. Do not create a duplicate top-level
`inflight` key or replace the existing `queued`, `streaming`, and `decoding`
labels.

```json
"inflight": {
  "queued": "...",
  "streaming": "...",
  "decoding": "...",
  "noPrompt": "No prompt"
}
```

#### MODIFY - `ui/src/i18n/ko.json`

Merge into the existing `inflight` object. Do not create a duplicate top-level
`inflight` key or replace the existing phase labels.

```json
"inflight": {
  "queued": "...",
  "streaming": "...",
  "decoding": "...",
  "noPrompt": "프롬프트 없음"
}
```

#### NEW - `tests/inflight-list-tooltip-contract.test.js`

Contract checks:

- The full prompt is present in `title`.
- The row has an accessible full-prompt label.
- The visible text still uses truncation.
- No Cancel button is introduced in this patch.

### 3. Add PgUp / PgDn Gallery Navigation

#### MODIFY - `ui/src/lib/galleryShortcuts.ts`

Extend action type:

```ts
export type GalleryShortcutAction =
  | "previous"
  | "next"
  | "first"
  | "last"
  | "pagePrevious"
  | "pageNext";
```

Add a named fixed step:

```ts
const GALLERY_PAGE_STEP = 10;
```

Add clamped page movement after current-index resolution:

```ts
if (action === "pagePrevious" || action === "pageNext") {
  const delta = action === "pagePrevious" ? -GALLERY_PAGE_STEP : GALLERY_PAGE_STEP;
  const nextIndex = Math.max(0, Math.min(visibleHistory.length - 1, currentIndex + delta));
  return visibleHistory[nextIndex] ?? null;
}
```

#### MODIFY - `ui/src/hooks/useGalleryViewerNavigation.ts`

Extend key map:

```ts
PageUp: "pagePrevious",
PageDown: "pageNext",
```

Keep the existing guards:

- `uiMode === "classic"`
- `event.defaultPrevented`
- editable target ignored
- `currentImage` required

#### MODIFY - Existing gallery shortcut/navigation tests

Likely files:

- `tests/gallery-shortcuts-behavior.test.js`
- `tests/gallery-viewer-navigation-contract.test.js`
- `tests/gallery-shortcuts-visible-domain-contract.test.js`

Cases:

- `tests/gallery-shortcuts-behavior.test.js`
  - `pageNext` jumps forward by the fixed page step inside the visible gallery
    domain.
  - `pagePrevious` jumps backward by the fixed page step inside the visible
    gallery domain.
  - `pageNext` clamps at the last visible item.
  - `pagePrevious` clamps at the first visible item.
  - `pageNext` / `pagePrevious` skip hidden `canvasVersion` rows.
- `tests/gallery-shortcuts-visible-domain-contract.test.js`
  - Page movement uses the same visible-domain helper as Arrow/Home/End.
- `tests/gallery-viewer-navigation-contract.test.js`
  - `KEY_TO_ACTION` contains `PageUp: "pagePrevious"`.
  - `KEY_TO_ACTION` contains `PageDown: "pageNext"`.
  - Existing editable-target guard remains present, so PgUp/PgDn do not steal
    keyboard behavior from prompt inputs or text fields.

### 4. Gallery Favorites Rescue / Load Older

This is not part of the first low-risk patch. It must be split into a linked
GitHub follow-up unless Jun explicitly chooses to broaden #52 after the small
Windows/tooltip/navigation patch lands.

Operational requirement before closing #52:

```text
Create a follow-up GitHub issue for gallery cap/favorites retrieval/performance
and link it from #52.
```

No gallery history code is changed in the first #52 patch. The follow-up issue
must contain its own complete plan covering:

```text
- server API: favorites-only filter before pagination;
- client API: favoritesOnly and cursor params;
- store state: next cursor, loading older, merge-by-filename behavior;
- UI: Load older affordance;
- grouping/session behavior: explicitly included or explicitly deferred;
- tests: backend favorites pagination and frontend source contracts.
```

## Follow-Up Issues to Create Before Closing #52

These are operational follow-ups, not advisory notes. During implementation,
create GitHub issues for these larger tracks and link their numbers in the #52
closing comment. Do not close #52 unless these follow-ups exist or Jun
explicitly decides not to track them.

### Follow-up 1 - Gallery performance: thumbnail cache and generated asset index

Goal:

- Stop scanning and metadata-reading every generated image for every history
  page request.
- Build a thumbnail cache or manifest/index for generated assets.

Out of scope for #52 because it is architecture/performance work.

Tracked as part of:

- https://github.com/lidge-ai/ima2-gen/issues/53

### Follow-up 2 - Gallery browsing: date-collapsible and virtualized large gallery

Goal:

- Support thousands of generated images with virtualized rows/cards.
- Add collapsible date groups.
- Make page size configurable without unsafe default large loads.

Out of scope for #52 because the current issue can be answered with reachability
and pagination first.

Tracked as part of:

- https://github.com/lidge-ai/ima2-gen/issues/53

### Follow-up 3 - True generation cancellation: backend AbortController propagation

Goal:

- `DELETE /api/inflight/:requestId` must actually abort provider work.
- Thread request-scoped `AbortSignal` through classic, multimode, node, edit,
  OAuth/API adapters.
- Finish canceled jobs with a durable canceled terminal state.
- Prevent late images from canceled jobs from being written into history.

Out of scope for the in-flight tooltip patch.

Operational requirement before closing #52:

```text
Create a follow-up GitHub issue for real generation cancellation and link it
from #52. Do not add a visible Cancel button in the #52 patch.
```

Tracked as:

- https://github.com/lidge-ai/ima2-gen/issues/54

### Follow-up 4 - In-flight cancellation UI

Goal:

- Add visible Cancel buttons only after true backend cancellation exists.
- Show canceling/canceled phases accurately.

Depends on Follow-up 3.

Tracked as part of:

- https://github.com/lidge-ai/ima2-gen/issues/54

### Follow-up 5 - Session/grouped gallery pagination

Goal:

- Remove hardcoded `limit: 500` in grouped/session gallery paths.
- Support Load older within session/grouped views.

Can be done with the #52 pagination work if small, but should split if grouped
state makes the patch too broad.

Tracked as part of:

- https://github.com/lidge-ai/ima2-gen/issues/53

## Pro Gate Fixes Applied 2026-05-06

ChatGPT Pro returned `NEEDS_FIX` for the first complete plan gate. Required
edits applied here:

```text
1. i18n patch now explicitly merges "noPrompt" into existing inflight objects.
2. PgUp/PgDn tests are explicit by test file and behavior.
3. Follow-up issue creation/linking is now an operational requirement before
   closing #52, not just advisory guidance.
4. Gallery cap/favorites and true cancellation are split out unless Jun
   explicitly broadens the patch.
5. Second Pro gate found a Section 4 contradiction; gallery implementation diff
   was removed from the first #52 patch and converted to a follow-up issue
   requirement.
6. In-flight tooltip testing is explicitly source-contract based because this
   repo does not currently use React Testing Library/jsdom for that component.
7. #52 closure semantics are explicit: close only after follow-up issues are
   created and linked, otherwise leave #52 open.
8. Final short-form Pro gate returned `PASS` for the reduced scope.
9. Follow-up issues were created: #53 for gallery cap/favorites/performance and
   #54 for true in-flight cancellation.
```

## Closeout 2026-05-07

This split plan is complete.

- #52 is closed with `status: split`.
- Same-day low-risk items shipped: Windows generated-folder opening, in-flight
  prompt hover/accessibility, and PgUp/PgDn gallery navigation.
- Follow-up issues were created and linked: #53 for gallery cap/favorites scale
  and #54 for true in-flight cancellation.
- #53/#54 implementation work landed afterward; #53 remains the active place for
  dynamic gallery depth, index/cache, and virtualization planning.

## #52 Closure Semantics

The same-day patch fixes only the low-risk parts of the report:

```text
1. Windows generated folder opening;
2. in-flight full-prompt hover/accessibility;
3. PgUp/PgDn gallery navigation.
```

Do not close #52 as fully fixed unless the closing comment explicitly states
that the larger gallery cap/favorites/performance and real-cancel requests were
split into linked follow-up issues. If those follow-ups are not created, leave
#52 open.

## Acceptance Criteria for Closing #52 Same-Day Patch

```text
- Windows 11 Gallery -> Open Folder opens the configured generated directory,
  not Documents.
- Windows open-directory tests assert raw spawn args, including paths with
  spaces/non-ASCII.
- In-flight rows expose the full prompt through hover/title and an accessible
  label while keeping compact visible text.
- PgUp/PgDn move by a bounded partial step and clamp at first/last.
- Home/End and ArrowLeft/ArrowRight behavior remain unchanged.
- Editable fields still ignore gallery keyboard shortcuts.
- Linked follow-up issues exist for gallery cap/favorites/performance and real
  generation cancellation, or #52 remains open.
- No visible Cancel button claims true cancellation unless backend abort
  propagation is implemented.
```

## Verification Plan

Focused checks:

```bash
node --test tests/open-directory.test.ts
node --test tests/gallery-shortcuts-behavior.test.js tests/gallery-viewer-navigation-contract.test.js
node --test tests/inflight-list-tooltip-contract.test.js
```

`tests/inflight-list-tooltip-contract.test.js` is a source-contract test using
`readFileSync`/regex, not a React Testing Library/jsdom test. It must assert:

```text
- `fullPrompt` normalization exists;
- `title={...}` exposes the full prompt;
- `aria-label={...}` exposes phase + full prompt;
- visible text still calls `truncate(f.prompt)`;
- no visible Cancel button is introduced.
```

Project checks:

```bash
npm test
cd ui && npx tsc -b --noEmit
cd ui && npm run build
```

Manual Windows check:

```text
Windows 11 / Edge / ima2-gen
Gallery -> Open Folder
Expected: %USERPROFILE%\.ima2\generated or configured generatedDir opens.
```

## Non-Goals

```text
- Implement thumbnail cache inside #52.
- Implement generated-asset index inside #52.
- Add date-collapsible virtualized gallery inside #52.
- Add Cancel UI before backend cancellation is real.
- Raise the gallery cap blindly.
- Commit or push this planning document unless explicitly requested.
```
