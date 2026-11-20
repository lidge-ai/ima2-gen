# PR #434 review #2 — provider URL must not override reference-to-video

Finding (fresh Terra review #2, head 1fda6e19, major): in `routes/video.ts` a
`providerUrl` forced `image-to-video` even when the request carried a voice or a
composer reference. Mode-dependent checks (the 720p reference-to-video cap and the
r2v duration ceiling) then ran against the wrong mode, so an invalid request
reached the paid planner before xAI rejected it.

## Change

- `routes/video.ts`: on `grok-imagine-video-1.5`, a `providerUrl` combined with
  a voice or a composer reference keeps `reference-to-video`; the URL is sent as
  the pinned first frame (`image`, <IMAGE_0>), the existing 1.5 rule (plan G3).
  Other models keep the previous `image-to-video` override (voices are already
  refused for them before planning; base refuses source + references).

## Acceptance

- Failing-first: `tests/videoRoutePins.test.ts` — voice + providerUrl and
  composer ref + providerUrl at 1080p return `INVALID_VIDEO_RESOLUTION` with zero
  upstream paths; at 720p exactly one start with `image.url === providerUrl` and
  the voice / reference attached. Baseline at 1fda6e19: both cases fail.
- Focused Grok video tests, typecheck, typecheck:tests, lint, test:inventory,
  structure check, builds, full suite green; fresh Terra review 0 blocker / 0 major.
