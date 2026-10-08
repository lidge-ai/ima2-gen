# 031 Live demo result (2026-10-08)

Branch feat/88api-provider. All calls ran once against https://api.88api.ai with the 88API test keys
(image key for image requests, video key for video requests). Keys were read from the environment only;
no key appears in the repository history, working tree, demo artifacts or server data (exact-string scan: 0).

## Direct transport run (scripts/api88-live-smoke.mjs --run --seedance --veo --omni)

| # | Request | Endpoint | Model | HTTP | Time | Result |
|---|---|---|---|---|---|---|
| 0 | catalog (image key, video key) | GET /v1/models | 10 image / 25 video ids | 200 / 200 | 0.6 s / 0.2 s | every requested id present |
| 1 | GPT text-to-image, 1024x1024, n=1 | POST /v1/images/generations | gpt-image-2 | 200 | 21.9 s | 1024x1024 PNG |
| 2 | GPT edit of #1, multipart image[] | POST /v1/images/edits | gpt-image-2 | 200 | 22.6 s | edited PNG |
| 3 | Gemini image, string content | POST /v1/chat/completions | gemini-3.1-flash-lite-image | 200 | 23.6 s | PNG |
| 4 | text-to-video 480p 4 s 16:9 | POST /v1/videos, GET /v1/videos/{id} x9, result GET | grok-imagine-video-1.5 | 200 | about 2 min | 848x480, 4.04 s MP4 |
| 5 | optional, 4 s | same | seedance-2.0-mini-480p | 200 | about 3 min | 864x496, 4.10 s MP4 |
| 6 | optional, 4 s 720p | same | veo-3.1-fast | 200 | about 1 min | 1280x720, 4.01 s MP4 |
| 7 | optional, 3 s | same | gemini-omni-flash | 200 | about 1 min | 1280x720, 3.03 s MP4 |

Every video request was submitted exactly once; result files were downloaded without an Authorization
header. The seedance result URL points at a Volcengine object store host rather than assets.88api.ai; it
downloaded without credentials as well.

## App path run (isolated ima2 server, UI driven)

| Request | Route | Model | Result |
|---|---|---|---|
| image | POST /api/generate (provider 88api) | gemini-3.1-flash-lite-image | PNG in gallery, sidecar provider 88api, 15.4 s |
| video | POST /api/video/generate (provider 88api) | grok-imagine-video-1.5, 480p, 4 s, 16:9 | MP4 in gallery, sidecar providerTaskId + api88Origin, ledger submitting -> submitted -> completed, 45.4 s |

## Questions answered by the run

- Gemini image response shape (handoff 6.6): `choices[0].message.content` is a string holding
  `![image](data:image/png;base64,...)`. The parser accepts this form plus the two other candidates.

## Still open for 88API (handoff section 8)

1. Endpoint for grok-imagine-image, grok-imagine-image-quality, grok-imagine-edit (registered, hidden).
2. Aspect-ratio / 1K-2K-4K fields for Gemini images on chat/completions.
3. grok-imagine-video-1.5 at 1080p: metadata.resolution or a separate model id.
4. Supported size and quality values for gpt-image-2.5-flare / -sunburst (1024x1024 is used today).
5. Unit of the price table (yuan or USD credit).

## Follow-ups noticed during QA (not blocking)

- The composer video toggle tooltip and the Animate button still say "Grok"; on the 88API lane they
  start an 88API video.
- Edit video / Extend video buttons are shown on 88API videos; the server rejects them for 88API
  (extended operations are out of scope), so the UI should hide them.
- The web-search toggle is shown on the 88API lane, where it has no effect.
- Local reference images for non-Veo video models need the /v1/media/uploads flow (phase 2).
