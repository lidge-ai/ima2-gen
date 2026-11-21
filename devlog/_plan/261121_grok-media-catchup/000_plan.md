# 000 Plan: Grok image / video / voice catch-up (xAI, 2026-11-21)

Loop-spec: same HOTL goal, P amendment 2026-11-21 (user). Separate logical change ⇒ own PR to dev (branch `codex/261121-grok-media` from dev after the earlier PRs merge; rebase-free: merge dev in if needed).

- Trigger: user's Grok findings (image 2.0 quality, retired -quality/-pro, video 1.5/1.5-lite, frame pins, voices, S2S/STT/TTS) + "find what else is missing".
- Evidence: 001 (Terra research …573d8e69 via Aside; main's live probes in `.codexclaw/evidence/grok-live-readonly-261121.md`).
- Goal: ima2's Grok image and video lanes and the video voice picker match current xAI behavior; retired ids migrate; docs/help/skills match.
- Non-goals: standalone speech-to-speech, STT and TTS product surfaces (ima2 has none today; adding them is a new feature, not a catch-up — recorded for a follow-up), image deferred/`n` batching, progrok and OpenCodex repos (other lanes), release.
- Live budget: already spent 3 paid calls (~$0.14: image 2.0 low, 1.5-lite t2v 1 s 480p, 1.5 t2v 1 s 480p). Implementation verification adds at most: one 1.5 request with `last_frame` + one keyframe at 480p 2 s, and nothing else paid. No coupon/credit redemption ever.
- Verifier: same gate chain as the other PRs; new failing-first tests below.

## Live facts (main, 2026-11-21)

- `/v1/image-generation-models`: grok-imagine-image (2026-03-02), grok-imagine-image-2.0 only — `-quality`/`-pro` gone from the catalog (docs: the slug still redirects to 2.0 at low).
- `/v1/video-generation-models`: grok-imagine-video, grok-imagine-video-1.5 (aliases -preview, -2026-05-30), grok-imagine-video-1.5-lite.
- `/v1/language-models` adds grok-4.7 (ima2 planner lists 4.3/4.6/4.5).
- `/v1/tts/voices`: 28 voices — altair, ara, atlas, aurora, carina, castor, celeste, cosmo, eve, helios, helix, iris, kepler, leo, liora, lumen, luna, lux, naksh, orion, perseus, rex, rigel, sal, sirius, ursa, zagan, zenith.
- image 2.0 `quality: "high"` → 400 "only supports … low, medium, auto"; `quality: "low"` 1k → 200, cost 4e8 ticks.
- 1.5-lite with `reference_images` → 400 "not supported for this model"; 1.5-lite t2v 1 s 480p → done, 2e8 ticks.
- full 1.5 plain text-to-video 1 s 480p (no canvas) → done, 8e8 ticks ⇒ the white-canvas shim (lib/grokVideoAdapter.ts:470-480) is obsolete.

## Decisions

| ID | Change |
|---|---|
| G1 | Image: retired `grok-imagine-image-quality` / `-pro` removed from registry, pickers and fallbacks (grokOperations.ts:47,94; grokMultimodeOperations.ts:53; grokImagePlanner.ts:305; imageModels.ts:46) and migrated to `grok-imagine-image-2.0` wherever a saved id is read (config, UI selection/memory, CLI resolver). Send `quality` to 2.0 on generate, edit, multimode, node and agent: UI low→low, medium→medium, high→medium (2.0's highest), auto/absent→auto. Base `grok-imagine-image` gets no quality field. |
| G2 | Video: register `grok-imagine-video-1.5-lite` (t2v, i2v; 1-15 s; resolutions per docs; no references/voices/frames) across registry, capabilities, route validation, CLI, MCP, agent and UI. Remove the 1.5 white-canvas shim. |
| G3 | Frames and references on 1.5: `last_frame` and up to 4 `keyframes` ({image, timestamp_s} strictly inside the duration, distinct 1/3 s slots), first-frame `image` allowed together with references; voice-only reference-to-video admitted end to end (route already allows, adapter rejects). Base model keeps 14 references (superseded by R2-F1; the docs say 7). |
| G4 | Remove the automatic 1.5 → base resubmission on any 400 (it can spend on a different model); surface the 400. |
| G5 | Voice roster: static list = the 28 live voices; capabilities read `GET /v1/tts/voices` when a credential exists (read-only, cached), static list as fallback, custom ids still allowed. |
| G7 | Docs/help/skills: models, 2.0 quality semantics, Lite limits, native 1.5 T2V, extension 2-10 s (bin/commands/video.ts help), frame pins. |
| G9 | Add grok-4.7 as a selectable Grok planner/prompt-builder model (default unchanged). |

## Work order (inside the PR)

1. Failing-first tests: outbound payload tests for G1 (every surface, quality mapping, migrated ids), G2 (lite registered, lite+refs rejected locally, 1.5 t2v payload has no `image`), G3 (last_frame/keyframes validation and payload; voice-only accepted), G4 (one start request on 400), G5 (28-voice static list; roster parsing), G9 (planner list).
2. Implementation in that order, files < 500 lines, functions < 50.
3. Docs.
4. One paid verification call for G3 (1.5, 2 s, 480p, last_frame + 1 keyframe from two tiny synthetic PNGs) through ima2's own route with planner/search disabled; record request id and status.



## Audit round 1 revisions (Terra …9bc5f401, FAIL → R1-F1..F7), superseding conflicting text above

- R1-F1 (G1 precedence): a saved retired id (`-quality`, `-pro`) migrates to `grok-imagine-image-2.0` and, when no explicit quality accompanies the request, sends `quality: "low"` (the documented redirect behavior). Explicit request quality wins: low→low, medium→medium, high→medium, auto→auto. The existing "high selects 2.0" control (lib/imageModels.ts:46 resolveGrokQualityModel) stays and now also sends `medium`. Tests: both credentials (grok OAuth, grok-api) × generate and edit × {migrated id without quality, explicit low/medium/high/auto}; base `grok-imagine-image` never gets a quality field.
- R1-F2 (base refs): keep the 14-reference cap for both models (later live evidence at lib/imageModels.ts:258, tests/video-ref2v-duration-contract.test.ts:73); docs note the doc/observed conflict. No local tightening.
- R1-F3 (pins end to end): request schema gains `lastFrame` (same image-input shape as `sourceImage`) and `keyframes: [{ image, timestamp }]` (≤4). Rules: pins only on `grok-imagine-video-1.5`; `sourceImage` + `referenceImages` allowed together on 1.5 (first frame + references, mode stays reference-to-video); timestamps strictly inside (0, duration) and in distinct 1/3 s slots; Lite and base reject pins/references locally. Propagation: lib/videoGenerationRequest.ts (types, normalize, mode precedence: references ⇒ reference-to-video, else source ⇒ image-to-video, else text), routes/video.ts, lib/grokVideoAdapter.ts payload (`last_frame`, `keyframes`, `image` with `reference_images`), lib/agentImageVideoGen.ts (accept an explicit model incl. Lite instead of deriving from resolution only), CLI `bin/commands/video.ts` (`--last-frame <path>`, `--keyframe <path>@<seconds>` repeatable, `--model lite`), MCP video tool (bin/lib/videoMcp.ts), capabilities (per-model pin/reference support), UI: model option for Lite and a last-frame image slot in the video composer; a keyframe editor UI is deferred (API/CLI/MCP only) and documented. Outbound-body tests at route, adapter and agent boundaries.
- R1-F4 (prompt-optional pins): keep the product rule that a prompt is required; documented as an intentional narrowing.
- R1-F5 (paid verification): the implementer first adds and mock-tests a no-planner path (the route's existing direct prompt mode if present; otherwise a `plannedPrompt` passthrough) proving exactly one upstream start and no resubmission; then one paid call: 1.5, 2 s, 480p, `last_frame` + one keyframe at 1.0 s, two tiny synthetic PNGs; record request id and terminal status. It verifies that single combined case only.
- R1-F6 (contract migration): deliberately update tests/grokVideoAdapter.test.ts:487 and tests/videoRoute.test.ts:346 (canvas) and tests/videoRoute.test.ts:280, tests/video-reference-audio-contract.test.ts:75 (fallback) to the new behavior after recording their intended failures; keep `requestedModel`/`effectiveModel` event fields (effective = requested, `modelFallback: null`) so history readers keep working; native-1080p T2V passes validateVideoResolutionForRequest for 1.5 (route + direct adapter tests); one-start-on-400 test. 1080p is not live-verified (NOT RUN).
- R1-F7 (voice roster): keep lib/capabilities.ts synchronous with the static 28-voice list; NEW `GET /api/capabilities/grok-voices` fetches `/v1/tts/voices` with a 5 s timeout, caches 1 h keyed by a hash of the credential, validates shape (array of ids/names), falls back to the static list on offline/timeout/malformed/empty, never returns custom-voice metadata beyond ids; VoicePicker uses it and still accepts custom ids. Tests for each failure mode.
- G9 also adds grok-4.7 to the agent allowlist (lib/agentImageVideoGen.ts:39). G7 keeps the 1.5 edit/extension restriction (routes/videoExtended.ts:127) until conflicting evidence is resolved; only the extension duration help (2-10 s) changes.


## Audit round 2 revisions (R2-F1..F4)

- R2-F1: base `grok-imagine-video` rejects pins only and keeps up to 14 references; Lite rejects pins and references; 1.5 allows both. Tests: base references 1/8/14 accepted, 15 rejected; base + lastFrame rejected; Lite + reference rejected.
- R2-F2: retired image ids are resolved together with quality at request resolution: `resolveGrokImageRequest(model, quality)` returns `{model: "grok-imagine-image-2.0", quality: explicit ?? "low"}` for a retired id and `{model, quality: explicit ?? "auto"}` for native 2.0. Saved-id readers (config, UI hydration/memory, CLI) keep the retired id as stored until this resolver runs, so the information is not lost; the UI picker shows a retired saved id as "Grok Imagine 2.0 (low)". Tests: saved config and UI hydration of `-quality` through generate and edit outbound bodies ⇒ 2.0 + low; with explicit high ⇒ 2.0 + medium; native 2.0 without quality ⇒ auto.
- R2-F3: mode precedence = image references or reference voices ⇒ reference-to-video (voice + source: source is the first-frame pin inside reference-to-video on 1.5; on base/Lite voice is rejected locally); else source ⇒ image-to-video; else text-to-video. Tests: voice-only and voice+source through normalize, route and outbound payload.
- R2-F4: no-planner path = the route's existing `plannedPrompt` passthrough contract made public as `planner: "off"`: the effective prompt sent is the user's prompt after the route has applied series/storyboard/preset context (routes/video.ts:538) — the same text the planner would have received — and no planner or search call is made. Tests: planner:"off" makes zero planner/search calls, sends the context-composed prompt, exactly one upstream start.


## Audit round 3 revision (R3-F1, NEAR-PASS)

- R3-F1: `planner: "off"` is rejected (400 GROK_VIDEO_PLANNER_OFF_UNSUPPORTED) when the request carries continuation lineage (continueFromVideo / continuityLineage) or a background constraint, because those reach the planner as separate inputs (lib/grokVideoAdapter.ts:153,168) and would be lost. Tests: planner off + continuation ⇒ 400 with zero upstream calls; planner off + plain request ⇒ zero planner/search calls and one start.

## Report 2/2 + live contract corrections (2026-11-21)

- Wire names (live 4xx probes): `last_frame: {url | file_id}`, `keyframes: [{ image: {url | file_id}, timestamp_s }]` (not `timestamp`), xAI enforces 0 < t < duration. Provenance (R4-F2): `last_frame` and `generate_audio` are guide-documented (the guide's Python SDK example sets `generate_audio=False`) and absent from the REST/OpenAPI request properties; OpenAPI mentions `last_frame` only inside the `keyframes` description (report §3.4). The wire shapes above come from live 4xx probes; live acceptance of `generate_audio: false` is not verified.
- Image 2.0 resolutions are `1k | 1.5k | 2k` (live 422 enum): add 1.5k to lib/grokSizeMapper.ts and pickers; quality stays low/medium/auto.
- `-pro` retired 2026-05-15 → `-quality` → (since 11-02) 2.0 low: same migration as G1.
- 1.5 reference-to-video is capped at 720p (report §3.2): validate locally (reject 1080p for reference mode on 1.5) with a test; native 1080p only for text/image-to-video.
- Lite 1080p is a 720p upscale billed at $0.14/s (7× 480p): show the price note in the UI cost hint/docs if ima2 has a Grok video cost estimate; no behavior change.
- Edit/extend stay on the base model (unchanged).
- G10 (new, small): optional `generateAudio: false` passthrough (`generate_audio`) for 1.5 and 1.5-lite only when the user turns sound off; default untouched; a guide-documented field missing from REST/OpenAPI, live acceptance of `false` not verified (NOT RUN).
- Out of scope, recorded: deferred image generation + webhooks, output.upload_urls / storage_options, X Subscription plan tiers display, grok.com usage UI.

## Audit round 4 revisions (R4-F1, R4-F2, NEAR-PASS)

- R4-F1 (supersedes R2-F3 precedence): reference-to-video when the request has image references, reference voices, `lastFrame` or `keyframes` (report §3.2: `image` together with `last_frame`/`keyframes`/`reference_images` is R2V with a pinned first frame; the source becomes `<IMAGE_0>`, references start at `<IMAGE_1>`); else source ⇒ image-to-video; else text-to-video. Pins are 1.5-only (base and Lite reject them locally, R2-F1). Because 1.5 reference-to-video is capped at 720p, every pinned combination at 1080p — source + lastFrame, source + keyframes, lastFrame only, keyframes only, pins + references — is rejected locally before any upstream call; 480p/720p are accepted. Tests at the normalizer, route and outbound body: each pinned combination at 1080p ⇒ 400 with zero upstream starts; source + lastFrame at 720p ⇒ one start whose body carries `image`, `last_frame` and `resolution: "720p"`; source only at 1080p ⇒ image-to-video accepted with native 1080p.
- R3-F1 test addition: `planner: "off"` + background constraint ⇒ 400 with zero upstream calls, as its own test next to the continuation test.
- R4-F2: provenance of `last_frame` / `generate_audio` corrected above.
- Prompt stays required on every request (R1-F4 product restriction), although the docs make it optional when frames are pinned.
## R5 note (implementation, S1)

Every image route normalizes quality before provider execution (`rawQuality = "medium"` in generate, edit, multimode and node; agent defaults to medium), so a request almost always carries an explicit quality. The resolver therefore maps the request's quality (low→low, medium→medium, high→medium, auto→auto) for a migrated retired id, and uses `low` only when a caller sends no quality at all. Server normalization accepts a retired id unchanged (it is no longer a registry entry), and the resolver inside the adapters (generate, edit, multimode), which every surface reaches, maps it to `grok-imagine-image-2.0` together with quality, so a request without quality keeps `low` (fresh review #1). The UI selection migrates saved ids to 2.0 because it always sends a quality.

- R5 (S5): the static preset roster is updated to the 28 live voices; live `GET /v1/tts/voices` discovery with credential-scoped caching (G5 second half, R1-F7) is deferred to a follow-up. The roster stays non-authoritative (`presetsAreAuthoritative: false`) and custom voice ids remain accepted, so a newly added xAI voice still works by typing its id.
