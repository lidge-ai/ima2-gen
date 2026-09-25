---
title: "Issue #62 — CLI Skill And Capability Discovery"
status: completed / moved to _fin
created: 2026-05-13
github: https://github.com/lidge-ai/ima2-gen/issues/62
tags: [cli, skill, agent-ux, capabilities, defaults]
---

# Issue #62 — CLI Skill And Capability Discovery

## Closeout Status — 2026-05-16

GitHub #62 is closed and this plan is archived in `_fin`.

Evidence:

- `skills/ima2/SKILL.md` is packaged.
- `ima2 skill`, `ima2 skill --json`, `ima2 capabilities --json`, and
  `ima2 defaults --json` are implemented.
- Follow-up hardening was split into #64/#65/#66/#67/#70 and is covered by
  `_fin/260515_issue64-70-hardening-pabcd/`.

## Summary

Jun raised that the `ima2` CLI is more agent-friendly than before, but still lacks an
installed/package-level skill like `agbrowse` and still makes agents infer too much
from scattered `--help` text. The CLI also cannot directly inspect the running
server's effective default image model, and changing persistent model/reasoning
defaults is not obvious enough for agents even though `ima2 config set` can already
write the underlying config keys.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/62

This plan captures the first clarification pass. It is intentionally not yet an
implementation patch.

Implementation note, 2026-05-13:

- Added packaged `skills/ima2/SKILL.md`.
- Added `ima2 skill`, `ima2 capabilities`, and `ima2 defaults`.
- Added `GET /api/capabilities`.
- Shared config file storage helpers through `bin/lib/config-store.ts`.
- Updated CLI/package/structure docs and contract tests.
- Read-only subagent verification PASSed for backend/CLI/security and docs/package/test integration.

## Confirmed User Requirements

### Scope

- Repository: `ima2-gen`.
- Current phase: jawdev-style record and ambiguity cleanup first.
- Final target: full implementation after the plan is accepted.

### Skill Packaging

- Add a Markdown skill file inside the `ima2-gen` package.
- The skill should be available to agents from installed packages, for example:
  - `node_modules/ima2-gen/skills/ima2/SKILL.md`
- The Markdown skill is the source of truth.
- Add a CLI command that can print the packaged skill text.
- Add a CLI command that can print a JSON wrapper around the Markdown skill text.
- Do not make JSON the canonical skill format.

### JSON Skill Output

The short-term JSON output is a wrapper for the Markdown skill, not a separate
schema-first skill system.

Expected shape, subject to implementation audit:

```json
{
  "name": "ima2",
  "format": "markdown-skill",
  "formatVersion": "1",
  "packageVersion": "1.1.10",
  "path": "skills/ima2/SKILL.md",
  "source": "package",
  "content": "..."
}
```

The JSON wrapper exists so short-term agent/tooling flows can receive the skill
through structured CLI output. The Markdown `content` remains the user-facing and
agent-facing source of truth.

### Server Defaults And Config

- The frontend currently uses a unified default image model.
- CLI should expose that same default as a discoverable value.
- CLI should be able to change the persistent default model.
- CLI should be able to change the persistent reasoning policy.
- These persistent defaults must not be changed through per-request generation
  flags.
- Existing request flags like `--model` and `--reasoning-effort` remain request
  overrides only.

Relevant current config keys:

- `imageModels.default`
- `imageModels.reasoningEffort`
- `apiProvider.defaultImageModel`
- `apiProvider.defaultReasoningEffort`

Existing generic command:

```bash
ima2 config get imageModels.default --effective --json
ima2 config set imageModels.default gpt-5.5
ima2 config get imageModels.reasoningEffort --effective --json
ima2 config set imageModels.reasoningEffort high
```

Problem: this is not discoverable enough for agents, and it may not prove the
running server's effective state when the server was started with a different
environment. The plan should add agent-facing defaults/capabilities commands and,
if needed, a server endpoint that reports the running server context.

Policy decision after A-audit:

- `ima2 defaults set model <model>` writes both `imageModels.default` and
  `apiProvider.defaultImageModel` so the user-facing "default model" remains a
  single concept across OAuth/API provider paths.
- `ima2 defaults set reasoning <effort>` writes both
  `imageModels.reasoningEffort` and `apiProvider.defaultReasoningEffort`.
- `ima2 defaults --json` reports provider-specific effective values so agents can
  see when OAuth and API defaults differ.
- `ima2 defaults set ...` does not require `-y` because these keys are not
  sensitive under the existing `config` command policy.

### Parallel Generation

Jun clarified that "parallel generation" means queuing multiple CLI generation
requests, not inventing another hidden generation mode.

Agent-facing guidance should say that when synchronous/CLI-controlled parallel work
is desired, agents can run several `ima2 gen` calls as separate queued jobs, bounded
by configured limits.

The skill should explain this plainly instead of implying a special `--parallel`
flag is required.

### I2I / Reference Generation

Jun confirmed that "i2i generation" means reference/image-to-image style usage.
The skill should explain available reference workflows and point agents to the
right command surface. It does not need to expose every internal distinction to the
user-facing plan.

Current relevant command surface:

- `ima2 gen --ref <file>`
- `ima2 multimode --ref <file>`
- `ima2 node generate --ref <file>`
- `ima2 edit <file> --prompt "<text>"`

### Quality High

The skill should tell agents to use `--quality high` when high-quality output is
needed. This is a usage recommendation, not necessarily a global default change.

### Reasoning Policy

Reasoning settings should follow the same policy as default model settings:

- persistent setting through config/defaults commands;
- request-level override remains available where already supported;
- no accidental default mutation through generation flags.

## Current Code Signals

### Existing CLI Entry

Main dispatcher:

- `bin/ima2.ts`

Relevant command modules:

- `bin/commands/config.ts`
- `bin/commands/gen.ts`
- `bin/commands/edit.ts`
- `bin/commands/multimode.ts`
- `bin/commands/node.ts`
- `bin/commands/observability.ts`
- `bin/commands/ping.ts`

### Existing Config

Config source of truth:

- `config.js`
- `config.ts`

Current defaults:

- `config.imageModels.default`
- `config.imageModels.valid`
- `config.imageModels.reasoningEffort`
- `config.imageModels.validReasoningEfforts`
- `config.apiProvider.defaultImageModel`
- `config.apiProvider.defaultReasoningEffort`

Important nuance:

- `config.js` says priority is `env var > config.json > built-in default`.
- A CLI process reading local config may not know the exact effective settings of
  an already-running server if that server was launched with different environment
  variables.
- Therefore "what is the running server default model?" likely needs a server
  runtime response, not only local config file inspection.

### Existing Server Runtime Endpoints

Existing:

- `GET /api/health`
- `GET /api/providers`
- `GET /api/oauth/status`
- `GET /api/inflight`

Current `/api/health` does not expose image model defaults or reasoning policy.

## Proposed User-Facing Behavior

After implementation, an agent should be able to do this from a fresh install:

```bash
ima2 --help
ima2 skill
ima2 skill --json
ima2 capabilities --json
ima2 defaults --json
```

And learn:

- where the packaged `SKILL.md` lives;
- how to generate images;
- how to use references / i2i-style workflows;
- how to request high quality;
- how to queue several generation jobs for parallel generation;
- how to inspect current default model/reasoning policy;
- how to persistently change default model/reasoning policy;
- which values are valid.

## Proposed Commands

### `ima2 skill`

Print the packaged Markdown skill text.

Candidate options:

```text
ima2 skill
ima2 skill --json
ima2 skill path
```

Expected behavior:

- `ima2 skill` prints `skills/ima2/SKILL.md`.
- `ima2 skill --json` prints a JSON wrapper containing the Markdown content.
- `ima2 skill path` prints the resolved package skill path.

### `ima2 capabilities`

Print agent-friendly capability information.

Candidate options:

```text
ima2 capabilities
ima2 capabilities --json
ima2 capabilities --server <url>
```

Expected JSON includes:

- package version;
- server URL if resolved;
- supported commands;
- valid image models;
- valid reasoning efforts;
- max references;
- max generated images;
- high-quality guidance;
- whether the command is reading local package config or running server context.
- `maxParallel` as advisory metadata, not a claim that the server enforces a
  concurrency semaphore.

Default behavior:

- `ima2 capabilities --json` tries to include running server context when a server
  can be resolved.
- If no server is reachable, it still returns package-local capabilities with
  `"server": null` and `"source": "local"`.
- A future `--require-server` option may force server failure semantics, but the
  default should be useful from a fresh install.

### `ima2 defaults`

Inspect and update persistent default model/reasoning policy.

Candidate commands:

```text
ima2 defaults
ima2 defaults --json
ima2 defaults set model <model>
ima2 defaults set reasoning <none|low|medium|high|xhigh>
ima2 defaults reset model
ima2 defaults reset reasoning
```

Implementation should reuse `config` semantics rather than introduce a second
settings store.

Expected mapping:

- `defaults set model` writes `imageModels.default` and
  `apiProvider.defaultImageModel`.
- `defaults set reasoning` writes `imageModels.reasoningEffort` and
  `apiProvider.defaultReasoningEffort`.
- Output must mention that a running server needs restart to pick up config file
  changes unless a future live-reload mechanism is explicitly added.
- `defaults --json` prefers running server values when a server is reachable and
  falls back to local effective config with `"source": "local"` when not.
- `defaults --local --json` ignores the server and reports local effective config.
- `defaults --server <url> --json` queries a specific server.

### Help Text Updates

The top-level help and command-specific help should point agents to discovery
commands instead of forcing them to infer defaults from scattered docs.

Examples:

```text
Run `ima2 skill` for agent usage instructions.
Run `ima2 capabilities --json` to inspect command capability metadata.
Run `ima2 defaults --json` to inspect default model and reasoning policy.
```

## Diff-Level Plan

### ADD `skills/ima2/SKILL.md`

Role:

- canonical package skill for agents.

Must include:

- start/status workflow;
- discovery workflow;
- generation workflow;
- reference/i2i guidance;
- high quality guidance;
- parallel generation guidance as multiple queued `ima2 gen` calls;
- defaults inspection/change workflow;
- warning that persistent default changes are not per-request flags;
- examples that use current CLI command names.
- `ima2 edit <file> --prompt "<text>"` exactly; do not document positional edit
  prompts.
- high-quality examples using `--quality high`.
- model guidance that says to use `ima2 capabilities --json` as source of truth
  and to avoid unsupported models.
- `maxParallel` guidance as advisory queue guidance only, not a guaranteed
  server-side throttle.

### MODIFY `package.json`

Add `skills/` to `files[]` so published packages include the skill.

Update `lint:pkg` required include list to assert `skills/` is packaged.

Implementation note:

- `lint:pkg` is currently an inline `node -e` script in `package.json`; update
  the `mustInclude` array inside that script directly. There is no separate lint
  config file for this check.

### ADD `bin/commands/skill.ts`

Role:

- read packaged Markdown skill from `skills/ima2/SKILL.md`;
- print Markdown by default;
- print JSON wrapper with `--json`;
- optionally print resolved path with `path`.

Constraints:

- Do not silently fallback to generated text if the file is missing.
- Missing packaged skill is a package integrity error.
- JSON output uses `formatVersion` for the wrapper schema and `packageVersion`
  for the package version. Do not overload a single `version` field.

### ADD `bin/commands/capabilities.ts`

Role:

- provide agent-facing discovery output.

Initial implementation can combine:

- package static metadata;
- local `config` valid model/reasoning/limit constants;
- running server context when `resolveServer(...)` succeeds.
- `VALID_IMAGE_QUALITIES` and `DEFAULT_IMAGE_QUALITY` from
  `lib/oauthNormalize.ts`; quality values do not come from `config`.

Open implementation question:

- exact running server defaults likely require a server endpoint. If the CLI cannot
  prove running server values from current endpoints, add a server route instead
  of pretending local config equals runtime config.
- Do not advertise unsupported model ids as safe defaults. If unsupported models
  must be shown, use a shape that separates supported and unsupported values.

### ADD or MODIFY Server Capability Route

Candidate:

- `GET /api/capabilities`

Role:

- return running server defaults and capability values from `ctx.config`.

Candidate payload:

```json
{
  "version": "1.1.10",
  "defaults": {
    "oauth": {
      "model": "gpt-5.4-mini",
      "reasoningEffort": "medium"
    },
    "api": {
      "model": "gpt-5.4-mini",
      "reasoningEffort": "low"
    }
  },
  "valid": {
    "imageModels": {
      "supported": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
      "unsupported": ["gpt-5.3-codex-spark"]
    },
    "reasoningEfforts": ["none", "low", "medium", "high", "xhigh"],
    "quality": ["low", "medium", "high"]
  },
  "limits": {
    "maxRefCount": 5,
    "maxParallel": {
      "value": 8,
      "enforced": false,
      "note": "advisory client-side queue guidance only"
    }
  }
}
```

Security note:

- Do not return API keys, tokens, raw config file contents, or auth secrets.
- Use an allowlist projection like `GET /api/providers`, not full `ctx.config`
  serialization.
- Convert all `Set` values to arrays explicitly with `Array.from(...)` before
  JSON serialization. `JSON.stringify(new Set(...))` would produce `{}`.
- `version` must come from `ctx.packageVersion`, matching the existing
  `/api/health` pattern.
- Add a response contract test that asserts no secret-looking keys such as
  `token`, `apiKey`, `password`, or raw credential fields appear in the
  capability payload.

### ADD `bin/commands/defaults.ts`

Role:

- agent-friendly wrapper around the existing config keys for default model and
  reasoning policy.

Should validate against `config.imageModels.valid` and
`config.imageModels.validReasoningEfforts`.

Should not alter request-level flags.

It should reuse config file read/write behavior through a shared helper rather
than duplicate the internals of `bin/commands/config.ts`.

Expected writes:

- `defaults set model <model>` writes both `imageModels.default` and
  `apiProvider.defaultImageModel`.
- `defaults set reasoning <effort>` writes both `imageModels.reasoningEffort` and
  `apiProvider.defaultReasoningEffort`.
- If an environment variable such as `IMA2_IMAGE_MODEL_DEFAULT` or
  `IMA2_API_IMAGE_MODEL_DEFAULT` currently overrides the file value, output the
  same kind of warning that `ima2 config set` prints.

### ADD `bin/lib/config-store.ts`

Role:

- shared config file helper for `bin/commands/config.ts` and
  `bin/commands/defaults.ts`.

Move or share:

- config file load/save;
- dotted key get/set/delete;
- writable key metadata;
- env override mapping and warning logic;
- restart notice text.

Do not duplicate config storage code in `defaults.ts`.

### MODIFY `bin/ima2.ts`

Add top-level commands:

- `skill`
- `capabilities`
- `defaults`

Update top-level help to point agents to the discovery flow.

Required edits:

- Add command descriptions to `showHelp()`.
- Add `skill`, `capabilities`, and `defaults` to the help-bypass whitelist used
  before the switch so `ima2 skill --help` reaches the command module instead of
  printing top-level help.
- Add switch cases using the same dynamic import pattern as existing command
  modules.

### MODIFY `bin/commands/config.ts`

Potentially small docs/help update only.

Existing `config` command already supports the underlying keys:

- `imageModels.default`
- `imageModels.reasoningEffort`

Do not duplicate storage logic if `defaults` can call the same helpers or share a
small config utility.

After adding `bin/lib/config-store.ts`, update `config.ts` command internals to
use the shared helper so `config set` and `defaults set` do not diverge.

### MODIFY Docs / Structure

Potential targets:

- `docs/CLI.md`
- `structure/02-command-reference.md`
- `structure/03-server-api.md`
- `structure/06-infra-operations.md`
- `structure/07-devlog-map.md`

Document:

- packaged skill path;
- `ima2 skill`;
- `ima2 capabilities`;
- `ima2 defaults`;
- i2i/reference guidance;
- parallel generation as multiple queued jobs;
- high quality guidance;
- model/reasoning persistent settings.
- package inclusion / `files[]` / `lint:pkg` / package smoke requirements for
  `skills/ima2/SKILL.md`.

### ADD Tests

Candidate tests:

- `tests/cli-skill-command-contract.test.js`
- `tests/cli-capabilities-contract.test.js`
- `tests/cli-defaults-command-contract.test.js`
- server route contract for `/api/capabilities`;
- package inventory/package smoke assertion that `skills/` is included.

Assertions:

- `skills/ima2/SKILL.md` exists and contains core command names.
- `ima2 skill --json` wraps Markdown content, not a separate schema-only skill.
- `package.json files[]` includes `skills/`.
- `ima2 defaults set model` maps to `imageModels.default`.
- `ima2 defaults set reasoning` maps to `imageModels.reasoningEffort`.
- `ima2 capabilities --json` includes valid models, reasoning efforts, limits, and
  no secrets.
- `/api/capabilities` converts `Set` values to arrays.
- `/api/capabilities` separates supported and unsupported image model ids.
- `/api/capabilities` reports `maxParallel` as advisory with `enforced: false`.
- `/api/capabilities` uses allowlist projection and never serializes full
  `ctx.config`.
- `ima2 edit` examples in `SKILL.md` use `--prompt`.
- `ima2 skill --help`, `ima2 capabilities --help`, and `ima2 defaults --help`
  reach their subcommand help through the `bin/ima2.ts` whitelist.
- `--help` mentions the discovery commands.

## Non-Goals

- Do not invent a new `--parallel` generation flag in this issue.
- Do not change default quality to `high` globally unless Jun explicitly requests
  that as a behavior change.
- Do not claim `limits.maxParallel` is enforced server-side in this issue.
- Do not make JSON the canonical skill format.
- Do not expose secrets in capability/defaults output.
- Do not enable CLI `edit --mask` here; keep #31 separate.
- Do not add server-side config mutation unless explicitly approved. Persistent
  default writes should stay file/config based for this issue.
- Do not fix the existing `edit.ts` acceptance of `gpt-5.3-codex-spark` in this
  issue unless a separate issue explicitly pulls that scope in. Capabilities
  should expose unsupported models separately instead.

## A-Audit Resolutions

Resolved after A-audit:

1. `ima2 capabilities --json` returns package-local capabilities with
   `"server": null` when no server is reachable.
2. `ima2 defaults --json` prefers running server values when available and falls
   back to local effective config with an explicit source marker.
3. `ima2 skill --json` includes `formatVersion`, `packageVersion`, `path`, and
   `content`.
4. `ima2 defaults set ...` does not require `-y`; model/reasoning keys are not
   sensitive under the existing config command policy.

Still deferred:

1. Whether to create a separate follow-up issue for the existing `edit.ts` model
   allowlist inconsistency around `gpt-5.3-codex-spark`.

## Suggested Next Step

Move this plan into PABCD P after Jun confirms the draft framing, then run A-phase
audit with:

- CLI/package/docs reviewer;
- backend/API reviewer for the `/api/capabilities` boundary and secret filtering.
