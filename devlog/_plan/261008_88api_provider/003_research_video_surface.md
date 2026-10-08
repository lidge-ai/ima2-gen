# video surface — read-only research (2026-10-08)

Source: sol research subagent, read-only inspection of origin/dev dbc32888. Line numbers refer to that tree.

88api video needs a separate submit/poll/download adapter and provider dispatch **before Grok normalization or credential resolution**. Adding it to the provider allowlist alone would send it through Grok OAuth, Grok model validation, and potentially `/v1/responses`.

All paths below refer to `/Users/jun/.codex/worktrees/8112/ima2-gen`. Findings are from source inspection; no files changed, builds, tests, or Git mutations ran.

**Current request and execution flow**

- [ui/src/store/storeVideoImpl.ts:42](ui/src/store/storeVideoImpl.ts:42), lines 42–48: `videoLaneFields()` preserves `comfy` and `grok-api`; every other provider becomes `"grok"`.
- Same file, lines 145–173: UI sends `prompt`, `requestId`, `provider`, `model`, `duration`, `resolution`, `aspectRatio`, reference inputs, continuity, presets/elements, and session/node IDs. A single attachment selected as I2V becomes `sourceImage`; other attachments become `referenceImages`. A parent still becomes `sourceFilename`; a parent video supplies its extracted last frame and `continueFromVideo`.
- [ui/src/lib/api-generation.ts:330](ui/src/lib/api-generation.ts:330), lines 330–395: subscribe to the multiplexed event channel **before** submission. [ui/src/lib/asyncJobSubmit.ts:90](ui/src/lib/asyncJobSubmit.ts:90) adds `async: true`.
- [routes/video.ts:174](routes/video.ts:174): default provider is Grok. Lines 192–259 select the lane/model and normalize parameters. Current defaults are duration `5`, resolution `"480p"`, aspect ratio `"auto"`; duration is restricted to integer `1–15`, resolution to `480p|720p|1080p`.
- Lines 87–104 and 278–417 resolve references and mode. `referenceImages`/`sourceImage` accept strings, including data URIs; generated filenames are read from `generatedDir` into raw base64. `providerUrl` overrides the source and forces I2V. Composer references select R2V; a source/node/continuity image selects I2V. Explicit mode can override derivation.
- Lines 420–440 admit `kind: "video"`, register cancellation, then return HTTP `202 { requestId }`. Execution continues after the response. Legacy callers without `async: true` receive SSE on the POST.
- Lines 447–518 execute Comfy directly. Otherwise lines 551–571 resolve Grok credentials and call `generateVideoViaGrok`.
- Lines 583–667 persist MP4 plus sidecar, start thumbnail creation, invalidate history, and emit `done`. `finally` releases the inflight job.

**Required video edit points**

| File / lines | Existing snippet | Exact 88api change |
|---|---|---|
| [routes/video.ts:15](routes/video.ts:15), 15–17 | `generateVideoViaGrok`, `resolveGrokCredential`, `generateVideoViaComfy` | Import the new API88 video adapter and its event/result types. Keep credential resolution inside each selected lane. |
| Same file, 192–193 | `provider !== "grok" && provider !== "grok-api"` | Admit literal vendor `"88api"` explicitly. An unknown provider must still fail. |
| Same file, 195–206 | `if (isComfy) { const unsupported = [...] }` | Add API88 capability checks before admission. Reject unsupported planner/voice/storyboard/native-extension options instead of silently ignoring them. Local last-frame continuation can be supported separately from native V2V. |
| Same file, 247–259 | `isComfy ? ... : normalizeGrokVideoModel(...)` | Add API88 model validation against its **video** catalog. Preserve the selected ID exactly: no trimming, lowercasing, Unicode normalization, whitespace replacement, alias rewriting, or Grok fallback. Use API88 per-model defaults/parameter constraints before applying Grok’s global normalizers. |
| Same file, 323–335 | `ELEMENT_CAPACITY_DEFAULTS.grok.video`; `provider: "grok"` | For API88, use its model’s supported reference capacity and prompt policy, or reject element references until mapped. Current code applies Grok element rules even to Comfy. |
| Same file, 365, 379–417 | `MAX_REF2V_REFERENCES`; `MAX_REFERENCE_AUDIOS`; `sourceB64 = incomingProviderUrl || ...` | Validate API88 reference count, audio support, and input roles per model. Preserve first-frame versus reference intent. Do not treat a second reference as an end frame implicitly. Validate missing I2V source before upstream submission. |
| Same file, 420–424 | `meta: { kind: "video", sessionId, clientNodeId, model, mode, duration, resolution, presetIds }` | Add `provider`, `aspectRatio`, and sufficient recovery metadata. Current admission metadata omits provider and upstream task ID. |
| Same file, 520–535 | `const onEvent = (ev: GrokVideoEvent)`; `xaiVideoRequestId: ev.xaiVideoRequestId` | Accept API88 submitted/progress events and expose a generic `providerTaskId`; retain the existing xAI field for Grok compatibility. Persist the API88 task ID immediately on submission, before polling. Normalize progress to the UI’s `0–1` scale. |
| Same file, 539–571 | `effectivePrompt = storyboardPrefix + basePrompt ...`; `const lane: GrokLane = ...`; `generateVideoViaGrok(...)` | Dispatch API88 **before** Grok credential resolution. Apply supported prompt additions deliberately; pass API88 video credentials/base URL, exact model, normalized inputs, request ID, abort signal, and event callback. Never call Grok planning/search for API88. |
| Same file, 592–650 | `provider`, `model: result.effectiveModel`, `video.xaiVideoRequestId` | Persist `"88api"`, exact requested/effective model, generic task ID, actual duration/resolution/aspect, mode, reference count, and frame provenance. Use `saveGeneratedVideoArtifact()` and invalidate history. Do not fabricate Grok usage/search/fallback fields. |
| Same file, 652–684 | `dualEmitVideo(..., "done", ...)`; `err.code || "GROK_VIDEO_FAILED"` | Emit API88 provenance/task ID in `done`; use API88 or generic video fallback error codes. Preserve cancellation handling and terminal envelopes. Prefer completing job bookkeeping before publishing success, as the extend operation already does. |

New file required: `lib/api88VideoAdapter.ts` — no existing snippet/line number.

Its minimal responsibilities:

- Resolve **only** `api88VideoKey` / `IMA2_88API_VIDEO_KEY`; never substitute the image key.
- Use configured `IMA2_88API_BASE_URL`, default `https://api.88api.ai`.
- Submit through `POST /v1/videos`, then poll `GET /v1/videos/{id}`. Encode the task ID as a URL path component; leave the **model value** byte-exact.
- Define API88-specific payload/status/result parsing. The inspected repository contains no API88 wire schema; Grok’s `image`, `reference_images`, `duration`, and status JSON must not be assumed compatible.
- Separate submit from poll/download so an existing task can resume without another billed POST.
- Carry cancellation through submit, polling waits, fetches, and download; bound time and downloaded bytes.
- Preserve the existing discipline of not automatically retrying an ambiguous billable submission without upstream idempotency.
- Return validated MP4 bytes and generic provenance. Reject incompatible containers rather than saving WebM/HTML under `.mp4`.
- Never invoke `/v1/responses`, the Grok canvas shim, or model fallback.

**Grok implementation to use as a lifecycle reference, not as API88 transport**

| File / lines | Existing snippet | Finding / API88 implication |
|---|---|---|
| [lib/grokVideoAdapter.ts:96](lib/grokVideoAdapter.ts:96), 96–114 | `GrokVideoGenerateResult` requires `xaiVideoRequestId`, Grok resolution/aspect types | Introduce an API88 result or a neutral shared result. Do not label an API88 ID as an xAI ID. Existing Grok types need no change if API88 remains separate. |
| Same file, 130–133, 372–414 | `sourceImageUrl(...)`; `{ model, prompt, duration, resolution }`; `aspect_ratio`; `image: { url }`; `reference_images` | Grok converts raw base64 to a data URI; existing data/HTTP URLs pass through. This documents current transport only. |
| Same file, 417–434 | `videoEndpoint(ctx, "/v1/videos/generations", ...)`; `data.request_id || data.id` | Grok submit path differs from API88’s `/v1/videos`. Do not reuse this function. |
| Same file, 447–508 | plan → canvas/fallback → submit → poll → download | API88 must bypass all Grok-specific stages. Grok search calls [lib/grokImagePlanner.ts:227](lib/grokImagePlanner.ts:227) `/v1/responses`. |
| [lib/grokVideoPoll.ts:41](lib/grokVideoPoll.ts:41), 41–70 | `GET /v1/videos/${requestId}` with `grokFetchWithRetry` | GET polling is retryable; each request uses the start timeout. API88 needs its own credentials/status parser. |
| Same file, 81–120 | `deadline = Date.now() + cfg.totalTimeoutMs`; `await sleep(cfg.pollIntervalMs, options.signal)` | Immediate first poll, then interval waits. Successful polls reset consecutive errors; cancellation/permanent errors stop immediately. Default five transient failures are tolerated; the sixth fails. Unchanged progress becomes stalled after 180 seconds. Deadline is checked before a poll, so one request can overshoot it. |
| [lib/grokVideoShared.ts:150](lib/grokVideoShared.ts:150), 150–159 | `data.video.url`; `pending|done|failed|expired`; `grok_cost_usd_ticks` | These are xAI-specific response/accounting assumptions; do not reuse for API88 without a confirmed schema. |
| [config.ts:431](config.ts:431), 431–436 | start `300_000`, interval `5_000`, errors `5`, poll budget `1_800_000`, download `300_000` | Actual current timeout location is 431–436. Add API88-owned configurable budgets; do not make API88 depend on `grokProvider`. |
| Same file, 363–371 | inflight TTL `90 * 60 * 1000`; terminal TTL `5 * 60 * 1000` | Ensure API88’s maximum legal lifecycle fits tracking TTL. Terminal metadata is a short-lived recovery breadcrumb. |
| [lib/grokVideoDownload.ts:142](lib/grokVideoDownload.ts:142), 142–165; 6–48, 80–120 | unauthenticated URL GET; 100 MiB cap; MP4 `ftyp` validation | Handles timeout/cancel during body reads and retryable fetches. Reusing unchanged would inherit Grok config/errors and its fixed cap. API88 should own transport/error/config semantics. |

**First/last frames and extended operations**

The ordinary `/api/video/generate` request currently has **no dedicated end-frame field**. `sourceImage` represents the initial frame; `referenceImages` represent subject/style guidance. A source video’s last frame becomes the **first frame of the next generated clip**.

| File / lines | Existing snippet | Exact change / boundary |
|---|---|---|
| [routes/videoExtended.ts:74](routes/videoExtended.ts:74), 74–76 | `provider === "grok-api" ? "grok-api" : "grok"` | Explicitly reject `"88api"` on unsupported extended operations. Currently any unrecognized provider silently becomes Grok OAuth. |
| Same file, 202–207, 442–471 | `getGrokEndpoint("/v1/responses", credential)` | Analysis extracts first/last frames and submits them to Grok Responses. API88 must never enter this path. Keep analysis explicitly Grok, or implement a separately authorized chat-compatible analysis lane. |
| Same file, 125–127, 220–245, 350–377 | only `"grok-imagine-video"`; `/v1/videos/edits`; `/v1/videos/extensions` | Native edit/extend are synchronous JSON operations, not the generation 202/SSE flow. API88 generation support does not imply these endpoints exist. Add provider guards; do not map them to guessed API88 endpoints. |
| Same file, 131–173 | `saveVideoResult()`; `provider: "grok"` | Grok-native persistence is hardcoded to Grok even for `grok-api`. If generalized, pass actual provider/task provenance and provider-owned downloader. Otherwise leave it Grok-only. |
| Same file, 27–32, 292–325, 342–346 | `generateVideo?: ... GrokVideoOptions`; `provider: "grok" \| "grok-api"`; `normalizeGrokVideoModel(...)` | For API88 last-frame continuation, widen the injected operation contract/provider type and dispatch model validation/adapter by lane. Keep source containment, lineage validation, cancellation checks, and early admission. |
| [lib/videoExtendI2vOperation.ts:24](lib/videoExtendI2vOperation.ts:24), 24–35, 56–74 | Grok-only task types; `resolveGrokCredential`; `generateVideo(... mode: "image-to-video", sourceMime: "image/png")` | Generalize only if API88 continuation is included. Use API88 credentials and model capabilities; persist generic task ID at submission. |
| Same file, 83–95 | `video.xaiVideoRequestId`; `finishJob(...)` **before** `publishJobEvent(..., "done", ...)` | Preserve MP4/sidecar rollback, lineage/continuity, and success ordering. Add API88 task provenance without inventing xAI fields. |

For true first-and-last-frame generation, add explicit frame roles to the shared request, route resolver, UI request type/store, and API88 serializer. The separate MCP lane already has end-frame provenance at [routes/mcpMedia.ts:625](routes/mcpMedia.ts:625); it does not establish support on `/api/video/generate`.

**Inflight, SSE, and resumption**

- [lib/inflight.ts:222](lib/inflight.ts:222), lines 222–232:
  ```ts
  UPDATE inflight SET prompt = ?, meta = ? WHERE request_id = ?
  ```
  Existing JSON metadata can store `{ provider: "88api", providerTaskId, model, ... }` without a DB migration. `updateJobAdmission()` **replaces** metadata, defaults missing prompt to `""`, and catches persistence errors. Calling it with only the task ID would discard session/node/model metadata. For dependable recovery, add a merge-preserving, checked task-metadata update or pass the complete admission record and make the write failure visible.

- Same file, lines 243–285: terminal metadata merges active metadata with `finishJob()` metadata; active row is deleted. Lines 352–393 expire stale rows into `JOB_TRACKING_TIMEOUT` terminals and abort registered workers. Persist the API88 ID **before polling**, so errors/timeouts retain it.

- Current Grok IDs are emitted at submission but written into final sidecar/finish metadata only after successful completion. Neither a restart nor retained inflight metadata automatically resumes polling. A resume path/startup worker is additional work: reacquire video credentials, poll the stored ID, download/persist once, restore session association, and avoid another submit. Store no API key or reference payload in recovery metadata.

- [lib/eventBus.ts:19](lib/eventBus.ts:19), lines 19, 90–116: 2,000-event in-memory replay ring with process cursor and per-job sequence. It is provider-neutral and needs no API88 enumeration change. It does not survive restart.

- [lib/ssePublish.ts:13](lib/ssePublish.ts:13), lines 13–30:
  ```ts
  if ((event === "done" || event === "error") &&
      (isJobCanceled(requestId) || isJobTrackingExpired(requestId))) return false;
  ```
  Reuse this for terminal events/envelopes. It suppresses canceled/expired outcomes; it does not suppress every possible second terminal event after success.

**Comfy and keying: no API88 edit required**

- [lib/comfyImageAdapter.ts:413](lib/comfyImageAdapter.ts:413), lines 413–418: `generateVideoViaComfy()` calls the shared workflow executor with `"video"`. Lines 469–590 implement `POST /prompt` → `GET /history/{id}` / queue → `/view` download. It reads only the first supplied reference; cancellation/timeout calls upstream cancellation. Video output selection and MP4 validation live at lines 302–370. API88 should not enter this protocol.
- [lib/providers/adapters/comfy.ts:53](lib/providers/adapters/comfy.ts:53), lines 53–64: `workflow.mediaKind !== "video"` deliberately filters video workflows from the **image** adapter. Do not broaden it.
- [routes/videoKeying.ts:50](routes/videoKeying.ts:50), lines 50–105: local `.mp4` → ffmpeg WebM; 202 plus `keying-*` events; sidecar and `assets` DB row. Provider-neutral. API88 MP4s work through this existing path. Keyed WebM is not included by the ordinary history scanner.

**Video persistence and history**

| File / lines | Existing snippet | 88api requirement |
|---|---|---|
| [lib/videoArtifactPersistence.ts:11](lib/videoArtifactPersistence.ts:11), 11–17 | `writeFile(filePath, buffer)`; `atomicWriteJson(\`${filePath}.json\`, metadata)`; unlink MP4 on sidecar failure | Reuse unchanged. MP4 write itself is not atomic; sidecar write is. Validate bytes before calling it. |
| [lib/historyList.ts:19](lib/historyList.ts:19), 19–77, 112–130 | scan `png|jpeg|webp|mp4`; `video: meta?.video`; `provider: meta?.provider || "oauth"` | History is a filesystem/sidecar projection, not a generated-video DB table. `"88api"` passes through without an allowlist. Put task ID inside `video`, or explicitly project a new top-level `providerTaskId`, since arbitrary top-level fields are dropped. |
| [lib/sessionStore.ts:226](lib/sessionStore.ts:226); [ui/src/store/storeGraphSave.ts:72](ui/src/store/storeGraphSave.ts:72) | `INSERT INTO nodes ... data`; `video: d.video ?? null` | UI saves completed video nodes through ordinary graph JSON. The generation route does not insert session nodes itself. No provider schema migration is needed. |
| [lib/agentStore.ts:220](lib/agentStore.ts:220), 220–242 | `INSERT OR REPLACE INTO agent_images (...)` | Agent videos occupy `agent_images` rows despite the table name. Provider/model/task provenance remains in sidecars; the row stores filename/URL/prompt. No new table is necessary. |

**Agent video assumptions**

[lib/agentImageVideoGen.ts:317](lib/agentImageVideoGen.ts:317), lines 317–369:

```ts
const videoModel = videoParams.resolution === "1080p"
  ? GROK_VIDEO_MODEL_15 : GROK_VIDEO_MODEL_BASE;
const result = await generateVideoViaGrok(prompt, ctx, ...);
```

The video path ignores `options.provider` for dispatch, selects a Grok model from resolution, and uses default Grok OAuth. Lines 407–452 require `GrokVideoGenerateResult` and save `provider: "grok"` / `xaiVideoRequestId`.

For agent API88 support: carry explicit video provider/model into normalization, validate per API88 model, dispatch its adapter, persist actual provider/task ID, and retain the existing source-image policy. Do not repurpose the current planner `options.model` blindly as a video ID. [lib/agentPlannerModel.ts:55](lib/agentPlannerModel.ts:55) also hardcodes Grok limits/canvas behavior and needs corresponding scope expansion.

**Download helper reuse**

[lib/mcp/downloadMediaResult.ts:53](lib/mcp/downloadMediaResult.ts:53), lines 53–125:

```ts
maxBytes ?? (kind === "video" ? 800 * 1024 * 1024 : ...);
sanitizedUrl: `${url.origin}${url.pathname}`;
```

This is provider-neutral, streams into a temporary file, validates public HTTPS targets on redirects, bounds bytes, and returns cleanup plus a query-stripped URL. However, it has **no caller AbortSignal or authenticated-download headers**, and its content-type check accepts arbitrary video containers without MP4 magic validation. Reuse requires addressing those gaps; otherwise implement an API88-owned downloader. No mandatory MCP adapter/route change is needed.

**Adjacent scope expansion needed for usable UI/catalog**

- [ui/src/store/storeVideoImpl.ts:42](ui/src/store/storeVideoImpl.ts:42): stop folding selected `"88api"` to Grok; preserve its video model.
- [ui/src/lib/api-generation.ts:275](ui/src/lib/api-generation.ts:275): widen provider union and submitted-event task ID; add explicit frame fields if supported. Immediate history construction at storeVideoImpl lines 217–233 currently omits provider/model/provider URL; include API88 provenance so it agrees with refreshed history.
- [ui/src/lib/videoHistoryItem.ts:16](ui/src/lib/videoHistoryItem.ts:16): extend provider union only if API88 last-frame extension is supported.
- [lib/videoGenerationRequest.ts:131](lib/videoGenerationRequest.ts:131): normalization is globally tied to Grok-era duration/resolution/aspect limits. Add provider/model-specific normalization for API88; its string model field currently passes through unchanged.
- [routes/models.ts:194](routes/models.ts:194), AtlasCloud projection and lines 309–319: API88 needs its own image **and video** catalog/defaults/readiness projection. Copying AtlasCloud unchanged produces `video: []`. Independent image/video credentials must not make video readiness depend on the image key.
- [lib/providers/adapters/types.ts:41](lib/providers/adapters/types.ts:41): `ProviderAdapterV1` has image preparation only; registering an AtlasCloud-style adapter does not supply video execution.
- [lib/capabilities.ts:128](lib/capabilities.ts:128): advertised video models/modes are Grok-specific. Add API88-specific capability projection rather than attaching Grok’s limits to its 25 models.
- Config/runtime/registry owners must provide the two credentials, base URL, `"video"` surface, exact video IDs, and model-specific constraints. CLI routing/help also needs its owning lane updated if CLI support is intended.

**Tests and enumerations affected**

These are inspection findings, not test results.

- [tests/provider-registry-contract.test.ts:17](tests/provider-registry-contract.test.ts:17): exact registry ID list.
- [tests/provider-registry-parity.test.ts:14](tests/provider-registry-parity.test.ts:14): `CORE_IDS`; lines 59–68 exact reference-limit maps; lines 102–104 exact adapter list. Add API88 where the new manifest changes those projections.
- [tests/provider-surface-support.test.ts:23](tests/provider-surface-support.test.ts:23): exhaustive `Record<CoreProviderId, MatrixRow>` needs API88’s actual video/reference facts.
- [tests/provider-adapter-v1-contract.test.ts:33](tests/provider-adapter-v1-contract.test.ts:33): inject both keys in fixtures; add missing-auth reason at lines 61–68. Lines 111–114 require adapter model IDs to equal manifest IDs, including video models. Lines 119–130 require source file `adapters/88api.ts` and forbid hardcoded registry model literals there.
- [tests/models-endpoint-contract.test.ts:179](tests/models-endpoint-contract.test.ts:179): exact returned lane list. Add separate image-key-only/video-key-only readiness cases and video catalog assertions.
- [tests/cli-video-command-contract.test.ts:118](tests/cli-video-command-contract.test.ts:118): exact provider-help union; update when CLI admits API88.
- Preserve existing Grok/Comfy contracts in `videoRoute.test.ts`, `grokVideoAdapter.test.ts`, `videoExtendedRoute.test.ts`, `videoExtendI2v.test.ts`, and `comfy-video-adapter.test.ts`. Their Grok-specific endpoint/ID assertions should remain Grok-specific.
- Preserve sidecar rollback, history roundtrip, canceled/expired terminal dominance, and `kind: "video"` recovery contracts in `videoArtifactPersistence.test.ts`, `history-video-row.test.ts`, `video-history-item.test.ts`, and `video-inflight-kind-contract.test.ts`.
- Add API88 contracts for exact space/uppercase/CJK model IDs, video-key isolation, only allowed submit/poll endpoints, zero Responses calls, model-specific references/frames, progress normalization, cancellation/download validation, and task-ID persistence before polling. Resume must prove it issues no second POST.

