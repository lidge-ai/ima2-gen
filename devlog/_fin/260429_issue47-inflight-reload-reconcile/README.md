# Issue #47 - In-flight Reload Reconcile

**GitHub**: https://github.com/lidge-ai/ima2-gen/issues/47
**Status**: completed / moved to _fin
**Date**: 2026-04-29

## Closeout Status — 2026-05-16

GitHub #47 is closed and this folder is archived in `_fin`.

Evidence:

- The issue comment records implementation by `74b8b57`.
- `tests/inflight-reload-race.test.js` and
  `tests/inflight-reload-reconcile-contract.test.js` cover stale spinner and
  server-active reconciliation behavior.
- Current code initializes local active generation display from server
  reconciliation rather than rendering stale persisted rows as live work.

## Problem

After a hard reload such as Cmd+Shift+R, the UI can briefly render generation
spinners from `localStorage` and then remove them once `/api/inflight`
reconciliation discovers that the server has no matching active or terminal
job.

This makes stale requests look like live work for about one polling tick. It
also makes post-reload debugging weak because terminal job snapshots are
memory-only and expire after 30 seconds.

## Root Cause

Current frontend boot order:

```text
useAppStore initial state
  -> activeGenerations = loadInFlight().length
  -> inFlight = loadInFlight()
  -> InFlightList renders immediately
  -> App useEffect calls reconcileInflight()
  -> stale local jobs are dropped
```

Current server terminal observability:

```text
finishJob() writes terminalJobs Map only
terminalTtlMs default = 30 seconds
terminalJobs disappear quickly after completion/failure
```

## Target Behavior

```text
1. Hard reload must not render stale local in-flight jobs as real active work.
2. Genuine server-active jobs must still reappear after reconciliation.
3. Terminal snapshots must remain inspectable for a practical reload/debug window.
4. The UI must still preserve out-of-scope local jobs during scoped reconciliation.
```

## Diff-Level Plan

### MODIFY - `ui/src/store/useAppStore.ts`

Before:

```ts
activeGenerations: loadInFlight().length,
inFlight: loadInFlight(),
```

After:

```ts
activeGenerations: 0,
inFlight: [],
```

Then `reconcileInflight()` uses persisted local state as its input snapshot:

```ts
const local = get().inFlight.length > 0 ? get().inFlight : loadInFlight();
```

This prevents pre-reconcile rendering while preserving request IDs and
out-of-scope jobs during the first reconciliation pass.

Polling must also restore server-only active jobs after terminal cleanup:

```ts
const nextIds = new Set(nextInflight.map((f) => f.id));
for (const j of jobs) {
  if (!nextIds.has(j.requestId)) {
    nextInflight.push(toPersistedInFlightJob(j));
    changed = true;
  }
}
```

This covers reload/abort races where one terminal job is removed from local UI
state while other backend jobs keep streaming but no longer have matching local
request IDs.

Polling TTL pruning must not remove jobs that the server still reports as
active:

```ts
const scopedActiveServerIds = new Set(jobs.map((j) => j.requestId));
const remaining = get().inFlight.filter(
  (f) => scopedActiveServerIds.has(f.id) || now - f.startedAt < INFLIGHT_TTL_MS,
);
```

This covers long-running backend streams where a server-only active job is older
than the local UI TTL. Without this guard, each polling tick can re-add the
server-active job and then immediately remove it, causing visible spinner
flicker around `/api/history` refreshes.

### MODIFY - `config.ts`

Before:

```ts
terminalTtlMs: ... 30 * 1000
```

After:

```ts
terminalTtlMs: ... 5 * 60 * 1000
```

Environment/config overrides continue to work through
`IMA2_INFLIGHT_TERMINAL_TTL_MS` and `fileCfg.inflight.terminalTtlMs`.

### MODIFY - `tests/inflight.test.js`

Add a regression test that proves terminal jobs survive at least 60 seconds and
are reaped after the configured 5 minute default window.

### NEW - `tests/inflight-reload-reconcile-contract.test.js`

Add a source-level contract test that locks the reload behavior:

```text
- initial store state does not call loadInFlight() for activeGenerations;
- initial store state does not call loadInFlight() for inFlight;
- reconcileInflight() explicitly uses loadInFlight() as the first-pass local snapshot;
- polling re-adds server-only active jobs after terminal cleanup;
- polling TTL prune keeps server-active jobs even after the local TTL expires;
- App.tsx still calls reconcileInflight() on mount.
```

## Acceptance Criteria

```text
- Reload no longer flashes stale local spinners before the first server reconcile.
- Server-active jobs still restore through /api/inflight.
- Long-running server-active jobs do not flicker out during polling TTL prune.
- Terminal completion/error/cancel snapshots remain visible for 5 minutes by default.
- Focused tests pass.
- Typecheck passes.
```

## Non-Goals

```text
- Persist terminal jobs to SQLite.
- Add a new visible "checking in-flight" UI state.
- Change generation request lifecycle semantics.
- Commit or push.
```

---

## STATUS 2026-04-30 — Partially shipped

Shipped commit on `main`:

- `74b8b57` `fix(inflight): avoid stale reload spinners` — primary fix for
  the user-visible "stale spinner after reload" symptom; on reload the
  client now reconciles `ima2.inFlight` against `/api/inflight` server
  truth and drops orphan rows whose request id is unknown to the server.

### Remaining work

1. Extended terminal TTL — server should retain terminal job records long
   enough to cover a reload that happens during the result toast window
   (currently a 5s grace; make it configurable, ~30s).
2. Polling guard — when only server-side active jobs remain (no local
   `inFlight` rows) the polling interval should back off to keep CPU low
   on idle tabs.
3. Race-condition test — add a `tests/inflight-reload-race.test.js` that
   simulates a reload mid-generation and asserts the client neither shows
   a stale spinner nor drops a real in-flight job.

When (1) (2) (3) land, this folder graduates to `_fin/`.
