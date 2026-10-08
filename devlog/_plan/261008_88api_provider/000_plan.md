# 261008 88API provider lane — 000 plan (MOC)

Status: wp1 (docs-only roadmap). Branch feat/88api-provider from origin/dev dbc32888 (v3.26.2).
Source of truth for the upstream contract: 88API handoff (Aside, 2026-10-08) and the 88API mail of
2026-10-08 (summary at ~/.ima2/88api-mail-notes.md, outside the repo). Research: 001-005 in this unit.

## Objective

Add a hosted provider lane `88api` (display "88API", internal identifier prefix `api88`, error
prefix `API88_`) that serves 10 image models and 25 video models through fixed per-family
endpoints, with two credentials (image key, video key) that never substitute for each other.
88API asked for one GPT text-to-image, one GPT edit, one Gemini image and one video request
to pass before payment; those four live calls are the delivery proof (wp4).

## Live catalog (GET /v1/models, 2026-10-08, free call)

Image key: gemini-3-pro-image, gemini-3.1-flash-image, gemini-3.1-flash-lite-image,
gemini-nano-banana-2.1, gpt-image-2, gpt-image-2.5-flare, gpt-image-2.5-sunburst,
grok-imagine-edit, grok-imagine-image, grok-imagine-image-quality.
Video key: gemini-omni-flash, grok-imagine-video, grok-imagine-video-1.5, kling-3.0-turbo-{720p,1080p,2k,4k},
minimax-h3-768p, "SD2.0 480P", "SD2.0 720P", "SD2.0 1080P", "SD2.0 4k", "SD2.5 480P", "SD2.5 720P",
"SD2.5 1080P", "Seedance-2.0-720p官方版", "Seedance-2.0-fast-720p官方版", "Seedance-2.5-720p官方版",
seedance-2.0-mini-480p, seedance-2.0-mini-720p, veo-3.1, veo-3.1-fast, wan3.0-video-{480p,720p,1080p}.
Ids are sent byte-exact (spaces, uppercase, CJK). Never trim, lowercase, slug or alias them in a
request body. Filenames/keys derived from an id use `api88ModelSlug(id)`.

## Locked design decisions (interface contract for 010/020/030)

D1 Lane id and naming. Registry `id: "88api"`, `vendor: "88api"`, `errorPrefix: "API88_"`.
   TS identifiers use `api88` (`createApi88Adapter`, `generateViaApi88Image`). Adapter descriptor file
   is `lib/providers/adapters/88api.ts` (the adapter contract test derives the filename from laneId).
   Transports live under `lib/api88/`.

D2 Credentials. Two api-key credentials in the manifest:
   - `keyVocabulary: "api88-image"`, `envVars: ["IMA2_88API_IMAGE_KEY"]`, `configKey: "api88ImageKey"`
   - `keyVocabulary: "api88-video"`, `envVars: ["IMA2_88API_VIDEO_KEY"]`, `configKey: "api88VideoKey"`
   Both `validateUrl: "https://api.88api.ai/v1/models"` with `validateUrlIsFallback: true` (runtime
   resolves the configured base URL). No `keyPrefix` (sk- is shared with OpenAI; never infer provider
   from prefix). Key routes: `PUT/DELETE /api/keys/api88-image`, `/api/keys/api88-video`; status
   entries `status["api88-image"]`, `status["api88-video"]`. Runtime context fields
   `api88ImageKey/api88ImageKeySource/hasApi88ImageKey` and the video equivalents. Image work reads only
   the image key; video work reads only the video key; a missing key fails closed with
   `API88_IMAGE_KEY_MISSING` / `API88_VIDEO_KEY_MISSING`. Both names join `ALWAYS_REDACT` in
   lib/configKeys.ts.

D3 Base URL. `config.api88Provider.baseUrl = pickStr(env.IMA2_88API_BASE_URL, file.api88Provider?.baseUrl,
   "https://api.88api.ai")`, trailing slashes and a trailing `/v1` stripped by `api88Origin()`; every
   transport appends `/v1/...` exactly once. Settings UI edits it through
   `GET/PATCH /api/config/88api` → `{ baseUrl, source: "env"|"config"|"default" }`; PATCH writes
   `api88Provider.baseUrl` via the existing atomic config writer and hot-updates the live config. An env
   value is immutable from the UI (409 `API88_BASE_URL_ENV_LOCKED`). Only https URLs (or http://127.0.0.1 /
   localhost for tests) are accepted.

D4 Unverified models. `CoreProviderModel` gains optional `status?: "unverified"`. The three
   grok-imagine image models carry `status: "unverified"` and `supports` all false. They are registered,
   hidden from UI pickers and the /api/models executable list, and rejected before any HTTP with
   `API88_MODEL_UNVERIFIED`. `deriveUnsupportedImageModelsFrom` becomes "unsupported in some lane and
   supported in no lane", matching scripts/generate-provider-types.mjs, so the shared ids stay valid for
   the native Grok lanes.

D5 Image routing (fixed, no fallback, no /v1/responses anywhere in lib/api88):
   - GPT family (`gpt-image-*`): no references → `POST /v1/images/generations` JSON
     `{model, prompt, size, n: 1}`; any source/reference image → `POST /v1/images/edits` multipart
     (`model`, `prompt`, `n=1`, `size`, one `image[]` part per image, source first). `size` is the
     requested WxH when it is one of 1024x1024/1536x1024/1024x1536, else `1024x1024`. `quality` and
     `response_format` are omitted (channel-dependent). Response `data[0].b64_json` or `data[0].url`
     (URL downloaded without Authorization, query kept).
   - Gemini family (`gemini-*image*`, `gemini-nano-banana-2.1`): `POST /v1/chat/completions`
     `{model, messages:[{role:"user", content:[{type:"text",text}, ...{type:"image_url",image_url:{url:dataUri}}]}]}`
     (string content when there are no images). Defensive parser accepts, in order:
     `message.images[]` (`image_url.url` or `url`), array content `image_url` parts, and markdown
     `![...](data:image/...|https://...)` / bare data URI / bare https image URL inside string content.
     No image found → `API88_EMPTY_RESULT` (fail closed, raw text excerpt ≤200 chars in the message).
   - Grok image family: `API88_MODEL_UNVERIFIED`.
   - Masks: unsupported (`API88_MASK_UNSUPPORTED`). Transparent background: not advertised.
   - Every image surface (classic, edit, node, multimode, agent) dispatches through
     `generateViaApi88Image()`; multimode keeps MIME and providerUrl.

D6 Video routing. `POST /v1/videos` → store `id` → `GET /v1/videos/{encodeURIComponent(id)}`.
   First poll after 4 s, then every 12 s, budget 15 min (`api88Provider.videoTimeoutMs`, 900_000).
   Terminal on `status` only (`completed` | `failed`); `unknown` tolerated 3 consecutive times then
   `API88_VIDEO_STATUS_UNKNOWN`. Poll GET retries 429 (Retry-After) and 5xx with backoff; submit is
   never retried — a network error or timeout after the request was sent is
   `API88_VIDEO_SUBMIT_UNCERTAIN` with no resubmission. Result URL order `url` → `video_url` →
   `result_url` (also nested under `output`/`data` if present); download with no Authorization header,
   follow redirects, keep the query string byte-exact, MP4 `ftyp` check, 200 MiB cap.
   The task id is emitted as `providerTaskId` on a `submitted` event and merged into inflight meta
   before the first poll; `POST /api/video/88api/resume { taskId, model, prompt? }` resumes poll →
   download → persist without a second POST. Legacy `/v1/video/generations`, `task_id` and
   `callback_url` are never used.

D7 Video bodies per family (lib/api88/videoSpecs.ts is the single table; UI gets a generated copy):
   grok → `{model,prompt,duration,size:ratio,images?[first],metadata:{resolution}}`;
   veo → `{model,prompt,duration∈{4,6,8} (8 when images),size:WxH from ratio+resolution,images?:dataUri[],
   metadata:{video_mode?, generateAudio?}}`; omni → `{model,prompt,duration 3-10,size:ratio,images?}`;
   kling/wan/minimax/seedance/sd → `{model,prompt,duration,ratio,images?,generate_audio? (kling, SD2.5 only)}`.
   Fixed-resolution models never send `resolution`. Phase 1 references: Veo accepts local images as
   base64 data URIs; other families accept only public https URLs (e.g. a previous 88API providerUrl);
   a local image for them fails with `API88_VIDEO_REFERENCE_NEEDS_URL` (upload flow is phase 2).
   Resolution choices exposed: grok 480p/720p (1080p hidden, open question), veo 720p/1080p, others fixed.
   wan3.0-video-480p reference caps use the smaller 10/5/5.

D8 Catalog intersection. `lib/api88/catalog.ts` caches `GET /v1/models` per key kind (TTL 10 min,
   refreshed at boot when a key exists, after a key PUT, and lazily on /api/models). /api/models exposes
   registry ∩ live ids when the live list is known, the registry list otherwise; unverified models are
   never executable. Key PUT validation reuses the same call.

D9 Defaults. The lane carries its own defaults (image `gpt-image-2`, video `grok-imagine-video-1.5`) for
   UI lane switching only. CLI `NO_DEFAULT_MODEL` behaviour is unchanged; 88api never becomes the global
   default.

D10 Readiness. Lane status is ready when either key is present; per-model entries are locked with a
   reason when their kind's key is missing. UI availability uses the key for the selected media kind.

## Work-phase map (one PABCD cycle each)

| wp | doc | outcome |
|---|---|---|
| wp1 | 000-005 (this doc + research) and 010/020/030 | roadmap locked |
| wp2 | 010_phase1_registry_keys_image.md | registry, types, config, keys, catalog, base URL route, image transport + adapter, all image surfaces, UI image selection and Settings (2 keys + base URL), generated types, enumeration tests, new contract tests |
| wp3 | 020_phase2_video.md | video specs, transport, route dispatch, resume route, UI video selection/controls, tests |
| wp4 | 030_phase3_live_demo.md | 4 mandatory live calls (+ cheap optional smokes), masked logs, demo artifacts, secret scan, branch push |

## Out of scope

main/dev merge, npm publish, release, README sponsor row, /v1/media/uploads, webhooks/callbacks, automatic
endpoint switching, Grok image enablement, video edit/extend/analysis for 88api, Agent-mode video for 88api,
full test suite runs (focused tests, typecheck, typecheck:tests, lint, test:inventory, provider type check
and ui build only).

## Open questions for 88API (tracked, do not block)

1. Endpoint for grok-imagine-image / -quality / -edit. 2. Gemini aspect/resolution fields on chat/completions.
3. grok-imagine-video-1.5 1080p. 4. gpt-image-2.5 size/quality values. 5. Price unit (¥ vs USD credit).

## Verification commands

`npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `node scripts/generate-provider-types.mjs --check`,
`node scripts/classify-tests.mjs && npm run test:inventory`,
`node --experimental-test-module-mocks --import tsx --test <focused files>`, `cd ui && npm run build`.

