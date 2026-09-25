---
created: 2026-04-23
tags: [ima2-gen, operations, build, testing]
aliases: [ima2 operations, ima2 infra, image_gen operations]
---
<!-- runtime-install:generated:start -->
| Contract | Value |
|---|---|
| Node engine | `>=22` |
| npm toolchain | `npm@11.18.0` |
| Release Node | `24.17.0` |
| CLI entry | `bin/ima2.js` |
| OpenAI SDK | `^7.4.0` |
| Express | `^5.1.0` |
<!-- runtime-install:generated:end -->

The runtime table is package-derived. Clean-checkout builds and installed-package smoke tests prove emitted JavaScript freshness.

# Infrastructure And Operations

## Local/LAN access operation

Non-loopback configuration requires a private `IMA2_LAN_TOKEN`; browser sessions
are memory-only, origin-bound, absolute eight-hour capabilities. API/media access
uses the same instance; session revocation closes admitted responses before HTTP
shutdown. Token rotation requires restart. CLI transport attaches the environment
token only after explicit server selection, with redirects disabled.

`IMA2_PUBLIC_ORIGINS` is a strict JSON array for exact serving origins (proxy/DNS/
published-port differences). No forwarded-header trust or broad CORS exception.
HTTP LAN is not encrypted; use TLS/VPN for untrusted networks. New private media
headers cannot revoke previously cached/downloaded copies; purge controlled caches.
Rollback must disable external ingress or bind loopback before reverting protection.
Windows configuration confidentiality relies on operator-directory ACLs; POSIX
private writes use exclusive0600 temporary files and atomic rename.

Native verification uses existing hosted CI, LAN/session/media/CLI tests and J9
with synthetic providers/credentials. The fixture keeps actual binds loopback and
unchanged child egress/filesystem/process restrictions. See docs/API.md and CLI.md
for user contracts; no private state or credential is part of runtime receipts.

`ima2-gen` operates as an npm package, local Node server with an in-process GPT OAuth client, SQLite-backed graph store, image file store, and React build artifact. Users see one CLI, but internally the server, UI bundle, local config, runtime port discovery, and runtime data move together.

This document matters because development mode and packaged mode take different paths. Developers run `npm run dev`, which builds the UI and launches the watched server. Users run `ima2 serve`, which checks for `ui/dist` and starts the server. Node mode is enabled in both paths by default. CLI clients read `~/.ima2/server.json` to find the running server. Config and generated data are split between the repo and the user's home directory.

For operations work, choose the layer first. Auth and provider changes touch config and the GPT OAuth client (`lib/codexBackend`). Release work touches `package.json`, `files`, and `prepublishOnly`. Test work touches `scripts/run-tests.mjs` and `tests/*.test.{js,ts,mjs,cjs,mts,cts}`. UI build work touches `ui/package.json` and `ui/dist`.

---

## Runtime Layout

```mermaid
graph TD
    CLI["ima2 CLI"] --> CFG["~/.ima2/config.json"]
    CLI --> ADV["~/.ima2/server.json"]
    CLI --> SRV["server.js"]
    SRV --> DIST["ui/dist"]
    SRV --> GEN["~/.ima2/generated"]
    SRV --> DB["SQLite via better-sqlite3"]
    SRV --> OAUTH["lib/codexBackend<br/>chatgpt.com/backend-api/codex"]
    SRV --> XAI["api.x.ai<br/>OAuth bearer / API key"]
    SRV --> ENV["env vars"]
    SRV --> ADV["actual runtime URLs<br/>~/.ima2/server.json"]
```

## Package Contract

| Item | Current value |
|---|---|
| package name | `ima2-gen` |
| version | `package.json` is authoritative; release commits update it before promotion |
| type | `module` |
| bin | `ima2` -> `./bin/ima2.js` |
| package engine | generated runtime-install table above; `package.json` is authoritative |
| release toolchain | Node `24.17.0` from `.node-version`; npm `11.18.0` from `packageManager` |
| publish files | `bin/**/*.js`, `lib/**/*.js`, `routes/**/*.js`, `skills/`, `ui/dist/`, `docs/`, `assets/card-news/templates/`, `integrations/comfyui/ima2_gen_bridge/*`, `server.js`, `config.js`, `.env.example`, `README.md`, `CHANGELOG.md`, `LICENSE` |
| bundled dependencies | `zod` |
| major dependencies | `@openai/codex`, `express`, `openai`, `better-sqlite3`, `dotenv`, `sharp`, `trash`, `ulid`, `zod`; exact versions come from the package manifest and lockfile |

README may still mention a different Node baseline. The operational baseline is the current `engines.node` field in `package.json`.

## Desktop macOS signing

`desktop.yml` separates unsigned PR previews from trusted dispatch/tag builds.
`desktop/scripts/desktop-build-policy.mjs` validates platform selection before
scheduling and checks required signing input presence. Secret-bearing steps and
publication conditions use GitHub event/ref/input context directly, not outputs
computed by PR code. Distribution is Apple Silicon macOS only: pull requests and
tag pushes build `mac` alone, while Windows and Linux stay selectable through
manual dispatch so widening distribution later is a config decision rather than a
rebuild of this policy. A dispatched build can never publish; a `desktop-v*` tag is
the only ref that reaches a release, because it pins the version the build
validates against and is the ref a protection rule can guard.

The existing `desktop/build/sign-extra-binaries.mjs` hook awaits the builder's
lazy keychain import, then signs loose Mach-O sidecars with the same scoped
Developer ID identity. Forced signing fails on incomplete discovery or scanning.
`verify-mac-signature.mjs` supplies native bundle checks;
`verify-mac-artifacts.mjs` verifies every architecture declared by
`desktop/electron-builder.yml`, extracts ZIPs and mounts
DMGs read-only, compares each app's signed-content fingerprint to its original,
and emits source-bound reports and hashes under `desktop/dist/signature-proof`.
Verification failure blocks installer export. Uncertain mounts are preserved
for diagnostics instead of recursively cleaned. Builder import failure before
disposer registration relies on disposable hosted-runner destruction.

The declared target set is the single source of truth for both packaging and
verification: re-adding `x64` to `mac.target[].arch` widens what is built and what
must be proved, with no second architecture list to keep in step.

Use `gh workflow run desktop.yml --ref <reviewed-branch> -f platform=mac`
for recovery verification. This is distinct from public release publication.

## Desktop release and updates (Apple Silicon)

A `desktop-v*` tag must equal `desktop-v${package.json.version}` at the tagged commit.
The root manifest is the packaged app selected by `directories.app: ..`, so it owns both
the shipped version and production dependencies; `desktop/package.json` owns only the
Electron build toolchain.

`prepare-release-assets.mjs` runs on the release runner with no installed
dependencies. It reads the signing proof, refuses a proof whose source SHA, ref,
version, team, authority or export results do not vouch for this exact release,
re-hashes the downloaded installers against the proof so artifacts cannot be
swapped in transit, revalidates `latest-mac.yml` file names, sizes and SHA-512
values, then writes `SHA256SUMS.txt` and release notes carrying the build commit,
Apple Team ID and signing authority.

The published asset set is exactly the DMG, the ZIP, their blockmaps,
`latest-mac.yml` and `SHA256SUMS.txt`. The signing proof stays an Actions artifact and
is never published. `draft_release` creates the draft and records the checksum-list
and release-notes digests as job outputs. A separate `publish_release` job references
the `desktop-production` environment, requires its environment-scoped
`DESKTOP_RELEASE_GATE=required-reviewer-v1` marker, rechecks the exact asset
allowlist, redownloads the assets to confirm those digests and every listed file,
and only then flips the draft public without making it the repository's Latest
release. A rerun against an already public release refuses rather than replacing
assets.

Keep the gate variable at environment scope: a repository-scoped copy would
satisfy the marker even with no environment protection. Leave prevent-self-review
off while the owner is the only reviewer, since enabling it would leave no one
able to approve. Configure a tag ruleset restricting `desktop-v*` creation before the
first live release; without it any actor with push access can mint the tag that
spends the repository signing secrets.

`electron-updater@6.8.9` is active only in a packaged `darwin/arm64` app. It checks
once after the local server starts and exposes `Check for Updates…` in the macOS app
menu. Automatic download and install-on-quit are disabled: the user approves
download and then restart separately. Before `quitAndInstall()`, the app stops and
disposes the local server. Draft releases stay invisible to installed updaters
until the approved publication above. A live signed two-version update remains
separate follow-up proof.

## Script Surface

| Script | Runs | Purpose |
|---|---|---|
| `npm start` | `node bin/ima2.js serve` | Start the server like a user would |
| `npm run dev` | `node scripts/dev.mjs` | Build UI, then run watched server |
| `npm run dev:server` | `tsx watch server.ts` | Watch the TypeScript server source directly |
| `npm run ui:install` | `npm --prefix ui ci` | Install the exact UI lockfile |
| `npm run ui:dev` | `cd ui && npm run dev` | Vite dev server |
| `npm run ui:build` | `cd ui && npm run build` | TypeScript build and Vite build |
| `npm run build` | `npm run ui:build` | Build UI bundle before publish |
| `npm run build:server` | `tsc -p tsconfig.build.json` | Emit ignored `*.js` runtime artifacts for `server`, `routes/`, `lib/`, `config` |
| `npm run build:cli` | `tsc -p tsconfig.bin.json && node scripts/fix-shebangs.mjs` | Emit ignored CLI runtime artifacts for `bin/` and reinstate shebangs |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | Source-level type check for the migrated TypeScript surface |
| `npm run typecheck:tests` | `tsc -p tsconfig.tests.json --noEmit` | Type check for the `tests/` overlay (runs against the test-only tsconfig) |
| `npm run test:inventory` | `node scripts/classify-tests.mjs --check --fail-js-runtime` | Inventory gate: classifies `tests/*` and fails if a `.js` runtime test slips back in instead of `.ts` |
| `npm test` | `node scripts/run-tests.mjs` | Run `tests/*.test.{js,ts,mjs,cjs,mts,cts}` with `node:test` |
| `npm run setup` | `node bin/ima2.js setup` | Configure provider |
| `npm run lint:pkg` | package metadata check | Validate package fields and publish file list |
| `npm run test:package-install` | temp tarball install smoke | Installs packed package and checks `ima2 doctor`, `/api/health`, and `/api/storage/status` |
| `npm run test:native-deps` | native import smoke | Fail closed unless `better-sqlite3` and `sharp` load |
| `npm run test:install-policy` | manifest/lock policy check | Require every install script to be approved and both bundled dependencies to match the lock root |
| `npm run test:install-policy:npm12` | npm pending-script oracle | Require npm 12 to report no pending root/UI install scripts |
| `npm run verify:release:source` | canonical source gate | Native imports, typechecks, inventory, builds, full tests, package lint, install policy, root production audit, and UI build-dependency audit |
| `npm run verify:release` | canonical release gate | Source gate plus a real packed-package install and server smoke |
| `npm run docs:refresh-line-counts` | `node scripts/refresh-structure-line-counts.mjs` | Refresh `structure/01-file-function-map.md` lib/bin/route line counts; pass `--check` in CI |
| `prepack` | `ui:build && build:server && build:cli` | Rebuild runtime artifacts (UI, server, CLI) before tarball |
| `prepublishOnly` | OIDC context assertion + `verify:release` | Blocks accidental directory publishing outside the registered OIDC workflow; the workflow publishes only its already-tested tarball with lifecycle scripts disabled. |

`release:*` scripts dispatch `.github/workflows/release.yml`, which runs the verified preview -> stable-tag OIDC flow in CI and creates the GitHub Release only after npm proof. Agents must not run them unless the user explicitly asks.

## Config And Data Locations

| Location | Role | Caution |
|---|---|---|
| `~/.ima2/config.json` | Provider config and possible API key location | May contain secrets; never paste values into docs |
| `~/.ima2/server.json` | Running server runtime advertisement | Used by CLI/Vite discovery; includes top-level backend URL plus nested backend/OAuth configured and actual ports |
| `${configDir}/mcp/<provider>.json` | Versioned MCP OAuth credential record | Atomic mode 0600; includes endpoint/redirect-origin binding metadata and must never enter diagnostics or support bundles |
| `${configDir}/mcp/snapshots/` | Sanitized MCP tool snapshots | Contains schemas/metadata, not OAuth credentials |
| `image_gen/.ima2/config.json` | Legacy config location | New CLI prefers the home config |
| `~/.ima2/generated/` | Image files and sidecar metadata | Runtime output; survives npm global updates. Startup migration scans legacy package `generated/` folders across npm, npx, pnpm, Yarn, Bun, nvm/fnm, asdf/mise, Volta, and common macOS/Linux/Windows global layouts |
| `~/.ima2/generated/.trash/` | Legacy in-package soft-deleted assets folder | Soft-delete now uses the OS trash via the `trash` dep (`lib/systemTrash.ts`); this folder remains for legacy rows pending purge |
| SQLite DB | Session graph storage | Managed through `lib/db.ts` and `lib/sessionStore.ts` |
| `ui/dist/` | Active UI bundle served by server | Build output, not source |

`ima2 doctor` includes a Storage section with the current gallery path, legacy-source counts, and recovery-guide pointer. The browser gallery also calls `/api/storage/status` and can open the current generated folder through `/api/storage/open-generated-dir`; that endpoint accepts no arbitrary path.

Machine `doctor --json` uses fixed code-derived messages with a fail-preserving
summary; it does not serialize free-form provider errors or storage paths.
`--installation --json` runs before config/account initialization and checks only
the package engine, dependencies/bins, in-memory native binding, skills and UI.
`--verify-keys` is explicit non-generating remote authentication, with a5000ms
deadline; `--runtime <loopback-origin>` is explicit local health/version with a1500ms
deadline and no credentials/redirects. Neither establishes provider generation
success. Timeout overrides are capped at30000ms. Generic logger error strings
redact URL-shaped/Bearer/query credentials before truncation and omit nested
cause/body/stack data; this does not claim arbitrary opaque free text is safe.

## Environment Variables

| Variable | Default or meaning |
|---|---|
| `OPENAI_API_KEY` | May be used for billing probes and legacy provider config |
| `IMA2_PROMPT_BUILDER_BACKEND` | Prompt Builder backend, default `auto`; accepted values are `auto`, `oauth`, `grok`, `api`, `grok-api`. Locks `promptBuilder.backend` in Settings. |
| `IMA2_PROMPT_BUILDER_MODEL` | Backend-scoped Prompt Builder model, default `auto` for the Auto backend. Locks `promptBuilder.model` in Settings. |
| `NOVELAI_API_KEY` | NovelAI persistent API token for the `nai` lane; no fixed prefix is required, and an env-sourced key is immutable from the UI (`ENV_KEY_IMMUTABLE`) |
| `IMA2_NAI_IMAGE_MODEL_DEFAULT` | NovelAI default image model, default `nai-diffusion-5-full` |
| `IMA2_NAI_BASE_URL` / `IMA2_NAI_ACCOUNT_BASE_URL` | NovelAI image and account hosts, both default `https://image.novelai.net` — account endpoints moved to the image host, so `api.novelai.net` rejects valid tokens |
| `IMA2_NAI_GENERATION_TIMEOUT_MS` | NovelAI request timeout, default `180000` |
| `IMA2_NAI_DEFAULT_STEPS` / `IMA2_NAI_DEFAULT_SCALE` | NovelAI sampling defaults, `23` and `5` |
| `IMA2_PORT` / `PORT` | Server preferred port, default `3333`; falls back to next free port when occupied |
| `IMA2_HOST` | Server bind host, default `127.0.0.1` |
| `IMA2_OAUTH_PROXY_PORT` / `OAUTH_PORT` | Port of the external GPT OAuth endpoint used with `IMA2_NO_OAUTH_PROXY=1`, default `10531` |
| `IMA2_SERVER` | CLI target server URL override |
| `IMA2_CONFIG_DIR` | Used by tests to isolate config directory |
| `IMA2_MCP_PROVIDERS` | Comma-separated compiled MCP provider allowlist; defaults to `runway,higgsfield` |
| `IMA2_MCP_TOKEN_DIR` | MCP credential directory override; one running ima2 process must own a token directory |
| `IMA2_MCP_SNAPSHOT_DIR` | Sanitized MCP tool snapshot directory override |
| `IMA2_ADVERTISE_FILE` | Overrides runtime discovery file path |
| `VITE_IMA2_API_TARGET` / `IMA2_DEV_API_TARGET` | Split Vite dev API proxy target override |
| `IMA2_IMAGE_MODEL_DEFAULT` | Server fallback GPT OAuth image model, default `gpt-6-luna` |
| `IMA2_REASONING_EFFORT` | Server OAuth/default reasoning effort, default `medium` |
| `IMA2_API_IMAGE_MODEL_DEFAULT` | Default image model for `provider: "api"` (Responses path), default `gpt-5.6-luna` |
| `IMA2_API_REASONING_EFFORT` | Default reasoning effort for `provider: "api"`, default `low` |
| `IMA2_API_IMAGE_SIZE` | Default size for `provider: "api"`, default `1024x1024` |
| `IMA2_API_ALLOW_WEB_SEARCH` | Toggle web search for `provider: "api"`, default `true` |
| `IMA2_GROK_PLANNER_MODEL` | Search/planner model for `provider: "grok"` classic generation, default `grok-4.5`; `grok-4.3` remains a compatibility override |
| `IMA2_GROK_PLANNER_TIMEOUT_MS` | Timeout for the Grok planner call, default `900000` |
| `IMA2_GROK_SEARCH_TIMEOUT_MS` | Timeout for the degradable Grok web-search brief, default `300000` |
| `IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS` | Ceiling on search + planner combined, default `1500000` (clamped to at least search + planner + 60 s) |
| `IMA2_GROK_IMAGE_MODEL_DEFAULT` | Default xAI image model for `provider: "grok"`, default `grok-imagine-image-quality` |
| `IMA2_GROK_VIDEO_MODEL_DEFAULT` | Default xAI video model for `provider: "grok"`, default `grok-imagine-video-1.5` |
| `IMA2_GROK_GENERATION_TIMEOUT_MS` | Timeout for final Grok image generation/edit calls, default `120000` |
| `IMA2_GROK_STATUS_TIMEOUT_MS` | Timeout for `/api/grok/status` model probes, default `3000` |
| `IMA2_OAUTH_MASKED_EDIT_ENABLED` | Feature flag (#31) gating masked-edit requests on the OAuth path; default off — when off, `lib/oauthProxy/generators.ts` rejects requests carrying a mask before calling upstream |
| `IMA2_INFLIGHT_TTL_MS` | Active in-flight stale-job TTL, default `5400000` (must outlive the longest legal request) |
| `IMA2_INFLIGHT_TERMINAL_TTL_MS` | Recent completed/error/canceled job debug retention, default `30000` |
| `VITE_IMA2_NODE_MODE` | UI build-time gate; set `0` only for a classic-only bundle |
| `IMA2_LOG_LEVEL` | Normal `ima2 serve` defaults to `warn`; `IMA2_DEV=1` defaults to `debug` unless env or config override is set |
| `IMA2_DEV` | Master dev gate; enables verbose logs and turns on `config.features.cardNews` |
| `IMA2_CARD_NEWS` | Server feature flag for the dev-only card-news API surface; either this or `IMA2_DEV=1` mounts `routes/cardNews.js` |
| `IMA2_CARD_NEWS_PLANNER` | Optional flag to enable LLM-backed card-news planning |
| `IMA2_CARD_NEWS_PLANNER_MODEL` | Model used when the card-news planner is enabled, default `gpt-6-luna` |
| `IMA2_CARD_NEWS_PLANNER_TIMEOUT_MS` | Card-news planner request timeout |
| `IMA2_CARD_NEWS_PLANNER_FALLBACK` | Switch for falling back to the deterministic planner when the LLM planner fails |
| `IMA2_GENERATED_DIR` / `IMA2_GENERATED_DIRNAME` | Override the generated images directory (absolute path or directory name under `~/.ima2`) |
| `IMA2_TRASH_DIR` / `IMA2_TRASH_DIRNAME` | Override the trash directory used by soft-delete |
| `IMA2_TRASH_TTL_MS` | Soft-delete retention before permanent purge |
| `IMA2_DB_PATH` | Override the SQLite database path |
| `IMA2_HISTORY_PAGE_SIZE` / `IMA2_HISTORY_MAX_PAGE` | History pagination tuning |
| `IMA2_BODY_LIMIT` | Express JSON body limit |
| `IMA2_MAX_REF_B64_BYTES` | Max base64 size per reference image |
| `IMA2_MAX_METADATA_READ_B64_BYTES` | Max base64 size accepted by `/api/metadata/read` |
| `IMA2_MAX_REF_COUNT` | Max number of reference images per request |
| `IMA2_MAX_GENERATED_IMAGES` | Max generated images per request (classic `n`, multimode `maxImages`, and UI count controls) |
| `IMA2_MAX_PARALLEL` | Max concurrent generation jobs |
| `IMA2_GRAPH_MAX_NODES` / `IMA2_GRAPH_MAX_EDGES` | Session graph save guardrails |
| `IMA2_GENERATED_HEX_BYTES` / `IMA2_NODE_HEX_BYTES` | Filename randomness for classic and node assets |
| `IMA2_INFLIGHT_REAP_MS` | Inflight registry sweep interval |
| `IMA2_OAUTH_STATUS_TIMEOUT_MS` | `/api/oauth/status` upstream timeout |
| `IMA2_OAUTH_RESTART_DELAY_MS` | Legacy restart cooldown; unused by the in-process GPT OAuth client |
| `IMA2_NO_OAUTH_PROXY` | Send GPT OAuth calls to an external OpenAI-compatible endpoint instead of ChatGPT |
| `IMA2_CODEX_CLIENT_VERSION` | Codex client version sent to ChatGPT; default is the latest `@openai/codex` release, at least `0.157.0` |
| `IMA2_RESEARCH_SUFFIX` | Optional suffix appended when research mode is on |
| `IMA2_STYLE_SHEET_MAX_PREFIX` | Max characters of a session style sheet injected into the next prompt |
| `IMA2_STYLE_MODEL` | Model used by `/api/sessions/:id/style-sheet/extract` (API-key client), default `gpt-5.6-luna` |
| `IMA2_STATIC_MAX_AGE` | Static asset Cache-Control max-age |
| `VITE_IMA2_DEV` | UI build-time dev flag; pairs with `VITE_IMA2_CARD_NEWS=1` to expose the dev-only card-news workspace in the bundle |

`IMA2_GROK_PROXY_HOST`, `IMA2_GROK_PROXY_PORT`, `IMA2_NO_GROK_PROXY`, and `IMA2_GROK_RESTART_*` were removed in 3.16 with the proxy itself; setting them now does nothing.

Generation and edit endpoints support OAuth, API-key, Grok, Gemini, Atlas Cloud, MiniMax, NovelAI, and ComfyUI providers. `provider: "nai"` calls the NovelAI image API with a saved persistent token, decodes the returned ZIP archive to PNG, and is text-to-image only — references and edits are refused rather than downgraded. `provider: "api"` calls the OpenAI Responses API with the hosted `image_generation` tool and requires `OPENAI_API_KEY` or the configured API key path. `provider: "grok"` calls `https://api.x.ai` directly with the xAI OAuth session stored in `~/.progrok/auth.json`; classic, Node, and Agent generation perform mandatory xAI Web Search and then a `grok-4.5` custom-tool planner call before executing xAI Images API. xAI does not document OAuth access to `api.x.ai` — only `/v1/me` is documented as accepting an OAuth token — so this lane works today but carries no compatibility promise; `grok-api` with `XAI_API_KEY` remains the documented path. If Grok generation includes references, a Node parent image, or an Agent current image, those images are sent into the planner and the final image call uses xAI `/v1/images/edits` with the same references instead of the text-only generation endpoint. Grok Node requests are capped at three total input images, and Agent Grok turns force web search on because the planner depends on it.

Runtime port fallback is intentional. If the preferred backend port is occupied, the server records the actual bound URL in `~/.ima2/server.json` and health/status responses. CLI clients and split Vite dev proxy resolution should consume that actual URL instead of reconstructing `localhost:${configuredPort}`.

MCP restore begins only after that actual backend port is published, because the callback origin is part of the credential binding. A usable same-binding record restores automatically without opening a browser. Endpoint/origin mismatches remain on disk and surface as `auth_required`; only a new user-initiated Connect flow may replace the registration after token exchange succeeds. Missing, corrupt, pending-only, and disabled records remain passive. OAuth state and PKCE verifiers intentionally live only in memory, so a browser flow interrupted by process restart cannot resume.

Startup restore is limited to two providers concurrently and 15 seconds per provider. A terminal current-transport failure gets one delayed reconnect; ordinary transient errors do not force a false disconnect. Local Disconnect writes a tombstone and clears the local client/token state but does not claim provider-side revocation. On shutdown, restore controllers and reconnect timers are canceled before clients close; HTTP and MCP shutdown start concurrently under a 2.9-second coordinator grace.

Do not run two ima2 processes against the same MCP token directory. The store uses revision checks, tombstones, and a PID+nonce recovery lock to fail closed around stale writes, but shared multi-process ownership is not a supported operating mode. Safe status may include state, timestamps, tool counts, snapshot drift, and stable diagnostic codes; it must never include access/refresh tokens, authorization codes, PKCE values, cookies, account identifiers, Authorization headers, or raw upstream errors.

## Observability

The server emits safe structured log lines for route lifecycle, OAuth responses, stream image receipt, inflight phase changes, session graph saves, and gallery history grouping. Normal `ima2 serve` is intentionally quiet and defaults structured logs to `warn`. `npm run dev`, `ima2 serve --dev`, and `IMA2_DEV=1` default to `debug` unless `IMA2_LOG_LEVEL` or `~/.ima2/config.json` provides an explicit log level. `IMA2_LOG_LEVEL` supports `debug`, `info`, `warn`, `error`, and `silent`; invalid values fall back to `info`.

Every `/api/*` request gets a sanitized `X-Request-Id` header. Static UI files and `/generated/*` images are deliberately outside the request logger so gallery image serving does not create log noise or surprise headers. Correlate a UI request with `requestId` first, then follow the same id through `[http.request]`, `[generate.request]`, `[oauth.response]`, `[inflight.phase]`, `[oauth.image]`, `[generate.saved]`, `[http.response]`, and `[inflight.finish]`.

Logs intentionally use counts rather than sensitive values: `promptChars`, `refs`, `imageChars`, `durationMs`, and `errorCode`. Do not add raw prompts, style-sheet bodies, data URLs, generated base64, tokens, cookies, or raw upstream response bodies to logs.

## npm Publish (OIDC)

Production releases use GitHub Actions `.github/workflows/publish.yml` with npm **trusted publishing** (OIDC):

| Trigger | npm dist-tag | Notes |
|---|---|---|
| Push to `preview` | `preview` | Publishes `X.Y.Z-preview.YYMMDD.RUN_ID.ATTEMPT`; a stable-tagged SHA already at `latest` is skipped |
| Push stable tag `vX.Y.Z` | `latest` | Tag/version must match, version must advance npm `latest`, and main/dev/preview/tag must identify the same source |

Scoped `workflow_dispatch` with `publish_ref`/`publish_sha` is also supported; GitHub Release events are not publish triggers. All third-party Actions use full commit SHAs. Jobs are `prepare`, `package`, `windows-consumer`, `publish-preview`, `publish-stable`, `create-github-release`, and `verify-existing`. OIDC is confined to the two publishers and the post-publish attestation job; packaging has no OIDC token. The package job runs the canonical source gate, packs once, embeds `gitHead`, records SHA-512/integrity in `release-manifest.json`, emits `sbom.cdx.json`, and install-smokes that tarball. The preview lane additionally installs/updates that artifact on Windows Node22/npm11 and Node24/npm12 and probes package-local Codex/OAuth. Stable publication revalidates the matching preview source-SHA proof rather than repeating that consumer matrix.

Codex login uses the package-local JavaScript bin with `cli_auth_credentials_store="file"`; the proxy requires a concrete auth file passed through `--oauth-file`. A keyring-only session is not proxy-ready. Publishers download the tested artifacts, recheck live refs, publish immutable bytes and verify registry/tag/integrity/Sigstore provenance. The stable follow-on creates the GitHub Release and attaches its manifest/SBOM; the TGZ is available from npm and the Actions artifact, not assumed to be a GitHub Release attachment. `verify-existing` recovers already-published versions without republishing. Repository, workflow, allowed ref, source commit, original run/attempt, GitHub-hosted builder and subject SHA-512 must agree; `npm audit signatures` performs cryptographic verification. A failed-job rerun checks immutable registry state before deciding whether publishing is necessary.

`.github/workflows/release.yml` owns the cut. Its baseline must equal origin/main and contain dev/preview and the recorded required-unit commits. It creates the version commit, runs release verification, and proves exact-candidate CI through a leased candidate ref **before** moving main/preview. It then publishes/verifies preview. The `npm-stable` environment gates tagging; after preview proof and unmoved-ref checks, the tag job atomically pushes main/dev/tag and dispatches stable publication. Both cut/tag jobs have scoped contents/actions writes and no OIDC publication permission. `expected_sha` guards the caller's chosen baseline; real release, dry-run and canary modes remain distinct.

`publish.yml` is reached by `workflow_dispatch` as well as by its original preview/tag pushes, because a push authenticated with `GITHUB_TOKEN` emits no workflow event; without that dispatch a CI-minted tag would leave an immutable tag with no npm package. The dispatch cannot widen what may be published: `PUBLISH_REF`/`PUBLISH_SHA` feed the same `classifyPublish`, which still accepts only `refs/heads/preview` or a `v*` tag matching `package.json`, and stable publishing still requires `main`, `dev`, `preview`, and the tag to share one SHA plus a matching npm preview `gitHead`. Every checkout in that workflow pins the published SHA so a dispatch cannot package the default branch. Recovery for an already-published version is the `verify-existing` job, which reuses `ensure-github-release`.

## Development And Verification

Pages publication is an explicit post-stable step, not a main-push side effect.
Dispatch pages.yml with release_version and the full release_sha only after the
canonical package publication is verified. Its build checks provenance, installs
that exact registry version in an owned directory, runs offline installation
doctor, and binds the report to source/tag/exact/latest metadata before uploading
the site. Failure leaves the previous site live. Once latest advances, recovery
uses a corrected forward release; an arbitrary older site cannot bypass this gate.

`npm run docs:runtime` projects package/.node-version metadata into current docs
and source/public installers. `npm run docs:runtime:check` checks drift without
writes. Windows scheduled and candidate CI both require exact-SHA checkout,
hosted installer behavior and packed installation before claiming acceptance.

Candidate CI binds every Linux, Windows, macOS-install and UI checkout to the
requested SHA (or event SHA when no override was supplied). macOS runs focused
native installer/offline-doctor/packed smoke, not another full suite. PR Fast runs
for every PR base, checks the synthetic merge SHA, and prints the separate PR head
SHA. Full Git history is required by existing release provenance checks; HEAD^1
alone is enough only for the blob budget. A pending/cancelled/missing job is not
acceptance. After a branch changes, prior runtime checks do not verify the new tip.
PR backend and frontend checks use independent hosted runners: server tests must
not leave configuration stores on the UI fixture's otherwise untouched machine.
The terminal check retains the name `PR fast gate` and succeeds only when both
jobs succeed. Existing UI isolation guards are unchanged; no stores are deleted.

The API guard matches `/api` case-insensitively with a segment boundary. Its only
OAuth callback exemption is GET on the exact callback path; state/PKCE validation
still owns that redirect. Per-app request budgets then run before JSON parsing:
600 total and120 mutating requests per socket peer per60 seconds, at most4096
tracked peers. Responses exceeding a budget return429/API_RATE_LIMITED with
Retry-After. Forwarded headers cannot choose a budget identity. Existing SSE
frames are not new requests; static UI/media are outside this admission counter.
These code-owned defaults and existing job concurrency limits protect one process,
not a distributed deployment. LAN explicit-token comparisons additionally share
a 10-failures/60-second socket-peer cooldown across API/media/status/bootstrap.
Valid cookie-only access is not blocked by bearer cooldown; cookie expiry and
normal token-free loopback use retain their own rules.

### Installed release UI verification

The `published-ui-smoke.yml` workflow reuses the installed-tarball smoke's
owned server and the existing Playwright dependency. `artifact_kind=candidate`
exercises a packed current checkout; `artifact_kind=published` requires the exact
stable tag, registry/provenance and manifest/TGZ digest before installation.
Candidate evidence never substitutes for published evidence. The driver commit
and installed product commit are recorded separately.

After canonical publication:

```sh
gh workflow run published-ui-smoke.yml --ref main \
  -f artifact_kind=published -f release_sha=<release-sha> -f release_version=<version>
```

The opt-in `IMA2_PACKAGE_UI_OUTPUT_DIR` in `tests/package-install-smoke.mjs`
captures desktop/mobile NovelAI panes from installed assets, with synthetic
provider metadata and no generation/account mutations. Real health/auth/static
responses remain unmocked; served JS/CSS bytes are checked against the installed
manifest. Read the original screenshots and JSON before accepting the result.
Published verification is manual-only. A path-filtered push trigger on the single
release-preparation branch bootstraps candidate evidence before the workflow
exists on main; it cannot select published mode. The workflow neither publishes
nor schedules follow-up work; existing package
smoke runs without this option do not launch a browser.

Accepted `/api/events` response headers include `x-ima2-event-cursor`, the effective
cursor before replay. CLI `openSse` exposes a validated `initialEventId` before the
job POST, so an EOF before any frame can reconnect without submitting the job
again. Missing headers support older servers but do not promise this recovery.
Retention gaps still use existing snapshot/error handling and tracking deadlines.

Node metadata/image readers check the canonical target against configured generated
storage, including the metadata-absent parent fallback. Canvas update/bake/revert
checks existing media and sidecars; writes preflight both leaves before changing
the image. Canvas leaf links/directories are refused, while absent new output files
are allowed. Single-asset trash cannot target a directory or storage root; restore
validates source, optional sidecar and destination parent before moving files.
These are path-boundary checks, not atomic protection from concurrent privileged
filesystem replacement.

| Task | Command | Expected result |
|---|---|---|
| Full test suite | `npm test` | `scripts/run-tests.mjs` runs `tests/*.test.{js,ts,mjs,cjs,mts,cts}` |
| UI build | `npm run build` | `ui/dist` is updated |
| Dev server | `npm run dev` | UI is built, then `tsx watch server.ts` starts with verbose diagnostics |
| Package sanity | `npm run lint:pkg` | Required `files[]`, `bin`, and version fields are checked |
| Package smoke | `npm pack --dry-run --json` | Verifies the publish manifest includes release-critical files |
| Package install smoke | `npm run test:package-install` | Installs the tarball in a temp project and checks `doctor`, `/api/health`, and `/api/storage/status` |
| Release contract | `node --import tsx --test tests/release-pipeline-contract.test.ts` | Exercises event/ref/version, immutable preview/rerun guards, npm 11/12 pack output, artifact digest, provenance, and local-publish guards |
| Windows global update | `npm run test:package-global-update` | Installs the previous release into an isolated global prefix, updates with the candidate tarball, and probes package-local Codex/OAuth without PATH assistance |
| npm 12 policy | `npx --yes --package npm@12.0.0 npm run test:install-policy:npm12` | npm and the custom checker report no unapproved install scripts |
| CLI health | `ima2 ping` | Checks `/api/health` on the running server |

## Pre-Release Checklist

- [ ] Run `npm ci` and `npm --prefix ui ci` with the pinned toolchain.
- [ ] Run `npm run verify:release`; this includes the full tests, builds, package lint, audit, and real tarball install smoke.
- [ ] Run the npm 12 root/UI clean-install lanes and `npm run test:install-policy:npm12`.
- [ ] Run `actionlint .github/workflows/publish.yml .github/workflows/ci.yml` and the focused release-contract test.
- [ ] Check README and `structure/` docs for Node baseline, provider wording, and CLI table drift.
- [ ] Run release scripts only with explicit authorization; they move remote refs and trigger immutable npm versions.

## Change Checklist

- [ ] If `package.json` scripts or engines change, update this doc.
- [ ] If config file locations change, update discovery flow in `[[02-command-reference]]`.
- [ ] If the GPT OAuth client (`lib/codexBackend`) changes, update `[[03-server-api]]` and provider docs.
- [ ] If `ui/dist` publish policy changes, update `[[04-frontend-architecture]]`.
- [ ] If tests are added, update the test map in `[[01-file-function-map]]`.

## Change Log

- 2026-04-23: Documented package, scripts, config, runtime data, and test/build operations.
- 2026-04-23: Translated this document from Korean to English.
- 2026-04-24: Added inflight terminal TTL and safe logging operations notes.
- 2026-04-25: Added npm package smoke guidance for release-critical file inclusion.
- 2026-04-25: Updated package metadata for version 1.1.0, `routes/`/`docs/` publish contract, and install-smoke script.
- 2026-04-25: Updated logging operations for dependency-free levels, request IDs, and API-only middleware.
- 2026-04-26: Documented actual runtime port fallback, CLI/Vite discovery, and image model default override.
- 2026-04-28: Bumped package metadata to ima2-gen 1.1.5, added `sharp` as a major dependency, recorded the full `prepublishOnly` chain, and expanded the environment variable surface to cover dev/card-news flags, generated/trash directory overrides, SQLite path, OAuth timeouts, style-sheet limits, body/reference/metadata limits, graph guardrails, and Vite dev flags.
- 2026-04-30: Bumped package metadata to ima2-gen 1.1.8 — added `trash` as a major dependency for OS-trash soft delete (`lib/systemTrash.ts`), expanded the publish files list with `assets/card-news/templates/`, `integrations/comfyui/ima2_gen_bridge/*`, and TypeScript-source pairs (`server.ts`, `config.ts`), introduced the `prepack` artifact-refresh chain, added `build:server`, `build:cli`, `typecheck` scripts, switched `dev:server` to `tsx watch server.ts`, and removed `npm test` from the `prepublishOnly` chain (run tests explicitly before publish).
- 2026-05-06: Bumped package metadata to ima2-gen 1.1.10. Added `npm run typecheck:tests` (`tsconfig.tests.json`) and `npm run test:inventory` (`scripts/classify-tests.mjs --check --fail-js-runtime`) as pre-publish gates and updated the `prepublishOnly` chain accordingly. Added env vars `IMA2_API_IMAGE_MODEL_DEFAULT`, `IMA2_API_REASONING_EFFORT`, `IMA2_API_IMAGE_SIZE`, `IMA2_API_ALLOW_WEB_SEARCH` (API-key Responses defaults, #49) and `IMA2_OAUTH_MASKED_EDIT_ENABLED` (#31 masked-edit feature flag). Noted the `lib/oauthProxy.ts` → `lib/oauthProxy/*` subtree split (#50) — no env-var or publish-file change.
- 2026-05-13: Added `skills/` to the package contract for #62 and documented `IMA2_REASONING_EFFORT` as the OAuth/default reasoning env override exposed by `ima2 defaults`.
- 2026-05-30: Updated the package version snapshot to `ima2-gen` 1.1.14 (re-grounding pass). Agent Mode (`routes/agent.ts` + `lib/agent*.ts`) and the prompt builder (`routes/promptBuilder.ts`) ship inside the existing `routes/` and `lib/` publish paths; see `[[00-structure-hub]]` and `[[03-server-api]]` for the added runtime surface since 1.1.10.
- 2026-06-01: Updated the package/runtime note for shipped Grok video support: progrok-backed video generation, edit, extension, frame extraction, analysis, and branch-local continuation are in the runtime scope; the older image-only wording no longer applies.
- 2026-06-27: Bumped operational baseline to ima2-gen 2.0.4; documented OIDC trusted publishing via `publish.yml` (`latest` on GitHub Release, `preview` on preview branch push).
- 2026-06-28: WP6 — added `npm run docs:refresh-line-counts` and documented `tests/{structure-line-counts,api-docs,cli-feature-parity}-contract.test.js` as docs drift gates.
- 2026-07-07: OIDC-only release flow — `scripts/release.sh` and `release:*` no longer run credentialed `npm publish`; the GitHub Release (via `gh release create`) is the sole production publish trigger, and `publish.yml` gained a release-tag/package-version guard. GPT-5.6 model rollout (`gpt-5.6-sol/terra/luna` + `max` reasoning) landed in the same cycle.
- 2026-07-10: Replaced Release-event publishing with preview-branch/stable-tag push contracts. Added exact tested-tarball handoff, SHA-512 manifest, CycloneDX SBOM, exact signed-provenance read-back, OIDC job isolation, immutable Action pins, verify-only reruns, npm 12 install policy, root/UI audits, pinned release toolchain, completion-only recovery, and post-publish GitHub Release creation.
- 2026-07-10: Added package-local dependency CLI execution for Codex/OAuth and a two-lane Windows global-update consumer gate before npm publish, closing the native `.cmd`/PATH regression exposed by `v2.0.14` updates.

Previous document: `[[05-node-mode]]`

Next document: `[[07-devlog-map]]`
- 2026-07-14: OIDC publish now creates/refreshes GitHub Releases for stable tags after npm proof (`create-github-release` job + `ensure-github-release`), so Releases no longer depend on local finalize alone.
- 2026-08-12: Retired `scripts/release.sh` and `scripts/release-preview.sh`. `.github/workflows/release.yml` now runs the whole cut in CI and reaches `publish.yml` by `workflow_dispatch`, since a `GITHUB_TOKEN` push emits no workflow event. `publish.yml` keeps its push triggers, remains the only holder of `id-token: write`, and resolves the released ref through `PUBLISH_REF`/`PUBLISH_SHA` so every checkout and contract call targets the release SHA. The audit gate also gained per-advisory exceptions (`scripts/audit-exceptions.json`) that require a GHSA id, evidence, and an enforced expiry.
- 2026-09-09: Removed the bundled progrok child process from the `grok` lane. The lane now calls `https://api.x.ai` directly with the xAI OAuth session in `~/.progrok/auth.json`, refreshed automatically two minutes before expiry; the file is shared with the progrok CLI when a user has it installed, but ima2 no longer bundles or spawns it. There is no local Grok proxy and no port 18645, so `IMA2_GROK_PROXY_HOST`, `IMA2_GROK_PROXY_PORT`, `IMA2_NO_GROK_PROXY`, and `IMA2_GROK_RESTART_*` are no longer read. `ima2 grok` is now `login` / `status` / `logout`, and `/api/health` and `~/.ima2/server.json` publish `grok: { auth: "oauth" | "none" }`. The risk this accepts: xAI documents only `/v1/me` as accepting an OAuth token, so the image and video calls ride an undocumented path that progrok also relied on; if it closes, `grok-api` with `XAI_API_KEY` is the documented fallback.
