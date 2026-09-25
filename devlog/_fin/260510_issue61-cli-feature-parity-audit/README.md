---
title: "Issue #61 — CLI Feature Parity Audit"
status: planned / P phase
created: 2026-05-10
github: https://github.com/lidge-ai/ima2-gen/issues/61
tags: [cli, parity, web-search, structure]
---

# Issue #61 — CLI Feature Parity Audit

## Summary

Jun raised that the `ima2` CLI may have fallen behind the browser UI and server API, especially around web-search options. The audit found that request-level web-search flags are wired for the main generation commands, but the CLI surface has real parity gaps around provider selection, multimode references, multimode prompt mode, masked edit input, favorites pagination, and inflight kind documentation.

GitHub issue:

- https://github.com/lidge-ai/ima2-gen/issues/61

## What Was Checked

CLI command sources:

- `bin/commands/gen.ts`
- `bin/commands/edit.ts`
- `bin/commands/multimode.ts`
- `bin/commands/node.ts`
- `bin/commands/ps.ts`
- `bin/commands/ls.ts`

Server/API sources:

- `routes/generate.ts`
- `routes/edit.ts`
- `routes/multimode.ts`
- `routes/nodes.ts`
- `routes/history.ts`
- `routes/health.ts`
- `lib/providerOptions.ts`

UI references:

- `ui/src/components/WebSearchToggle.tsx`
- `ui/src/components/ProviderSelect.tsx`
- `ui/src/store/useAppStore.ts`
- `ui/src/lib/api.ts`

Existing tests:

- `tests/web-search-toggle-contract.test.js`
- `tests/api-provider-parity.test.ts`
- `tests/cli-commands.test.js`

## Findings

### Web Search

`--web-search` and `--no-web-search` are present in:

- `ima2 gen`
- `ima2 edit`
- `ima2 multimode`
- `ima2 node generate`

Each command validates mutual exclusion and maps the request to `webSearchEnabled` in the JSON body. Server routes pass the raw request setting through `resolveProviderOptions(...)`.

Important nuance: for the API-key provider, `--web-search` cannot override an administrative/global disable. `resolveProviderOptions(...)` only enables API web search when `apiProvider.allowWebSearch !== false`, the request did not set `webSearchEnabled: false`, and search mode is not `"off"`. That means the flag works as a request override, but `IMA2_API_ALLOW_WEB_SEARCH=false` still wins.

### Confirmed CLI Drift

The CLI is not fully caught up with the browser/server surface:

- `ima2 ps --help` still documents `--kind classic|node`, while `/api/inflight` and the UI now support `kind=multimode`.
- Generation CLI commands do not expose `--provider <auto|oauth|api>` even though the server routes and UI provider selector support per-request provider selection.
- `ima2 multimode` does not expose `--ref <file>`, while `/api/generate/multimode` and the UI support references.
- `ima2 multimode` does not expose `--mode <auto|direct>`, while the server route accepts prompt mode.
- `ima2 edit` does not expose `--mask <png>`, while `/api/edit` and Canvas Mode have mask plumbing. #61 will explicitly defer this to #31 instead of exposing a CLI mask option now, because current behavior is guided edit rather than guaranteed true masked/inpaint semantics.
- `ima2 ls --favorites` fetches a normal history page and filters client-side, while `/api/history` now supports `favoritesOnly=1`. The current CLI can miss older favorites.
- No focused CLI source-contract test currently locks `webSearchEnabled` request-body mapping across all generation commands.

## Proposed Implementation Slices

### Slice A — Lock Existing Web Search CLI Behavior

- Add CLI source-contract tests for `gen`, `edit`, `multimode`, and `node generate`.
- Assert that `--web-search` maps to `webSearchEnabled: true`.
- Assert that `--no-web-search` maps to `webSearchEnabled: false`.
- Assert mutual exclusion errors stay in place.
- Document the API-provider global gate behavior.

### Slice B — Inflight And Favorites Parity

- Update `ima2 ps --help` and related tests to include `multimode`.
- Update `ima2 ls --favorites` to call `/api/history?favoritesOnly=1`.
- Add test coverage so older favorites are not lost by client-side filtering.

### Slice C — Generation Option Parity

- Add `--provider <auto|oauth|api>` where matching server routes accept `provider`.
- Add `--ref <file>` and `--mode <auto|direct>` to `ima2 multimode`.
- Keep request-body compatibility with `/api/generate/multimode`.
- Add tests for CLI request payload shape.

### Slice D — Masked Edit CLI Decision

- Defer `ima2 edit --mask <png>` until #31 is fully closed.
- Document the intentional omission in the public CLI docs and structure docs.
- Do not add a `mask` flag in #61 tests or implementation.

## Structure Updates

This investigation also refreshed the structure docs to match current code:

- `structure/01-file-function-map.md`
- `structure/02-command-reference.md`
- `structure/03-server-api.md`
- `structure/07-devlog-map.md`

## PABCD Diff Plan

### Part 1 — User-Facing Behavior

After this work, the CLI should stop feeling like an older shell around a newer app. Web-search flags will be locked by tests, `ps`/`inflight` will understand multimode jobs in help and tests, favorites listing will use the same server-side pagination as the Gallery, and generation commands will expose the provider and multimode options that the server/UI already support. Masked edit will stay deferred to #31, with public docs explaining that `ima2 edit --mask` is intentionally not part of #61.

### Part 2 — Diff-Level Plan

#### MODIFY `bin/commands/gen.ts`

Before:

- `SPEC.flags` has `model`, `mode`, `moderation`, `session`, `reasoning-effort`, and web-search flags.
- Request body does not include `provider`.
- Help text does not mention provider override.

After:

- Add `provider: { type: "string" }` to `SPEC.flags`.
- Validate provider against `auto`, `oauth`, `api`.
- Add `provider: args.provider` to the `/api/generate` body only when provided.
- Help text gains:

```text
        --provider <auto|oauth|api>          Provider for this request; api requires a configured API key
```

Test coverage:

- New CLI source-contract test checks `gen` exposes provider in the flag spec/help and forwards it to the body.
- Existing behavior for `--web-search` / `--no-web-search` remains unchanged.

#### MODIFY `bin/commands/edit.ts`

Before:

- Request body supports `model`, `mode`, `moderation`, `session`, `reasoningEffort`, and `webSearchEnabled`.
- CLI cannot set `provider`.
- CLI cannot set `mask`.

After:

- Add `provider: { type: "string" }` and validate `auto|oauth|api`.
- Add `if (args.provider) editBody.provider = args.provider` before calling `/api/edit`.
- Do not add a `mask` flag in #61.
- Add a short docs note in `structure/02-command-reference.md` and `docs/CLI.md` that CLI masked edit remains deferred to #31.
- Reason: current server validation is safe, but behavior is still guided edit rather than guaranteed true masked/inpaint semantics.

#### MODIFY `bin/commands/multimode.ts`

Before:

- `SPEC.flags` has `quality`, `size`, `max-images`, output flags, model, reasoning effort, web-search, moderation, session, and `show-partial`.
- Request body does not include `provider`, `references`, or `mode`.

After:

- Add:

```ts
provider: { type: "string" },
mode: { type: "string", default: "auto" },
ref: { type: "string", repeatable: true },
```

- Validate:
  - `provider`: `auto | oauth | api`
  - `mode`: `auto | direct`
  - refs max 5, same as classic generation
- Convert refs with `fileToDataUri(...)`.
- Request body includes:

```ts
if (args.provider) body.provider = args.provider;
body.mode = args.mode;
body.references = references;
```

`provider` is omitted when not provided. `references` is always an array; empty when no refs exist.

- Help text gains:

```text
        --provider <auto|oauth|api>
        --mode <auto|direct>
        --ref <file>                    Attach reference image (repeatable, max 5)
```

#### MODIFY `bin/commands/node.ts`

Before:

- Node generate already supports `--ref`, `--parent`, reasoning effort, and web-search.
- It does not expose `--provider`, even though `/api/node/generate` accepts `provider`.

After:

- Add `provider: { type: "string" }` to `GEN_FLAGS`.
- Validate provider against `auto`, `oauth`, `api`.
- Include `if (args.provider) body.provider = args.provider` when provided.
- Add provider line to `HELP`.
- Keep node `searchMode` behavior unchanged; this plan does not redesign node context/search policy.

#### MODIFY `bin/commands/ps.ts`

Before:

```text
ima2 ps [--kind classic|node] [--session id] [--terminal] [--json]
```

After:

```text
ima2 ps [--kind classic|node|multimode] [--session id] [--terminal] [--json]
```

- Do not hard-reject unknown kinds unless A-phase reviewers ask for validation.
- Reason: `/api/inflight` accepts a free string filter today, and this patch should not introduce a new behavior break for existing scripts.

#### MODIFY `bin/commands/observability.ts`

Before:

```text
inflight ls [--kind <k>] [--session <id>] [--terminal] [--json]
```

After:

```text
inflight ls [--kind classic|node|multimode] [--session <id>] [--terminal] [--json]
```

- This is help/documentation parity with `ps`.
- Runtime query behavior remains unchanged.

#### MODIFY `bin/commands/ls.ts`

Before:

- `--favorites` fetches a normal `/api/history?limit=...` page and filters client-side:

```ts
if (args.favorites) items = items.filter((it) => it.isFavorite === true);
```

After:

- When `--favorites` is set, add `favoritesOnly=1` to query params.
- Keep client-side `isFavorite === true` filter as a defensive last check, but no longer rely on it for reachability.
- Preserve `--session` interaction by sending both `sessionId` and `favoritesOnly=1` when both are present.

#### MODIFY `structure/02-command-reference.md`

Before:

- Documents current known drift after the investigation.

After:

- Update from "known follow-up gap" to implemented behavior for:
  - provider override
  - multimode refs/mode
  - `ps`/`inflight` multimode help
  - `ls --favorites` server-side filter
- Keep masked-edit note aligned with the final implementation decision.
- Add provider semantics:
  - `api` forces the API-key Responses path and requires a configured API key.
  - `oauth` forces the local OAuth proxy path.
  - `auto` preserves the route default and currently resolves to OAuth unless server routing changes.
- Add the public note that `ima2 edit --mask` remains deferred to #31.

#### MODIFY `structure/03-server-api.md`

Before:

- Documents server API accurately after the investigation.

After:

- Only update if B changes CLI docs that require clarifying API/CLI relationship.
- No endpoint shape change is planned in this issue.

#### MODIFY `docs/CLI.md`

Before:

- Public CLI reference omits `--provider`.
- It documents generic generation flags without explaining the new multimode `--ref` / `--mode` support.
- It documents inflight kinds as `classic|node`.

After:

- Add `--provider <auto|oauth|api>` to generation command documentation.
- Add provider semantics:
  - `api` forces the API-key Responses path and requires a configured API key.
  - `oauth` forces the local OAuth proxy path.
  - `auto` preserves route default behavior and currently resolves to OAuth unless server routing changes.
- Document multimode-specific `--ref <file>` and `--mode <auto|direct>`.
- Update inflight kind docs to `classic|node|multimode`.
- Mention `ima2 ls --favorites` uses server-side favorites filtering.
- Mention `ima2 edit --mask` is intentionally deferred to #31.

#### MODIFY `README.md`

Before:

- README links to `docs/CLI.md` as the full CLI reference.

After:

- Check README CLI examples for contradiction with #61 changes.
- Only edit README if an example or summary now conflicts with the updated CLI surface.
- If no contradiction exists, leave README unchanged and rely on `docs/CLI.md` for option-level detail.

#### MODIFY `structure/07-devlog-map.md`

Before:

- Marks #61 as investigated.

After:

- Mark #61 as planned/in-progress or shipped depending on B/C result.

#### MODIFY `devlog/_plan/260510_issue61-cli-feature-parity-audit/README.md`

Before:

- Investigation record plus P plan.

After:

- Add A audit results after plan audit.
- Add B implementation notes and verification evidence after build.
- Move to `_fin` only after implementation ships and #61 is closed.

#### ADD `tests/cli-feature-parity-contract.test.js`

Purpose:

- Source-level contract test that does not call upstream providers.
- Locks CLI flag/body/help parity so these options cannot drift again.

Required assertions:

- `gen.ts`
  - contains `provider` flag
  - validates provider values
  - forwards `provider` in body
  - still maps `--web-search` / `--no-web-search` to `webSearchEnabled`
- `edit.ts`
  - contains `provider` flag
  - forwards `provider` in body
  - web-search mapping remains
  - does not add a `mask` flag in #61
  - docs mention masked edit remains deferred to #31
- `multimode.ts`
  - contains `provider`, `mode`, and repeatable `ref`
  - imports and uses `fileToDataUri`
  - caps refs at 5
  - converts refs with `fileToDataUri`
  - forwards `provider`, `mode`, and `references`
  - web-search mapping remains
- `node.ts`
  - contains `provider` flag
  - forwards `provider`
  - web-search mapping remains
- `ps.ts` and `observability.ts`
  - help includes `classic|node|multimode`
- `ls.ts`
  - `--favorites` sends `favoritesOnly=1`
  - defensive `isFavorite === true` filtering remains

#### MODIFY `tests/cli-commands.test.js`

Before:

- Live CLI smoke covers basic help, reachability, `ps`, `cancel`, and empty history.

After:

- Extend help assertions where low-risk:
  - `ima2 gen --help` includes `--provider`
  - `ima2 edit --help` includes `--provider`
  - `ima2 multimode --help` includes `--provider`, `--mode`, and `--ref`
  - `ima2 ps --help` includes `multimode`
- Do not add live provider/upstream calls here.

#### Optional MODIFY `tests/web-search-toggle-contract.test.js`

Before:

- Covers UI/server/provider web-search behavior.

After:

- Usually leave unchanged.
- Only touch if A-phase reviewers prefer CLI web-search assertions to live near the existing web-search contract instead of in the new CLI parity contract test.

## Plan Audit Targets

Send A-phase read-only audits to:

- `료`: backend/API/CLI request-body audit. Ask whether provider/ref/mode/favorites/mask decisions match server routes and whether any CLI behavior break is hidden.
- `니지카`: UX/help/docs audit. Ask whether help text, user-facing semantics, and structure/devlog docs are clear and whether no UI behavior is accidentally implied.

Audit incorporation, 2026-05-10:

- Backend/API/CLI request-body audit: PASS.
- Help/docs/user-facing audit: initially FAIL because `docs/CLI.md` was missing and provider wording was vague.
- Plan revised to include `docs/CLI.md`, README contradiction check, explicit provider semantics, and definite `edit --mask` deferral to #31.
- Help/docs/user-facing re-audit: PASS. No blocking issues remain.

## Verification Plan

Targeted:

```bash
node --test tests/cli-feature-parity-contract.test.js tests/cli-commands.test.js tests/web-search-toggle-contract.test.js
```

Static/build:

```bash
npm run typecheck
npm run typecheck:tests
git diff --check
```

If implementation touches docs inventory or runtime inventory:

```bash
npm run test:inventory
```

Full test only if A/B changes broaden beyond CLI/docs:

```bash
npm test
```

## Status

C/D checks passed locally. Implementation is complete but not committed or pushed.

## B Implementation Notes, 2026-05-11

Implemented:

- `gen`, `edit`, `multimode`, and `node generate` now accept and validate `--provider <auto|oauth|api>` and forward it to the matching request body only when provided.
- `multimode` now accepts `--mode <auto|direct>` and repeatable `--ref <file>` with a max of 5 references; refs are converted with `fileToDataUri(...)` and sent as `references`.
- `ps` and `inflight ls` help now document `classic|node|multimode`.
- `ls --favorites` sends `favoritesOnly=1` to `/api/history` and keeps a defensive `isFavorite === true` client filter.
- `edit --mask` was not added and remains deferred to #31.
- `docs/CLI.md`, `structure/00-structure-hub.md`, `structure/01-file-function-map.md`, `structure/02-command-reference.md`, `structure/07-devlog-map.md`, and `docs/migration/runtime-test-inventory.md` were updated to match the new CLI surface.

Verification run so far:

```bash
node --test tests/cli-feature-parity-contract.test.js tests/cli-commands.test.js tests/web-search-toggle-contract.test.js
# 29 pass, 0 fail

npm run typecheck
# pass

npm run typecheck:tests
# pass

npm run test:inventory
# pass after regenerating docs/migration/runtime-test-inventory.md

npm run build:cli
# pass

npm run build:server
# pass

git diff --check
# pass
```

## C Check Notes, 2026-05-11

Fresh final checks after B approval:

```bash
npm run typecheck
# pass

npm run typecheck:tests
# pass

npm run test:inventory
# pass

npm run build:cli
# pass

npm run build:server
# pass

git diff --check
# pass
```
