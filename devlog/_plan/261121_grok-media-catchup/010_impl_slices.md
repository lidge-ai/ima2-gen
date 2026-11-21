# 010 Implementation slices (wp9)

Binding decisions live in 000_plan.md (G1–G10 and the R1–R4 revisions). This file only orders the work so each slice is one failing-first commit plus one fix commit, small enough for a single implementation turn.

| Slice | Decisions | Main files (confirm with rg before editing) | Failing-first tests |
|---|---|---|---|
| S1 image | G1, R1-F1, R2-F2, 1.5k | lib/grokImageQuality.ts (new resolver), lib/grokOperations.ts, lib/grokMultimodeOperations.ts, lib/grokImagePlanner.ts, lib/imageModels.ts, lib/grokSizeMapper.ts, UI picker labels | resolver table; outbound body for retired id (2.0 + low), explicit high (2.0 + medium), native 2.0 (auto), base model (no quality); 1.5k accepted |
| S2 video models | G2, G4 | lib/imageModels.ts video registry, lib/capabilities.ts, routes/video.ts validation, lib/grokVideoAdapter.ts (remove white-canvas shim ~470-480 and 400 resubmission), CLI/MCP/agent lists | lite registered; lite + reference rejected locally; 1.5 t2v body has no image; one upstream start on a 400 |
| S3 frames + mode | G3, R2-F1, R4-F1, G10 | lib/videoGenerationRequest.ts (pins, mode precedence), routes/video.ts, lib/grokVideoAdapter.ts payload (last_frame, keyframes[{image, timestamp_s}], generate_audio) | each pinned combination at 1080p ⇒ 400, zero starts; source + lastFrame 720p body; base/Lite reject pins; base 14 refs accepted, 15 rejected; voice-only and voice + source mode |
| S4 planner off | R2-F4, R3-F1 | routes/video.ts (~538), lib/grokVideoAdapter.ts (~153, ~168, ~456) | planner off ⇒ zero planner/search calls, one start, context-composed prompt; planner off + continuation ⇒ 400; planner off + background constraint ⇒ 400 |
| S5 voices + planner model | G5, G9 | voice roster (static 28 + cached GET /v1/tts/voices), lib/agentImageVideoGen.ts allowlist (~39), Grok planner model list | static roster equals the 28 live ids; malformed/empty/timeout roster ⇒ static fallback; grok-4.7 selectable, default unchanged |
| S6 docs | G7 | docs/API*, docs/CLI*, README locales, skills/ima2, bin/commands/video.ts help, structure/ | doc contract checks only (no behavior change) |
| S7 verification | R1-F5 | none | after S4 passes with mocks: one paid 1.5 call, 480p, 2 s, last_frame + one keyframe at 1.0 s from two tiny synthetic PNGs through ima2's route with planner off; record request id and terminal status in .codexclaw/evidence |

Order: S1 → S2 → S3 → S4 → S5 → S6 → S7. S3 depends on S2's registry. S7 runs only after S4's mocked one-start proof. Any UI-visible change (pickers, new video options) gets a screenshot on pr-assets; new collapsible option groups start folded, following the quota card rule.
