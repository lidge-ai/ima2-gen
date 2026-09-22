---
created: 2026-04-23
tags: [ima2-gen, CLI, commands, automation]
aliases: [ima2 CLI, ima2 commands, image generation CLI]
---

# Command Reference

`gen`, `edit`, `multimode`, and `node generate` accept `--image-tool-model` for API
Sunburst/Flare 2.5 tools. `--model` remains the outer GPT choice; omission keeps
upstream selection. See `docs/CLI.md` for exact IDs and xhigh/max quality scope.

The `ima2` CLI lets users configure the server, generate images, edit images, inspect history, and list active jobs without opening the browser UI. Server commands and server-client commands share the same entrypoint.

This matters because `ima2-gen` is both a browser app and an automation tool. Users can run `npx ima2-gen serve` for an instant local app, while scripts can call `ima2 gen` or `ima2 edit` against the same server. If the CLI contract drifts, README examples, tests, server discovery, and API response handling drift with it.

Before using client commands, make sure a server is running. `ima2 serve` starts the server and OAuth proxy, then advertises the actual bound URL in `~/.ima2/server.json`. Client commands such as `ima2 gen`, `ima2 edit`, `ima2 ls`, `ima2 ps`, and `ima2 ping` use that advertisement file or an override to find the server, including fallback ports when the default is busy.

Not every server surface has a CLI wrapper. **Agent Mode** (`/api/agent/*`) is a server + web-UI feature with no `ima2` subcommand. The prompt-builder assistant (`POST /api/prompt-builder/chat`) is available through `ima2 prompt build`. For agent-facing discovery, `ima2 capabilities --json` reports supported models, valid quality/reasoning/moderation/provider/mode values, writable config keys, limits, and the package/server version, and `ima2 skill` prints the packaged agent skill.

`ima2 prompt build --backend <backend> --model <model>` sends its request through the
configured or per-request Prompt Builder backend. `promptBuilder.backend=auto` chooses
the first ready lane in the order `oauth -> grok -> api -> grok-api`; an explicit value
stays pinned and fails with a typed error when unavailable. The response exposes
`requestedBackend` and the answering `backend`; the UI badge renders the latter.

---

## Execution Flow

```mermaid
sequenceDiagram
    participant User as User
    participant CLI as ima2 CLI
    participant Adv as ~/.ima2/server.json
    participant Server as Express server
    participant OAuth as openai-oauth

    User->>CLI: ima2 serve
    CLI->>Server: tsx server.ts (dev) / node server.js (publish)
    Server->>OAuth: start local proxy
    Server->>Adv: advertise port
    User->>CLI: ima2 gen prompt
    CLI->>Adv: read advertised port
    CLI->>Server: POST /api/generate
    Server->>OAuth: image request
    Server-->>CLI: image data and filename
```

## Server Commands

| Command | Alias | Role | Main files |
|---|---|---|---|
| `ima2 serve [--dev]` | none | Run setup if needed and start the server; `--dev` enables verbose diagnostics | `bin/ima2.ts`, `server.ts` |
| `ima2 stop [--force]` | none | Stop the running server: verify advertised pid against `/api/health`, graceful nonce-authed `POST /api/admin/stop`, then SIGTERM→SIGKILL; cleans stale advertise files; idempotent | `bin/commands/stop.ts`, `lib/processControl.ts`, `routes/admin.ts` |
| `ima2 service <sub>` | none | Background service (launchd / systemd user unit): install/uninstall/start/stop/restart/status/logs/repair with PATH-baked artifacts and KeepAlive-honest stop | `bin/commands/service.ts`, `bin/lib/serviceTemplates.ts` |
| `ima2 setup` | `login` | Configure API key or OAuth interactively | `bin/ima2.ts` |
| `ima2 status` | none | Show config, provider, and OAuth session state | `bin/ima2.ts`, `lib/codexDetect.ts` |
| `ima2 doctor [--json] [--bundle] [--verify-keys] [--runtime <loopback-origin>]` | none | Fixed-code machine reports or human storage/auth checks; network verification is explicit and bounded | `bin/commands/doctor.ts`, `bin/lib/doctor-report.ts`, `bin/lib/doctor-providers.ts` |
| `ima2 doctor --installation [--json]` | none | Early offline package/engine/native/UI/skill check, no config/account/network initialization | `bin/ima2.ts`, `bin/lib/doctor-runtime.ts` |
| `ima2 open` | none | Open the web UI at the advertised or default port | `bin/ima2.ts`, `bin/lib/platform.ts` |
| `ima2 grok login/status/logout` | none | Manage the xAI OAuth session (device code) used by `provider: "grok"`, with an optional `status --probe` model check | `bin/commands/grok.ts`, `routes/grok.ts` |
| `ima2 reset` | none | Reset `~/.ima2/config.json` to an empty object | `bin/ima2.ts` |
| `ima2 --version` | `-v` | Print the package version | `bin/ima2.ts`, `package.json` |
| `ima2 --help` | `-h` | Print top-level help | `bin/ima2.ts` |

## Client Commands

The CLI surface was expanded to near-feature-parity with the server API in #45 (`feat(cli): full feature parity with server API`, commit 9698fc1). The table below groups commands by the API surface they wrap. Run `ima2 <command> --help` for full per-command flags.

| Command | Server API | Role |
|---|---|---|
| `ima2 gen <prompt>` | `POST /api/generate` | Generate image(s) from a prompt and optional references |
| `ima2 edit <file>` | `POST /api/edit` | Edit an existing image with a prompt |
| `ima2 multimode <spec>` | `POST /api/generate/multimode` | Run a multimode generation sequence |
| `ima2 video <prompt>` | `POST /api/video/generate` | Grok video generation, reference-to-video, and branch-local continuation |
| `ima2 node <subcommand>` | `/api/node/*` | Node-mode generate/show/list (graph-aware) |
| `ima2 session <subcommand>` | `/api/sessions*` | List/load/save/rename/delete sessions and style sheets |
| `ima2 history <subcommand>` | `/api/history*` | List, show, favorite, restore, soft-delete, permanent-delete history items |
| `ima2 prompt <subcommand>` | `/api/prompts*` and `/api/prompt-import/*` | Prompt library list/show/save/delete/import/export |
| `ima2 prompt build` | `POST /api/prompt-builder/chat` | Build a structured image prompt from a message or transcript |
| `ima2 annotate <subcommand>` | `/api/annotations/:filename` | Get/put/delete canvas annotations |
| `ima2 canvas-versions <subcommand>` | `/api/canvas-versions*` | List/save canvas version snapshots |
| `ima2 metadata <subcommand>` | `/api/metadata/read` | Read embedded XMP metadata from images |
| `ima2 comfy export <filename>` | `/api/comfy/export-image` | Upload a generated image into ComfyUI's `input/` |
| `ima2 comfy workflow ls` | `GET /api/comfy/workflows` | List registered workflows with per-origin health |
| `ima2 comfy workflow inspect <file>` | `POST /api/comfy/inspect` | Show nodes and binding candidates without saving |
| `ima2 comfy workflow add <file> --id <id>` | `POST /api/comfy/workflows` | Register from an API-format export or a ComfyUI PNG |
| `ima2 comfy workflow rm <id>` | `DELETE /api/comfy/workflows/:id` | Remove a registered workflow |

`workflow add` identifies the file by magic bytes rather than extension, and
refuses ambiguous bindings even with `--yes` — `--yes` only accepts candidates
that were already unambiguous. Two `CLIPTextEncode` nodes is the ordinary
shape and a wrong guess swaps positive and negative silently.

`ima2 gen --provider comfy --model <workflow>` needs no separate wiring:
`bin/lib/modelResolver.ts` resolves against the live `GET /api/models`
catalog, so a registered workflow is selectable and an unregistered id fails
with `MODEL_NOT_FOUND` while an all-offline lane fails with
`LANE_UNAVAILABLE`.
| `ima2 cardnews <subcommand>` | `/api/cardnews/*` | Dev-gated card-news templates/sets/jobs |
| `ima2 config <get\|set>` | local | Read/write `~/.ima2/config.json` |
| `ima2 vectorize <image>` | local | Trace a raster image into SVG via `lib/vectorizeImage.ts`; no server or provider needed |
| `ima2 defaults <subcommand>` | local or `/api/capabilities` | Inspect/change persistent model and reasoning defaults |
| `ima2 capabilities` | `/api/capabilities` or local fallback | Print agent-facing capability metadata |
| `ima2 skill [ima2\|front\|uiux]` | local package | List or print the three packaged Markdown agent skills and their reference modules |
| `ima2 skill install [<name>] --dir <path>` | local package | Install all packaged skills, or one selected skill, into an agent-readable directory |
| `ima2 skill install [<name>] --tmp` | local package | Install packaged skills under the temporary directory for ephemeral agent use |
| `ima2 inflight <subcommand>` | `/api/inflight*` | List/cancel running jobs (alias surface for `ps`/`cancel`; implemented in `bin/commands/observability.ts`) |
| `ima2 storage <subcommand>` | `/api/storage*` | Storage status and open generated dir (via `observability.ts`) |
| `ima2 backfill-thumbs` | `POST /api/history/backfill-thumbnails` | Recursive local thumbnail backfill for gallery/history |
| `ima2 billing` | `/api/billing` | Show billing/usage summary (OpenAI/API-key probe; not Grok quota; via `observability.ts`) |
| `ima2 providers` | `/api/providers` | Show available providers and modes (via `observability.ts`) |
| `ima2 oauth <subcommand>` | `/api/oauth*` | OAuth status and helpers (via `observability.ts`) |
| `ima2 ls` | `GET /api/history` | History list (legacy alias of `history list`) |
| `ima2 show <name>` | `GET /api/history` plus file path | Show or reveal one history item |
| `ima2 ps` | `GET /api/inflight` | List running classic/node/multimode jobs (legacy alias of `inflight list`) |
| `ima2 cancel <requestId>` | `DELETE /api/inflight/:requestId` | Mark a running/known job as canceled (legacy alias of `inflight cancel`) |
| `ima2 ping` | `GET /api/health` | Check server reachability and health |

## `gen` Options

| Option | Default | Description |
|---|---|---|
| `-q`, `--quality` | `low` | Passes `low`, `medium`, `high`, or `auto` |
| `-s`, `--size` | `1024x1024` | Passes `WxH` or `auto` |
| `-n`, `--count` | `1` | Generation count; CLI clamps from 1 to the configured image-count limit (default 24) |
| `--ref <file>` | none | Attach a reference image; max 5 |
| `-o`, `--out <file>` | generated name | Save path for one image |
| `-d`, `--out-dir <dir>` | current directory | Save directory for multiple images |
| `--json` | false | Print machine-readable JSON |
| `--no-save` | false | Print base64 to stdout without writing files |
| `--force` | false | Allow large base64 output to a TTY |
| `--stdin` | false | Read extra prompt text from stdin |
| `--timeout <sec>` | `180` | HTTP request timeout |
| `--server <url>` | auto-discovered | Override server discovery |
| `--model <id>` | `gpt-5.6-luna` | Image model: `gpt-5.6-luna`, `gpt-6-astra`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `grok-imagine-image`, `grok-imagine-image-quality`, or server-rejected `gpt-5.3-codex-spark` |
| `--provider <oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai|comfy|runway|higgsfield>` | server default | Per-request provider override; `api`/`grok-api`/`gemini-api`/`atlascloud`/`minimax`/`nai` require configured keys; `grok` uses the xAI OAuth session (device code); `agy` shells out to local `agy` CLI; `nai` is text-to-image only. The enum is derived from `lib/providers/registry.ts`, so it is never hand-maintained in code. |
| `--mode <auto|direct>` | `auto` | Prompt handling mode |
| `--moderation <auto|low>` | `low` | OAuth moderation level |
| `--reasoning-effort <none|low|medium|high|xhigh>` | server default | Reasoning effort hint for prompt-aware models |
| `--web-search` / `--no-web-search` | server default | Toggle Responses-API web search for the request |
| `--session <id>` | none | Apply enabled session style sheet |

Web-search note: `--web-search` and `--no-web-search` set the request-level `webSearchEnabled` field. For `provider: "api"`, the request still respects the global API-provider gate (`IMA2_API_ALLOW_WEB_SEARCH` / `apiProvider.allowWebSearch`); a globally disabled API web-search setting cannot be re-enabled by one CLI call.

Provider override semantics: `api` forces the API-key Responses path, `oauth` forces the local OAuth proxy path, `grok` forces the xAI path with the stored OAuth session, `nai` forces the NovelAI image API (text-to-image only — `--ref` is refused with `NAI_REF_UNSUPPORTED` rather than dropped), and `auto` preserves route default behavior on the legacy `edit`/`multimode`/`node` surface. `ima2 gen` removed `auto` and exits 2 with `PROVIDER_AUTO_REMOVED`. Grok Classic and Node route through mandatory xAI Web Search, `grok-4.5` planning, and xAI Images API; requests with references use xAI `/v1/images/edits` to preserve image-to-image context.

NovelAI native options are shared by `gen`, `multimode`, and `node generate`:

| Option family | Flags |
|---|---|
| Prompt/sampling | `--nai-negative-prompt`, `--nai-sampler`, `--nai-noise-schedule`, `--nai-steps`, `--nai-scale`, `--nai-cfg-rescale`, `--nai-seed` |
| Presets | `--nai-uc-preset`, `--nai-quality-preset` (V5 only) |
| Toggles | `--nai-auto-smea`, `--nai-decrisper`, `--nai-variety-plus`, `--nai-straight-alpha` plus matching `--no-nai-*` forms |

`gen` may use a persisted `nai/<model>` default after catalog resolution.
`multimode` and `node generate` require an explicit NAI provider/model with native
flags. Target conflicts, malformed values, and V5-only fields on V4.5 exit 2 before
generation network I/O.

## `video` Options

| Command | Role |
|---|---|
| `ima2 video <prompt>` | Generate T2V/I2V/Ref2V through Grok video |
| `ima2 video continue <prompt> --video <generated-file>` | Extract the parent generated video's last frame and create a new branch-local continuation clip |
| `ima2 video edit <prompt> --video <value>` | xAI native V2V edit; base video model only |
| `ima2 video extend <prompt> --video <value>` | xAI native extension; returns original+extension combined |
| `ima2 video frame <generated-file>` | Extract a PNG frame from a generated `.mp4` |
| `ima2 video analyze <generated-file>` | Analyze first/last frames through the configured planner model (Grok 4.5 default) |

Video prompts cannot be blank. Agents should include visual flow, motion flow,
sound/no-music, dialogue/no-dialogue, and the ending frame. `continue` differs
from `extend`: `continue` persists `videoContinuity` lineage metadata and starts
a fresh generated clip from the last frame; `extend` calls xAI's native
extension endpoint.

Video model contract, 2026-07-26: `grok-imagine-video-1.5` is the canonical
generation default; `grok-imagine-video-1.5-preview` is accepted as an alias.
`1080p` is valid for 1.5 prompt-only T2V through the canvas shim and for I2V
with one image/frame source. Ref2V/multi-ref, edit, and extension remain base-model paths.

## `edit` Options

| Option | Default | Description |
|---|---|---|
| `-p`, `--prompt` | required | Edit instruction |
| `-q`, `--quality` | `low` | Edit quality |
| `-s`, `--size` | `1024x1024` | Output size |
| `-o`, `--out <file>` | generated name | Save path |
| `--json` | false | Print machine-readable JSON |
| `--timeout <sec>` | `180` | HTTP request timeout |
| `--server <url>` | auto-discovered | Target server URL |
| `--model <id>` | `gpt-5.6-luna` | Image model: `gpt-5.6-luna`, `gpt-6-astra`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `grok-imagine-image`, `grok-imagine-image-quality`, or server-rejected `gpt-5.3-codex-spark` |
| `--provider <oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai|comfy|runway|higgsfield>` | server default | Per-request provider override; `api`/`grok-api`/`gemini-api`/`atlascloud`/`minimax`/`nai` require configured keys; `grok` uses the xAI OAuth session (device code); `agy` shells out to local `agy` CLI; `nai` is text-to-image only. The enum is derived from `lib/providers/registry.ts`, so it is never hand-maintained in code. |
| `--mode <auto|direct>` | `auto` | Prompt handling mode |
| `--moderation <auto|low>` | `low` | OAuth moderation level |
| `--reasoning-effort <none|low|medium|high|xhigh>` | server default | Reasoning effort hint for prompt-aware models |
| `--web-search` / `--no-web-search` | server default | Toggle Responses-API web search for the request |
| `--session <id>` | none | Apply enabled session style sheet |

## `multimode` Options

| Option | Default | Description |
|---|---|---|
| `--max-images <1..24>` | `4` | Maximum separate stage images by default; configurable through `IMA2_MAX_GENERATED_IMAGES` |
| `--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai>` | server default | Per-request provider override |
| `--mode <auto|direct>` | `auto` | Prompt handling mode |
| `--ref <file>` | none | Attach a reference image; repeatable, max 5 |
| `--web-search` / `--no-web-search` | server default | Toggle Responses-API web search for the request |
| `--show-partial` | false | Print partial preview notices |

CLI parity note (#61): `gen`, `edit`, `multimode`, and `node generate` expose request-level web-search toggles and provider overrides. `multimode` exposes references and prompt mode. `ima2 ls --favorites` uses `/api/history?favoritesOnly=1` so favorites are filtered before pagination. `ima2 edit --mask` remains deferred to #31 because the current mask path is guided edit, not guaranteed true masked/inpaint semantics.

## Agent Discovery Commands

Issue #62 adds an explicit agent discovery layer so agents no longer have to infer package behavior from many unrelated help screens.

| Command | Role |
|---|---|
| `ima2 skill ls` | Lists the packaged `ima2`, `front`, and `uiux` skills |
| `ima2 skill [front\|uiux]` | Prints the core, frontend, or UI/UX `SKILL.md`; these package skills should be preferred for ima2 work over generic skills |
| `ima2 skill [front\|uiux] --json` | Wraps the selected Markdown skill in `{ name, format, formatVersion, packageVersion, path, source, content }` |
| `ima2 skill [front\|uiux] path` | Prints the selected installed skill file path |
| `ima2 skill [front\|uiux] refs` | Lists reference modules for the selected skill |
| `ima2 skill [front\|uiux] ref <name>` | Prints one reference module without installing the skill |
| `ima2 skill install [front\|uiux] --dir <path>` | Copies all skills, or one selected skill, to an agent-readable directory |
| `ima2 skill install [front\|uiux] --tmp` | Copies skills under `$TMPDIR/ima2-skills/` for ephemeral use |
| `ima2 capabilities --json` | Reports commands, supported/unsupported models, reasoning efforts, quality values, and limits |
| `ima2 defaults --json` | Reads running server defaults when reachable; falls back to local effective config |
| `ima2 defaults set model <model>` | Writes both `imageModels.default` and `apiProvider.defaultImageModel` |
| `ima2 defaults set reasoning <effort>` | Writes both `imageModels.reasoningEffort` and `apiProvider.defaultReasoningEffort` |

`ima2 capabilities` uses `/api/capabilities` when a running server is available, and otherwise emits local package metadata. `limits.maxGeneratedImages` reports the per-request image-count cap, and `limits.maxParallel` reports the enforced server-side inflight capacity guard.

## `ps` Options

| Option | Default | Description |
|---|---|---|
| `--kind <classic|node|multimode>` | all | Filter running jobs by kind |
| `--session <id>` | all | Filter running jobs by session |
| `--terminal` | false | Include recently completed/error/canceled jobs |
| `--json` | false | Print machine-readable JSON |
| `--server <url>` | auto-discovered | Target server URL |

## `cancel`

`ima2 cancel <requestId>` calls `DELETE /api/inflight/:requestId`. When the server still has an active abort controller for the request, cancellation aborts the in-flight provider call and records a short-lived terminal `canceled` snapshot. If the process restarted or the request already finished, the command still records cancellation intent for the known request id, but it cannot retroactively stop upstream work.

## CLI Parity Audit, 2026-05-10

Issue #61 tracks the parity slice after the browser/server surface moved ahead of the CLI.

Verified current behavior:

- `ima2 gen`, `ima2 edit`, `ima2 multimode`, and `ima2 node generate` expose `--web-search` / `--no-web-search`.
- Those commands expose `--provider <auto|oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai>` and pass it to matching server routes. `gen` drops `auto` (fail-closed lane routing) and adds `runway`/`higgsfield`.
- `ima2 multimode` exposes `--ref <file>` and `--mode <auto|direct>`.
- `ima2 ps` / `ima2 inflight ls` document `classic|node|multimode`.
- `ima2 ls --favorites` uses server-side `favoritesOnly=1` before its defensive client-side favorite filter.
- Those flags map to `webSearchEnabled` in the request body.
- Server routes normalize the request through `resolveProviderOptions(...)`.
- API-provider web search still respects the global `apiProvider.allowWebSearch` gate.

Deferred:

- `ima2 edit --mask <png>` remains under #31 until provider-backed masked edit semantics are verified.

## Server Discovery Priority

| Priority | Source | Description |
|---:|---|---|
| 1 | `--server <url>` | Strongest per-command override |
| 2 | `IMA2_SERVER` | Environment override for client commands |
| 3 | `~/.ima2/server.json` | URL/port advertisement written by the running server |
| 4 | `http://localhost:3333` | Default fallback |

## Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Success |
| 2 | Bad CLI arguments |
| 3 | Server unreachable |
| 4 | `APIKEY_DISABLED` |
| 5 | 4xx response |
| 6 | 5xx response |
| 7 | Safety refusal |
| 8 | Timeout |

## Sync Checklist

- [ ] If top-level commands in `bin/ima2.ts` change, update the server-command table.
- [ ] If `bin/commands/*.ts` options change, update the option tables and README.
- [ ] If `bin/lib/client.ts` discovery order changes, update this doc and `[[06-infra-operations]]`.
- [ ] If API response shape changes, update `[[03-server-api]]` and CLI normalization logic.
- [ ] If exit-code mapping changes, update README and tests.

## Change Log

- 2026-04-23: Documented the current CLI command surface and discovery contract.
- 2026-04-23: Translated this document from Korean to English.
- 2026-04-26: Added classic CLI parity options, cancel command, terminal inflight listing, and actual-port discovery notes.
- 2026-04-28: Documented the `serve --dev` verbose diagnostics flag and storage-doctor inclusion in `ima2 doctor`. Note that prompt-library, image-metadata, and card-news endpoints have no CLI client today; access them through the web UI or direct HTTP.
- 2026-04-30: Captured the CLI feature-parity #45 surface (multimode, node, session, history, prompt, annotate, canvas-versions, metadata, comfy, cardnews, config, inflight, storage, billing, providers, oauth) and documented the new `--reasoning-effort` and `--web-search` / `--no-web-search` flags on `gen`/`edit`. Switched all `bin/*` path references from `.js` to `.ts` source.
- 2026-05-10: Re-audited CLI parity for #61. Web-search flags are wired for `gen`, `edit`, `multimode`, and `node generate`; follow-up work was planned for provider override, multimode refs/mode, `ps` multimode help, server-side favorites listing, masked edit CLI decision, and dedicated CLI payload tests.
- 2026-05-11: Implemented the #61 CLI parity slice: provider overrides for generation commands, multimode refs/mode, multimode inflight help, server-side `ls --favorites`, and CLI feature-parity contract tests. `edit --mask` remains deferred to #31.
- 2026-05-13: Added #62 agent discovery commands: packaged `skills/ima2/SKILL.md`, `ima2 skill`, `ima2 capabilities`, and `ima2 defaults`.
- 2026-06-27: Expanded `--provider` enum (`grok-api`, `agy`, `gemini-api`), documented `ima2 backfill-thumbs`, and clarified billing vs quota CLI surfaces at ima2-gen 2.0.4.
- 2026-06-28: WP6 — documented that `inflight`/`storage`/`billing`/`providers`/`oauth` aliases dispatch through `bin/commands/observability.ts`.

Previous document: `[[01-file-function-map]]`

Next document: `[[03-server-api]]`
