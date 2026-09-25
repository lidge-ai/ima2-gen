---
title: "UX, CLI, And Install Hardening Audit Closeout"
status: completed / moved to _fin
created: 2026-05-15
tags: [ux, cli, packaging, install, hardening, agent-ux]
sources:
  - https://github.com/lidge-ai/ima2-gen/issues/27
  - https://github.com/lidge-ai/ima2-gen/issues/28
  - https://github.com/lidge-ai/ima2-gen/issues/31
  - https://github.com/lidge-ai/ima2-gen/issues/59
  - https://github.com/lidge-ai/ima2-gen/issues/60
  - https://github.com/lidge-ai/ima2-gen/issues/62
  - https://github.com/lidge-ai/ima2-gen/issues/63
  - https://github.com/lidge-ai/ima2-gen/issues/64
  - https://github.com/lidge-ai/ima2-gen/issues/65
  - https://github.com/lidge-ai/ima2-gen/issues/66
  - https://github.com/lidge-ai/ima2-gen/issues/67
  - https://github.com/lidge-ai/ima2-gen/issues/68
  - https://github.com/lidge-ai/ima2-gen/issues/69
  - https://github.com/lidge-ai/ima2-gen/issues/70
---

# UX, CLI, And Install Hardening Audit Closeout

## Purpose

Jun asked for a broad jawdev-style investigation of:

- overall UX issues worth addressing next;
- missing or weak CLI command surfaces;
- postinstall / package / release hardening work;
- which items should become implementation plans or GitHub issues.

This is a research ledger, not an implementation patch.

## Closeout Status — 2026-05-16

This research ledger is complete and archived in `_fin`.

The follow-up implementation pass covered:

- #64 CLI/Skill discovery/help/examples.
- #65 UI provider/capability readiness.
- #66 destructive CLI confirmations plus doctor/status hardening.
- #67 package/release hardening.
- #68 Gallery deletion/dedupe/loading UX.
- #69 Multimode sequence/cancel/partial UX.
- #70 Prompt import JSON/preview CLI wrappers.
- #59 Generate current image as first Node Mode root.

Implementation evidence is consolidated in:

- `devlog/_fin/260516_gh-issue-hardening-jawdev/README.md`
- `devlog/_fin/260515_issue64-70-hardening-pabcd/README.md`

## Detailed Documents

- [cli-install-hardening.md](./cli-install-hardening.md) — CLI command gaps,
  agent discovery, package install, postinstall, release hardening.
- [ux-hardening.md](./ux-hardening.md) — current UX issue lanes and close
  candidates.

The split is intentional because jaw project guidance keeps files under 500
lines.

## Repository Snapshot

Repository:

```text
/Users/jun/Developer/new/700_projects/ima2-gen
https://github.com/lidge-ai/ima2-gen
```

Open issues at investigation time:

| Issue | Title | Current read |
|---|---|---|
| #63 | Image delete button then keyboard focus | Likely fixed; close candidate after issue comment. |
| #62 | CLI/Skill capability discovery | Mostly implemented; small agent-discovery follow-ups remain. |
| #60 | 4-image multimode queued/stale progress | Likely fixed; close candidate after issue comment. |
| #59 | Generate as first node from More menu | Open UX feature. |
| #31 | Provider-backed masked edit | Open high-risk Canvas provider feature. |
| #28 | Canvas composition PPTX export | Open export feature. |
| #27 | Canvas annotations SVG/vector package | Open export/data-model feature. |

Issue split performed on 2026-05-15:

| Issue | Title | Status |
|---|---|---|
| #60 | 4-image multimode queued/stale progress | Closed as shipped; UX follow-up split to #69. |
| #63 | Image delete button then keyboard focus | Closed as shipped; Gallery modal follow-up split to #68. |
| #62 | CLI/Skill capability discovery | Closed as shipped; follow-ups split to #64, #65, #66, #67, #70. |
| #64 | CLI/Skill discovery/help/examples | Open follow-up. |
| #65 | UI provider/capability readiness | Open follow-up. |
| #66 | Destructive command confirmations + doctor/status | Open follow-up. |
| #67 | Packaging/release hardening | Open follow-up. |
| #68 | Gallery modal/dedupe/large-session UX | Open follow-up. |
| #69 | Multimode sequence/cancel/partial UX | Open follow-up. |
| #70 | Prompt import JSON/preview CLI wrappers | Open follow-up. |

Relevant committed signals:

- `fix(multimode): stream incremental sequence outputs`
- `fix(ui): dedupe history strip updates`
- `feat(cli): align generation parity options`
- `feat(cli): add ima2 skill discovery`
- `fix(gallery): restore viewer focus after delete`
- `docs(devlog): add canvas implementation research`

## Employee Review Status

Backend / CLI / packaging employee review was received and used as the primary
source for CLI, package, and install-hardening lanes.

Frontend / UX employee review was received after the initial dispatch transport
failure. The report was read-only and used as the primary source for UX lanes.

Initial transport error:

```text
Error: fetch failed
```

The recovered frontend report confirmed the main UX lanes around gallery
aftercare, multimode sequence state, Canvas/Viewer current-image actions,
provider readiness, prompt import closeout, and first-run blocked states.

## Current Strengths

### Agent Discovery Exists

The CLI now exposes the main agent-facing discovery surface:

- top-level help names `skill`, `capabilities`, and `defaults`;
- `ima2 skill` prints packaged Markdown from `skills/ima2/SKILL.md`;
- `ima2 capabilities --json` reports package/server metadata;
- `ima2 defaults --json` reports running server defaults when available and
  local defaults otherwise.

Anchors:

- `bin/ima2.ts:312-368`
- `bin/ima2.ts:380-444`
- `bin/commands/skill.ts:1-56`
- `bin/commands/capabilities.ts:1-91`
- `bin/commands/defaults.ts:1-188`
- `skills/ima2/SKILL.md:1-145`
- `docs/CLI.md:28-41`
- `docs/CLI.md:144-158`

### Package Contract Is Already Strong

Current package hardening includes:

- `prepack` builds UI/server/CLI artifacts before packing;
- `prepublishOnly` runs type checks, test inventory, builds, package lint, and
  package-install smoke;
- `files[]` includes runtime, docs, skills, assets, and generated JS entrypoints;
- `lint:pkg` asserts critical publish entries;
- `test:package-install` packs the package, installs it into a temp project,
  runs `ima2 doctor`, starts `ima2 serve`, checks health/storage routes, and
  verifies Card News gate behavior.

Anchors:

- `package.json:18-23`
- `package.json:44-61`
- `tests/package-install-smoke.mjs:80-204`
- `structure/06-infra-operations.md:64-67`
- `structure/06-infra-operations.md:155-166`

## Recommended Issue / Action Split

### Close Candidates

Done:

1. #60 was closed as completed after adding implementation evidence.
2. #63 was closed as completed after adding implementation evidence.
3. #62 was closed as completed after splitting smaller hardening issues.

### New Issues To Open

Opened follow-up issues:

1. #64 `CLI/Skill: harden agent discovery, help, and command examples`
2. #65 `UI: expose provider and capability readiness for first-run users`
3. #66 `CLI: add destructive command confirmations and doctor/status hardening`
4. #67 `Packaging: add LICENSE, publish dry-run, and release-script guards`
5. #68 `Gallery UX: harden deletion aftercare, duplicate identity, and large-session loading`
6. #69 `Multimode UX: clarify sequence cancel, partial slot mapping, and active generation state`
7. #70 `CLI: add prompt import JSON and preview wrappers for non-folder workflows`

Recommended existing issue sub-tasks:

- #31: add CLI `edit --mask` only when provider-backed mask semantics are
  verified.
- #59: implement first-node action in `ResultActions` plus store graph action.
- #27/#28: keep as Canvas export sequence.

## Recommended Order

1. Implement #64 and #70 together as the CLI/Skill discovery slice.
2. Implement #66 as the CLI safety/doctor slice.
3. Implement #67 as the package/release safety slice.
4. Implement #65 as the first-run readiness UI slice.
5. Implement #59 as the current-image first-node action slice.
6. Keep #68/#69 as follow-up UX polish unless the current PABCD scope explicitly
   expands to Gallery/Multimode UX closeout.
7. Continue #31/#27/#28 Canvas features after the current-image action boundary
   is stable.

## Verification Notes

This was a documentation/research-only pass.

No code was changed.

Suggested checks for a future implementation pass:

```bash
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm run lint:pkg
npm run test:package-install
npm test
```
