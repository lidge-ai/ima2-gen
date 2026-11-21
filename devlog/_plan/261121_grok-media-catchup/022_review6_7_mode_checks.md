# PR #434 reviews #6/#7 — predictable mode errors before planning; function sizes

- Review #6 video F1 (major): explicit `reference-to-video` on 1.5 with only a source
  passed the route; the source became the pinned first frame, leaving nothing to
  reference, and lib/grokVideoPayload.ts rejected it after the paid planner. Fix ddb3ae8c
  (failing-first 5e96f352): the empty-reference check in routes/video.ts runs after
  pinnedFirst/referenceImages are computed.
- Review #7 F1 (major): explicit `image-to-video` with no source or providerUrl reached
  the planner before the payload builder's "requires a source image". Fix: the route
  refuses it with GROK_VIDEO_INVALID_MODE before the job starts (failing-first 7e702259).
- Review #6 image minor: changed functions already over 50 lines on dev grew by 1-2
  lines (generateViaGrok 56->58, generateMultimodeViaGrok 89->91, generateAgentImage
  118->119). New lines were folded so each is back to its dev length; no new function
  is 50+ lines (TypeScript AST scan over every changed code file).
