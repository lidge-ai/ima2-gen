# API Reference

This document lists the local HTTP API exposed by `ima2 serve`.

Base URL:

```text
http://localhost:3333
```

## Local and LAN access

The configured bind determines access mode. Loopback keeps single-user no-token
use; a non-loopback bind requires `IMA2_LAN_TOKEN`, including requests arriving
from a loopback proxy. LAN protects both `/api` and `/generated` before file,
Range or conditional-response processing. UI/static assets remain public.

| Endpoint | Contract |
|---|---|
| `GET /api/auth/lan/session` | No-store `{mode, authenticated, expiresAt}`; no token/cookie value returned |
| `POST /api/auth/lan/session` | Same-origin `Origin`, JSON `{}`, valid `x-ima2-token`; 204 and an opaque HttpOnly/SameSite=Strict cookie in LAN mode |
| `DELETE /api/auth/lan/session` | Same-origin `Origin` and presented cookie; revoke it and return 204 |

Sessions are in memory, origin-bound and expire after an absolute eight hours.
Restart/rotation invalidates them. Settings → General → Studio session signs out;
sign-out/expiry closes admitted streams but does not cancel accepted generation.
Reauthentication does not automatically submit a waiting generation again.
The browser removes a supplied `?token=...` before loading App and never stores
the token in local/sessionStorage; entering it in the sign-in form avoids putting
it in initial URL/access logs. API clients can use `x-ima2-token`; legacy query
tokens remain accepted. Header → query → cookie precedence applies. Malformed
duplicates are rejected; an explicit invalid credential cannot fall back to a cookie.

Serving Host/Origin must match the actual listener or exact configured
`server.publicOrigins` / `IMA2_PUBLIC_ORIGINS` JSON array (maximum 16). No wildcards,
userinfo, paths, query or fragments. This is a serving-origin list, not CORS
permission: cross-origin and same-site sibling-origin requests remain rejected.
Forwarded headers do not establish trust. The case-compatible exact GET MCP OAuth
callback retains its existing state/PKCE check; admin stop still needs its nonce.

For Vite development, use `http://127.0.0.1:5173` and explicitly include that origin
on the backend (`IMA2_PUBLIC_ORIGINS='["http://127.0.0.1:5173"]'`). The dev proxy
preserves Host. If opening `localhost` instead, list that exact origin too; local
mode canonicalizes it to `127.0.0.1`, while LAN mode preserves the entered origin.

LAN media uses `private, no-store, max-age=0`, no ETag/Last-Modified, and
same-origin resource policy. JSON sidecars and outside-root links are not served;
SVG retains its restrictive CSP. Previously cached/downloaded copies cannot be
revoked: purge operator-controlled proxy caches during upgrade. HTTP LAN is for
trusted networks only; use TLS/VPN on untrusted networks. HTTPS sessions use Secure
cookies. A malicious process on the operator host is outside this boundary.

Wrong/missing LAN credentials return `401 LAN_TOKEN_REQUIRED`; invalid Host/Origin
returns 403. Bootstrap is limited to ten failed attempts per socket peer per minute
and shares the app API request budget. Respect `Retry-After` on 429; a full
256-session store returns 503 instead of evicting users. Tokens are bounded to
4096 UTF-8 bytes. Access errors contain fixed messages, never supplied secrets.

## Provider Policy

Image generation supports OAuth, API-key, Grok, and Gemini (`agy` and `gemini-api`) providers.

- `provider: "oauth"` uses the local Codex OAuth proxy.
- `provider: "api"` uses the OpenAI Responses API with the hosted `image_generation` tool.
- `provider: "grok"` calls `https://api.x.ai` directly with the xAI OAuth session in `~/.progrok/auth.json`. Classic, Node and multimode image generation honor `webSearchEnabled: false` (Node also honors `searchMode: "off"`): this skips `/v1/responses` search, not the configured planner's forced `generate_image` call. Planner default is `grok-4.3`; `grok-4.6` and `grok-4.5` remain selectable overrides. References select `/v1/images/edits` instead of `/v1/images/generations`. Agent's omitted-option search default is unchanged.
- `provider: "agy"` spawns the Antigravity CLI (`agy -p`) to generate images via Google Gemini's `default_api:generate_image` tool. Model is `nano-banana-2`. Output is fixed at 1024×1024 JPEG. Max 3 reference images (i2i). No web search, quality, size, or mask controls. Multimode returns a single image. Video is unsupported (`AGY_VIDEO_UNSUPPORTED`).
- `provider: "grok-api"` uses a direct xAI API key with the same image search/planner/image semantics. Missing or blank image credentials are refused with `GROK_API_KEY_MISSING` before admission, never changed to the OAuth lane. Video remains a separate path. Configure the key in Settings or `XAI_API_KEY`.
- `provider: "gemini-api"` calls the Google Generative Language API directly (or Vertex AI with a service account JSON). Supports models `nano-banana-2` (Gemini 3.1 Flash Image) and `nano-banana-pro` (Gemini 3 Pro Image). Supports variable aspect ratios (1:1 through 21:9) and four resolution tiers (512px, 1K, 2K, 4K) on both auth paths — the direct API path sends `generation_config.response_format.image` (snake_case) while the Vertex AI endpoint (`aiplatform.googleapis.com`) sends `generationConfig.imageConfig` (camelCase). With `size: "auto"` the image config is omitted entirely and the model decides ratio/size. Auth: `GEMINI_API_KEY` env var, web UI key management (`/api/keys/gemini`), or a Vertex AI service account JSON (`VERTEX_SERVICE_ACCOUNT_JSON` or `/api/keys/vertex`). When both Vertex credentials and an API key are configured, Vertex takes priority. The chosen auth mode (`apikey` or `vertex`) persists to `~/.ima2/config.json` as `geminiAuthMode` and is restored on server startup. Per-model cost: `nano-banana-2` (Flash): 512=$0.001, 1K=$0.003, 2K=$0.004, 4K=$0.006; `nano-banana-pro`: 1K=$0.007, 2K=$0.007, 4K=$0.013. No web search or mask controls.
- `provider: "nai"` calls NovelAI text-to-image generation with one of `nai-diffusion-5-full`, `nai-diffusion-5-curated`, `nai-diffusion-4-5-full`, or `nai-diffusion-4-5-curated`. It accepts the provider-native request fields documented below and returns a ZIP that ima2 decodes to PNG. References, edits, and masks are explicitly refused.
- API-key generation covers classic generate, edit, mask-guided edit, multimode, and node generation.
- If `provider: "api"` is requested without an API key, routes fail before upstream with `401` and `API_KEY_REQUIRED`.
- Grok generation maps `size` to xAI `aspect_ratio` and `resolution`; it does not send an OpenAI-style `size` field upstream. Grok edit uses xAI `/v1/images/edits`; Grok mask edit remains unsupported and returns `GROK_MASK_UNSUPPORTED`.
- Mask edits are mask/selection guided edits, not pixel-perfect inpaint guarantees.

Grok video generation uses `POST /api/video/generate` (SSE). See the Video
Generation section below for the full endpoint specification.

### Grok image artifact retrieval

Returned image URLs require HTTPS and a conservative numeric-address policy.
Private/link-local/shared/loopback/documentation/transition destinations are
rejected by default; every DNS answer and redirect hop is validated, and the
connection uses only those validated addresses. No default re-resolution,
connection pooling, API credential, cookie or referrer forwarding occurs.

The exact server-configured proxy origin is a local exception only when it is
the initial artifact origin. Leaving it permanently removes that exception for
the chain: public→private-proxy and proxy→public→private-proxy cannot regain trust.
At most five redirects and50MiB are accepted; the single30s default deadline
covers DNS, retries, redirects and streamed bytes. An omitted/false Content-Length
does not bypass the streamed cap. HTTP GET may retry under the existing policy;
billable image POST is not automatically retried.

The downloader reports `GROK_IMAGE_DOWNLOAD_FAILED`/502 for policy/body failures,
`GROK_IMAGE_TIMEOUT`/504 for deadline, and `GENERATION_CANCELED`/499 for caller
abort; existing surface error normalization still applies. Errors do not expose
raw returned URL/query credentials. This restricted policy is not an exhaustive
public-address/routability guarantee and does not change video or MCP URL policy.

### Agy artifact reads and cleanup

Reported and fallback artifact paths must be absolute regular files within the
canonical `.gemini`, `.cache`, or system temporary roots. Intentionally relocated
root directories remain supported; missing roots never broaden the boundary.
Leaf symlinks, paths escaping those roots, unusable file identities and detected
path/file replacement are rejected. The same checks apply to parsed result paths
and fallback discovery; filename matching alone is not acceptance.

The reader enforces an inclusive 50MiB limit before and during descriptor reads,
using bounded blocks even when individual reads are short. A successful receipt
authorizes cleanup only for that same checked file; replacements and unrelated
siblings are left alone. Direct reader/operation cancellation returns
`GENERATION_CANCELED`/499 after pending file I/O and descriptor close settle;
existing node normalization can expose `INVALID_REQUEST`/499 instead.
Policy-rejected artifacts are not deleted. The reader and Agy operation add no
retries, but caller policies remain unchanged: reference-free node requests can
retry once after retryable artifact errors, starting another generation attempt.

`AGY_PATH_REJECTED`/502 covers the path/identity policy; `AGY_ARTIFACT_TOO_LARGE`/502
covers overflow, and `AGY_ARTIFACT_NOT_FOUND`/502 covers missing reported files.
Existing generation normalization may expose `code: UNKNOWN` while retaining
the original `rawCode` and `errorClass: INTERNAL_STATE_ERROR`.
Windows uses explicit path/identity checks without POSIX no-follow open flags.
This is not an atomic filesystem sandbox against another same-user process, a
hardlink-provenance guarantee, or a process-wide memory ceiling.

## Health And Status

### Core provider surface metadata

`GET /api/capabilities` includes `providerSurfaces[coreProviderId][surface]`.
`GET /api/models` includes the same `surfaces` on each core lane; MCP lanes
retain their existing model capabilities. Surfaces are `generate`, `edit`,
`multimode`, `node`, and `video`.

Each record contains `supported`, `references`, `mask`, `streaming`, and
`catalogAccess` (`static` or `runtime`). These are application capability facts,
not credential/liveness or entitlement checks. `references` means the surface
can accept image input; a Comfy workflow still needs the appropriate binding.
`streaming` describes partial-image delivery on Node/Multimode, not lifecycle SSE.

NovelAI's generate/node/multimode entries are supported without references;
edit/video are unsupported. Its models explicitly declare generation support,
not fictitious edit support. Comfy is runtime-catalog backed: empty static
model IDs do not disable its generate/edit/video surfaces, while node/multimode
remain unsupported. Local capabilities expose the structural map without
inventing a runtime `lanes` availability result.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Server health, version, paths, provider policy; includes `grok: { auth: "oauth" \| "none" }`, mirrored in `~/.ima2/server.json` |
| `POST` | `/api/admin/stop` | Clean shutdown (local admin only): requires the boot-generated `X-Ima2-Admin-Nonce` from `~/.ima2/server.json`; any request with an `Origin` header is refused (browser drive-by protection). Responds `202` then self-signals SIGTERM |
| `GET` | `/api/providers` | Provider availability and runtime ports |
| `GET` | `/api/oauth/status` | OAuth proxy status and visible models |
| `GET` | `/api/grok/status` | xAI OAuth session state and visible xAI image models: `ready`, `no_image_model`, `error`, or `offline` with `reason: "login_required"` when no session is stored |
| `GET` | `/api/billing` | Billing/status probe, including API key source when configured |
| `GET` | `/api/quota` | Provider quota: returns `{ codex, grok, nai }`. Codex windows are `5h` and `7d`. NovelAI returns a `v5-battery` remaining-charge window when available (`resetsAt` is the ISO ETA for +1%, not full recharge), with Anlas balances in `nai.anlasFixed` / `nai.anlasPurchased`; a missing meter has no window. NovelAI account email is always null. Eligible Grok Build xAI OIDC/external auth returns a `weekly` percentage/reset window from `GET /v1/billing?format=credits`. If unavailable, the legacy endpoint may return a `monthly` window plus `billing: { usedUsd, limitUsd }`. |

## Account Switching

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/switch` | Start a device-code OAuth flow. Body: `{ "provider": "grok" \| "codex" }`. Returns `{ sessionId, userCode, verificationUrl }`. |
| `GET` | `/api/auth/switch/:sessionId` | Poll switch-account session status. Returns `{ status }` where status is `pending`, `complete`, `error`, or `expired`. |

The Switch Account flow opens a browser verification URL. Once the user completes the device-code step, the server saves the new credentials (Grok: `~/.progrok/auth.json`; Codex: via `codex login --device-auth`) and the session transitions to `complete`. This endpoint is surfaced as a **Switch Account** button in the Settings QuotaCard for Grok and Codex providers.

## Storage

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/storage/status` | Summarized gallery storage status for support UI |
| `POST` | `/api/storage/open-generated-dir` | Ask the server process to open the generated image folder |

`GET /api/storage/status` returns a support-safe summary, not raw legacy path arrays by default.

```json
{
  "ok": true,
  "data": {
    "generatedDirLabel": "~/.ima2/generated",
    "generatedCount": 0,
    "legacyCandidatesScanned": 18,
    "legacySourcesFound": 0,
    "legacyFilesFound": 0,
    "state": "not_found",
    "messageKind": "apology",
    "recoveryDocsPath": "docs/RECOVER_OLD_IMAGES.md",
    "doctorCommand": "ima2 doctor",
    "overrides": {
      "generatedDir": false,
      "configDir": false
    }
  }
}
```

Storage `state` values:

| State | Meaning |
|---|---|
| `ok` | Current gallery has files or no recovery notice is needed |
| `recoverable` | Legacy folders/files are still present and may be recoverable |
| `not_found` | Current gallery is empty and no legacy folder was found |
| `unknown` | Storage status inspection failed or was incomplete |

`POST /api/storage/open-generated-dir` opens the generated image folder on the machine running `ima2 serve`. If the browser is connected to a remote server, VM, container, WSL instance, or another computer on the network, this action targets that server machine, not necessarily the browser device.

## In-Flight Jobs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/inflight` | Active jobs only by default |
| `GET` | `/api/inflight?includeTerminal=1` | Includes recent terminal jobs for debugging |
| `DELETE` | `/api/inflight/:requestId` | Cancel or forget an active job |
| `GET` | `/api/events` | Persistent SSE multiplex channel for all async generation progress (see below) |

In-flight logs and responses use `requestId` for correlation. Logs should not include raw prompts, reference data URLs, generated base64, tokens, cookies, auth headers, or raw upstream bodies.

## Events (SSE Multiplexing)

### `GET /api/events` (SSE Multiplexing)

Single persistent Server-Sent Events channel that carries progress for all async generation jobs. The browser UI opens one `EventSource` here instead of holding a per-request SSE connection for each job, avoiding browser per-origin connection limits.

| Query | Notes |
|---|---|
| `lastEventId` | Optional. Reconnect cursor; also accepted via the `Last-Event-ID` request header |

**Response**: `text/event-stream` (persistent). Each frame uses standard SSE fields `id`, `event`, and `data` (JSON).

**Connection limits**: When active listeners reach 512, the server returns `503` with `SSE_CAPACITY` before opening the stream.

**Heartbeat**: Every 15 seconds the server writes a comment frame:

```text
: ping
```

**Replay**: On reconnect, the server replays events from an in-memory ring buffer (size 2000) for IDs newer than `lastEventId`. Large image payloads (>1000 characters) are omitted from replay with `_imageOmitted: true` in the `data` payload. If the requested ID is older than the oldest buffered event, the server emits a `replay-gap` event before live fan-out:

| Event | Data | Description |
|---|---|---|
| `replay-gap` | `{ lastEventId, oldestAvailableId }` | Client should reconcile inflight state (for example via `GET /api/inflight`) |

**Job routing**: Every `data` payload includes `jobId` (same value as the job's `requestId`). Event bodies also carry `requestId` where applicable. Clients filter events by matching `data.jobId` or `data.requestId` to the job they started.

**Event types** (fan-out to all connected clients):

| Event | Emitted by | Description |
|---|---|---|
| `phase` | node, multimode, video | Lifecycle phase change |
| `partial` | node, multimode | Progressive preview image (base64 data URL) |
| `image` | multimode | Final saved `GenerateItem` for one sequence image |
| `done` | node, multimode, video | Terminal success payload (route-specific shape) |
| `error` | all generation routes | Terminal failure |
| `submitted` | video | Job submitted to xAI |
| `progress` | video | Progress fraction 0.0–1.0 |
| `planning` | video | Video planner running |

Example SSE frame:

```text
id: 42
event: phase
data: {"requestId":"req_abc","jobId":"req_abc","phase":"streaming"}
```

### Async generation mode

`POST /api/node/generate`, `POST /api/generate/multimode`, and `POST /api/video/generate` support an async POST mode for clients that already hold `GET /api/events`:

```json
{
  "async": true,
  "requestId": "req_xxx",
  "...": "other route fields"
}
```

| Outcome | HTTP | Body |
|---|---|---|
| Accepted | `202` | `{ "requestId": "req_xxx" }` |
| Duplicate active `requestId` | `409` | `REQUEST_ID_IN_USE` |
| More than the configured concurrent active job limit | `429` | `TOO_MANY_JOBS` with `Retry-After: 5`; default limit is `24` via `IMA2_MAX_PARALLEL` |

Progress events are published on `GET /api/events`. The POST response returns immediately; clients must not expect SSE on the POST connection when `async: true`.

CLI and legacy clients omit `async` and keep the original behavior: per-request SSE on the same POST response (`Accept: text/event-stream` where applicable). The server dual-emits in that mode — it writes SSE to the POST response and also publishes the same events on `GET /api/events`.

## Generation

## Sprite Atlas

Sprite atlas imports require both a sprite-gen-compatible manifest and a PNG atlas. Unknown manifest fields are preserved during read/write round trips.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/sprite-atlas/import` | JSON `{ manifest, atlasBase64, runId?, name? }`; validates explicit rects and creates a sprite run plus representative image asset. |
| `GET` | `/api/sprite-atlas/:runId` | Returns manifest, optional curation, and atlas URL. |
| `PUT` | `/api/sprite-atlas/:runId/curation` | Stores sprite-gen curation v1 atomically without changing source frames. |
| `POST` | `/api/sprite-atlas/:runId/unpack` | Extracts frames using manifest rects. |
| `POST` | `/api/sprite-atlas/:runId/bake` | Applies curation and rebuilds atlas, manifest, and report. |
| `POST` | `/api/sprite-atlas/:runId/export/contact-sheet` | Body `{ state, columns? }`; creates a PNG contact sheet. |
| `POST` | `/api/sprite-atlas/:runId/export/gif` | Body `{ state, fps?, loop? }`; creates and decode-validates a transparent GIF through ffmpeg. |

Import without a manifest returns `SPRITE_MANIFEST_REQUIRED`. GIF export returns `FFMPEG_UNAVAILABLE` with HTTP 503 when ffmpeg is unavailable.

### `POST /api/generate`

Text-to-image and reference-guided root generation.

```json
{
  "prompt": "a shiba in space",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "provider": "oauth",
  "model": "gpt-5.4",
  "references": [],
  "requestId": "optional-client-id",
  "storyboard": false
}
```

Supported quality values: `low`, `medium`, `high`.

Supported moderation values: `auto`, `low`.

When `storyboard` is `true`, the server prepends storyboard keyframe instructions so image
generations maintain character and scene continuity for multi-shot video production.

Current app default: `gpt-5.6-luna`. `gpt-5.5` and the other supported GPT image models remain available when callers explicitly select them.

When `provider` is `"nai"`, classic, multimode, and node generation accept the
same 13 provider-native fields: `negativePrompt`, `sampler`, `noiseSchedule`,
`steps`, `scale`, `cfgRescale`, `seed`, `ucPresetId`, `qualityPresetId`,
`autoSmea`, `decrisper`, `varietyPlus`, and `straightAlpha`. Missing values stay
sparse and resolve from `config.naiProvider`; operator defaults `defaultAutoSmea`
and `defaultDecrisper` are `false` unless overridden by config or
`IMA2_NAI_DEFAULT_AUTO_SMEA` / `IMA2_NAI_DEFAULT_DECRISPER`. Quality preset and
enabled alpha are V5-only. The four exact image models are
`nai-diffusion-5-full`, `nai-diffusion-5-curated`,
`nai-diffusion-4-5-full`, and `nai-diffusion-4-5-curated`. The lane is
text-to-image only: `NAI_REF_UNSUPPORTED`, `NAI_EDIT_UNSUPPORTED`, and
`NAI_MASK_UNSUPPORTED` fail closed rather than discarding input.

When `provider` is `"grok"`, supported models include `grok-imagine-image-2.0`,
`grok-imagine-image` and `grok-imagine-image-quality`. The server uses `grok-4.3`
as the configured search/planner default (`IMA2_GROK_PLANNER_MODEL`) and times search and
planner steps separately from the image call (`IMA2_GROK_PLANNER_TIMEOUT_MS`).
For `n > 1`, search and planning run once and the planned prompt is reused for
the image requests. Search-disabled classic generations report zero search calls;
otherwise the shared plan reports one logical search call.

If `references` are present on a Grok classic request, ima2 still performs the
configured planning phase, with search only when enabled. The planner receives the
reference images as multimodal `image_url` inputs, and its forced
`generate_image.prompt` argument is instructed to be English-only except for
exact visible text requested by the user. The final image call then uses xAI
`/v1/images/edits` with the same reference images instead of
`/v1/images/generations`. This keeps image-to-image/reference context alive
through the pipeline. The server permits up to three source images for these
Grok classic requests; more than three
references return `GROK_REF_TOO_MANY`.

Grok size mapping:

| Requested size | xAI `aspect_ratio` | xAI `resolution` |
|---|---|---|
| `1024x1024` | `1:1` | `1k` |
| `1536x1024` | `3:2` | `1k` |
| `1024x1536` | `2:3` | `1k` |
| `1360x1024` | `4:3` | `1k` |
| `1024x1360` | `3:4` | `1k` |
| `1824x1024` | `16:9` | `1k` |
| `1024x1824` | `9:16` | `1k` |
| `2048x2048` | `1:1` | `2k` |
| `2048x1152` | `16:9` | `2k` |
| `1152x2048` | `9:16` | `2k` |
| `3840x2160` | `16:9` | `2k` |
| `2160x3840` | `9:16` | `2k` |
| `auto` | `auto` | omitted |

Custom sizes are reduced to the closest xAI-supported aspect ratio and use
`2k` when the requested longest edge or pixel budget is closer to a 2K image.

### `POST /api/edit`

Image edit / image-to-image generation.

The request includes a prompt and image payload. `provider: "api"` sends the prompt and image through the shared Responses image adapter. Optional masks are forwarded as mask guidance, not a pixel-perfect edit guarantee.

With `provider: "grok"`, edit requests are sent to xAI `/v1/images/edits`
with the stored OAuth session. Masked Grok edits are rejected before
upstream with `GROK_MASK_UNSUPPORTED`.

Grok multimode plans each attempted image in order and performs search only when
enabled. Sparse successes retain their original attempt index: a failed first
attempt cannot make the final sweep persist the second image twice. Identical
bytes at different successful indices remain separate outputs. The internal
originalIndexes array is not added to request/SSE/history/sidecar schemas.

### `POST /api/node/generate`

Node-mode generation and child edits.

Body fields:

```json
{
  "parentNodeId": "optional-server-node-id",
  "prompt": "continue this image",
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "model": "grok-imagine-image",
  "references": [],
  "externalSrc": "optional-history-url",
  "sessionId": "session-id",
  "clientNodeId": "client-node-id",
  "requestId": "request-id",
  "provider": "grok"
}
```

When `parentNodeId` is present, the server loads the stored parent node image and uses the edit path. Node-local references are allowed on both root and child/edit nodes; for child/edit nodes the parent image is sent first, then references, then the text prompt.

Grok Node Mode uses the configured planner and Images API, with search suppressed by `searchMode: "off"` or `webSearchEnabled: false`. A parent node image, `externalSrc`, or extra references are passed to the planner and then to `/v1/images/edits`; otherwise the final call uses `/v1/images/generations`. The server caps total input images at three, counting parent/current image plus references, and returns `GROK_REF_TOO_MANY` before upstream when exceeded. Existing quality-model resolution is unchanged.

The route can stream Server-Sent Events when the client sends `Accept: text/event-stream`. Possible events include `phase`, `partial`, `done`, and `error`. Alternatively, send `{ "async": true, "requestId": "req_xxx" }` in the body to receive `202 { requestId }` immediately and follow progress on `GET /api/events` (see Events section).

Grok Node SSE responses do not include Responses API `partial` image events because the xAI Images API call is synchronous JSON. They still emit `phase` and `done`/`error` events so the Node UI can use the same in-flight lifecycle.

### `POST /api/generate/multimode` (SSE)

Multi-image sequence generation. SSE-only on the POST response unless async mode is used.

```json
{
  "prompt": "a story in four panels",
  "maxImages": 4,
  "quality": "medium",
  "size": "1024x1024",
  "format": "png",
  "moderation": "low",
  "model": "gpt-5.4",
  "provider": "oauth",
  "references": [],
  "requestId": "optional-client-id",
  "async": false
}
```

Send `Accept: text/event-stream` for per-request SSE on the POST connection. Or set `"async": true` with a client `requestId` to get `202 { requestId }` and receive events on `GET /api/events`.

**SSE events**:

| Event | Data | Description |
|---|---|---|
| `phase` | `{ requestId, phase, sequenceId?, maxImages? }` | Lifecycle phase |
| `partial` | `{ requestId, image, index }` | Progressive preview |
| `image` | full `GenerateItem` | One saved sequence image |
| `done` | route-specific summary; may include `status: "partial"` after timeout if at least one image was saved | Sequence complete |
| `error` | `{ requestId, error, code?, status? }` | Generation failed |

### `GET /api/node/:nodeId`

Fetch stored node metadata and asset URL.

## Reference Images

Reference uploads are capped at 5 items. The frontend compresses large JPEG/PNG files before sending them. HEIC/HEIF files are rejected with a user-facing conversion hint.

Server-side validation may return these reference codes:

| Code | Meaning |
|---|---|
| `REF_NOT_ARRAY` | `references` was not an array |
| `REF_TOO_MANY` | More than the configured reference count |
| `REF_NOT_STRING` | A reference item was not a string |
| `REF_EMPTY` | A reference item was empty |
| `REF_TOO_LARGE` | A reference exceeded the configured base64 size |
| `REF_NOT_BASE64` | A reference was not valid base64 |
| `GROK_REF_TOO_MANY` | Grok classic generation received more than three reference images |
| `GROK_MASK_UNSUPPORTED` | Grok edit was requested with a mask; xAI mask edit is not wired in this release |

## Video Generation

### `POST /api/video/generate` (SSE)

Generate a video via the Grok video provider. Returns Server-Sent Events on the POST connection, or accepts async mode (`{ "async": true, "requestId": "req_xxx" }`) for `202 { requestId }` with progress on `GET /api/events` (see Events section).

```json
{
  "prompt": "a cat playing piano",
  "provider": "grok",
  "model": "grok-imagine-video",
  "duration": 5,
  "resolution": "480p",
  "aspectRatio": "auto",
  "sourceImage": "<base64>",
  "referenceImages": ["<base64>", "<base64>"],
  "referenceFilenames": ["existing-file.png"],
  "continueFromVideo": "1780226256355_50252101.mp4",
  "continuityLineage": { "lineageId": "optional-client-hint", "entries": [] },
  "sessionId": "optional",
  "requestId": "optional-client-id"
}
```

**Models**: `grok-imagine-video-1.5` (default), `grok-imagine-video`. The legacy `grok-imagine-video-1.5-preview` string is accepted as a compatibility alias and normalized before the upstream request.

**Mode** is auto-detected from reference inputs:

| Inputs | Mode | Duration cap |
|---|---|---|
| No images | text-to-video | 1–15s |
| 1 image (`sourceImage` or `sourceFilename`) | image-to-video | 1–15s |
| 2–14 images (`referenceImages` / `referenceFilenames`) | reference-to-video | 1–15s on grok-imagine-video-1.5, 1–10s on grok-imagine-video |

1080p is accepted for `grok-imagine-video-1.5` prompt-only text-to-video and image-to-video with one image/frame source, including `continueFromVideo` after the server extracts the parent video's last frame. Prompt-only 1.5 text-to-video uses the internal white-canvas image-to-video shim before the upstream request. 1.5 does not add Ref2V, V2V edit, or extension support.

**Parameters**:

| Field | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | — | Required |
| `provider` | string | `"grok"` | `"grok"` or `"grok-api"` |
| `model` | string | `grok-imagine-video-1.5` | Video model |
| `duration` | integer | `5` | 1–15 seconds (clamped to 10 for reference-to-video) |
| `resolution` | string | `"480p"` | `480p`, `720p`, or `1080p` (`1080p` uses 1.5 T2V canvas shim or I2V) |
| `aspectRatio` | string | `"auto"` | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto |
| `sourceImage` | string | — | Base64 image for image-to-video |
| `sourceFilename` | string | — | Existing generated file for image-to-video |
| `referenceImages` | string[] | — | Base64 images for reference-to-video |
| `referenceFilenames` | string[] | — | Existing generated files for reference-to-video |
| `continueFromVideo` | string | — | Generated `.mp4` parent; server extracts its last frame and rebuilds lineage from sidecar |
| `continuityLineage` | object | — | Optional client hint; used only when `continueFromVideo` is absent |
| `plannerModel` | string | `grok-4.3` | Grok video planner model override; `grok-4.6` and `grok-4.5` are selectable (also via settings UI or `IMA2_GROK_PLANNER_MODEL`) |
| `storyboard` | boolean | `false` | Enable storyboard mode — maintains character/scene continuity across sequential clips |

Blank prompts return `PROMPT_REQUIRED` with a `guidance` string. The active
prompt should describe visual flow, motion flow, sound/music/no-music,
dialogue/no-dialogue, ending frame, and duration pacing. The video planner uses
the selected duration as the full clip runtime and expands short requests into a
production-level sequence with opening composition, connected motion/emotion
change, and a stable ending frame suitable for continuation. For multi-character
scenes, the planner identifies speakers by visual appearance (clothing, physique,
position, props) rather than names, and attributes each dialogue line accordingly.

When `continueFromVideo` is present, the server treats the generated `.mp4`
sidecar as authoritative. Client `continuityLineage` cannot override it. The
saved child sidecar includes `videoContinuity`, a branch-local max-4 stack using
`keep-start-plus-latest-3` retention.

`videoContinuity` shape:

```json
{
  "lineageId": "lineage:parent",
  "parentFilename": "parent.mp4",
  "sourceFrame": "last",
  "maxEntries": 4,
  "retention": "keep-start-plus-latest-3",
  "entries": [
    {
      "id": "clip:parent.mp4",
      "ordinal": 1,
      "role": "start",
      "filename": "parent.mp4",
      "userPrompt": "original user prompt",
      "revisedPrompt": "planner prompt actually sent to Grok video",
      "createdAt": 1780300000000
    }
  ]
}
```

Entry `role` is `start`, `ancestor`, `parent`, or `current`. The first clip is
kept as the start anchor; later generations keep only the latest three entries.
`lineageId` uses the generated video basename without the `.mp4` extension.
This metadata is stored in the generated `.mp4.json` sidecar and returned in
history rows and video `done` events; `/generated/*.json` remains private.

Grok prompt surfaces used by video APIs:

| Surface | Model | Responsibility |
|---|---|---|
| Video planner | `grok-4.5` (override via `plannerModel`) | Converts user prompt, search context, refs, and optional continuity lineage into the final English video prompt. It must structure core subject, action/motion, camera/composition, environment/style, dialogue/audio, ending-frame handoff, and constraints. Multi-character dialogue uses appearance-based speaker identification. |
| Video generation | xAI video model | Receives the planner prompt plus `sourceImage` or `referenceImages` when present. |
| Video analysis | `grok-4.5` | Reads first/last frame images from `/api/video/analyze` and returns recreation/continuation guidance. |

**SSE events**:

| Event | Data | Description |
|---|---|---|
| `planning` | `{ requestId }` | Preparing video generation |
| `submitted` | `{ requestId, xaiVideoRequestId, requestedModel, effectiveModel, modelFallback }` | Submitted to xAI |
| `progress` | `{ requestId, progress, stalled }` | Progress 0.0–1.0 |
| `done` | `{ requestId, filename, url, mediaType, revisedPrompt, elapsed, usage, requestedModel, effectiveModel, modelFallback, video, videoContinuity }` | Video ready |
| `error` | `{ error, code, status, requestId, guidance? }` | Generation failed |

**Video error codes**:

| Code | Meaning |
|---|---|
| `VIDEO_PROVIDER_UNSUPPORTED` | Provider is not `"grok"` or `"grok-api"` |
| `PROMPT_REQUIRED` | Empty or missing prompt |
| `INVALID_GROK_VIDEO_MODEL` | Model not in valid set |
| `INVALID_VIDEO_RESOLUTION` | Resolution is not 480p/720p/1080p, or 1080p was requested outside `grok-imagine-video-1.5` prompt-only T2V / I2V |
| `INVALID_VIDEO_ASPECT_RATIO` | Aspect ratio not in valid set |
| `INVALID_VIDEO_DURATION` | Duration not 1–15 integer |
| `GROK_VIDEO_REF_TOO_MANY` | More than 7 reference images |
| `GROK_VIDEO_FAILED` | Upstream xAI video generation failed |
| `GROK_VIDEO_FRAME_FAILED` | Server could not extract the parent video's last frame |
| `GROK_VIDEO_DOWNLOAD_FAILED` | Download-stage HTTP, size, MIME, empty-body, MP4-prefix or read failure (502) |
| `GROK_VIDEO_TIMEOUT` | The download's own non-resetting timeout expired (504) |
| `GENERATION_CANCELED` | Caller cancellation observed while downloading, including custom reasons (499) |

Completed Grok video artifacts are consumed incrementally with an inclusive
**100 MiB** byte cap. Declared size and actual streamed bytes are checked before
retaining an overflowing chunk; invalid/empty/aborted bodies do not reach caller
persistence. Accepted MIME is MP4 or octet-stream (missing MIME defaults to MP4),
and the existing minimum-length/`ftyp` prefix check is retained. This is not full
MP4 decoding or a100MiB process-memory ceiling: fetch buffers, chunk overhead and
downstream copies are separate. Safe GET retry ends at response headers; body
failure never starts a new billed generation.

The video destination policy is unchanged: initial HTTPS or the existing literal
HTTP-loopback allowlist, with fetch's default redirect behavior. It does not gain
the image downloader's DNS/private-address/per-hop pinning policy. Do not treat
HTTPS alone or these body bounds as an SSRF/security guarantee. Download error
status appears in the existing JSON or SSE/terminal envelope for each caller.

### `POST /api/video/edit`

Edit an existing video via Grok V2V. This is a blocking JSON endpoint that starts the xAI edit job, polls it, downloads the final MP4, and saves it as a generated video artifact.

```json
{
  "prompt": "make it sunset",
  "videoUrl": "https://vidgen.x.ai/.../clip.mp4",
  "model": "grok-imagine-video"
}
```

`videoUrl` may be an HTTPS video URL, xAI `file_id`, `data:video/*` URL, or generated `.mp4` filename. Generated-file inputs are restricted to real `.mp4` files under the generated directory.

### `POST /api/video/extend`

Extend a video from its last frame (last-frame→I2V orchestration). This is an async job endpoint: it returns HTTP 202 immediately and streams lifecycle events (`queued → extracting-frame → planning → submitted/progress → persisting → done` or `error`) over `GET /api/events`. The server extracts the parent video's last frame, injects it as the image-to-video source, and records durable lineage on the child artifact.

```json
{
  "sourceVideoId": "1780226256355_50252101.mp4",
  "requestId": "vext_optional",
  "prompt": "camera pulls back (optional — inherits parent prompt when empty)",
  "provider": "grok",
  "model": "grok-imagine-video",
  "duration": 6
}
```

Immediate response:

```json
{ "ok": true, "requestId": "vext_...", "sourceVideoId": "1780226256355_50252101.mp4", "workflow": "last-frame-i2v" }
```

The terminal `done` payload carries `video.operation: "extend"`, `video.sourceFrame: "last"`, and `videoLineage` (`id`, `parentId`, `rootId`, `seriesId`, `sequenceIndex`). Duplicate `requestId` returns 409. Frame-extraction failures map to `VIDEO_FRAME_EXTRACT_UNAVAILABLE` (503), `VIDEO_FRAME_EXTRACT_TIMEOUT` (504, retryable), or `VIDEO_FRAME_EXTRACT_FAILED` (500).

### `POST /api/video/extend/native`

Legacy provider-native extension (blocking JSON). Starts the xAI extension job, polls it, downloads the combined output MP4, and saves it as a generated video artifact. Prefer `/api/video/extend` for new integrations.

```json
{
  "prompt": "camera pulls back",
  "videoUrl": "1780226256355_50252101.mp4",
  "duration": 6,
  "model": "grok-imagine-video"
}
```

`duration` must be an integer from 2 to 10 seconds. Edit and native extension support `grok-imagine-video` only; `grok-imagine-video-1.5` and its preview alias are not accepted for these endpoints.

### `GET /api/video/frame`

Extract a PNG frame from a generated `.mp4` file.

| Query | Notes |
|---|---|
| `file` | Required generated `.mp4` filename or generated-dir absolute path |
| `position` | `last` (default) or non-negative seconds |

### `POST /api/video/analyze`

Analyze first and last frames from a generated `.mp4` using the configured planner model (`grok-4.5` by default). This does not upload the video as temporal video; it extracts two PNG frames and asks the vision model to infer likely motion.

```json
{
  "videoUrl": "1780226256355_50252101.mp4"
}
```

Remote URLs and `data:` inputs are intentionally rejected to avoid server-side URL fetching through `ffmpeg`.

## Generation Request Log

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/generation-requests` | Returns `{ items: GenerationRequestLogEntry[] }` — the last 200 generation attempts (prompt, requested/succeeded flags, error). Surfaced in the web UI dev panel (`GenerationRequestLogPanel`); no CLI wrapper (#95). |

## History

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/history` | List generated assets |
| `GET` | `/api/history?groupBy=session` | Group assets by session title |
| `DELETE` | `/api/history/:filename` | Tombstone a generated asset |
| `POST` | `/api/history/:filename/restore` | Restore a recently deleted asset |

History rows can include node metadata such as `sessionId`, `nodeId`, `clientNodeId`, `requestId`, and `refsCount`.

## Assets Library

Persistent library catalog over generated files (phase 050). Records reference
files inside `generated/`; deleting an asset never deletes the file.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/assets` | List/search assets (`kind`, `folderId`, `tag`, `q`, `cursor`, `limit`) |
| `GET` | `/api/assets/:id` | Fetch one asset by ID; returns `404 ASSET_NOT_FOUND` when absent |
| `POST` | `/api/assets` | Promote/create an asset (`filePath`, `kind`, `name?`, `folderId?`, `tags?`, `metadata?`) |
| `POST` | `/api/assets/promote-element` | Promote a gallery result to an `element` asset (`result.path` or `filePath`, `elementKind`, `name?`, `notes?`, `folderId?`, `tags?`) |
| `POST` | `/api/assets/derived` | Save a derived asset (raw `image/png` body; query `source`, `kind=keyed-png`, `projectId?`, `name?`, `meta?` JSON) — writes `<src>-keyed-<ts>.png` + sidecar with `derivedFrom` and registers an asset record `kind=vector-svg` sends NO body: the server reads the validated `source` from generated storage, traces it via `lib/vectorizeImage.ts`, and writes `<src>-vector-<ts>.svg` (query `preset?`, `colorPrecision?`, `filterSpeckle?`, `cornerThreshold?`; a non-raster source is refused with `DERIVED_SOURCE_NOT_RASTER`). Traced SVGs are served with a restrictive CSP and `nosniff`. |
| `POST` | `/api/video/keying` | Derive an alpha WebM from a generated green-screen mp4 (`source`, `keyParams{tolerance,softness,keyColor?}`, `projectId?`, `name?`) — responds `202 {requestId, filePath}`, publishes `keying-start/progress/done/error` on the event bus, writes sidecar with `derivedFrom` and registers a video asset |
| `PATCH` | `/api/assets/:id` | Update name/folder/notes/tags/metadata |
| `POST` | `/api/assets/:id/test-sheet` | Run an element test sheet; currently returns `501 TEST_SHEET_NOT_IMPLEMENTED` after validating the element asset |
| `DELETE` | `/api/assets/:id` | Delete the catalog row only (file untouched) |
| `DELETE` | `/api/assets/all` | Delete all asset records (files untouched) |
| `GET` | `/api/assets/folders` | List folders (flat; tree assembled client-side) |
| `POST` | `/api/assets/folders` | Create folder (`name`, `parentId?`) |
| `PATCH` | `/api/assets/folders/:id` | Rename/move folder (cycle-safe) |
| `DELETE` | `/api/assets/folders/:id` | Delete an empty folder |
| `GET` | `/api/assets/tags` | Distinct tags |

`kind` is one of `image | video | element | preset | template`. `filePath` is
required for `image`/`video`, must stay inside `generated/`, and is stored
relative to it. Cursor pagination orders by `created_at DESC, id DESC`; errors
use the standard envelope with codes such as `INVALID_ASSET_KIND`,
`INVALID_FILENAME`, `INVALID_PARENT`, `FOLDER_CYCLE`, `FOLDER_NOT_EMPTY`.

## Sessions And Graphs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sessions` | List graph sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET` | `/api/sessions/:id` | Load a session and graph |
| `PATCH` | `/api/sessions/:id` | Rename a session |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `PUT` | `/api/sessions/:id/graph` | Save graph snapshot |

`PUT /api/sessions/:id/graph` requires an `If-Match` header containing the current graph version.

Version mismatch returns `GRAPH_VERSION_CONFLICT` and the current version. This only means the client saved against a stale graph version; it is not proof that another browser tab changed the graph.

## Node Templates

Node graph templates (higgsfield 120). Seed templates ship with the app and are read-only; user templates are created from the canvas.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/node-templates` | List template summaries (seed + user) |
| `POST` | `/api/node-templates` | Create a user template (`201 { template }`) |
| `POST` | `/api/node-templates/:id/instantiate` | Return a graph copy with fresh node IDs (never auto-runs) |
| `PATCH` | `/api/node-templates/:id` | Rename a user template (seed → `403`) |
| `DELETE` | `/api/node-templates/:id` | Delete a user template (seed → `403`) |
| `GET` | `/api/node-templates/:id/export` | Download one template as a portable JSON file (seed templates included) |
| `POST` | `/api/node-templates/import` | Create a user template from such a file (`201 { template }`) |

### Portable template files

A template lives in the SQLite database of the machine that made it, so moving a
hand-built graph to a second machine means carrying the file:

```bash
curl -sO -J http://127.0.0.1:3000/api/node-templates/<id>/export
curl -sX POST http://127.0.0.1:3000/api/node-templates/import   -H 'content-type: application/json' --data-binary @my-flow.ima2-template.json
```

The document holds only the shape of the workflow — no sessions, no generated
images:

```json
{
  "kind": "ima2.node-template",
  "version": 1,
  "exportedAt": 1758499200000,
  "sourceId": "template_01J…",
  "name": "Idol Kpop",
  "description": "",
  "tags": [],
  "graph": { "nodes": [], "edges": [] }
}
```

Import is a normal create: the graph goes through the same strip step, so
secret-looking keys and run outputs in a file from elsewhere never reach the
database. A file whose `kind` is wrong (`TEMPLATE_FILE_KIND`), whose `version`
is newer than this app understands (`TEMPLATE_FILE_VERSION`) or which is over
2 MB / 300 nodes / 1200 edges (`TEMPLATE_FILE_TOO_LARGE`) is refused. A name
already in use is imported as `Name (2)` instead of overwriting.

Graph save requests may include observability headers:

```text
X-Ima2-Graph-Save-Id
X-Ima2-Graph-Save-Reason
X-Ima2-Tab-Id
```

## Style Sheets

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sessions/:id/style-sheet` | Load session style sheet |
| `PUT` | `/api/sessions/:id/style-sheet` | Save style sheet |
| `PATCH` | `/api/sessions/:id/style-sheet/enabled` | Toggle style sheet usage |
| `POST` | `/api/sessions/:id/style-sheet/extract` | Extract style fields from prompt/reference |

Style-sheet extraction can require an API key/openai client. Image generation also supports `provider: "api"` through the shared Responses API image adapter when an API key is configured.

## Prompt Library

Backed by `routes/prompts.ts` and SQLite prompt tables in `lib/db.ts`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/prompts` | List prompts (`folderId`, `q`, `favoritesOnly`, pagination) |
| `POST` | `/api/prompts` | Create prompt |
| `GET` | `/api/prompts/:id` | Fetch one prompt |
| `PATCH` | `/api/prompts/:id` | Update prompt fields |
| `DELETE` | `/api/prompts/:id` | Delete prompt |
| `POST` | `/api/prompts/:id/favorite` | Toggle favorite |
| `POST` | `/api/prompts/import` | Legacy bulk import (JSON body) |
| `GET` | `/api/prompts/export` | Export prompt library JSON |
| `GET` | `/api/prompts/folders` | List folders |
| `POST` | `/api/prompts/folders` | Create folder |
| `PATCH` | `/api/prompts/folders/:id` | Rename folder |
| `DELETE` | `/api/prompts/folders/:id` | Delete folder |

## Prompt Import

Preview/commit import flow for local files, GitHub folders, curated sources, and discovery review. Implemented in `routes/promptImport.ts`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/prompts/import/curated-sources` | List curated source registry entries |
| `GET` | `/api/prompts/import/discovery` | List discovery review queue |
| `POST` | `/api/prompts/import/discovery-search` | Search GitHub for prompt-pack candidates |
| `POST` | `/api/prompts/import/discovery-review` | Approve/reject discovery candidate |
| `POST` | `/api/prompts/import/curated-search` | Search indexed curated sources |
| `POST` | `/api/prompts/import/curated-refresh` | Refresh curated index cache |
| `POST` | `/api/prompts/import/folder-files` | List files in a GitHub folder |
| `POST` | `/api/prompts/import/folder-preview` | Preview selected GitHub folder files |
| `POST` | `/api/prompts/import/preview` | Preview local/GitHub import candidates |
| `POST` | `/api/prompts/import/commit` | Commit selected candidates into the prompt library |

## Card News (dev-gated)

Registered only when `config.features.cardNews` is true (`routes/cardNews.ts`). Web UI requires `VITE_IMA2_CARD_NEWS=1` or `VITE_IMA2_DEV=1`; CLI uses `ima2 cardnews …`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/cardnews/image-templates` | List image templates |
| `GET` | `/api/cardnews/image-templates/:templateId/preview` | Template preview image |
| `GET` | `/api/cardnews/role-templates` | Built-in role templates |
| `GET` | `/api/cardnews/sets` | List card-news sets |
| `GET` | `/api/cardnews/sets/:setId` | Fetch one set |
| `GET` | `/api/cardnews/sets/:setId/manifest` | Set manifest JSON |
| `POST` | `/api/cardnews/draft` | Create planner draft |
| `POST` | `/api/cardnews/generate` | Start card generation job |
| `POST` | `/api/cardnews/jobs` | Create job record |
| `GET` | `/api/cardnews/jobs/:jobId` | Poll job status |
| `POST` | `/api/cardnews/jobs/:jobId/retry` | Retry failed job |
| `POST` | `/api/cardnews/cards/:cardId/regenerate` | Regenerate one card |
| `POST` | `/api/cardnews/export` | Export completed set assets |

## Common Error Codes

| Code | Meaning |
|---|---|
| `API_KEY_REQUIRED` | `provider: "api"` was requested without a configured API key |
| `APIKEY_DISABLED` | Legacy/deprecated hard-block code from older builds |
| `INVALID_IMAGE_MODEL` | Model name is unknown or unsupported |
| `IMAGE_MODEL_UNSUPPORTED` | Model exists but cannot use image generation |
| `INVALID_REQUEST` | Upstream request parameters are invalid; raw provider details may be included as `upstreamCode`, `upstreamType`, and `upstreamParam` |
| `INVALID_MODERATION` | Moderation value is not `auto` or `low` |
| `SAFETY_REFUSAL` | Upstream safety refusal |
| `MODERATION_REFUSED` | Content generation refused by moderation |
| `AUTH_CHATGPT_EXPIRED` | Codex/ChatGPT OAuth session expired |
| `AUTH_API_KEY_INVALID` | API key is invalid, revoked, out of quota, or wrong org |
| `NETWORK_FAILED` | Network, proxy, VPN, or firewall failure |
| `OAUTH_UNAVAILABLE` | Local OAuth proxy is not available |
| `OPEN_GENERATED_DIR_FAILED` | The server could not open the generated image folder |
| `GRAPH_VERSION_REQUIRED` | Missing graph `If-Match` header |
| `GRAPH_VERSION_CONFLICT` | Stale graph version |
| `GRAPH_TOO_LARGE` | Graph exceeds node/edge limits |
| `NODE_NOT_FOUND` | Node metadata was not found |
| `INVALID_GROK_IMAGE_MODEL` | A Grok request used a model outside `grok-imagine-image` or `grok-imagine-image-quality` |
| `GROK_RATE_LIMITED` | xAI returned a rate-limit response |
| `GROK_AUTH_FAILED` | The xAI request could not be authenticated |
| `GROK_SEARCH_TIMEOUT` / `GROK_PLANNER_TIMEOUT` / `GROK_IMAGE_TIMEOUT` | The Grok search, planner, or image API step exceeded its timeout budget |
| `AGY_GENERATION_FAILED` | Gemini (agy) image generation failed |
| `AGY_TIMEOUT` | Agy CLI process exceeded its 360-second timeout |
| `AGY_PROCESS_ERROR` | Agy CLI binary failed to start or crashed |
| `AGY_QUOTA_EXHAUSTED` | Gemini API quota exhausted (rate limit) |
| `AGY_PARSE_FAILED` | Could not parse artifact path from agy output |
| `AGY_ARTIFACT_NOT_FOUND` | Agy reported an artifact path that does not exist |
| `AGY_PATH_REJECTED` | Agy artifact path, file type, or identity failed the allowed-root policy |
| `AGY_ARTIFACT_TOO_LARGE` | Agy artifact exceeded the inclusive 50MiB read limit |
| `AGY_VIDEO_UNSUPPORTED` | Video generation is not supported by the Gemini (agy) provider |
| `AGY_MASK_UNSUPPORTED` | Mask-based editing is not supported by the Gemini (agy) provider |
| `AGY_REF_TOO_MANY` | Too many reference images for agy (max 3) |
| `GEMINI_API_KEY_MISSING` | Gemini API key or Vertex AI credentials not configured |
| `GEMINI_API_RATE_LIMITED` | Gemini API rate limited (429) |
| `GEMINI_API_BAD_REQUEST` | Gemini API bad request (400/403) |
| `GEMINI_API_SAFETY_BLOCKED` | Gemini API generation blocked by safety filter |
| `GEMINI_API_NO_IMAGE` | Gemini API returned no image in response |
| `VIDEO_PROVIDER_UNSUPPORTED` | Video generation requires provider `"grok"` or `"grok-api"` |
| `SSE_CAPACITY` | More than 512 concurrent `GET /api/events` listeners |
| `REQUEST_ID_IN_USE` | Async POST used a `requestId` that already has an active job |
| `TOO_MANY_JOBS` | More than the configured concurrent active generation job limit (`Retry-After: 5`; default `24`) |

## Key Management

API key management endpoints for configuring provider credentials at runtime through the web UI or HTTP API.

| Endpoint | Method | Description |
|---|---|---|
| `/api/keys/status` | GET | Returns configured/valid/maskedKey status for all providers (openai, xai, gemini, atlascloud, minimax, nai, vertex) plus `geminiAuthMode` (`"apikey"` or `"vertex"`) |
| `/api/keys/:provider` | PUT | Save an API key. Body: `{ "apiKey": "..." }`. Validates key format and upstream before saving to config.json. Provider: `openai`, `xai`, `gemini`, `atlascloud`, `minimax`, or `nai`. `minimax` and `nai` have no fixed key prefix, so only the upstream validation call gates them. |
| `/api/keys/:provider` | DELETE | Remove a config-sourced API key. Env-sourced keys cannot be removed (`ENV_KEY_IMMUTABLE`). |
| `/api/keys/vertex` | PUT | Save a Vertex AI service account JSON. Body: `{ "serviceAccountJson": "..." }`. Validates JSON structure (`type: "service_account"`, `project_id` required). |
| `/api/keys/vertex` | DELETE | Remove a config-sourced Vertex AI service account. |
| `/api/keys/gemini-auth-mode` | PUT | Persist the Gemini auth mode chosen in the settings dropdown. Body: `{ "mode": "apikey" \| "vertex" }`. Saved to `config.json` and hot-updated. |

Keys saved via PUT are stored in `config.json` and hot-updated in the runtime context (no server restart required). Keys loaded from environment variables (`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `VERTEX_SERVICE_ACCOUNT_JSON`) take precedence and are immutable through the API.

## Thumbnail Backfill

| Endpoint | Method | Description |
|---|---|---|
| `/api/history/backfill-thumbnails` | POST | Generate missing `.thumb.jpg` thumbnails for all images and videos in the generated directory. Returns `{ ok, total, created, skipped, failed }`. Also available offline via `ima2 backfill-thumbs`. |

Thumbnails are also generated automatically on server startup for any media files that lack them.

## Agent Mode

Agent Mode is a conversational image workspace (web UI only — no CLI). All routes are under `/api/agent/*` and are backed by `routes/agent.ts` + `lib/agent*.ts`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/agent/tools` | Slash-command and tool metadata |
| `GET` | `/api/agent/sessions` | List sessions (`?limit=`) |
| `POST` | `/api/agent/sessions` | Create session (`title`, `currentImage`, `webSearchEnabled`) → `201` |
| `GET` | `/api/agent/sessions/:sessionId` | Fetch one session |
| `PATCH` | `/api/agent/sessions/:sessionId` | Update title, `webSearchEnabled`, `generationSettings`, `currentImage`, locks |
| `DELETE` | `/api/agent/sessions/:sessionId` | Delete session |
| `POST` | `/api/agent/sessions/:sessionId/compact` | Session compaction |
| `GET` | `/api/agent/sessions/:sessionId/manifest` | XML manifest export |
| `POST` | `/api/agent/sessions/:sessionId/turns` | Synchronous turn (`prompt`, provider, quality, size, model, …) |
| `GET` | `/api/agent/sessions/:sessionId/errors` | Recent errors (`?limit=`, default 10) |
| `GET` | `/api/agent/sessions/:sessionId/queue` | Per-session queue items |
| `POST` | `/api/agent/sessions/:sessionId/queue` | Enqueue async turn / slash command → `202` |
| `GET` | `/api/agent/queue` | Global queue listing |
| `POST` | `/api/agent/queue/:itemId/cancel` | Cancel queued item |
| `POST` | `/api/agent/queue/:itemId/retry` | Retry failed item |

## Prompt Builder

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/prompt-builder/chat` | `{ messages, backend?, model?, context? }` | `{ provider, backend, requestedBackend, model, message, usage }` |
| `GET` | `/api/prompt-builder/config` | none | `{ backend, model, options: { backends, models, autoOrder }, locked }` |
| `PUT` | `/api/prompt-builder/config` | `{ backend, model? }` | Same config payload after atomic persistence |

The persisted keys are `promptBuilder.backend` and `promptBuilder.model`; the corresponding
environment locks are `IMA2_PROMPT_BUILDER_BACKEND` and `IMA2_PROMPT_BUILDER_MODEL`.
`backend=auto` tries `oauth -> grok -> api -> grok-api` and selects the first ready lane.
An explicit backend stays pinned and never falls back. Chat responses separate
`requestedBackend` from the answering `backend`, which the UI renders as `via <backend>`.

Invalid backend/model pairs return typed 400 errors. An unavailable explicit lane returns its
typed 401/503 error, no ready Auto lane returns 503 `PROMPT_BUILDER_NO_BACKEND_READY`, and
environment-locked config writes return 409 `PROMPT_BUILDER_CONFIG_ENV_LOCKED`. Auto selection
happens before sending upstream; an accepted or failed upstream request is not retried on another
backend.

## Endpoint → CLI Mapping

Most server routes under `/api/*` have a CLI wrapper. The exception is **Agent Mode** (`/api/agent/*`), which is server + web-UI-only and has no `ima2` subcommand. The prompt builder HTTP route (`POST /api/prompt-builder/chat`) is wrapped by `ima2 prompt build`. Use this table to find the command that calls a given endpoint. (See README.md "Client" section for full flag lists.)

| Endpoint | CLI |
|---|---|
| `POST /api/generate` | `ima2 gen` |
| `POST /api/edit` | `ima2 edit` |
| `POST /api/generate/multimode` (SSE) | `ima2 multimode` |
| `POST /api/video/generate` (SSE) | `ima2 video` |
| `POST /api/video/generate` with `continueFromVideo` | `ima2 video continue` |
| `POST /api/video/edit` | `ima2 video edit` |
| `POST /api/video/extend` | `ima2 video extend` |
| `GET /api/video/frame` | `ima2 video frame` |
| `POST /api/video/analyze` | `ima2 video analyze` |
| `POST /api/node/generate` (SSE) / `GET /api/node/:id` | `ima2 node generate` / `ima2 node show` |
| `GET /api/history` | `ima2 ls` |
| `DELETE /api/history/:name` / `…/permanent` | `ima2 history rm [--permanent]` |
| `POST /api/history/:filename/restore` | `ima2 history restore --trash-id` |
| `POST /api/history/favorite` | `ima2 history favorite` |
| `POST /api/history/import-local` | `ima2 history import` |
| `POST /api/metadata/read` | `ima2 metadata` / `ima2 show --metadata` |
| `GET/POST/PUT/DELETE /api/sessions[/…]` | `ima2 session ls/show/create/rm/rename` |
| `GET/PUT /api/sessions/:id/graph` | `ima2 session graph load/save` |
| `GET/PUT /api/sessions/:id/style-sheet[/…]` | `ima2 session style-sheet …` |
| `GET/PUT/DELETE /api/annotations/:name` | `ima2 annotate get/set/rm` |
| `POST /api/canvas-versions` / `PUT /api/canvas-versions/:name` | `ima2 canvas-versions save/update` |
| `GET/POST/PUT/DELETE /api/prompts[/…]` | `ima2 prompt …` |
| `GET/POST/PATCH/DELETE /api/prompts/folders[/…]` | `ima2 prompt folder …` |
| `…/api/prompts/import/…` | `ima2 prompt import sources/refresh/curated/discovery/folder` |
| `…/api/cardnews/…` (gated on `features.cardNews`) | `ima2 cardnews …` |
| `POST /api/comfy/export-image` | `ima2 comfy export` |
| `GET /api/comfy/workflows` | `ima2 comfy workflow ls` |
| `POST /api/comfy/workflows` | `ima2 comfy workflow add` |
| `DELETE /api/comfy/workflows/:id` | `ima2 comfy workflow rm` |
| `POST /api/comfy/inspect` | `ima2 comfy workflow inspect` |
| `POST /api/comfy/probe` | Web UI only (origin reachability in the workflow form) |
| `GET /api/inflight` / `DELETE /api/inflight/:id` | `ima2 inflight ls` (alias `ps`) / `ima2 inflight rm` (alias `cancel`) |
| `GET /api/events` (SSE multiplex) | Web UI only (persistent `EventSource`; no CLI wrapper) |
| `GET /api/storage/status` / `POST /api/storage/open-generated-dir` | `ima2 storage status` / `ima2 storage open` |
| `GET /api/billing` / `GET /api/providers` / `GET /api/oauth/status` / `GET /api/grok/status` | `ima2 billing` / `ima2 providers` / `ima2 oauth status` / `ima2 grok status` |
| `GET /api/quota` | Web UI only (Grok and NovelAI quota in Settings) |
| `POST /api/auth/switch` / `GET /api/auth/switch/:sessionId` | Web UI only (Settings > QuotaCard > Switch Account) |
| `GET /api/health` | `ima2 ping` |
| `GET /api/capabilities` | `ima2 capabilities` |
| `GET /api/config/grok-planner` | — (Grok planner model query) |
| `PATCH /api/config/grok-planner` | — (Grok planner model update) |
| `GET /api/agy/status` | — (Antigravity CLI install status) |
| `POST /api/history/backfill-thumbnails` | `ima2 backfill-thumbs` |
| `GET /api/keys/status`, `PUT/DELETE /api/keys/:provider`, `PUT/DELETE /api/keys/vertex` | Web UI only (Settings > API Keys) |
| `GET/POST/PATCH/DELETE /api/agent/*` (sessions, turns, queue) | — (Agent Mode; web UI only, no CLI) |
| `POST /api/prompt-builder/chat` | `ima2 prompt build` |
| `GET/PUT /api/prompt-builder/config` | Web UI only (Settings > Providers > Prompt Builder backend / Builder model) |

Notes:
- `ima2 history favorite` and `ima2 annotate …` send `X-Ima2-Browser-Id: cli-<sha1prefix>` derived from the config dir, so CLI activity does not collide with browser sessions.
- `ima2 session graph save` performs a GET-then-PUT with `If-Match: "<version>"` to guard against `GRAPH_VERSION_CONFLICT`.
- `ima2 history import` and `ima2 canvas-versions save/update` send raw bytes with `Content-Type: image/<png|jpeg|webp>`; the SSE endpoints (`multimode`, `node generate`, `video`) use `Accept: text/event-stream`. The web UI instead uses `GET /api/events` plus `async: true` on POST routes.
- `ima2 cardnews …` checks `runtimeConfig.features.cardNews` before calling the gated endpoints; when disabled the CLI exits 2 with a clear message instead of producing a 404.

## CLI Discovery

The server writes an advertisement file at:

```text
~/.ima2/server.json
```

CLI commands such as `ima2 ping`, `ima2 gen`, and `ima2 ls` use this file unless `--server` or `IMA2_SERVER` is provided.

Current shape:

```json
{
  "port": 3334,
  "url": "http://localhost:3334",
  "pid": 12345,
  "startedAt": 1777180000000,
  "version": "1.0.0",
  "backend": {
    "configuredPort": 3333,
    "actualPort": 3334,
    "url": "http://localhost:3334"
  },
  "oauth": {
    "configuredPort": 10531,
    "actualPort": 10532,
    "url": "http://127.0.0.1:10532",
    "status": "ready"
  }
}
```

Top-level `port` and `url` are kept for older CLI clients. New code should prefer `backend.url`.

---

## Sprite Recipe Routes

### `GET /api/sprite-recipes`

List all sprite recipes. Returns `{ recipes: SpriteRecipeRecord[] }`.

### `POST /api/sprite-recipes`

Create a new sprite recipe. Body: `SpriteRecipeDefinition`. Returns `201 { recipe }`.

### `GET /api/sprite-recipes/:id`

Get a single recipe. Returns `{ recipe }` or `404 { error }`.

### `PATCH /api/sprite-recipes/:id`

Update recipe fields. Returns `{ recipe }`.

### `DELETE /api/sprite-recipes/:id`

Delete a recipe. Returns `{ ok: true }`.

### `POST /api/sprite-recipes/:id/anchor/approve`

Approve an idle candidate as the identity anchor. Body: `{ assetId }`. Returns `{ recipe }`.

### `POST /api/sprite-recipes/:id/anchor/generate`

Generate an idle anchor candidate. Async: returns `202 { requestId }`, progress via `/api/events`.

### `POST /api/sprite-recipes/:id/generate`

Generate sprite rows for approved recipes. Body: `{ states?, async, requestId }`. Async: `202 { requestId }`.

## MCP Provider Connections

Remote subscription MCP providers (Runway, Higgsfield) connect through a compiled
registry — arbitrary endpoints are rejected. All responses are secret-free: tokens
live only in versioned `${configDir}/mcp/<provider>.json` records (0600), bound to
the provider endpoint and live callback origin.

After the server has selected and published its actual port, it automatically restores
each enabled provider with a completed same-binding token bundle. This path does not
open a browser. Missing, corrupt, pending-only, disabled, or binding-mismatched records
do not send a Bearer request and are not silently deleted. A mismatch is reported as
`auth_required`; start Connect again to authorize the new endpoint/origin. OAuth state
and PKCE are memory-only, so a browser flow interrupted by restart must be restarted.

### `GET /api/mcp/providers`

List registry providers with per-provider connection status.

### `POST /api/mcp/temp-references`

Stage local reference sources (data URLs) as a temporary gallery batch so MCP
generation can upload them by filename. Returns `{ ok, batchId, files[] }`.

### `DELETE /api/mcp/temp-references/:batchId`

Delete a staged temp-reference batch after the MCP job finishes.

### `GET /api/models`

Canonical lane catalog for CLI/agent routing. Returns
`{ ok, lanes: { [lane]: { status, reason?, defaults: { image?, video? }, models: { image[], video[] } } } }`
for the ten core lanes (`oauth|api|grok|grok-api|agy|gemini-api|atlascloud|minimax|nai|comfy`) plus MCP lanes
(`runway|higgsfield`). Status is one of `ready|locked|disconnected|key-missing`
with precedence `locked > key-missing|disconnected > ready`. MCP static snapshot
models are always listed; dynamic (`models_explore`) models appear only while
connected. Consumed by `ima2 models`, `ima2 defaults set image|video`, and the
CLI model resolver.

### `GET /api/mcp/providers/:id/status`

Connection status: `disconnected | connecting | auth_required | connected | offline | error`.
The optional `detail` is a stable secret-free diagnostic code. `connected` means the
current generation/transport is usable; `offline` means a terminal transport failure
was observed and at most one reconnect is scheduled; `error` is an unrecovered failure.

### `POST /api/mcp/providers/:id/connect`

Start or resume a connection. Returns `202 { status: { state: "auth_required", authorizationUrl } }`
when the user must approve OAuth in a browser; `202` while connecting; `200` once
connected. Terminal responses preserve state: `409 disconnected`, `503 offline`, or
`502 error`. `ok` is true only for `connected`.

### `GET /api/mcp/oauth/callback`

OAuth redirect target (`?state=&code=`). Exempt from the LAN token guard; protected by
the single-use OAuth `state` + PKCE. Invalid state → `400` with no token exchange.
Completion HTML is returned only after the manager reaches `connected`; otherwise the
callback returns the state's mapped 202/409/503/502 response and a failure page.

### `POST /api/mcp/providers/:id/refresh`

Close and re-establish the session reusing stored tokens (refresh-token path). It uses
the same state-to-HTTP mapping as Connect and cannot overwrite a newer disconnect or
connection generation.

### `DELETE /api/mcp/providers/:id/connection`

Clear local tokens and close the session. The response note explicitly says this is
local-only; it does not revoke the provider-side grant. The tombstone prevents older
connect, callback, restore, or refresh work from recreating the credential.

Transport recovery never replays a host `callTool` request. In particular, mutating or
billed media operations are not automatically retried by the connection manager.

### `POST /api/mcp/generate`

Generate media through a connected MCP provider. Body:
`{ provider: "runway", kind: "image"|"video", prompt, model?, ratio?, startFrameUrl?, requestId? }`.
Async: returns `202 { requestId }`; progress (`submitted`, `provider-queued`,
`provider-running`, `downloading`) and terminal `done`/`error` arrive on `/api/events`.
The route is the single persistence owner: results are committed to the generated
library (file + strict sidecar + thumbnail) before `done` is emitted. Catalog-only
providers (e.g. Higgsfield on a free plan) return `409 MCP_EXECUTION_LOCKED`.
`startFrameFilename` accepts an existing generated-library image: it is uploaded to
the provider and used as the image-to-video start frame, recording
`parent: { filename, mediaType, role: "start-frame" }` lineage in the sidecar.

### `POST /api/mcp/media-action`

Run a media workflow action. Body: `{ action: "stitch"|"upscale-video"|"upscale-image"|"edit-video"|"extend"|"reframe", files: [generated filenames], prompt?, provider? }`.
The workflow router decides per-tool: `native` (provider tool present live with a
matching schema), `fallback` (`stitch` → local ffmpeg concat; `extend` → last-frame
I2V), or `unavailable` (`409 MEDIA_ACTION_UNAVAILABLE`, e.g. reframe while the
provider is catalog-only). Async: `202 { requestId, mode, plan }`; results commit
through the same single persistence owner with `parent`/`inputs` lineage.

### `POST /api/mcp/tasks/:taskId/recover`

### `POST /api/mcp/multishot`

Generate a multishot (multi-scene) video through Runway MCP. Body:
`{ prompt?: string, shots?: string[] (3-5), duration?: 5|10|15, resolution?: "720p"|"1080p", aspectRatio?, sound?: boolean, firstSceneFilename?, requestId? }`.
`prompt` maps to auto mode (storyPrompt); `shots[]` maps to custom mode.
One of `prompt` or `shots` is required (`400 INVALID_MULTISHOT` otherwise).
Async: `202 { requestId, provider }`; lifecycle events on `/api/events`.
Results commit with `workflow: "video.multishot"` and `mcpParameters`.

Re-download a remote-succeeded MCP task into the generated library. Body:
`{ provider?: "runway", kind?: "video"|"image" }`. Use after a generation's
download/commit step failed transiently — provider assets stay fetchable for
~24-48h. Re-polls `get_task`, requires `SUCCEEDED` with an output URL
(`error` SSE event with `MCP_TASK_NOT_SUCCEEDED` otherwise), then runs the same
download (with retry + IPv4 fallback) → single-persistence commit path as a
normal generation. Async: `202 { requestId, taskId }`; `done` carries
`recovered: true`.
Catalog-only providers (e.g. Higgsfield on a free plan) return
`409 MCP_EXECUTION_LOCKED`, same as `/api/mcp/generate`.

## Media Merge

`POST /api/media/merge` joins several already-generated files into a single MP4.
No model is called: the route only runs ffmpeg, so it is fast and costs nothing.

```json
{
  "items": [{ "filename": "1790001755820_8a5e47d5.mp4" }, { "filename": "n_5a3efe98d3.png" }],
  "imageSec": 2,
  "fps": 24
}
```

- `items` — two or more entries, in the exact order they should appear. Each
  `filename` must resolve inside the generated directory; paths are rejected.
  Videos keep their own length, images are held for `imageSec` seconds
  (default 2, max 30).
- `fps` — optional output frame rate (default 24, max 60).

Every input is scaled and padded to one frame size before concatenation, taken
from the first video in the list (falling back to 720×1280 when the list holds
only images). Mixed resolutions and aspect ratios are therefore safe.

The output carries **no audio track**: mixing clips that have sound with images
that do not needs a silent source and drift correction, which this route does
not attempt.

```json
{ "ok": true, "filename": "1790002811990_ghep.mp4", "url": "/generated/1790002811990_ghep.mp4", "items": 3 }
```

Errors: `MERGE_NEED_TWO` (fewer than two items), `MERGE_ITEM_INVALID` (an entry
without a filename), `MERGE_ITEM_KIND` (unsupported extension), `MERGE_FAILED`
(ffmpeg failed or is not installed).

## Workflows (START → END)

A graph that carries a **START** marker node (`vaiTro: "bat-dau"`) reaching an
**END** marker (`vaiTro: "ket-thuc"`) is a runnable workflow. The START node is
the entry point: its address is `/api/wf/:sessionId/:startNodeId`. The server
runs every node between the two markers itself — no browser tab has to be open —
and the END node decides what comes back: the media of the nodes wired into it.

These routes sit under `/api`, so they inherit the same access rules as every
other route: open on a local bind, `x-ima2-token` required in LAN mode (see
[Local and LAN access](#local-and-lan-access)).

### Listing and describing

`GET /api/wf` lists every START node found in the most recent sessions.

```json
{ "workflows": [
  { "sessionId": "s_01M…", "title": "Idol Kpop", "startNodeId": "nc_a1b2",
    "path": "/api/wf/s_01M…/nc_a1b2", "ready": true, "steps": 6 },
  { "sessionId": "s_01N…", "startNodeId": "nc_c3d4", "ready": false,
    "reason": "thieu-ket-thuc" }
] }
```

`GET /api/wf/:sessionId/:startNodeId` describes one workflow without running it —
the ordered steps with their current content, and the input slots it needs. The
prompts are here so a caller can build the override body without reading the
graph.

```json
{ "sessionId": "s_01M…", "startNodeId": "nc_a1b2", "ketThuc": "nc_z9",
  "soViec": 2, "inputs": ["MAU_SAC"],
  "buoc": [{ "nodeId": "nc_ve", "vaiTro": "canh", "viec": "anh",
             "prompt": "a {{MAU_SAC}} circle", "size": "1024x1024" }] }
```

### Running

`POST /api/wf/:sessionId/:startNodeId`

```json
{
  "inputs": { "TRANG_PHUC": "a pleated navy skirt and a white knit top" },
  "images": { "nc_bocdo": ["data:image/png;base64,iVBORw0KGgo…"] },
  "nodes": { "nc_canh": { "prompt": "she sits by the window", "size": "1024x1536" } }
}
```

- `inputs` — fills `{{NAME}}` slots in the prompts. Names are `A-Z`, `0-9` and
  `_` only. A slot left unfilled is **refused with 400 `WF_INPUT_MISSING`**
  rather than sent to the model: `{{…}}` reaching a prompt generates nonsense
  and still costs money. At most 64 inputs, 4000 characters each.
- `images` — reference images for specific nodes, keyed by node id, replacing
  whatever that node has attached **for this call only**. Each entry must be a
  **data URL** whose payload is real base64; file paths and remote URLs are
  rejected, since accepting them would let a caller read arbitrary files or turn
  the server into a downloader, and a malformed payload is rejected here rather
  than failing later with an opaque provider error. At most 8 images per node.
  The target must be a node in this chain that actually generates something — a
  merge node takes media from its incoming edges, not attachments, and is
  refused.

  Leaving `images` out does **not** mean no attachments: the run then uses the
  ones the user attached in the Node Studio, which are stored server-side in the
  `node_refs` table. They used to live only in that browser's local storage, so
  changing an attachment on the canvas had no effect on an API run at all —
  fixed. Attachments are managed through
  `GET|PUT|DELETE /api/sessions/:id/node-refs[/:nodeId]`, which writes each image
  as a file and keeps only its `/generated/...` URL in the table, so neither the
  table nor the graph carries base64.

### Outfit descriptions follow the flat lay

An extraction node (`vaiTro: "trang-phuc"`) produces a flat lay, and the nodes
that use it as a **reference** carry a `She wears: … . Use the reference image`
block naming the garments. The text is what decides what gets worn — a reference
image alone keeps detail but does not dictate the outfit — so a stale block is
enough to dress the model in the previous outfit no matter which flat lay is
attached. That is exactly what happened: the flat lay was a new cardigan set
while two downstream nodes still described a mountain-print shirt, and the run
produced the shirt.

So after an extraction node finishes, the run re-reads its fresh flat lay
(through `/api/prompt-builder/chat`) and rewrites that block in **every node
downstream of it that carries one**, not just the nodes holding a reference edge
to it. The block is copied down the chain: a scene node takes the dressed model
as its base image and has no edge back to the extraction node at all, so
rewriting only direct reference users left the scene wearing the previous shirt
on the new silhouette. The rewrite applies **for that run only** — the template keeps its own text and is
re-read from scratch next time. The flat lay is also attached to the
reference channel of the nodes that hold a reference edge to it — not to every
downstream node, since a scene node's base is already the dressed model. That
attachment happens whether or not the description succeeds: the
attachment costs no model call and is what holds motif counts and pattern
direction. A failed description logs `wf.outfit_describe_failed` and the run
continues with the existing text rather than discarding the steps already paid
for.

A video node inherits the **scene node's** prompt as its own description, so the
rewrite has to be visible through that inheritance too: the run reads every
node's effective prompt — the stored one with this run's overrides applied on
top — not the one stored in the graph. Reading the parent straight from the graph
is what made a run produce three correct images followed by a video in the
previous outfit.

That makes a `nodes` override on a video node **additive, not replacing**: the
prompt sent is the parent's effective text, a space, then the override. The
override stands in for the node's own line, which is the part a video node holds
anyway — replacing the whole thing would silently throw away the scene it is
animating. A video node with nothing of its own sends the parent's text alone,
and one wired to nothing sends only its own. `inputs` are substituted after the
two halves are joined, so a `{{SLOT}}` works in either.

### Image size follows the base

A node with no `size` of its own takes the size of the **base image it is
editing**, walking up the chain until one is found. Only when nothing in the
chain sets a size does the request go out without the field, leaving the server
default (`1024x1024`) in place.

Without that, a run mixed aspect ratios in one pass: nodes generated by hand in
the canvas carry the size the panel had selected (say `1152x2048`), while nodes
added later carry none — and a workflow running on the server has no panel to
read, so those fell back to the square default even though every one of them was
editing the same portrait base.

The full precedence is: the node's own `size`, then the base it is editing, then
a `size` set on the **START marker** — the ratio for the whole workflow — and
only then the server default. The canvas offers that picker on the START node
and resolves a single node's GEN the same way, so pressing GEN on one node and
running the whole workflow land on the same ratio.

A `nodes` override may set `size` too, and an override on a parent carries down
the chain for that call, same as its prompt.

### An extraction node needs a photo

A `trang-phuc` (extraction) node in the chain must have at least one image going
in — an attachment on the node, an `images` entry in the request, or an incoming
image edge. Without one the run is refused up front with `WF_REF_MISSING` and
the offending `nodeId`, before a single node is generated.

The node's prompt is *"read the reference photograph and lay every garment
out"*, so with no photo the model invents an outfit and every node behind it
dresses the model in that invention — a failure that only becomes visible in the
last image, after all of them have been paid for.

This is easiest to hit right after copying a template: a template deliberately
carries no attachments (that is what keeps data URLs out of the database), so a
fresh copy has an empty extraction node. The canvas now says so on the node
itself, and pressing GEN there does nothing but repeat the message.

### The outfit slot

The description goes into a `{{TRANG_PHUC}}` slot, and that is the path to write
prompts against:

```text
He wears: {{TRANG_PHUC}}. Use the reference image for the garments.
```

A slot is plain text substitution, so the prompt can say anything around it —
`She wears:`, `He wears:`, `Outfit:`, or a sentence in Vietnamese. A run fills
it for every node downstream of the extraction node, so those nodes do **not**
ask the caller for `TRANG_PHUC`: it is left out of the `inputs` list a describe
call returns, and a run without it is accepted. A `{{TRANG_PHUC}}` on a node
that is *not* downstream of an extraction node is still a caller input and still
refused with `WF_INPUT_MISSING` — nothing would fill it.

Passing `inputs.TRANG_PHUC` **overrides** the reading, on both paths: the caller
said what to wear, and overwriting that would ignore their instruction silently.

In the canvas there is no extraction step behind a single GEN, so the extraction
node stores the sentence it read on itself (`data.moTaTrangPhuc`) and any node
behind it fills `{{TRANG_PHUC}}` from there at generate time. It is kept *beside*
the prompt rather than written into it: a prompt carrying a literal outfit is how
a stale outfit came back after the garment had already been changed. A node whose
only unfilled slot is `TRANG_PHUC` and which has no extraction node behind it
says so instead of refusing with a generic "slot not filled".

The older shape — rewriting the block between `She wears: ` and `. Use the
reference image` — still works for prompts written before the slot existed, and
now keeps whichever subject the prompt used instead of forcing `She`. Prefer the
slot: a pattern that hardcodes English and one gender misses a male subject, and
a miss here is silent — the model simply wears the old outfit.

None of this asks the user to wire every node to the extraction node. A scene or
video node takes the dressed model as its base and has no business holding the
flat lay as an image; forcing an edge there would only dilute its input, and it
would not fix the video at all, since a video takes its parent's *text*.

### What a video node animates

A video node's *image* input is whatever its parent produced **in this run**, not
the copy sitting in the graph or the template — every step re-reads the graph, so
the step that just finished is what the next one sees.

| Parent | Sent as | Provider mode |
|---|---|---|
| an image node | `sourceFilename` — the parent's generated file | `image-to-video` (first frame) |
| a video node | `continueFromVideo` — the parent clip; the server extracts its last frame | `image-to-video`, continuing the lineage |
| nothing | the node's own attachments, if any | `reference-to-video`, else `text-to-video` |

The server does **one of the two**, never both: a first frame or a reference
list. So when a base exists it wins, and an attachment on the video node is left
for a run that has no base — sending both would drop the first frame, and the
video would come back with a different person in different light.

A video node carries its own settings in `data.caiDatVideo`, which the run uses
in place of the defaults:

```json
{ "aspectRatio": "9:16", "resolution": "720p", "duration": 8, "anhNen": "khung-dau" }
```

Every field is optional; an absent one keeps the server default (`auto`, `480p`,
`5s`). `anhNen` chooses what the base image is for — `khung-dau` (the default)
locks it as the first frame, `tham-chieu` sends it as a reference instead, for a
shot that should not start on that exact frame. An API run reads these from the
graph: nobody is sitting at the panel to pick them, and the defaults are almost
never the aspect ratio the workflow wants.
- `nodes` — replaces a node's content for **this call only**, keyed by node id.
  Only `prompt`, `size` and `model` can be set: allowing `vaiTro` or edges would
  let one API call redraw a workflow the user shaped by hand on the canvas. The
  graph is never modified, so calling a hundred times with a hundred different
  prompts still leaves one template behind — the same rule as `inputs` and
  `images`. An override is checked against the
  effective prompt, so one that removes a `{{SLOT}}` needs no input for it, and
  one that introduces a new slot is refused like any other missing input.

Three ways to call it:

| Call | What comes back |
|---|---|
| `POST <path>` | waits, then the finished run (the default) |
| `POST <path>?stream=1` | an SSE stream, one frame per step as it finishes |
| `POST <path>?async=1` | `202` with `runId`, `statusUrl` and `streamUrl` |

### Streaming

`?stream=1` answers with `text/event-stream` and the same event names the UI
listens to, so there is one vocabulary for both:

```
event: wf_start
data: {"runId":"wfr_01M…","tong":2,"buoc":[{"nodeId":"nc_ve","viec":"anh"}]}

event: wf_step
data: {"runId":"wfr_01M…","nodeId":"nc_ve","trangThai":"xong","url":"/generated/n_6c34eeab.png","daXong":1,"tong":2}

event: wf_end
data: {"runId":"wfr_01M…","ok":true,"run":{…},"result":{…}}
```

Each step reports twice — once on `dang-chay`, once on `xong` with its media.
`wf_end` carries the whole run and its result, so a streaming caller never needs
a second request. The connection closes on `wf_end`; a `: ping` comment every
15 s keeps proxies from cutting a long gap between steps, and a run that outlives
the 10-minute ceiling gets a `wf_timeout` frame naming the `statusUrl` to poll
instead of hanging forever.

`GET /api/wf/runs/:runId/stream` attaches to a run already in progress — pair it
with `?async=1`. A run that has already finished gets its `wf_end` immediately
and the connection closes, rather than waiting for events that will never come.

Disconnecting does **not** cancel the run, exactly as with `?async=1`: aborting a
generation halfway costs the same and yields nothing. Use
`POST /api/wf/runs/:runId/cancel` to actually stop it.

```json
{ "ok": true,
  "run": { "id": "wfr_01M…", "trangThai": "xong", "buoc": [ … ] },
  "result": {
    "media": [{ "nodeId": "nc_canh", "url": "/generated/n_6c34eeab.png", "loai": "anh" }],
    "nodes": { "nc_canh": { "url": "/generated/n_6c34eeab.png", "loai": "anh" } }
  } }
```

`result.media` is what the END node collects; `result.nodes` carries every node
that ran, for workflows where intermediate output matters too.

### URLs follow the caller

Every URL a workflow route returns — `buoc[].url`, `result.media[].url`,
`result.nodes[*].url`, `statusUrl`, `streamUrl`, and the `url` beside a
workflow's `path` — is **absolute, built from the origin of the request being
answered**. Call from the LAN and the links point at the LAN address; call from
the machine itself and they point at localhost. A fixed origin would hand a
caller addresses it cannot reach.

The `Host` header is safe to echo because the access layer has already rejected
any host outside the serving origins (`LOCAL_HOST_REJECTED`) before a route runs.

Absolute URLs exist **only in responses**. What is stored keeps the
`/generated/...` path: a host belongs to a call, not to a file, and baking one in
would make the whole history point at the wrong place the day the port or address
changes. `statusUrl` and `streamUrl` are already complete — prefixing them with a
base again yields nonsense. `path` is kept alongside `url` for callers that
already build their own.

Results are also written back into the session graph, so opening the Node Studio
shows them on the nodes. Each write re-reads the newest graph and touches only
the node that just ran, so a browser tab editing another node is not clobbered.

A failing node **stops the run**: every node behind it consumes that node's
image, so continuing would only spend money producing wrong results. The
response carries the failing step and `error.nodeId`.

### Run status and history

Runs are stored in the `wf_runs` table, so they survive a restart and answer
"what did that API call produce yesterday". Each row keeps the inputs it ran
with, every step with its media, and the final result.

- `GET /api/wf/runs` — newest first. Filters: `?sessionId=`, `?startNodeId=`,
  `?status=` (`dang-chay` / `xong` / `hong` / `da-huy`), `?limit=` (max 200) and
  `?before=` for paging. The response carries `total` and a `nextBefore` cursor.
- `GET /api/wf/runs/:runId` — one run. `202` while it is still going, `200` when
  finished. Add `?wait=1` to hold the connection until it ends.
- `POST /api/wf/runs/:runId/cancel` — stop after the node that is currently
  running. A generation already in flight is not interrupted: aborting halfway
  still costs the same and yields nothing.
- `DELETE /api/wf/runs/:runId` — drop one run from the history. A run that is
  still going is refused with `409 WF_RUN_BUSY_OR_MISSING`: removing its record
  while it keeps spending would lose the only way to follow it.

The newest 500 runs are kept; older finished rows are pruned as new ones arrive.
Rows are not tied to the session by a foreign key, so deleting a session leaves
its run history intact — the files in `/generated` are still there.

A run that was going when the server stopped is closed on the next start with
`WF_SERVER_RESTARTED` and its unfinished steps marked `bo-qua`. The generation
processes died with the server, so leaving the row as "running" would show a run
that never ends. Recovery only touches runs that are not live in the current
process, so it cannot disturb one that is genuinely running.

### Watching a run from the UI

Every run publishes to the shared `/api/events` stream under the fixed job id
`wf`, with the run id inside the payload — the browser cannot know the id of a
run some other system started, so a fixed channel is what makes it observable.

| Event | Sent when |
|---|---|
| `wf_start` | the chain is resolved and the steps are known |
| `wf_step` | a step starts, finishes (carrying its `url`) or fails |
| `wf_end` | the run reaches `xong` / `hong` / `da-huy` |

The Node Studio listens on that channel: the START marker shows `API run x/y`
with a Stop button, the node being generated gets the running outline and
overlay, and each finished image lands on its node as it is produced.

The START marker's `API` panel also carries everything needed to call it: the
endpoint, the input slots, that workflow's recent runs, and **every node in the
chain with its current prompt** — the content lives on those nodes, not on the
marker, so the panel prints them there rather than making the reader hunt for
ids. `Copy curl` yields a body pre-filled with all of them; each node also has
its own copy button for a body that overrides just that one.

The **Runner** button in the Node Studio toolbar opens a wider view: every
workflow on the server (with its endpoint, step count, or the reason it is not
runnable) beside the recent runs. Each run row names the session it belongs to;
expanding one shows the inputs it was called with, each step with its media, and
any error. A workflow's runs can be isolated with `Only this`, and a run still
going can be stopped from there.

A run's results are written into its session's graph, so `Watch on canvas` on a
run opens that session and the workflow is visible running on the nodes. Opening
a session also asks the server which runs are still going in it, because the
event stream only reports what happens from that moment on and events for a
session that is not open are dropped — waiting for the next event would leave the
node being generated unmarked. The START marker's own panel only knows its own history, and only
while that session is open — the Runner is where a workflow triggered by another
system while nobody was looking becomes visible.

### Status codes

| Code | Meaning |
|---|---|
| `WF_SESSION_NOT_FOUND` | 404 — no such session |
| `WF_RUN_NOT_FOUND` | 404 — no such run |
| `WF_CHAIN_KHONG_PHAI_MOC_DAU` | 400 — that node is not a START marker |
| `WF_CHAIN_THIEU_KET_THUC` | 400 — no END marker downstream |
| `WF_CHAIN_VONG_LAP` | 400 — the graph loops back on itself |
| `WF_INPUT_MISSING` / `WF_INPUT_INVALID` | 400 — inputs missing or malformed |
| `WF_IMAGE_INVALID` / `WF_IMAGE_NODE_UNKNOWN` | 400 — attached images malformed or aimed at a node that does not exist |
| `WF_NODE_OVERRIDE_INVALID` / `WF_NODE_OVERRIDE_UNKNOWN` | 400 — override malformed, or aimed at a node outside this workflow / one that generates nothing |
| `WF_CANCELED` | 409 — the run was canceled |
| `WF_RUN_BUSY_OR_MISSING` | 409 — cannot delete a run that is still going |
| `WF_SERVER_RESTARTED` | recorded on a run the server was killed in the middle of |
| `WF_REF_MISSING` | 400 — an extraction node in the chain has no image going in (carries `nodeId`) |
| `WF_NODE_FAILED`, `WF_PROMPT_EMPTY`, `WF_PARENT_EMPTY`, `WF_MERGE_NEED_TWO`, `WF_NODE_TIMEOUT` | 500 — the run started but a node could not complete |

## Contract Discovery

Machine-readable tool contracts for AI agents (`ima2 tools` CLI backs onto these).

### `GET /api/contracts`

Full catalog summary: `{ ok, data: { tools: [{ id, namespace, availability, executable, description }] }, catalogVersion, schemaVersion, cliVersion, requestId, generatedAt }`.
Availability is promoted from live connection state: `callable` requires a connected
session plus post-connect ingest evidence; bundled snapshots alone stay `documented`.

### `GET /api/contracts/:id`

Full contract for one tool, including the `execution` binding block: bound tools carry
`{ binding, endpoint, inputContract }` — the normalized schema `ima2 tools call`
accepts (the raw upstream `inputSchema` is reference material only).
