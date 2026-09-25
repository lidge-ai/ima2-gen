---
created: 2026-04-23
tags: [ima2-gen, Express, server-api, OAuth]
aliases: [ima2 API, image_gen server API, ima2 endpoints]
---

# Server API

API image tool selection: classic/edit/multimode/node accept optional `imageToolModel`
only for provider `api` (Sunburst/Flare 2.5 IDs). `model` keeps its outer GPT meaning.
Only selected 2.5 tools accept image quality `xhigh`/`max`; other scopes normalize to
medium. `oauthNormalize.ts` owns this allowlist and `providerOptions.ts` validates
API values. `openaiOperations.ts` emits the tool model, and sidecar/history metadata
preserves it. See `docs/API.md` for exact values.

`server.ts` is the runtime bootstrap for `ima2-gen`. The browser UI and CLI both call `/api/*` endpoints registered from `routes/*.ts`. TypeScript is the source of truth; `server.js`/`routes/*.js`/`lib/*.js` are generated runtime outputs, ignored in the current checkout, and must be built before package/runtime verification rather than hand-edited. The server hosts the in-process GPT OAuth client (`lib/codexBackend`), serves the built UI, wires route modules, stores generated image files under the configured generated directory, reconstructs history, and exposes graph sessions.

This document matters because the UI and CLI share the same server contract. For example, `/api/generate` returns a different shape for single-image and multi-image responses. `/api/history` supports both a flat list and session grouping. Node mode uses separate `/api/node/generate` and `/api/sessions/*` contracts. If those differences are not documented, clients can break quietly.

When changing an API, find the endpoint here first. Then check the CLI usage in `[[02-command-reference]]`, the browser client in `[[04-frontend-architecture]]`, and the graph workflow in `[[05-node-mode]]`.

---

## API Map

```mermaid
graph TD
    API["server.ts + routes/* /api"] --> STATUS["status<br/>providers health oauth billing quota keys"]
    API --> KEYS["keys auth switch agy genlog"]
    API --> IMG["classic image<br/>generate edit history"]
    API --> JOBS["inflight jobs"]
    API --> EVENTS["events multiplex<br/>GET /api/events SSE"]
    API --> NODE["node mode<br/>node generate node fetch"]
    API --> SESS["sessions<br/>sqlite graph + style sheet"]
    API --> META["metadata read<br/>embedded XMP"]
    API --> CANVAS["canvas<br/>annotations versions"]
    API --> COMFY["comfy bridge<br/>local upload"]
    API --> MULTI["multimode<br/>sequence generation"]
    API --> PROMPTS["prompt library<br/>crud folders import export"]
    API --> ASSETS["assets library<br/>catalog folders tags"]
    API --> AGENT["agent mode<br/>sessions turns queue"]
    API --> BUILDER["prompt builder<br/>chat assist"]
    API --> GENLOG["generation request log<br/>GET /api/generation-requests"]
    API --> MCP["MCP providers<br/>OAuth connection lifecycle"]
    API --> CARD["cardnews dev-only<br/>templates jobs sets"]
    IMG --> FILES["~/.ima2/generated<br/>sidecar metadata + embedded XMP"]
    NODE --> FILES
    EVENTS --> JOBS
    SESS --> DB["SQLite"]
    PROMPTS --> DB
    ASSETS --> DB
    ASSETS --> FILES
    CARD --> FILES
```

## Status And Provider Endpoints

| Method | Path | Response | Description |
|---|---|---|---|
| `GET` | `/api/providers` | `{ apiKey, oauth, oauthPort, apiKeyDisabled, apiKeySource, runtime }` | Reports available providers and runtime ports to the UI. `apiKeyDisabled` is a legacy compatibility field and is `false` in current API-provider builds. |
| `GET` | `/api/capabilities` | `{ ok, source, version, defaults, valid, limits, guidance, providerSurfaces }` | Agent-facing defaults and structural core surface facts, independent of optional runtime lane availability |
| `GET` | `/api/models` | `{ ok, lanes }` | Core lanes add the same `surfaces` projection; MCP model metadata and Comfy per-workflow binding roles remain distinct |
| `GET` | `/api/health` | `{ ok, version, provider, uptimeSec, activeJobs, pid, startedAt, runtime }` | Used by CLI discovery and health checks |
| `GET` | `/api/oauth/status` | `{ status, models?, auth, grokAuth, runtime }` | Proxy readiness plus login verdicts (`lib/authStatus.ts`); a dead proxy with no session file reports `auth_required` |
| `GET` | `/api/billing` | `{ oauth, apiKeyValid, apiKeySource, credits?, costs? }` | Probes billing/model state when an API key exists |
| `GET` | `/api/quota` | `{ codex?, grok? }` | Grok Build weekly credits percentage/reset via `billing?format=credits`; optional legacy monthly dollar fallback; web-UI only |
| `GET` | `/api/github/star` | `{ state, prompted, repo, url }` | One-time GitHub star prompt state (`lib/githubStar.ts`, shared with the CLI prompt). `state` is null once prompted; loopback peers only (403 `LOCAL_ONLY`) |
| `POST` | `/api/github/star`, `/api/github/star/dismiss` | `{ ok, state? }` | Star through the user's own `gh` (trusted install paths, output never captured) or record the dismissal; 409 `GH_UNAUTHENTICATED`, 502 `GH_FAILED` |
| `GET` | `/api/keys/status` | masked key status + `geminiAuthMode` | Settings > API Keys aggregate |
| `PUT` | `/api/keys/:provider` | `{ apiKey }` | Save an `openai` / `xai` / `gemini` / `atlascloud` / `minimax` / `nai` key. Unknown ids answer 400 `INVALID_PROVIDER`. Lanes with no fixed key prefix (`minimax`, `nai`) skip the format check and rely on the upstream validation call. |
| `DELETE` | `/api/keys/:provider` | none | Remove config-sourced key |
| `PUT` | `/api/keys/vertex` | `{ serviceAccountJson }` | Save Vertex service account |
| `DELETE` | `/api/keys/vertex` | none | Remove Vertex credentials |
| `PUT` | `/api/keys/gemini-auth-mode` | `{ mode }` | Persist `apikey` or `vertex` mode |
| `POST` | `/api/auth/switch` | `{ provider, flow? }` | Start Switch Account OAuth (codex: native browser PKCE or device code; grok: device code) |
| `GET` | `/api/auth/switch/:sessionId` | none | Poll Switch Account session |
| `DELETE` | `/api/auth/switch/:sessionId` | none | Cancel a pending login and free the callback port |
| `POST` | `/api/oauth/restart` | none | Make GPT OAuth pick up the current session file (clears the cached model roster) |
| `GET` | `/api/agy/status` | `{ ready, ... }` | AGY CLI provider probe |
| `GET` | `/api/generation-requests` | `{ items }` | Last 200 generation attempts (#95) |
| `GET` | `/api/storage/status` | `{ ok, data: { generatedDirLabel, generatedCount, legacyCandidatesScanned, legacySourcesFound, legacyFilesFound, state, messageKind, recoveryDocsPath, doctorCommand, overrides } }` | Summarizes gallery storage and legacy recovery state for UI support banners |
| `POST` | `/api/storage/open-generated-dir` | `{ ok }` | Opens only the configured generated image folder in the local OS file manager |

`/api/billing` reports `apiKeySource` as `"none"`, `"env"`, or `"config"`. API-key generation requires a configured key and returns `API_KEY_REQUIRED` before upstream when `provider: "api"` is requested without one.

The live generation/edit provider can be OAuth, API-key, Grok, Gemini, Atlas Cloud, MiniMax, NovelAI, or ComfyUI based. The NovelAI (`nai`) lane is text-to-image only: `/api/generate` refuses attached references with `NAI_REF_UNSUPPORTED` and `/api/edit` refuses outright with `NAI_EDIT_UNSUPPORTED`, so the capability is never silently downgraded. OAuth and API-key paths use the Responses API `image_generation` tool through a shared image adapter; only the endpoint/auth boundary differs. Grok image generation uses the configured planner (default grok-4.3); search is enabled by default but classic, node and multimode honor the resolved off flag without skipping planning. Classic shares one plan per batch, while multimode plans each item; the edit route remains direct. Agent's omitted-option search default is unchanged. When Grok references, a Node parent image, or an Agent current image are explicitly attached, the planner also receives those images as multimodal inputs and the final step switches to xAI `/v1/images/edits` with the same reference images so i2i context survives the planner phase. Agent image plans now carry `sourceImagePolicy: "none" | "current" | "auto"`; plain image requests default to fresh generation (`none`), while current-image edit/reference use requires explicit planner or prompt intent (`current`). Grok video uses separate routes: `/api/video/generate` for T2V/I2V/Ref2V plus branch-local continuation, `/api/video/edit`, `/api/video/extend`, `/api/video/frame`, and `/api/video/analyze`.

Storage endpoints are local-support helpers. `/api/storage/open-generated-dir` never accepts a browser-supplied path; it opens `ctx.config.storage.generatedDir` only.

Runtime responses expose configured and actual ports separately. The backend can bind `3334+` when `3333` is occupied, and an external GPT OAuth endpoint (`IMA2_NO_OAUTH_PROXY=1`) reports its configured port when `10531` is occupied. Clients should follow the URL in `~/.ima2/server.json` or the `runtime.*.url` fields rather than rebuilding URLs from configured defaults.

## Image Execution Ownership

`lib/providers/execution/index.ts` exposes `prepareImageExecution(ctx, request,
progress?)`, returning an executable closure. Classic generation, node generation,
multimode and edit call this shared typed boundary. The request has an explicit
surface plus already-resolved provider/options, validated references and an
AbortSignal; the result is a native single image or sequence, not a job handle.
It is in-process only and adds no serialized/stored fields.

OAuth/API execution now belongs to `providers/adapters/openaiExecution.ts`.
`openaiOperations.ts` owns the existing generate/edit/multimode payload operations,
`openaiTypes.ts` their unchanged option/reference types, and `responsesTransport.ts`
the endpoint/auth/readiness, redaction, abort and response-parser boundary.
`responsesImageAdapter.ts` is a compatibility re-export for existing agent/sprite
and other consumers; it contains no duplicate operation implementation.
Grok/proxy and directGrok execution now belongs to `grokExecution.ts`, with actual
operations in `grokOperations.ts`/`grokMultimodeOperations.ts` and planning in
`grokImagePlanner.ts`. Compatibility facades retain old function/type exports.
Agy/Gemini execution belongs to `googleExecution.ts`, with actual operations in
`agyOperations.ts` and `geminiOperations.ts`; old adapters remain direct reexports.
The four `legacy*` helpers now contain only Atlas/MiniMax/NAI/Comfy and exclude
OpenAI, Grok and Google lanes from their types.

Google node inputs match the admitted context policy: parent-only sends only an
existing parent, while parent-plus-refs sends parent first followed by selected
references. Agy no longer drops supplementary refs; Gemini no longer sends ignored
ones. Classic keeps its prepare-time scalar capture and live references/signal;
other surfaces derive inputs on execution. Native multimode still returns one
dense image, not maxImages billed calls or fabricated image callbacks.

Agy's native child lifecycle is owned by `agyProcess.ts`, with centralized
`AGY_PROCESS_POLICY`. Pre-aborted calls never spawn; cancellation/timeout pins its
499/504 reason, requests TERM then KILL after a1000ms grace if needed, and settles
after child close. Staged refs are cleaned on partial-write failure and operation
exit. The final success check occurs after awaited ref cleanup, so cancellation
during cleanup cannot return success. This does not claim descendant-tree control.
`agyArtifact.ts` retains parser/fallback ordering but excludes symlink/nonregular
scanner entries. `agyArtifactRead.ts` owns canonical root and descriptor identity
checks, 50MiB bounded reads, and private receipt-authorized unlink/nonrecursive
parent cleanup. Operations no longer consume or delete an unchecked raw path.
Path mappings are checked again after close and before cleanup; detected changes
fail closed. Windows uses explicit checks without POSIX open flags. Same-user
atomic filesystem confinement and hardlink provenance are not claimed.
Gemini's public/Vertex payloads and legacy TimeoutError502 classification remain
unchanged; fixture proof is not live provider/auth availability assurance.

Classic prepares its Grok plan once per batch and retains its existing Responses
retry loop in the OpenAI execution owner. API empty422 is not retried; retryable
HTTP503 can reach a second attempt. Classic OAuth alone opts into its existing
reference-preserving/degraded fallback chain. Node keeps retry ownership at the
caller; edit executes one operation; multimode invokes its native sequence
operation. Routes/pipelines still own input
validation, start/finish/cancellation, persistence, sidecars and SSE/eventbus
publication. Existing low-level transport phase updates remain in place.

SSE final callbacks retain original image objects, await completion and dedupe
repeated bytes. JSON parsing has no callbacks/SSE dedupe, while OAuth fallback
still uses SSE parsing but forwards no callbacks. Masked edits remain prompt
guidance through image/text content, not a newly claimed native mask parameter.
Transport499 cancellation/504 timeout codes stay distinct from classic's existing
normalization and the caller's final cancellation/partial-timeout envelopes.

For these four image surfaces, missing or blank `grok-api` credentials now return
`GROK_API_KEY_MISSING` (401) before job admission instead of selecting the proxy.
The boundary rechecks presence before preparation and each execution; classic
and node retain their original captured key if it changes to another nonblank key.
Removing a key after admission refuses execution and finishes that owned job.
The distinct `grok` proxy lane remains valid without an xAI API key. This is not
a statement about video/agent/sprite authentication behavior.

NAI multimode references now return `NAI_REF_UNSUPPORTED` before job admission,
matching the existing text-to-image-only contract. Legacy multimode keeps its
HTTP200 error SSE envelope, while async JSON carries the refusal status. Existing
edit validation still runs after its original admission point; mask/surface
refusals keep their previous codes and bookkeeping.

`tests/provider-execution-*.test.ts` cover real route/fixture behavior and the
typed dispatch boundary. The import guard checks the four selected callers,
not arbitrary future barrels or the intentionally unchanged agent/sprite routes.

Grok node/multimode now forward resolved search policy: false skips search but
keeps the planner. Classic still plans once per batch, edit stays direct.
Multimode carries successful original attempt indices in-process into the final
sweep, preventing sparse duplicates without content dedupe or new serialized fields.

Returned Grok images use `grokImageDownload.ts` and its address policy: validated
per-hop DNS pinned into the actual connection, agent:false, conservative IPv4/IPv6
ranges, max5redirects, streamed50MiB and one overall deadline. Only an initially
matching configured proxy origin gets local trust; leaving it permanently drops
the exception. Request/response error listeners remain owned through close.
Artifact GET carries no API key/cookie/referrer. The exact address policy and
safe502/504/499 error contract are in docs/API.md. Video/MCP policies are separate.

## MCP Connection Lifecycle

| Method | Path | Success/state response | Description |
|---|---|---|---|
| `GET` | `/api/mcp/providers` | `{ ok, providers[] }` | Compiled provider registry plus secret-free status |
| `GET` | `/api/mcp/providers/:id/status` | `{ ok, status }` | Current public state; unknown is 404 and disabled is 409 |
| `POST` | `/api/mcp/providers/:id/connect` | `{ ok, status }` | Coalesced connect; may return an authorization URL |
| `GET` | `/api/mcp/oauth/callback` | HTML only when connected | Single-use state + PKCE callback; non-connected terminal states keep their mapped HTTP status |
| `POST` | `/api/mcp/providers/:id/refresh` | `{ ok, status }` | Generation-safe close and reconnect using stored credentials |
| `DELETE` | `/api/mcp/providers/:id/connection` | `{ ok, status, note }` | Clears the local credential and client only; it does not revoke the provider grant |

The connection states map to HTTP as follows: `connected` → 200 with `ok: true`; `auth_required` and `connecting` → 202; `disconnected` → 409; `offline` → 503; `error` → 502. Non-connected responses use `ok: false`. Public diagnostics are stable codes rather than raw upstream OAuth or transport errors.

After the HTTP listener publishes `serverActualPort`, startup inspects each enabled provider record. Only a completed token bundle whose provider endpoint and redirect origin match the live binding is restored, with at most two providers in parallel and a 15-second per-provider bound. Missing, corrupt, pending-only, and disabled records are not connected. A binding mismatch is preserved on disk and reported as `auth_required`; user-initiated Connect may register the new binding, but startup never silently migrates it. Pending OAuth state and PKCE verifiers are memory-only, so an interrupted browser flow must be started again after restart.

Each live client is identified internally by `{ generation, epoch }`. Expected closes during refresh, disconnect, replacement, or shutdown do not degrade newer state. For the pinned MCP SDK 1.29 terminal retry-exhaustion signal, an unexpected current connection becomes `offline` and receives at most one bounded reconnect; ordinary transient `onerror` does not end a usable POST session. Host code does not replay `callTool`, so mutating or billed operations are never automatically duplicated by this recovery layer.

Shutdown starts HTTP accept-stop and MCP shutdown together. MCP aborts restores, cancels reconnect timers, advances generations, and closes clients with a 2-second internal bound; the coordinator has a 2.9-second grace.

`/api/capabilities` exists for agents and CLI discovery. It reports provider-specific defaults, supported versus unsupported image model ids (including `imageModels.naiSupported` with the four NovelAI ids), valid reasoning efforts, valid quality values, reference/image limits, and advisory parallel queue metadata. NovelAI display defaults include sampler, noise schedule, steps, scale, `autoSmea`, and `decrisper`; sparse clients do not echo untouched defaults back. The endpoint must never serialize the full runtime config. It uses an allowlist projection and converts `Set` values to arrays so JSON clients receive stable arrays instead of `{}`.

## Classic Generate And Edit

| Method | Path | Body | Success response |
|---|---|---|---|
| `POST` | `/api/generate` | `{ prompt, quality?, size?, format?, moderation?, model?, provider?, n?, references?, sessionId?, clientNodeId?, requestId?, reasoningEffort?, webSearchEnabled? }` | For `n=1`: `{ image, elapsed, filename, requestId, usage, provider, webSearchCalls, quality, size, moderation, model }` |
| `POST` | `/api/generate` | same body | For `n>1`: `{ images, elapsed, count, requestId, usage, provider, webSearchCalls, quality, size, moderation }` |
| `POST` | `/api/edit` | `{ prompt, image, mask?, quality?, size?, moderation?, model?, provider?, sessionId?, requestId?, reasoningEffort?, webSearchEnabled? }` | `{ image, elapsed, filename, usage, provider, moderation, model, requestId }` |
| `POST` | `/api/generate/multimode` | `{ prompt, maxImages?, references?, quality?, size?, moderation?, model?, provider?, mode?, sessionId?, requestId?, reasoningEffort?, webSearchEnabled? }` | SSE events: `phase`, `partial`, `image`, `done`, `error` |

NovelAI requests on classic, multimode, and node surfaces also accept the sparse
provider-native fields `negativePrompt`, `sampler`, `noiseSchedule`, `steps`, `scale`,
`cfgRescale`, `seed`, `ucPresetId`, `qualityPresetId`, `autoSmea`, `decrisper`,
`varietyPlus`, and `straightAlpha`. Enabled alpha and quality preset are V5-only.
References/edit/masks remain explicit `NAI_*_UNSUPPORTED` failures.

`/api/generate` accepts up to 5 `references`. `n` is clamped from 1 to `limits.maxGeneratedImages` (default 24, configurable through `IMA2_MAX_GENERATED_IMAGES`). Result files are written to the configured generated directory, usually `~/.ima2/generated`, and sidecar JSON stores prompt, quality, size, format, moderation, model, provider, usage, web search counts, generation time (`elapsed`, numeric seconds), and `reasoningEffort`. `elapsed` and `reasoningEffort` are also embedded in the PNG XMP and returned by `/api/history`, so per-image metadata survives reload (#79, forward-fix — only items generated after the fix carry them).

Image generation model selection is explicit. If omitted, GPT OAuth defaults to `gpt-6-luna` (GPT OAuth accepts `gpt-6-luna`, `gpt-6-sol`, `gpt-6-astra` and maps legacy ids to their GPT-6 tier). API-key image models are `gpt-5.6-luna`, `gpt-6-astra`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`. `gpt-5.3-codex-spark` can appear in OAuth model status, but it does not support the `image_generation` tool, so generation endpoints reject it with `IMAGE_MODEL_UNSUPPORTED` before calling OAuth.

For `provider: "api"`, missing options use `config.apiProvider` defaults: `gpt-5.6-luna`, `low` reasoning effort, `1024x1024`, and web search enabled. These defaults are overridable via `apiProvider.*` config or the `IMA2_API_IMAGE_MODEL_DEFAULT`, `IMA2_API_REASONING_EFFORT`, `IMA2_API_IMAGE_SIZE`, and `IMA2_API_ALLOW_WEB_SEARCH` env vars (see `06-infra-operations`). Validated request options still pass through. Generate/edit/multimode/node use `providers/adapters/openaiExecution.ts`, `openaiOperations.ts`, and `responsesTransport.ts` for the shared OAuth/API Responses payload, including reasoning-effort, web-search, and reference-image plumbing. `lib/responsesImageAdapter.ts` remains the compatibility re-export for agent/sprite consumers. `tests/api-provider-parity.test.ts` and `tests/provider-execution-*.test.ts` cover the parity and dispatch contracts.

For `provider: "grok"`, supported image models are `grok-imagine-image` and
`grok-imagine-image-quality`. Classic `n > 1` requests run mandatory search and
the `grok-4.5` planner tool call once, then reuse the planned prompt for each image and report one search call in metadata. The planned image prompt is requested in English, with explicitly requested visible non-English text preserved verbatim. Grok classic and Node requests with references send those images to the planner, use `/v1/images/edits` for the final image call, and are capped at three total input images (`GROK_REF_TOO_MANY`) because xAI documents up to three source images for image editing. Node counts its parent image plus references; Agent uses the current image as its edit reference when one exists. Grok size
requests are converted to xAI `aspect_ratio` and `resolution`; the OpenAI-style
`size` field is not sent upstream. Grok edit calls xAI `/v1/images/edits`; Grok
mask edit is rejected before upstream with `GROK_MASK_UNSUPPORTED`.

`webSearchEnabled` is a request-level toggle. `false` disables web-search tooling for that request. `true` asks for web search, but API-provider requests still respect the global `apiProvider.allowWebSearch` gate; a deployment that sets `IMA2_API_ALLOW_WEB_SEARCH=false` will not re-enable API web search for one request.

Multimode is SSE-only. The route now saves and sends each final image as it arrives instead of buffering the full sequence before sending any `image` event. If the provider times out after at least one image was saved, the route sends a `done` event with `status: "partial"` and HTTP status metadata in the payload. If no image was saved before timeout, the route sends an error. JSON/non-stream fallback images from the adapter are saved only for indexes not already emitted by the final-image callback.

Masked edits are sent as mask/selection guidance; callers should not treat them as pixel-perfect inpainting. The OAuth path additionally honours a feature flag, `config.oauth.maskedEditEnabled` (env: `IMA2_OAUTH_MASKED_EDIT_ENABLED`, default off) — when a mask is present and the flag is disabled, `lib/oauthProxy/generators.ts` rejects the request before calling upstream so masked edits stay opt-in until #31 ships in full. `tests/oauth-masked-edit-contract.test.js` covers the flag.

Prompt assembly for the OAuth path injects a short safety intent policy (`SAFETY_INTENT_POLICY` from `lib/promptSafetyPolicy.ts`) into the `lib/oauthProxy/prompts.ts` builder for generate/edit/multimode. The same constant is reused by the API-key Responses adapter so both providers send the same intent guardrails.

## Video Runtime

`lib/grokVideoDownload.ts` owns incremental100MiB body enforcement, existing MIME/
MP4-prefix validation and reader cleanup. It returns the same Buffer/contentType;
callers persist only after success. Caller abort is499, downloader timeout504 and
body/header failure502. The single timeout is not reset by GET retries or chunks;
body failure does not restart generation. This is a byte bound, not an RSS ceiling
or new URL/DNS/redirect security policy. See docs/API.md for exact limitations.

The last-frame background operation now lives in `videoExtendI2vOperation.ts` with
the original body, captures, phase/terminal ordering and dependencies. The route
still responds202 and invokes it without awaiting completion. Its actual complete
Promise can be observed by test wrappers; inflight removal or an early cancel event
is not by itself proof that background work has stopped.

| Method | Path | Body / query | Response |
|---|---|---|---|
| `POST` | `/api/video/generate` | SSE body with `prompt`, optional refs, `duration`, `resolution`, `aspectRatio`, `continueFromVideo`, `continuityLineage` | SSE `planning`, `submitted`, `progress`, `done`, `error` |
| `POST` | `/api/video/edit` | `{ prompt, videoUrl, model? }` | Blocking JSON result saved as generated `.mp4` |
| `POST` | `/api/video/extend` | `{ prompt, videoUrl, duration?, model? }` | Blocking JSON original+extension artifact |
| `GET` | `/api/video/frame` | `file`, `position` | PNG frame |
| `POST` | `/api/video/analyze` | `{ videoUrl }` generated `.mp4` | Configured-planner first/last-frame analysis (Grok 4.5 default) |

Blank video prompts return `PROMPT_REQUIRED` and include active prompt guidance:
visual flow, motion flow, sound/no-music, dialogue/no-dialogue, and ending
frame. `/api/video/generate` stores `videoContinuity` in the `.mp4.json`
sidecar and returns it in `done`. When `continueFromVideo` is present, the
server validates the generated `.mp4`, extracts its last frame, reads the parent
sidecar, and treats that sidecar lineage as authoritative over any client hint.
Lineage keeps at most four entries with start preserved plus the latest three.

`grok-imagine-video-1.5` is the canonical Grok Video generation default. Incoming `grok-imagine-video-1.5-preview` values are accepted only as a compatibility alias and are normalized before upstream calls. `resolution: "1080p"` is accepted when the effective request is 1.5 prompt-only T2V or image-to-video with one image/extracted frame source; prompt-only 1.5 T2V is converted to the existing white-canvas I2V shim before the upstream request. Base-model requests, Ref2V/multi-image, video edit, and extension requests reject it with `INVALID_VIDEO_RESOLUTION`.

## History And Asset Lifecycle

| Method | Path | Query or body | Response |
|---|---|---|---|
| `GET` | `/api/history` | `limit`, `since`, `before`, `beforeFilename`, `sessionId`, `favoritesOnly` | `{ items, total, nextCursor }` |
| `GET` | `/api/history` | `groupBy=session` | `{ sessions, loose, total, nextCursor }` |
| `DELETE` | `/api/history/:filename` | none | `{ ok, trashId, filename, unlinkAt, sessionsTouched, nodesTouched }` |
| `DELETE` | `/api/history/:filename/permanent` | none | `{ ok, filename }` — bypasses soft-delete, removes the file (and any sidecar) immediately |
| `POST` | `/api/history/:filename/restore` | `{ trashId }` | `{ ok }` |
| `POST` | `/api/history/favorite` | `{ filename, favorite }` | `{ ok, favorite }` |
| `POST` | `/api/history/import-local` | raw body `image/png` \| `image/jpeg` \| `image/webp`; optional header `X-Ima2-Original-Filename` | `201 { item }` (GenerateItem with `kind: "imported"`) |
| `POST` | `/api/history/backfill-thumbnails` | none | `{ created, skipped, failed, total }` — recursive thumbnail backfill for gallery/history |

History is reconstructed from image files and sidecar JSON under the configured generated directory. The current implementation uses a process-local history index/cache and applies browser-scoped favorites as an overlay for `/api/history`. `favoritesOnly=1` filters before pagination so older favorites can be reached with cursor paging. `DELETE /api/history/:filename` is a soft-delete into the OS trash via `lib/systemTrash.ts` (`trash` dependency); `lib/assetLifecycle.ts` returns a `trashId` so the UI can offer undo through `POST /api/history/:filename/restore`. `DELETE /api/history/:filename/permanent` skips the trash and removes the file plus any sidecar immediately — used by the gallery's permanent-delete affordance.

`/api/history/import-local` accepts a single raw image body and writes it into `generated/` as `imported-<yyyymmddhhmmss>-<rand6>.<ext>` with embedded XMP metadata (`kind: "imported"`). Frontend uses this to drop external images directly onto the Canvas viewer area; the response item is appended to the in-memory history list and selected as the current image.

When `groupBy=session` is used, session groups include `title` and `label` when the session still exists in SQLite. The gallery should prefer the title and only fall back to the short server session id.

## Assets Library API

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/api/assets` | `kind`, `folderId`, `tag`, `q`, `cursor`, `limit` | `{ assets, nextCursor }` |
| `POST` | `/api/assets` | `{ kind, name?, filePath?, folderId?, notes?, metadata?, tags? }` | `201 { asset }` |
| `PATCH` | `/api/assets/:id` | `{ name?, folderId?, notes?, metadata?, tags? }` | `{ asset }` |
| `DELETE` | `/api/assets/:id` | none | `{ ok: true }` |
| `GET` | `/api/assets/folders` | none | `{ folders }` |
| `POST` | `/api/assets/folders` | `{ name, parentId? }` | `201 { folder }` |
| `PATCH` | `/api/assets/folders/:id` | `{ name?, parentId? }` | `{ folder }` |
| `DELETE` | `/api/assets/folders/:id` | none | `{ ok: true }` |
| `GET` | `/api/assets/tags` | none | `{ tags }` |
| `POST` | `/api/assets/derived` | `kind=keyed-png` + raw `image/png` body, or `kind=vector-svg` (bodyless) with `source`, `preset?`, `colorPrecision?`, `filterSpeckle?`, `cornerThreshold?` | `201 { filePath, asset, ... }` |

`routes/assets.ts` and `lib/assetsStore.ts` implement a SQLite catalog over files already stored in the configured generated directory; the catalog does not duplicate image or video bytes. Asset kinds are the closed enum `image | video | element | preset | template`. Image and video creation requires a validated regular file under generated storage, while the other kinds may be metadata-only. Listing supports kind, folder, tag, and name/notes search filters with opaque `(createdAt, id)` cursor pagination (default 50, maximum 500).

Node templates are `template` assets (`lib/nodeTemplateStore.ts`, `routes/nodeTemplates.ts`). `GET /api/node-templates/:id/export` and `POST /api/node-templates/import` move one template between machines as an `ima2.node-template` v1 file (`lib/nodeTemplateFile.ts`). The file is a boundary for untrusted input. The graph is rebuilt from node, edge and data allowlists in both directions, because React Flow applies node-level keys such as `style` and `domAttributes` to the DOM. The import route has its own 2 MB JSON parser in `server.ts`, ahead of the global body limit, and it maps parser failures to fixed codes. Imports get new ids and are never instantiated or run. See `docs/API.md` for limits and error codes.

`routes/assetDerived.ts` registers `POST /api/assets/derived`, which writes a derived
file next to its source and registers it as an `image` asset carrying a `derivedKind`
metadata marker. `keyed-png` uploads a client-composited alpha PNG as a raw body.
`vector-svg` sends NO body: the server reads the already-validated source from generated
storage and traces it to SVG via `lib/vectorizeImage.ts`, rejecting a non-raster source
with `DERIVED_SOURCE_NOT_RASTER` so a vector can never be re-traced. Traced SVGs are
served from `/generated` with `Content-Security-Policy: default-src 'none'` and
`X-Content-Type-Options: nosniff`, since SVG is an active document under top-level
navigation and `/generated` sits outside the LAN token guard.

Folder writes preserve tree integrity with stable errors: `INVALID_PARENT` rejects a missing parent, `FOLDER_CYCLE` rejects moving a folder beneath itself or a descendant, and `FOLDER_NOT_EMPTY` rejects deletion while assets or child folders remain. `INVALID_FOLDER` covers asset assignment to a missing folder. Deleting an asset removes only its SQLite catalog row (and cascading tag rows); the generated file is deliberately preserved. File deletion remains owned by the history/asset lifecycle endpoints above.

## Canvas, Metadata, And Local Integrations

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/annotations/:filename` | none | `{ annotations }` |
| `PUT` | `/api/annotations/:filename` | `{ annotations }` | `{ ok }` |
| `DELETE` | `/api/annotations/:filename` | none | `{ ok }` |
| `POST` | `/api/canvas-versions` | raw PNG payload + canvas metadata headers | `{ item }` |
| `PUT` | `/api/canvas-versions/:filename` | raw PNG payload + canvas metadata headers | `{ item }` |
| `POST` | `/api/metadata/read` | `{ image }` | `{ metadata, missing? }` |
| `POST` | `/api/comfy/export-image` | `{ filename, origin? }` | `{ ok, uploadedFilename }` |
| `GET` | `/api/comfy/workflows` | none | `{ ok, workflows: [{ …record, health }] }` |
| `POST` | `/api/comfy/workflows` | `{ id, label?, origin?, mediaKind?, graph? \| pngBase64?, bind, params?, replace? }` | `{ ok, workflow }` |
| `DELETE` | `/api/comfy/workflows/:id` | none | `{ ok, id }` |
| `POST` | `/api/comfy/inspect` | `{ graph? \| pngBase64? }` | `{ ok, nodes, candidates, mediaKind?, needsConfirmation }` |
| `POST` | `/api/comfy/probe` | `{ origin }` | `{ ok, origin, health }` |

Canvas annotation and canvas-version routes are internal editor persistence surfaces. Canvas versions are hidden from the normal Gallery and HistoryStrip visible domain; navigation should prefer source images and only display a matching canvas version inside Canvas Mode.

`/api/comfy/export-image` accepts a generated filename only, validates local-loopback ComfyUI origins, and uploads the selected image to ComfyUI without exposing arbitrary filesystem paths.

### ComfyUI provider lane (260823)

The workflow routes back the `comfy` provider lane, which is the reverse
direction of `export-image`: ima2 CALLS a user-run ComfyUI
(`POST /prompt` → `GET /history/{id}` → `GET /view`) instead of uploading into
it. There is no OpenAI-compatible `/v1` shim and no supervised child process —
unlike the grok lane, no ready-made proxy binary exists to bundle, so a shim
would duplicate the workflow-binding work and add spawn, port and restart
supervision for nothing.

A registered workflow IS a model: it appears in the selector where
`grok-imagine-image-2.0` sits in the grok lane. Because that set is
user-authored, the lane's registry manifest carries `models: []` with
`catalogAccess: "runtime"`, and `comfyLane()` fills the real list from the
workflow store. That field is deliberately NOT the same one as
`lib/mcp/providerRegistry.ts`'s `McpCatalogAccess`, which solves a similar
problem for remote MCP servers in a different module.

Each record carries its OWN origin, so single-instance and multi-instance
setups (8188 for SDXL, 8189 for Flux) share one code path;
`config.comfy.defaultUrl` is only what the registration form starts with.
`normalizeComfyOrigin` gates every write, so a record can never hold an
address the bridge would refuse later.

`/inspect` deliberately does not persist: it is the input to the confirmation
step. Binding candidates are inferred by `class_type`, but a field matched by
several nodes stays `unambiguous: false` — two `CLIPTextEncode` nodes is the
ordinary shape and `_meta.title` is free text the user can rename, so guessing
would swap positive and negative silently.

`/probe` normalizes before it fetches, so the browser never issues a request
to a typed string. A malformed origin is 400 while an unreachable one is 200
with `health.ok === false` — telling someone to start ComfyUI when their URL
has no port sends them looking in the wrong place.

Queueing splits by responsibility: ComfyUI owns GPU scheduling through its own
`/prompt` queue, while ima2 owns admission and tracking through
`lib/inflight.ts` and the SSE bus. The sidecar records `comfyPromptId` PAIRED
with `comfyOrigin`, because a prompt_id is instance-local and looking one up
on another instance returns "not found".

Multimode, node mode and Agent Mode refuse this lane with
`COMFY_SURFACE_UNSUPPORTED` (400) until they gain a real dispatch branch;
without that guard they fall through to `generateViaResponses` and bill OAuth
for an image the user asked ComfyUI to make.

### Comfy video workflow catalog lock (260824)

Workflow records carry `mediaKind: image | video`; legacy records missing the field
normalize to image. Inspect groups candidates across node classes, so SDXL's two
CLIPTextEncode nodes remain ambiguous while MiniMax H3's
MiniMaxH3ImageToVideo prompt/width/height, RandomNoise seed and SaveVideo output infer
unambiguously. Explicit kind that contradicts the selected SaveImage/SaveVideo output
is rejected.

`GET /api/models` partitions Comfy workflows by media kind. Video workflows carry no
blanket lock since 2026-08-25 (devlog unit `260825_comfy_video_provider_ux`): they are
executable, and a dead origin shows through the `(offline)` description instead, which
is an availability fact rather than a capability lock. They still never become the image
default. The classic image resolver returns `COMFY_VIDEO_WRONG_ENDPOINT` — the workflow
is runnable, it just belongs on `POST /api/video/generate`.

`POST /api/video/generate` accepts `provider: "comfy"` with a registered video workflow
id as `model`. The branch runs inside the same handler closure as the Grok path, after
`startJob` and `registerJobAbortController`, so a UI cancel reaches the adapter's poll
loop and `finishJob` still releases the inflight slot. Grok-only axes (storyboard,
continuation, planner, topic, reference audio) are refused with
`COMFY_VIDEO_OPTION_UNSUPPORTED` rather than silently dropped.

Comfy video output arrives under the history `images` key with an `animated` flag —
core `SaveVideo` and `SaveWEBM` both return `ui.PreviewVideo`, which serializes that way
(verified against `comfy_api/latest/_ui.py`). `gifs` (VideoHelperSuite) and `videos`
are read for compatibility only. Output is validated by magic bytes; MP4/MOV are stored
and WebM is refused by name, because the persistence chain is anchored to `.mp4`.

`GET /api/capabilities` carries an optional `lanes` map since 2026-08-25
(`260825_comfy_video_provider_ux` wp3). Its keys are the `/api/models` lane id set, and
each entry is `{ status, reason?, models: { image, video } }` — counts rather than ids,
because `ima2 models` already answers which models a lane holds and a second copy of
that list is a second thing to drift. `buildLaneSummary` in `routes/models.ts` is the
single source: both endpoints call it, behind a 5s TTL because each build costs a
ComfyUI origin probe and an agy binary spawn while the UI polls capabilities.

`lanes` is present only when `source === "server"`, and is omitted entirely otherwise —
lane state is something only a running server can know, so absence means unknown rather
than unavailable. Do not confuse it with `valid.providers`, which is the CLI `--provider`
flag vocabulary: that one carries `auto` and omits the MCP lanes.

`GET /api/models` exposes the NovelAI lane as `.lanes.nai` with four compile-time image ids (`nai-diffusion-5-full`, `nai-diffusion-5-curated`, `nai-diffusion-4-5-full`, `nai-diffusion-4-5-curated`) and `defaults.image = nai-diffusion-5-full`. Every entry declares `inputRoles: ["text"]` only — the catalog must not advertise `image_references` for a lane whose routes answer `NAI_REF_UNSUPPORTED`. Status is `key-missing` until a token is saved, then `ready`.

## Inflight Jobs

| Method | Path | Query | Response |
|---|---|---|---|
| `GET` | `/api/inflight` | `kind`, `sessionId` | `{ jobs }` |
| `GET` | `/api/inflight` | `kind`, `sessionId`, `includeTerminal=1` | `{ jobs, terminalJobs }` |
| `DELETE` | `/api/inflight/:requestId` | none | `{ requestId, active, aborted }` |

The inflight registry tracks classic, node, and multimode jobs. The default response is active-only so the UI never renders completed jobs as still running. `includeTerminal=1` is an opt-in debug surface that keeps recent completed/error/canceled jobs briefly for request tracing. Cancellation records a terminal `canceled` snapshot and aborts the upstream request when the active job still has a registered `AbortController`.

Tracker TTL expiry persists `status: error`, `errorCode: JOB_TRACKING_TIMEOUT`,
`httpStatus: 504` before removing the active row in one SQLite transaction. It means
upstream completion is unknown, not proven generation failure. Clients should
inspect history before submitting again. Column-first session/node correlation
survives restart; top-level prompt is not copied into terminal snapshots.
`lib/jobs/terminalStore.ts` owns disk serialization; inflight owns the lazy cache
and local controllers. Failed expiry writes roll back without abort/publication.
A retained outcome left beside an active row after failed cleanup is preserved,
including its timestamp; recovery cleanup does not emit another terminal event.

## Events Multiplexing (SSE)

The browser UI uses a single persistent SSE channel (`GET /api/events`) for all async generation progress. This replaces per-request SSE streams that previously consumed one HTTP connection each and caused gallery hangs at the browser's 6-connection limit.

| Method | Path | Query | Response |
|---|---|---|---|
| `GET` | `/api/events` | `lastEventId` (optional, for replay) | `text/event-stream` (persistent) |

### Connection lifecycle

1. Client opens `EventSource("/api/events")`.
2. Server responds with `text/event-stream`, sets `X-Accel-Buffering: no`, starts 15s heartbeat pings.
3. If `activeConnections >= MAX_SSE_LISTENERS` (512): responds `503 SSE_CAPACITY`.
4. Events are fan-out: every connected client receives all job events.
5. On disconnect: listeners and timers removed, capacity released once, owned response destroyed.
6. A false write pauses output until drain. Accepted chunks are not repeated;
   catch-up uses the bounded global ring, with no per-client event queue. A stall
   exceeding `SSE_STREAM_POLICY.drainTimeoutMs` (15s) closes that response.

### Replay

- Client sends `Last-Event-ID` header or `?lastEventId=` query on reconnect.
- Server replays from ring buffer (size 2000). Large image payloads (>1000 chars) are stripped in replay with `_imageOmitted: true`.
- Evicted or future cursors emit `replay-gap`; zero also detects eviction of the
  first event. Absent/invalid cursors remain live-only. Paused connections check
  eviction again on drain. Browser clients clear their cursor and invoke resync;
  CLI MCP clients recover the terminal snapshot without another generation POST.
- IDs remain process-local numbers: equal/lower restart collisions are not an epoch protocol.

### Event envelope

All events carry: `id` (global monotonic seq), `event` (type name), `data` (JSON with `jobId` for client-side routing).

### Event types

| Event | Emitted by | Payload |
|---|---|---|
| `phase` | node, multimode, video | `{ requestId, phase, sequenceId?, maxImages? }` |
| `partial` | node, multimode | `{ requestId, image (base64 data URL), index }` |
| `image` | multimode | full `GenerateItem` |
| `done` | node, multimode, video | route-specific response |
| `error` | routes + `abortJob` | `{ requestId, error, code?, status? }` |
| `replay-gap` | events route | `{ lastEventId, oldestAvailableId }` |
| `submitted` | video | `{ requestId, jobId }` |
| `progress` | video | `{ requestId, progress (0.0–1.0), stalled? }` |
| `planning` | video | `{ requestId, status }` |

### Async generation (UI path)

POST routes (`/api/node/generate`, `/api/generate/multimode`, `/api/video/generate`) accept `{ async: true, requestId }`. They respond immediately with `202 { requestId }` and emit progress via `eventBus.publish()` → `GET /api/events`. CLI/legacy clients omit `async` and receive per-request SSE on the same response (dual-emit: both legacy SSE write and eventBus publish).

### Cancellation and expiry terminal guard

`abortJob` records cancellation before invoking synchronous abort listeners.
`lib/ssePublish.ts` rejects later `done` AND `error` after retained cancellation or
tracking expiry, without allocating a sequence. Node/video/Sprite canonical terminal
publication uses this guard. Raw nonterminal/custom untracked events are outside
this promise; it is not universal success/error ordering. A deliberately reused ID
clears its old disk snapshot in the same successful admission transaction. Concurrent
reuse while an old producer still runs is outside the request-ID ownership contract.
Only locally registered controllers can be aborted; no cross-process cancellation
or upstream completion guarantee is introduced.

## Node Mode API

`extraParentNodeIds?: string[]` supplies additional saved node images. The primary
`parentNodeId` remains the editable base; deduplicated extra parents precede user
references in the provider request. Explicit missing/invalid extras fail, and
combined configured reference limits apply before provider admission. Parent-only
skips loading extra parents; existing adapter-specific user-reference behavior
is preserved. Graph session edge ordering is explicit so reloading cannot swap
base and reference roles.

| Method | Path | Body or query | Response |
|---|---|---|---|
| `POST` | `/api/node/generate` | `{ parentNodeId?, prompt, quality?, size?, format?, moderation?, model?, references?, externalSrc?, contextMode?, searchMode?, sessionId?, clientNodeId?, requestId?, provider? }` | `{ nodeId, parentNodeId, requestId, image, filename, url, elapsed, usage, webSearchCalls, provider, moderation, model, refsCount, contextMode, searchMode }` |
| `GET` | `/api/node/:nodeId` | none | `{ nodeId, meta, url }` |

When `parentNodeId` is present, the server reads the stored parent image and uses the edit path. Node-local `references` are allowed on both root and child/edit nodes. For child/edit nodes, the parent image is sent first, then reference images, then the text prompt. `refsCount` is stored as numeric metadata only; reference image base64 is not written to sidecars. `externalSrc` is a controlled fallback for promoting an existing history asset into a node workflow.

Node context is explicit. `contextMode` defaults to `parent-plus-refs`, meaning immediate parent image plus explicit node-local references. `parent-only` drops explicit references. `ancestry` is reserved but currently rejected with `CONTEXT_MODE_UNSUPPORTED` so clients cannot accidentally assume full-chain context. Edit web search is explicit too: `searchMode` defaults to `on`; `off` disables the edit research prompt and OAuth web-search tool. Root generation can still use search through the normal generation path.

`/api/node/generate` also supports an SSE response when the client sends `Accept: text/event-stream`. In that mode validation still happens before headers are opened. After the stream opens, the server may emit `phase`, `partial`, `done`, and `error` events. Root generation opts into OAuth `partial_images: 2`; child/edit generation stays final-only for now. If an upstream stream error happens after headers are committed, the outer HTTP status may remain `200`; clients must read the SSE `error` event and node state. Clients must treat partial events as progressive previews only and use the `done` payload as the canonical saved node.

Upstream request/validation failures are normalized to `INVALID_REQUEST` while preserving provider diagnostics as `upstreamCode`, `upstreamType`, and `upstreamParam`. In SSE mode these fields travel inside the `error` event payload together with `status`.

Provider diagnostic fields are machine labels, never sentences. `upstreamCode`, `upstreamType` and `upstreamParam` pass through `safeDiagnosticLabel` (`lib/diagnosticLabel.ts`, re-exported by `lib/responsesParse.ts`); every error envelope (generate/edit `upstreamErrorFields`, edit, multimode, node catch and node envelopes) emits them through `upstreamLabelFields`: values over 120 characters, values that are not a single code-like token, and credential shapes (Bearer, `sk-`, `sk_live_`/`sk_test_`, `xai-`/`xai_`, `AIza`, `AKIA`, JWTs, `gh[pousr]_`, `password`/`secret`/`token`/`api_key` key=value, unbroken alphanumeric runs of 32+ characters, URLs, `@`) become `_redacted`. When a Responses image item fails, `emptyResponseError` carries that item's code and type labels in `upstreamCode`/`upstreamType`; the stable ima2 code (for example `IMAGE_TOOL_FAILED`) still decides classification and retries, and the user-facing message stays fixed. The provider's own `error.message` sentence is not parsed into diagnostics, logs or envelopes, because redaction patterns cannot prove a free-form sentence free of prompts or credentials (PR 256 WP3 deliberately rejected that). Providers remain untrusted, and pattern matching has limits: a credential split by `-` or `_` into runs shorter than 32 characters with no recognised prefix (for example some `org-`/`sess-` style identifiers) still passes as a label. Known remaining exposure: the OAuth passthrough keeps the provider's message (`lib/oauthProxy/errors.ts`); node envelopes and the `node.final_error` log filter its code and type labels at emission.

Node sidecars include `requestId` as recovery metadata. `/api/history` exposes the same field so a reloaded graph can match completed assets by request id before falling back to `(sessionId, clientNodeId, createdAt)`.

## Agent Mode API

Agent Mode is a conversational image workspace. Each agent session holds a current image, a web-search toggle, generation settings, style/subject locks, a turn history, and a durable per-session job queue. These routes are always registered (not feature-gated). Implementation is split across `lib/agentStore.ts` (sessions, workspace payload, XML manifest, locks, current image, generation settings), `lib/agentQueueStore.ts` + `lib/agentQueueWorker.ts` (durable queue, worker, and runtime LLM planning), `lib/agentCommandParser.ts` (`/question` and slash commands), `lib/agentQuestionResponder.ts`, `lib/agentRuntime.ts` (`runAgentTurn`, allowed-tool payload, error lookup), `lib/agentToolManifest.ts` (tool surface single source: names, descriptions, parameter schemas), and `lib/agentPlannerModel.ts` (provider-follow LLM planner: oauth/api via Responses, grok via chat completions, regex fallback on failure; gated by `agentPlanner.enabled`/`agentPlanner.timeoutMs`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent/tools` | Allowed tool payload + parameter-schema manifest for the agent runtime |
| `GET` | `/api/agent/sessions` | Workspace payload (session list + selected); `selectedSessionId` query selects |
| `POST` | `/api/agent/sessions` | Create a session (`title?`, `currentImage?`, `webSearchEnabled?`) |
| `GET` | `/api/agent/sessions/:sessionId` | Load one session workspace |
| `PATCH` | `/api/agent/sessions/:sessionId` | Update title, web search, generation settings, current image, or style/subject locks |
| `DELETE` | `/api/agent/sessions/:sessionId` | Delete a session |
| `POST` | `/api/agent/sessions/:sessionId/compact` | Compact the session turn history |
| `GET` | `/api/agent/sessions/:sessionId/manifest` | XML manifest of the session workspace |
| `POST` | `/api/agent/sessions/:sessionId/turns` | Run an agent turn (prompt + generation options); supports slash commands and `/question` |
| `GET` | `/api/agent/queue` | Global queue snapshot |
| `GET` | `/api/agent/sessions/:sessionId/queue` | Per-session queue |
| `POST` | `/api/agent/sessions/:sessionId/queue` | Enqueue a generation turn |
| `POST` | `/api/agent/queue/:itemId/cancel` | Cancel a queued item |
| `POST` | `/api/agent/queue/:itemId/retry` | Retry a queued item |
| `GET` | `/api/agent/sessions/:sessionId/errors` | Read-only recent generation failures (failed queue jobs + error turns); `limit` query (1-20) |

Agent Mode is a server + web-UI feature (`ui/src/components/agent/*`, `ui/src/lib/agentApi.ts`, `ui/src/styles/agent-workspace*.css`). There is no `ima2 agent` CLI command; drive it from the web UI or `/api/agent/*` directly. Turns run through the durable queue worker so parallel/auto-generation work survives reconnects.

Agent generation settings accept `provider: "oauth" | "api" | "grok"`. With `provider: "grok"`, the Agent runtime keeps the same user/tool/assistant turn skeleton (`ima2.get_image_context`, `ima2.web_search`, `ima2.generate_image`) but routes the generator through the Grok search + `grok-4.5` planner + xAI Images API path. Grok Agent turns force web search on because the provider planner depends on it; `quality: "high"` promotes the final image model to `grok-imagine-image-quality`. Image plans use `sourceImagePolicy`: `none` ignores the current session image and calls `/v1/images/generations`, `current` attaches the selected/current image and calls `/v1/images/edits`, and `auto` is reserved for compatibility flows. The regex fallback infers `none` for fresh/new/no-i2i wording and plain image requests, `current` for explicit current-image/reference/edit wording, and `auto` for video so existing image-to-video continuity remains unchanged.

## Prompt Builder API

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/prompt-builder/chat` | `{ messages, backend?, model?, context? }`; omitted backend/model use `config.promptBuilder` | `{ provider, requestedBackend, backend, model, message, usage }` |
| `GET` | `/api/prompt-builder/config` | none | configured `{ backend, model }`, backend/model catalogs, `autoOrder`, env-lock bits |
| `PUT` | `/api/prompt-builder/config` | `{ backend, model? }` | atomically persisted config payload; a backend change without model selects that backend's default |

`/api/prompt-builder/chat` powers the UI and `ima2 prompt build`. The persisted keys are
`promptBuilder.backend` and `promptBuilder.model`; the CLI may override either for one
request. `auto` selects the first ready lane in the order `oauth -> grok -> api ->
grok-api`. An explicit backend never falls back and returns a typed readiness/key error;
Auto with no ready lane returns `PROMPT_BUILDER_NO_BACKEND_READY`. Chat responses keep
`requestedBackend` separate from the answering `backend`, which drives the UI's
`via <backend>` badge.

Fallback is a pre-request readiness decision, not an upstream retry. A non-first Auto
selection emits the safe `prompt-builder.backend_fallback` event with requested/from/to/
reason metadata. Once a request is sent, an upstream failure remains
`PROMPT_BUILDER_UPSTREAM_FAILED`; it is not replayed on another backend. Environment
variables lock their matching config fields, and conflicting PUTs return 409
`PROMPT_BUILDER_CONFIG_ENV_LOCKED`.

## Session DB API

| Method | Path | Body or header | Response |
|---|---|---|---|
| `GET` | `/api/sessions` | none | `{ sessions }` |
| `POST` | `/api/sessions` | `{ title }` | `{ session }` |
| `GET` | `/api/sessions/:id` | none | `{ session }` |
| `PATCH` | `/api/sessions/:id` | `{ title }` | `{ ok: true }` |
| `DELETE` | `/api/sessions/:id` | none | `{ ok: true }` |
| `PUT` | `/api/sessions/:id/graph` | `If-Match` header, `{ nodes, edges }` | `{ ok, nodes, edges, graphVersion }` |
| `GET` | `/api/sessions/:id/style-sheet` | none | `{ ok, styleSheet, styleSheetEnabled, styleSheetGeneratedAt, styleSheetSourceFilename }` |
| `PUT` | `/api/sessions/:id/style-sheet` | `{ styleSheet, sourceFilename?, enabled? }` | `{ ok, styleSheet, styleSheetEnabled, styleSheetGeneratedAt, styleSheetSourceFilename }` |
| `PATCH` | `/api/sessions/:id/style-sheet/enabled` | `{ enabled }` | `{ ok, styleSheetEnabled }` |
| `POST` | `/api/sessions/:id/style-sheet/extract` | `{ filename }` | `{ ok, styleSheet, styleSheetGeneratedAt, styleSheetSourceFilename }` |

Graph saving uses optimistic concurrency. Missing `If-Match` returns `428`. Version mismatch returns an error payload with the current version.

Graph edges are the source of truth for node parentage. On save, the server filters dangling edges, derives each node's `data.parentServerNodeId` from the single incoming edge source node's current `data.serverNodeId`, and rejects multiple incoming parent edges with `409 GRAPH_PARENT_CONFLICT`. This keeps visual graph state and backend generation parent state aligned after reload.

`GRAPH_VERSION_CONFLICT` only means the client saved against a stale `If-Match` graph version. It is not proof that another browser tab edited the graph; a delayed debounce, recovered node save, or session switch flush can also surface the same response. The UI should therefore use source-neutral language such as "graph version changed" unless a separate tab identity protocol proves otherwise.

Graph saves may include observability headers: `X-Ima2-Graph-Save-Id`, `X-Ima2-Graph-Save-Reason`, and `X-Ima2-Tab-Id`. The server logs these values for `graph_save` and `graph_conflict` events but must not treat them as authorization or correctness inputs.

Style sheet endpoints persist a per-session reference style summary in SQLite. `/style-sheet/extract` calls the OpenAI API-key client with `IMA2_STYLE_MODEL` (default `gpt-5.6-luna`) to derive a short text style sheet from a single history image; the route enforces that the source image belongs to the same session. `enabled` is a separate toggle that determines whether the style sheet is injected into the next prompt; the actual injection uses up to `IMA2_STYLE_SHEET_MAX_PREFIX` characters and is performed at the route layer.

## Image Metadata API

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/metadata/read` | `{ image }` (data URL or base64 PNG, capped by `IMA2_MAX_METADATA_READ_B64_BYTES`) | `{ ok, metadata: { prompt?, quality?, size?, format?, moderation?, model?, provider?, references?, ... } }` or `{ ok: false, code: "NO_METADATA" }` |

Generated PNGs embed the same sidecar fields into XMP via `lib/imageMetadata.ts`. `routes/metadata.ts` parses an image base64 supplied by the UI and returns the embedded metadata so the user can drop a previously generated file back into the composer to restore prompt and parameters. The route never persists the uploaded image; it only reads embedded XMP.

## Prompt Library API

| Method | Path | Body or query | Response |
|---|---|---|---|
| `GET` | `/api/prompts` | `folderId?`, `favorite?`, `q?` | `{ ok, prompts }` |
| `POST` | `/api/prompts` | `{ title?, body, folderId?, tags?, favorite? }` | `{ ok, prompt }` |
| `GET` | `/api/prompts/:id` | none | `{ ok, prompt }` |
| `PATCH` | `/api/prompts/:id` | `{ title?, body?, folderId?, tags?, favorite? }` | `{ ok, prompt }` |
| `DELETE` | `/api/prompts/:id` | none | `{ ok }` |
| `POST` | `/api/prompts/:id/favorite` | `{ favorite }` | `{ ok, favorite }` |
| `POST` | `/api/prompts/import` | `{ prompts: [...] }` or NDJSON body | Existing bulk import route for local/export compatibility |
| `POST` | `/api/prompts/import/preview` | `{ source: { kind: "local", filename, text } }` or `{ source: { kind: "github", input } }` | `{ source, candidates, warnings }` preview for single `.md`, `.markdown`, or `.txt` sources |
| `POST` | `/api/prompts/import/commit` | `{ candidates, folderId? }` | `{ foldersCreated, promptsImported, duplicatesSkipped }` |
| `GET` | `/api/prompts/import/curated-sources` | none | `{ sources }` static curated and manual-review source registry |
| `POST` | `/api/prompts/import/curated-search` | `{ q?, sourceIds?, limit? }` | `{ results, sources, warnings }` from the file-based curated prompt index |
| `POST` | `/api/prompts/import/curated-refresh` | `{ sourceId }` | `{ source, indexedFiles, candidateCount, warnings }` for one curated source |
| `POST` | `/api/prompts/import/folder-files` | `{ source: { kind: "github-folder", input } }` | `{ source, files, warnings }` for supported files in one GitHub folder |
| `POST` | `/api/prompts/import/folder-preview` | `{ source: { kind: "github-folder", input }, paths }` | `{ source, files, candidates, warnings }` preview for selected listed folder files |
| `GET` | `/api/prompts/import/discovery` | `status?` | `{ candidates, warnings }` from the local discovery review queue |
| `POST` | `/api/prompts/import/discovery-search` | `{ q?, seeds?, limit? }` | `{ candidates, warnings, rateLimit? }` from GitHub repository discovery |
| `POST` | `/api/prompts/import/discovery-review` | `{ repo, status, reviewNotes?, allowedPaths?, defaultSearch? }` | `{ candidate, source?, warnings }` after approving or rejecting a discovery candidate |
| `GET` | `/api/prompts/export` | none | NDJSON stream of stored prompts |
| `GET` | `/api/prompts/folders` | none | `{ ok, folders }` |
| `POST` | `/api/prompts/folders` | `{ name }` | `{ ok, folder }` |
| `PATCH` | `/api/prompts/folders/:id` | `{ name }` | `{ ok, folder }` |
| `DELETE` | `/api/prompts/folders/:id` | none | `{ ok }` |

Prompts and folders are stored in SQLite alongside sessions; migrations live in `lib/db.ts`. The library supports favorite filtering, free-text search across title and body, folder grouping, and full-export round trips. Prompt rows are independent from history filenames so the same prompt body can be reused across sessions.

Prompt import PR1 is preview-first. `/api/prompts/import/preview` accepts either local text supplied by the browser or a GitHub file source and returns prompt candidates without saving. GitHub sources are limited to `github.com` and `raw.githubusercontent.com`, reject host spoofing, unsupported extensions, encoded slash/backslash, traversal, folder URLs, oversized files, and redirected final URLs that are not supported prompt files. `/api/prompts/import/commit` saves only selected candidates through the same SQLite prompt semantics as the existing import path and stores source metadata as tags only, such as `github`, `repo:owner/repo`, `ref:main`, `file:prompts.md`, and `ext:md`.

Prompt import PR2 adds curated indexed search without introducing a DB migration. Static sources live in `lib/promptImport/curatedSources.ts`; indexed source/candidate cache is written under `config.storage.promptImportIndexCacheFile`, usually `~/.ima2/prompt-import-index.json`, with atomic temp-file writes. Curated search is read-only: results remain commit-compatible prompt candidates with mandatory `text`, but they are never saved until the UI sends selected candidates to `/api/prompts/import/commit`. `gpt-image-2` model/task/size/quality hints and warnings are stored in candidate metadata for ranking and UI display, while attribution and license state persists through tags such as `source:<sourceId>`, `license:<spdx>`, `trust:<tier>`, and `attribution-required`.

Prompt import PR3 adds GitHub folder browse without recursive crawling or auto-import. `/api/prompts/import/folder-files` lists only supported `.md`, `.markdown`, and `.txt` files from a single GitHub Contents API directory. `/api/prompts/import/folder-preview` re-lists the same folder server-side and previews only selected paths that appear in that listing as supported `type: "file"` entries; client-supplied download URLs are never trusted. Slash-branch shorthand remains rejected with `AMBIGUOUS_GITHUB_REF`, and ambiguous `tree/feature/foo/...` URLs do not trigger a slash-branch resolver in PR3. Saving still goes through `/api/prompts/import/commit`.

Prompt import PR4 adds GitHub repository discovery as a manual-review workflow. Discovery search calls GitHub from the server only, optionally using `IMA2_GITHUB_TOKEN`, and never exposes the token to the browser. Results are stored in a file-backed review queue under `config.storage.promptImportDiscoveryRegistryFile`, usually `~/.ima2/prompt-import-discovery.json`. Discovery candidates are not prompt candidates and cannot be committed directly; the user must approve or reject them through `/api/prompts/import/discovery-review`. Approved reviewed sources are merged into curated source listings and can join indexed search only when they have validated `.md`, `.markdown`, or `.txt` `allowedPaths`; slash default branches and empty paths are listed with warnings but skipped from default search/indexing.

## Card-News API (dev-only)

The card-news routes are mounted only when `config.features.cardNews` is true, which currently requires `IMA2_CARD_NEWS=1` or `IMA2_DEV=1`. They are not part of the public publish surface.

| Method | Path | Body or query | Response |
|---|---|---|---|
| `GET` | `/api/cardnews/image-templates` | none | `{ ok, templates }` |
| `GET` | `/api/cardnews/image-templates/:templateId/preview` | none | `{ ok, preview }` or `404` |
| `GET` | `/api/cardnews/role-templates` | none | `{ ok, roles }` |
| `GET` | `/api/cardnews/sets` | none | `{ ok, sets }` |
| `GET` | `/api/cardnews/sets/:setId` | none | `{ ok, set }` |
| `GET` | `/api/cardnews/sets/:setId/manifest` | none | `{ ok, manifest }` |
| `POST` | `/api/cardnews/draft` | `{ topic, options? }` | `{ ok, draft }` |
| `POST` | `/api/cardnews/generate` | `{ draft, templateId, role?, options? }` | `{ ok, jobId }` |
| `POST` | `/api/cardnews/jobs` | `{ ... }` | `{ ok, job }` |
| `GET` | `/api/cardnews/jobs/:jobId` | none | `{ ok, job }` |
| `POST` | `/api/cardnews/jobs/:jobId/retry` | none | `{ ok, job }` |
| `POST` | `/api/cardnews/cards/:cardId/regenerate` | `{ ... }` | `{ ok, card }` |
| `POST` | `/api/cardnews/export` | `{ jobId, format? }` | `{ ok, export }` |

Implementation lives in `lib/cardNews*.ts`: `cardNewsTemplateStore`, `cardNewsRoleTemplateStore`, `cardNewsManifestStore`, `cardNewsJobStore`, `cardNewsPlanner`, `cardNewsPlannerClient`, `cardNewsPlannerPrompt`, `cardNewsPlannerSchema`, and `cardNewsGenerator`. Optional planner integration is gated by `IMA2_CARD_NEWS_PLANNER`, with model (default `gpt-5.6-luna`) and timeout configured by `IMA2_CARD_NEWS_PLANNER_MODEL` and `IMA2_CARD_NEWS_PLANNER_TIMEOUT_MS` and an explicit `IMA2_CARD_NEWS_PLANNER_FALLBACK` switch. Generated card images and manifests share the same `~/.ima2/generated` directory as classic and node assets.

## Error States

| Case | Status | Code or message |
|---|---:|---|
| Missing prompt | 400 | `Prompt is required` |
| Invalid or too many references | 400 | `INVALID_REFS` or string error |
| Invalid moderation | 400 | `INVALID_MODERATION` or string error |
| Invalid image model | 400 | `INVALID_IMAGE_MODEL` |
| Unsupported OAuth model for image generation | 400 | `IMAGE_MODEL_UNSUPPORTED` |
| Upstream request/validation error | 400 | `INVALID_REQUEST` |
| Unsupported node context mode | 400 | `CONTEXT_MODE_UNSUPPORTED` |
| Reference attached to the NovelAI lane | 400 | `NAI_REF_UNSUPPORTED` |
| Edit or mask requested on the NovelAI lane | 400 | `NAI_EDIT_UNSUPPORTED` / `NAI_MASK_UNSUPPORTED` |
| NovelAI token missing, rejected, or unsubscribed | 401 / 402 | `NAI_API_KEY_MISSING`, `NAI_AUTH_FAILED`, `NAI_SUBSCRIPTION_REQUIRED` |
| NovelAI V5 battery exhausted with no Anlas available | 402 | `NAI_USAGE_EXHAUSTED` |
| NovelAI archive unreadable or empty | 502 | `NAI_ZIP_INVALID`, `NAI_ZIP_UNSUPPORTED`, `NAI_ZIP_TOO_LARGE`, `NAI_RESPONSE_NOT_ZIP`, `NAI_IMAGE_INVALID`, `NAI_EMPTY_IMAGE`, `NAI_UPSTREAM_ERROR` |
| Multiple incoming parent edges | 409 | `GRAPH_PARENT_CONFLICT` |
| API-key provider requested without a configured key | 401 | `API_KEY_REQUIRED` |
| Safety refusal | 422 | `SAFETY_REFUSAL` |
| Moderation/content refusal | 422 or upstream mapped error | `MODERATION_REFUSED` |
| OAuth session expired | upstream mapped error | `AUTH_CHATGPT_EXPIRED` |
| Network/proxy failure | upstream mapped error | `NETWORK_FAILED` or `OAUTH_UNAVAILABLE` |
| Missing graph version header | 428 | `GRAPH_VERSION_REQUIRED` |
| Graph too large | 413 | `GRAPH_TOO_LARGE` |
| Missing node metadata | 404 | `NODE_NOT_FOUND` |
| Image without embedded metadata | 200 | `{ ok: false, code: "NO_METADATA" }` from `/api/metadata/read` |
| Card-news routes when feature flag is off | 404 | Routes are not mounted unless `config.features.cardNews` |
| MCP provider unknown or disabled | 404 / 409 | `MCP_PROVIDER_UNKNOWN` / `MCP_PROVIDER_DISABLED` |
| MCP connection not ready | 409 / 503 / 502 | `disconnected` / `offline` / `error` state response |

## Observability Contract

Server logs use compact structured lines such as `[node.request] requestId="..." quality="medium"`. Every `/api/*` request receives a sanitized `X-Request-Id` response header. If the client sends a safe `X-Request-Id` (`A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `-`, max 128 chars), the server echoes it; otherwise the server replaces it with `req_<uuid>`. Non-API static files and `/generated/*` assets are not mutated by the request logger.

Generation, edit, node, OAuth stream, inflight, history, and session graph saves should carry the same `requestId` where available. Classic and node generation routes fall back to `req.id` when the JSON body does not provide a `requestId`.

Logs must never include raw prompts, effective prompts, revised prompts, OAuth/API tokens, authorization headers, cookies, raw request bodies, reference data URLs, generated base64, or raw upstream response bodies. Use counts and sizes instead: `promptChars`, `refs`, `imageChars`, `durationMs`, `httpStatus`, and `errorCode`.

Node retry diagnostics include safe context such as `operation`, `clientNodeId`, `parentNodeId`, `errorEventType`, `errorEventCount`, and the filtered `upstreamCode`/`upstreamType` labels (`finalErrorUpstreamLabels`). They must not log prompt text or image payloads.

## Sync Checklist

- [ ] If an endpoint is added, update this doc and `ui/src/lib/api.ts`.
- [ ] If a CLI-called endpoint changes, update `[[02-command-reference]]`.
- [ ] If error shape is standardized, check all error tables and UI toast handling.
- [ ] If the session graph contract changes, update `[[05-node-mode]]`.
- [ ] If `server.ts` is split into route files, update line counts in `[[01-file-function-map]]`.
- [ ] If a provider lane is added to `lib/providers/registry.ts`, update the keys row, the generation-provider paragraph, the error table, the `/api/models` contract, `[[00-structure-hub]]`, `[[02-command-reference]]`, `[[04-frontend-architecture]]`, `[[06-infra-operations]]`, `docs/API.md`, `docs/CLI.md`, and the README env table. The CLI enum derives itself; the prose does not.

## Change Log

- 2026-08-24: Documented the NovelAI (`nai`) lane: keys row widened to every key-bearing provider, text-to-image-only refusal codes, the `.lanes.nai` catalog contract, and a Sync Checklist row for future provider lanes.

- 2026-07-17: Documented bound MCP credential restore after the actual server port, truthful state/HTTP mapping, generation/epoch recovery, and coordinated shutdown.

- 2026-04-23: Documented the current `server.ts` endpoint surface and response shapes.
- 2026-04-23: Translated this document from Korean to English.
- 2026-04-24: Added node SSE partial streaming, requestId sidecar/history recovery, observability, terminal inflight, and gallery session-title response notes.
- 2026-04-24: Added explicit image model selection contract for classic, edit, and node generation.
- 2026-04-24: Clarified source-neutral `GRAPH_VERSION_CONFLICT` semantics and graph save metadata headers.
- 2026-04-25: Updated server ownership after route decomposition and clarified generated-directory storage plus error-code UX contracts.
- 2026-04-25: Documented sanitized API request IDs and API-only request logging.
- 2026-04-25: Documented child/edit node references and SSE inner-error diagnostics.
- 2026-04-25: Documented node context/search modes and graph-edge-derived parent normalization.
- 2026-04-26: Documented runtime actual-port reporting and removed dev-only API details from the evergreen public API map.
- 2026-04-28: Added session style-sheet endpoints, `/api/history/favorite`, `/api/metadata/read`, prompt library CRUD/folders/import/export, and dev-gated card-news API surface for ima2-gen 1.1.5.
- 2026-04-30: Added `DELETE /api/history/:filename/permanent`, switched all `lib/*` and `routes/*` references to `.ts` source paths after the TypeScript migration close, and clarified that soft-delete now routes through `lib/systemTrash.ts` (OS trash) instead of `.trash/`.
- 2026-04-28: Added PR2 prompt import curated-source, curated-search, and curated-refresh API contracts plus file-cache and tag-based attribution notes.
- 2026-05-06: Documented API-key Responses parity for generate/edit/multimode/node (#49) via `lib/responsesImageAdapter.ts` and the `IMA2_API_*` env defaults; documented the `IMA2_OAUTH_MASKED_EDIT_ENABLED` feature flag and its `lib/oauthProxy/generators.ts` guard for #31; documented prompt safety intent policy injection from `lib/promptSafetyPolicy.ts` into `lib/oauthProxy/prompts.ts` and the API-key adapter.
- 2026-05-13: Added `/api/capabilities` as the agent-facing runtime metadata endpoint for #62.
- 2026-05-29: Persisted per-image `elapsed` (numeric seconds) and `reasoningEffort` in sidecar + embedded XMP and exposed both through `/api/history` for Classic, Canvas edit, and Node modes (#79, forward-fix; older items stay blank). Classic/edit `elapsed` responses are now numeric.
- 2026-05-30: Documented the Agent Mode API (`/api/agent/*` — sessions, turns, durable queue, compact, manifest, tools; backed by `lib/agentStore.ts`, `lib/agentQueueStore.ts`, `lib/agentQueueWorker.ts`, `lib/agentRuntime.ts`) and the Prompt Builder endpoint (`POST /api/prompt-builder/chat`). Re-grounded the API map against current code at ima2-gen 1.1.14.
- 2026-06-01: Updated the API map for Grok video runtime: generation/edit/extension/frame/analyze, active prompt guidance, `continueFromVideo`, and `videoContinuity` sidecar/SSE contracts.
- 2026-06-27: Documented keys/quota/auth-switch/agy/generation-request-log endpoints and provider matrix at ima2-gen 2.0.4; added `POST /api/history/backfill-thumbnails`.
- 2026-06-28: WP6 — expanded `docs/API.md` with Prompt Library, Prompt Import, and Card News route tables; `tests/api-docs-contract.test.js` enforces full `routes/*.ts` `/api/*` coverage.
- 2026-07-13: Phase 050 — documented the SQLite-backed Assets Library catalog, nine `/api/assets*` endpoints, kind enum, cursor pagination, folder integrity errors, and file-preserving catalog deletion.

Previous document: `[[02-command-reference]]`

Next document: `[[04-frontend-architecture]]`
