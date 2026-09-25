# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-07-16

### Breaking

- **Fail-closed CLI generation** — bare `ima2 gen` and generate-mode `ima2 video` now require a persisted target from `ima2 defaults set image|video <lane>/<model>`; without one they exit 2 with `NO_DEFAULT_MODEL`. A per-call `--model <lane>/<model>` or explicit `--provider <lane>` remains valid.
- **Lane-qualified model namespace** — provider routes are explicit lanes (`oauth`, `api`, `grok`, `grok-api`, `agy`, `gemini-api`, `runway`, and `higgsfield`). Bare model IDs resolve only when unique; image aliases such as `oauth/luna` are accepted in the model segment.
- **`--provider auto` removed from `gen` and generate-mode `video`** — it exits 2 with `PROVIDER_AUTO_REMOVED` instead of silently selecting a lane.
- **Stable CLI failure contract** — `--json` failures emit exactly one `{ "ok": false, "code": "...", "message": "..." }` document. User-fixable routing/flag errors exit 2, server/connectivity errors exit 3, and generation failures exit 1.
- **MCP generation lanes** — Runway, and Higgsfield once unlocked, use `POST /api/mcp/generate` plus SSE completion. MCP lanes accept one output per command, generated-gallery filenames for references, and reject unsupported core-only flags with `FLAG_NOT_SUPPORTED`.

### Added

- `ima2 models [--kind image|video] [--lane <lane>] [--json]` lists live lane status, models, and capabilities; the JSON shape is stable as `{ ok, kinds: { image: [], video: [] } }`.
- `ima2 defaults set image|video <lane>/<model>` and `ima2 defaults reset image|video` manage the fail-closed CLI targets, which are also exposed as `defaults.cli` in JSON output.

## [2.0.17] - 2026-07-13

### Fixed

- **Windows installer npm handling** — compose global npm lockfile path with nested `Join-Path` calls for PowerShell 5.1 compatibility; wrap npm invocations in `Invoke-Npm` with `Continue` error action preference so stderr warnings do not abort the installer (#110, #111).

## [3.16.1] - 2026-09-17

### Fixed

- **`ima2 grok` subcommands ignored `--help`** (#244) — `grok login`, `grok status`, and `grok logout` were dispatched before their arguments were parsed, so `ima2 grok login --help` started a real xAI device-code flow and sat polling instead of printing anything, and `ima2 grok logout --help` deleted `~/.progrok/auth.json` before any help text appeared. Each subcommand now answers `--help`/`-h` with its own usage before doing anything observable, and rejects options it does not accept.

### Changed

- **Dependencies** — `@openai/codex` 0.153.2 to 0.153.4; the UI development group moves `@playwright/test` 1.62.1 to 1.63.0 and `@types/react-dom` 19.2.5 to 19.2.7.

## [3.16.0] - 2026-09-09

### Removed

- **Bundled progrok proxy** — the `grok` lane no longer bundles or spawns the progrok child process, and there is no local Grok proxy or port 18645. `IMA2_GROK_PROXY_HOST`, `IMA2_GROK_PROXY_PORT`, `IMA2_NO_GROK_PROXY`, and `IMA2_GROK_RESTART_*` are no longer read; setting them is harmless.
- **`ima2 grok models` and `ima2 grok proxy`** — the subcommand surface is now `login`, `status [--json] [--probe]`, and `logout`.

### Changed

- **Native xAI OAuth on the `grok` lane** — image and video requests call `https://api.x.ai` directly with the OAuth session stored in `~/.progrok/auth.json`, obtained through `ima2 grok login` or the web UI and refreshed automatically two minutes before expiry. The credential file keeps its path and schema, so existing users are not asked to log in again, and it is still shared with the progrok CLI for anyone who has that installed. `grok-api` continues to use `XAI_API_KEY` directly. xAI documents only `/v1/me` as accepting OAuth tokens, so this path carries no compatibility promise; `grok-api` remains the documented one.
- **Grok readiness reporting** — `/api/grok/status` returns `ready`, `no_image_model`, `error`, or `offline` with `reason: "login_required"` when no session is stored, and `/api/health` plus `~/.ima2/server.json` publish `grok: { auth: "oauth" | "none" }`.

## [3.15.0] - 2026-09-08

### Added

- **NovelAI quota lane** (#193) — `GET /api/quota` now returns `nai` alongside `codex` and `grok`: the Opus V5 battery meter (`v5-battery` window with remaining charge and the next +1% ETA), the `isNegative` recharge flag and fixed/purchased Anlas, read from `image.novelai.net/user/subscription` without forwarding account identifiers. Settings shows a NovelAI card with the charge bar and Anlas line when a token is configured.
- **NAI 402 split** (#193) — a 402 on a V5 model probes the subscription once and reports `NAI_USAGE_EXHAUSTED` (battery drained, no Anlas) separately from `NAI_SUBSCRIPTION_REQUIRED`; V4.5 requests and failed probes keep the subscription code without a second request.

### Changed

- **Provider Adapter v1 execution hook** (#150) — `ProviderAdapterV1` gains an optional `prepareImageExecution` and the NovelAI, MiniMax, Atlas Cloud and ComfyUI adapters now own their classic/node/edit/multimode dispatch; `prepareImageExecution` routes to a registered adapter before the legacy lane switches, which are reduced to their unsupported-surface refusals. Descriptor adapters for `api`, `grok-api` and `gemini-api` (API key or Vertex service account) join the common contract suite; `oauth`, `grok` and `agy` stay unregistered because their readiness is asynchronous.

### Fixed

- Removed no-op `catch (error) { throw error; }` wrappers across provider execution, sprite, asset and LAN-session modules; behavior is unchanged and the coding convention now asks for try/catch only where an error is transformed, logged, or surfaced at a boundary.

## [3.14.0] - 2026-09-06

### Production readiness

- Correct NovelAI positive/negative prompt pane sizing, scrolling and toolbar spacing across sidebar, bottom, home and mobile composers; retain drafts when changing providers.
- Keep provider/model labels, capabilities and selection consistent across the UI, CLI and generation routes, including unavailable or malformed provider catalogs.
- Preserve accepted-job tracking through disconnects, cancellation, restart and LAN reauthentication without automatically submitting the job again.
- Bound image/video artifact reads and downloads, reject escaped artifact paths, and keep cancellation from persisting an incomplete result.
- Add LAN sign-in with origin-bound, HttpOnly session cookies; protect generated media, SSE, Range and HEAD requests. Default loopback use remains token-free, and explicit header/query API credentials remain supported.
- Share failed-token cooldown across API, media, status and browser bootstrap; retain existing cookie sessions during a bearer-token cooldown.
- Bind CLI LAN credentials only to an explicitly selected server, reject redirects and credential-bearing URLs, and preserve provider authentication errors separately from LAN access failures.
- Add offline `doctor --installation --json`, safe diagnostic reports and metadata-derived installation/runtime documentation; improve Windows lock handling without terminating unrelated processes.
- Use a patched, development-only Node SDK downloader for source builds; keep runtime dependencies and install-script approvals unchanged.

LAN HTTP is intended for trusted networks and does not encrypt tokens or cookies; use an operator-configured HTTPS proxy or VPN on untrusted networks. Verification uses isolated synthetic providers, not a claim that live provider credentials, billing or every remote deployment have been exercised.

### Added

- **Current model defaults** — Grok search, image/video planning, and frame analysis now default to `grok-4.5` while retaining `grok-4.3` as an explicit compatibility override. GPT image generation, stylesheet analysis, Card News planning, and Prompt Builder default to `gpt-5.6-luna`; Grok video model discovery projects `grok-imagine-video-1.5` from runtime config.
- **GPT-5.6 rollout** — `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` accepted as OAuth image models across server validators, prompt builder, CLI, and UI pickers; reasoning ladder gains `max` after `xhigh`.
- **Verified OIDC release contract** — a release commit must pass the `preview` channel before the same SHA can be tagged and published to `latest`; GitHub Release creation and branch synchronization happen only after npm dist-tag, `gitHead`, integrity, and provenance read-back succeeds.
- **Tested-artifact evidence** — `publish.yml` packs once, install-smokes that exact tarball, records SHA-512 in `release-manifest.json`, emits a CycloneDX SBOM, and gives OIDC permission only to the job that publishes the downloaded artifact.
- **Signed provenance recovery** — stable full reruns use a verify-only job, failed-job reruns guard against republishing an immutable version, and finalization recovers the original publish attempt from cryptographically verified npm Sigstore provenance instead of relying on recent successful-run listings.
- **SSE multiplexing** — shared `GET /api/events` endpoint with ring-buffer replay and `Last-Event-ID` reconnect support (`lib/eventBus.ts`, `routes/events.ts`).
- **Async POST generation mode** — multimode, node, and video routes accept async POST and dual-emit progress on both per-request SSE and the shared event bus.
- **Frontend event channel** — singleton `EventSource` client (`ui/src/lib/eventChannel.ts`) replaces per-request SSE streams for UI generation flows.
- **Subscribe-before-fetch contract** — `tests/async-stream-subscribe-order.test.js` locks the race where ultra-fast server publish could arrive before client handler registration.
- Store modularization — split monolithic `useAppStore` into focused impl modules (`storeGenImpl`, `storeNodeGenImpl`, `storeVideoImpl`, `storeInflightImpl`, etc.).
- Frontend/API barrel splits — `ui/src/lib/api.ts` and `ui/src/index.css` decomposed into ≤500-line modules.
- Storyboard workflow — 9-panel grid with black Panel 1 lead-in for image and video generation.
- Gallery hang fix — video decoder/connection exhaustion on focus change (RCA 01).

### Changed

- UI clients migrated from per-request SSE to `eventChannel` + async POST for multimode, node, and video generation.
- Multimode concurrency tracking uses `activeFlightIds` Set instead of `multimodeAbortControllers`.
- Release builds now pin Node `24.17.0`, npm `11.18.0`, and `@openai/codex` `0.144.1`; CI also performs clean npm 12 installs on Ubuntu and Windows.
- npm 12 install-script approvals are explicit for root/UI lockfiles and one-click installers verify the installed native runtime with `ima2 doctor`.
- GitHub Actions are pinned to full commit SHAs, Windows runs the installed-tarball smoke, and UI build dependencies are audited at high severity (`vite` 7.3.6, `esbuild` 0.28.1).
- Test suite grew to **1094** cases across **207** files (73 runtime-importing, 134 contract-only).

### Fixed

- SSE multiplexing hardening — inflight cancel/done race guards, replay-gap handling, subscribe/timeout/requestId races, and frontend reconnect/error parsing (`sseStreamError.ts`).
- Node route validation order — `startJob`/202 response moved after request validation.
- CI typecheck — unused imports in card-news tests and store split type mismatches.
- Thumbnail backfill failure reporting (#94).
- AGY provider detection now finds user-local `agy` installs such as `~/.local/bin/agy` and supports `IMA2_AGY_BIN` for explicit binary paths.
- AGY Windows pipe handling, Gemini API aspect ratio string values, multimode same-prompt batching.
- Moderation over-filtering — removed safety tags and added error enrichment.
- Packaged `openai-oauth` now has its required `zod` peer available in consumer installs; package smoke executes both bundled CLIs from the installed tarball.
- npm 12 keyed-object `npm pack --json` output is normalized alongside npm 11 array output, so package smoke and release packing share one cross-version artifact contract.
- Windows npm subprocesses execute `npm-cli.js` through Node with preserved arguments, and packaged CLI smoke executes declared JS bins instead of fragile `.cmd` shell shims.
- Windows OAuth discovery now executes the package-local `@openai/codex` and bundled `openai-oauth` JavaScript entrypoints through the current Node runtime instead of relying on global PATH, `npx`, or direct `.cmd` spawning. Codex login explicitly uses file-backed credential storage required by the proxy, while keyring-only sessions receive a precise re-login diagnosis. Release publishing is gated by npm 11/12 Windows global-update smokes of the exact tarball.

## [2.0.4] - 2026-06-27

### Added

- **Result metadata inspector** — inspect generation result metadata from the UI (#108).
- **OAuth size directive** — reinforce non-auto resolutions with explicit LANDSCAPE / PORTRAIT / SQUARE orientation in the text prompt.
- **Release notes script** — `scripts/generate-release-notes.mjs` auto-categorizes conventional commits for GitHub Releases.

### Changed

- **Preview publish** — merged preview npm publish into the registered `publish.yml` workflow (OIDC trusted publisher); preview dist-tag on `preview` branch push, `latest` on GitHub Release.

### Docs

- `docs/IMAGE_RESOLUTION.md` — OAuth image resolution temporary limitation (~1.57M cap) and future policy undecided.

### CI

- OIDC precondition checks and npm version logging in publish workflow.

## [2.0.1] - 2026-06-03

### Added

- **Gemini API provider** (`provider: "gemini-api"`) — direct Generative Language API and Vertex AI paths with `nano-banana-2` / `nano-banana-pro` model picker, aspect ratio, and resolution controls.
- **Grok billing quota bar** — `$used/$limit` on QuotaCard via `GET /api/quota`.
- **Switch Account** — device-code OAuth re-auth for Grok and Codex without leaving the app.
- **Grok video model picker** — V / V1.5 selection in video controls.
- Image/video thumbnails and history sidebar cards.
- Centralized recursive thumbnail backfill.
- Gemini/Vertex API key management routes and web UI.

### Changed

- Provider plumbing and CLI parity for gemini-api, grok-api, and vertex paths.
- Grok model/size pickers and adapter updates.
- Pages and developer docs reorganized to be feature-centric.

### Fixed

- Preserve video metadata in sequence history and thumbnail fallbacks in history UI.
- Vertex AI integration — auth mode persistence, skip unsupported `response_format`, prefer Vertex over API key when both configured.
- Gemini image cost corrected to official pricing; aspect ratio/resolution UI layout polish.
- Skip GPT pixel-limit size confirm for Grok/Gemini providers.
- Reap orphaned codex device-auth child on abandoned Switch Account flow.
- Document Gemini providers in CLI help; harden provider paths and CLI metadata.

### Security

- Atomic `config.json` writes in keys routes; atomic token write with codex env scrubbing.
- Cap sharp input pixels to prevent decompression bombs.
- Audit fixes — crypto session IDs, session cap, double-click guard, API key in header only.

## [2.0.0] - 2026-06-02

### Added

- Major version bump packaging the Gemini API, Grok API key, Vertex AI, and expanded provider surface shipped in the 1.1.x preview line.

## [1.1.23] - 2026-06-02

### Added

- Gallery skeleton shimmer and F5 refresh fix (#93).
- Hero one-click install scripts on the documentation site.

## [1.1.22] - 2026-06-02

### Fixed

- Graceful shutdown releases file handles on Windows (EBUSY fix).
- Ctrl+C clean shutdown — database close, child process stop, file lock release.

## [1.1.21] - 2026-05-31

### Changed

- Bump bundled progrok 0.1.1 → 0.2.0 (video edit + extend commands).

## [1.1.15] - 2026-05-31

### Added

- **Agent Mode** — conversational image workspace with sessions, turns, durable queue, slash commands (`/api/agent/*`).
- **Grok provider** — bundled progrok, Classic/Node/Agent through search + planner + xAI Images API.
- **Video generation** — text/image/reference-to-video via Grok, edit/extend/frame/analyze routes, branch-local last-frame continuation.
- `GET /api/capabilities` discovery endpoint (#62).
- `POST /api/prompt-builder/chat` assistant and `ima2 prompt build` CLI wrapper.
- Grok model/size pickers, billing API, and `ima2 grok` helpers.

### Fixed

- Prompt Studio regression (#75), long-prompt preview (#77), prompt autofill perf (#78).
- Per-image metadata persistence (#79), batch comparison matrix (#80).

## [1.1.10] - 2026-05-06

### Added

- API-key provider Responses parity for generate/edit/multimode/node (#49).
- Masked-edit feature flag groundwork (`IMA2_OAUTH_MASKED_EDIT_ENABLED`, #31).
- Gallery default-to-current-session with All Images toggle (#42).
- Centralized `persistenceRegistry` for `ima2.*` localStorage keys (#43).
- `typecheck:tests` and `test:inventory` quality gates.

### Changed

- Split `lib/oauthProxy.ts` into `lib/oauthProxy/*` subtree.
- Added `lib/runtimeContext.ts`, `lib/responsesImageAdapter.ts`, `lib/providerOptions.ts`, `lib/errInfo.ts`, `lib/promptSafetyPolicy.ts`.

## [1.1.0] - 2026-04-25

### Added

- TypeScript migration complete — route, lib, server, config, and bin sources are `*.ts` with committed build artifacts.
- CLI feature parity with server API (#45).
- Canvas Mode workspace split and dual-mask cleanup.
- OS-trash soft-delete for history.

## [1.0.3] - 2026-04-23

### Added

- Initial npm publish of `ima2-gen` — local OAuth image generation studio with Classic mode, Node mode, Canvas Mode, and CLI.

[Unreleased]: https://github.com/lidge-ai/ima2-gen/compare/v2.0.13...HEAD
[2.0.4]: https://github.com/lidge-ai/ima2-gen/compare/v2.0.1...v2.0.4
[2.0.1]: https://github.com/lidge-ai/ima2-gen/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.23...v2.0.0
[1.1.23]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.22...v1.1.23
[1.1.22]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.21...v1.1.22
[1.1.21]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.20...v1.1.21
[1.1.15]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.14...v1.1.15
[1.1.10]: https://github.com/lidge-ai/ima2-gen/compare/v1.1.9...v1.1.10
[1.1.0]: https://github.com/lidge-ai/ima2-gen/compare/v1.0.11...v1.1.0
[1.0.3]: https://github.com/lidge-ai/ima2-gen/releases/tag/v1.0.3
