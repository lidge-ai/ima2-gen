---
title: "Issues 64-70 + 59 Hardening Closeout"
status: completed / moved to _fin
created: 2026-05-15
project_root: /Users/jun/Developer/new/700_projects/ima2-gen
tags: [pabcd, cli, skill, ux, packaging, gallery, multimode, node-mode]
issues:
  - https://github.com/lidge-ai/ima2-gen/issues/64
  - https://github.com/lidge-ai/ima2-gen/issues/65
  - https://github.com/lidge-ai/ima2-gen/issues/66
  - https://github.com/lidge-ai/ima2-gen/issues/67
  - https://github.com/lidge-ai/ima2-gen/issues/68
  - https://github.com/lidge-ai/ima2-gen/issues/69
  - https://github.com/lidge-ai/ima2-gen/issues/70
  - https://github.com/lidge-ai/ima2-gen/issues/59
---

# Issues 64-70 + 59 Hardening Closeout

## Part 1 Summary

This PABCD pass turns the research split into implementation slices: CLI/Skill
discovery, prompt import CLI parity, destructive command safety, doctor/status
diagnostics, package/release hardening, first-run readiness popup, first-node button,
Gallery modal hardening, and Multimode sequence UX. The work is intentionally
split into small commits and verification gates because it touches CLI,
server capability metadata, UI, package scripts, and tests. Issues #31, #27, and
#28 remain separate Canvas feature plans; this pass only creates the shared
current-image action foundation needed by #59 and later Canvas exports.

## Closeout Status — 2026-05-16

This folder has moved from `_plan` to `_fin` because the implementation slices
are present in local code and covered by contracts.

| Issue | Completion evidence |
|---|---|
| #64 | `lib/capabilities.ts`, `bin/ima2.ts`, `bin/commands/config.ts`, `skills/ima2/SKILL.md`, `tests/cli-config-keys-contract.test.js`, `tests/cli-capabilities-contract.test.js`. |
| #70 | `bin/commands/prompt.ts`, `docs/CLI.md`, `skills/ima2/SKILL.md`, `tests/cli-prompt-import-contract.test.js`. |
| #66 | `bin/lib/destructive-confirm.ts`, `bin/ima2.ts`, `bin/commands/config.ts`, `bin/lib/doctor-checks.ts`, `tests/cli-destructive-safety-contract.test.js`, `tests/cli-doctor-status-contract.test.js`. |
| #67 | `LICENSE`, `package.json`, `.github/workflows/ci.yml`, `scripts/publish-dry-run.mjs`, release scripts, `tests/package-smoke.test.js`. |
| #65 | `ui/src/components/ProviderReadinessPopup.tsx`, `GenerateButton.tsx`, `SettingsWorkspace.tsx`, `tests/current-image-actions-readiness-contract.test.js`. |
| #59 | `ui/src/components/ResultActions.tsx`, `ui/src/store/useAppStore.ts`, `tests/current-image-actions-readiness-contract.test.js`. |
| #68 | `ui/src/components/GalleryModal.tsx`, `ui/src/lib/galleryNavigation.ts`, gallery load/dedupe contracts. |
| #69 | `ui/src/components/MultimodeSequencePreview.tsx`, `ui/src/store/useAppStore.ts`, `tests/multimode-ui-contract.test.js`. |

The broader issue matrix and remaining open Canvas work are recorded in:

- `devlog/_fin/260516_gh-issue-hardening-jawdev/README.md`

## GitHub Issue State

Completed before this P plan:

- #60 closed as shipped; residual UX split to #69.
- #63 closed as shipped; residual Gallery modal UX split to #68.
- #62 closed as shipped; hardening split to #64, #65, #66, #67, #70.

Open implementation scope for this PABCD:

| Issue | Scope |
|---|---|
| #64 | CLI/Skill agent discovery, help, examples, capabilities/config keys |
| #70 | Prompt import JSON/preview CLI wrappers |
| #66 | Destructive command confirmation and doctor/status hardening |
| #67 | LICENSE/package manifest/publish dry-run/release script guards |
| #65 | UI provider/capability readiness popup for first-run users |
| #59 | Generate current image as first Node Mode root via visible button |
| #68 | Gallery modal delete aftercare, duplicate identity, large-session UX |
| #69 | Multimode sequence cancel/partial/status UX |

## `--help` Investigation Snapshot

Commands checked:

```bash
node bin/ima2.js --help
node bin/ima2.js capabilities --help
node bin/ima2.js defaults --help
node bin/ima2.js config --help
node bin/ima2.js skill --help
node bin/ima2.js gen --help
node bin/ima2.js multimode --help
node bin/ima2.js inflight --help
node bin/ima2.js prompt --help
```

Findings:

- `gen` and `multimode` now expose provider, model, direct mode, moderation,
  reasoning effort, web search, refs, quality, size, and output paths.
- `capabilities`, `defaults`, and `skill` exist and are usable.
- Top-level help still does not teach global server discovery and env overrides
  clearly enough for an agent.
- `config --help` lists `set/rm`, but does not expose the writable key list.
- `prompt --help` has curated/discovery/folder import paths, but not generic JSON
  import or preview wrappers.

## Implementation Slices

### Slice 1 — CLI/Skill Discovery (#64)

#### MODIFY `lib/capabilities.ts`

Before:

- `valid` exposes `imageModels`, `reasoningEfforts`, and `quality`.
- `commands` is a short flat list.
- No writable config key metadata.

After:

- Add `valid.modes = ["auto", "direct"]`.
- Add `valid.moderation = ["auto", "low"]`.
- Add `valid.providers = ["auto", "oauth", "api"]`.
- Add `configKeys.writable` from `WRITABLE_CONFIG_KEYS`.
- Add `configKeys.envOverrides` from `KEY_TO_ENV`.
- Keep allowlist projection only; never return raw `ctx.config`.

#### MODIFY `bin/commands/capabilities.ts`

Before:

- Text mode prints defaults, models, reasoning, quality, and limits.

After:

- Print modes, moderation, providers, and config key discovery hints.
- Keep JSON output unchanged except for additive fields.

#### MODIFY `bin/commands/config.ts`

Before:

- Subcommands: `path`, `ls`, `get`, `set`, `rm`.

After:

- Add `keys [--json]`.
- Text output lists writable keys and env override names.
- JSON output:

```json
{
  "keys": ["imageModels.default"],
  "envOverrides": { "imageModels.default": "IMA2_IMAGE_MODEL_DEFAULT" }
}
```

#### MODIFY `bin/ima2.ts`

Before:

- Top-level help lists commands and examples.
- It does not clearly mention `--server`, `IMA2_SERVER`, config dir, generated
  dir, Card News, log level, or server advertisement.

After:

- Add a compact `Global discovery` / `Useful env` block:
  - `--server <url>`
  - `IMA2_SERVER`
  - `~/.ima2/server.json`
  - `IMA2_CONFIG_DIR`
  - `IMA2_GENERATED_DIR`
  - `IMA2_CARD_NEWS`
  - `IMA2_LOG_LEVEL`

#### MODIFY `skills/ima2/SKILL.md`

Before:

- Covers first commands, generation, references, parallel generation,
  defaults, high quality, and visible text.

After:

- Add `Watching Jobs` section with `ima2 inflight ls --json`.
- Add multimode SSE flow: `phase -> partial -> image -> done/error`.
- Add `History Import` example.
- Add server discovery/recovery:
  - `ima2 status`
  - `ima2 doctor`
  - `ima2 capabilities --require-server --json`
  - `IMA2_SERVER` / `--server`

#### MODIFY `docs/CLI.md`

Document the new `config keys`, enhanced help, and skill examples.

#### TESTS

- MODIFY `tests/cli-capabilities-contract.test.js`
- MODIFY `tests/cli-skill-command-contract.test.js`
- MODIFY `tests/bin.test.js`
- ADD `tests/cli-config-keys-contract.test.js`

### Slice 2 — Prompt Import CLI Parity (#70)

#### MODIFY `bin/commands/prompt.ts`

Before:

- Import subcommands: `sources`, `refresh`, `curated`, `discovery`, `folder`.

After:

- Add `import json <file|@file|-> [--folder <id>] [--dry-run] [--json]`.
- Add `import preview <file|@file|-> [--json]`.
- Reuse `resolveText(...)` style for `@file` and stdin.
- Use existing server import/preview endpoints.
- Keep existing import commands stable.

#### MODIFY `docs/CLI.md`

Add examples for:

```bash
ima2 prompt import json prompts.json --folder fav
ima2 prompt import preview @candidates.json --json
```

#### MODIFY `skills/ima2/SKILL.md`

Mention the JSON/preview wrapper so agents do not use raw `curl`.

#### TESTS

- ADD `tests/cli-prompt-import-contract.test.js`

### Slice 3 — Destructive CLI Safety + Doctor/Status (#66)

#### MODIFY `bin/ima2.ts`

Before:

- `ima2 reset` rewrites config without confirmation.
- `status` does not show generated dir.
- `doctor` prints port but does not probe availability.

After:

- `ima2 reset --yes` is required in non-TTY.
- Interactive TTY asks for confirmation.
- `status` prints generated dir and advertised server URL if present.
- `doctor` probes preferred port availability.
- `doctor` prints Card News effective state.
- `doctor` prints packaged skill path/integrity.
- `doctor` includes a best-effort native module probe for `better-sqlite3`.
- `doctor` warns on POSIX if config file contains sensitive values and
  group/other permissions can read it.

#### MODIFY `bin/commands/config.ts`

Before:

- `config rm <key>` removes file-layer keys without confirmation.

After:

- `config rm <key> --yes` required in non-TTY.
- Interactive TTY confirmation for removal.
- Reuse existing `-y, --yes`.
- Keep auth-key removal rejection and env override warnings.

#### TESTS

- MODIFY `tests/config.test.js`
- MODIFY `tests/bin.test.js`
- ADD `tests/cli-destructive-safety-contract.test.js`
- ADD `tests/cli-doctor-status-contract.test.js`

### Slice 4 — Package / Release Hardening (#67)

Detailed package and release diff lives in
[package-release-slice.md](./package-release-slice.md) to keep this plan file
under the 500-line jaw limit.

Files:

- ADD `LICENSE`
- MODIFY `package.json`
- MODIFY `.github/workflows/ci.yml`
- MODIFY `scripts/release.sh`
- MODIFY `scripts/release-preview.sh`
- MODIFY `tests/package-smoke.test.js` or `tests/package-install-smoke.mjs`

Native module policy: do not package local `.node` binaries and do not add
postinstall rebuild hooks; package smoke/doctor should detect missing
`better-sqlite3` bindings and report a reinstall/rebuild diagnostic.

### Slice 5 — UI Provider / Capability Readiness Popup (#65)

#### ADD `ui/src/components/ProviderReadinessPopup.tsx`

Responsibilities:

- Popup/modal-style readiness surface, not an always-visible settings panel.
- Show OAuth/API readiness booleans without secrets.
- Show current default provider/model/reasoning in user terms.
- Link users to Account settings or `ima2 doctor`/`ima2 capabilities` wording.
- Be openable from Settings and from blocked/uncertain Generate readiness copy.

#### MODIFY `ui/src/components/SettingsWorkspace.tsx`

Before:

- Generation settings show image model, reasoning, web search, gallery scope.
- Provider readiness is not in the generation section.

After:

- Add a compact "Check readiness" button in the generation section.
- The button opens `ProviderReadinessPopup`.
- Do not add a large persistent panel to Settings.

#### MODIFY `ui/src/components/GenerateButton.tsx`

Before:

- Does not explain provider readiness.

After:

- If a provider is unavailable or uncertain, expose compact copy and a path to
  open the readiness popup rather than a large inline explanation.
- Do not block generation solely from stale client state unless server state is
  clearly unavailable.

#### MODIFY `ui/src/components/ProviderSelect.tsx`
- Keep if mounted by readiness popup; otherwise trim stale assumptions.

#### MODIFY `ui/src/i18n/en.json`
#### MODIFY `ui/src/i18n/ko.json`
Add concise readiness popup labels and blocked-state copy.

#### TESTS

- ADD `tests/provider-readiness-popup-contract.test.js`
- MODIFY `tests/settings-workspace-layout-contract.test.js`

### Slice 6 — Generate As First Node Button (#59)

#### ADD `ui/src/components/CurrentImageActionsMenu.tsx`

Responsibilities:

- Own only overflow menu items that remain in the More menu.
- Keep `ResultActions.tsx` below the 500-line limit.
- Accept:
  - `actionImage`
  - `canExportToComfy`
  - `comfyExporting`
  - callbacks for ComfyUI and permanent delete.

#### ADD `ui/src/components/GenerateAsFirstNodeButton.tsx`

Responsibilities:

- Render a visible first-node button near the primary result actions.
- Use icon+text or compact text consistent with existing `action-btn` styling.
- Stay outside the More menu so Jun can find it directly.
- Receive `actionImage` and call the store action.

#### MODIFY `ui/src/components/ResultActions.tsx`

Before:

- More menu contains ComfyUI export and permanent delete inline.

After:

- Use `GenerateAsFirstNodeButton` as a visible button.
- Use `CurrentImageActionsMenu` only for overflow actions.
- Preserve `Continue Here`, Canvas open, delete, and ComfyUI behavior.

#### MODIFY `ui/src/store/useAppStore.ts`

Add action:

```ts
createRootNodeFromHistoryItem(item: GenerateItem): ClientNodeId
```

Behavior:

- Create a root node with `status: "ready"`.
- Use `item.image` / `item.url` as `imageUrl`.
- Preserve prompt into node prompt if present.
- Store the image as a ready preview root, not as a pending reference-only node.
- Switch `uiMode` to `"node"`.
- Schedule graph save.

#### MODIFY `ui/src/i18n/en.json`
#### MODIFY `ui/src/i18n/ko.json`
Add menu labels/toasts:

- `Generate as first node`
- success toast
- failure toast if no image data is available

#### TESTS

- ADD `tests/current-image-first-node-contract.test.js`
- MODIFY `tests/canvas-mode-contract.test.js`
- MODIFY `tests/comfy-export-ui-contract.test.js`

### Slice 7 — Gallery Modal Hardening (#68)

#### MODIFY `ui/src/lib/galleryUtils.ts`

Add shared visible item dedupe helper:

```ts
uniqueGalleryItems(items: GenerateItem[]): GenerateItem[]
```

Identity: `filename ?? image`, matching HistoryStrip.

#### MODIFY `ui/src/components/GalleryModal.tsx`

Before:

- Uses `history.filter(isGalleryVisibleItem)`.
- Delete path does not have modal-local aftercare.

After:

- Use shared dedupe helper.
- After delete, select the next visible item deterministically:
  - next item at same index;
  - previous item if deleting last;
  - close detail view / remain in modal if none.
- Restore focus to the replacement tile or modal container.
- Keep date-grid virtualization unchanged.

#### MODIFY `ui/src/components/gallery/GallerySessionGroups.tsx`

- Add a compact large-session hint if session mode cannot load older pages.
- Do not add full session virtualization in this pass unless tests prove it is
  needed; keep follow-up note if scope grows.

#### TESTS

- ADD `tests/gallery-modal-aftercare-contract.test.js`
- MODIFY `tests/history-strip-duplicate-contract.test.js`
- MODIFY `tests/gallery-load-older-contract.test.js`

### Slice 8 — Multimode Sequence UX (#69)

#### MODIFY `ui/src/components/MultimodeSequencePreview.tsx`

Before:

- Cancel button visibility uses global `activeGenerations > 0`.
- Index-less partials can match every slot through `find`.

After:

- Cancel button is shown only when current sequence status is active:
  `pending` or `partial`.
- Index-less partial fallback maps only to the first empty slot without an
  indexed partial, never every slot.
- Add status copy for canceled/partial/finalizing where needed.

#### MODIFY `ui/src/store/useAppStore.ts`

- Preserve current concurrent generation ability.
- Make sequence status transitions explicit enough for UI tests.
- Do not reintroduce the old #60 all-or-nothing multimode behavior.

#### MODIFY `ui/src/i18n/en.json`
#### MODIFY `ui/src/i18n/ko.json`

Add concise sequence state copy if needed.

#### TESTS

- ADD `tests/multimode-sequence-preview-contract.test.js`
- MODIFY `tests/multimode-ui-contract.test.js`

## Non-Goals

Do not implement #31/#27/#28, do not add install lifecycle hooks, do not enforce
`limits.maxParallel`, and do not commit/push unless Jun asks in the same turn.

## Verification Plan

Focused checks during build: run each impacted `node --test` contract listed in
the slices above before running the full suite.

Full checks before reporting B complete:

```bash
npm run typecheck
npm run typecheck:tests
cd ui && npx tsc -b --noEmit
npm run ui:build
npm run test:inventory
npm run lint:pkg
npm run test:package-install
git diff --check
npm test
```

If new test files are added, refresh runtime inventory before final checks.

## A-Phase Audit Plan

Dispatch read-only audit:

- Ryo: CLI/server/package/release/test plan audit for #64, #66, #67, #70.
- Nijika: UI/UX plan audit for #65, #59, #68, #69.

Audit questions:

- Are any listed file paths wrong or stale?
- Is the scope too broad for one PABCD B phase?
- Are any implementation steps likely to violate the 500-line file rule?
- Does any UX behavior need Jun's business decision before coding?
