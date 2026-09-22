# WP6: normalized generated-media merge

Class C4 filesystem and subprocess boundary. Independent capability consumed by WP7.
Original source 08dfbd0f backend/client hunks, final source e3a731cb.

## Change map
NEW lib/mediaMerge.ts, routes/mediaMerge.ts, ui/src/lib/gopMedia.ts (rename to
mediaMerge.ts for existing naming conventions only with all consumers updated).
MODIFY routes/index.ts for registration and docs/API.md media section.
Do not import merge node roles/UI until workflow slice.
Reuse lib/assetLifecycle.ts resolveInGenerated/assertRegularGeneratedPath and
lib/videoConcat.ts process conventions; do not add dependencies or shell eval.

## Concrete hardening delta
```diff
- items.length >= 2, no maximum
+ 2 <= items.length <= 12; bounded total bytes/duration/dimensions/fps
- stat(path) with lexical containment only
+ validated filename + assertRegularGeneratedPath + canonical regular input
- Date.now() output with ffmpeg -y
+ random UUID output in task-owned temporary directory, publish once complete
- execFile(timeout only)
+ AbortSignal, pre-abort check, kill, listener cleanup, bounded concurrent jobs
- stderr included in HTTP message
+ typed stable safe errors (FFMPEG_UNAVAILABLE 503, invalid input 4xx)
```
Match image/video order; preserve aspect by scale/pad; output MP4 without audio
as explicitly documented original behavior. ffprobe failure is not success/default.
Failure, abort or timeout removes task-owned partial output; never user inputs.
Use existing configuration owner for configurable limits; name fixed format
limits. No persistent request fields except output asset metadata.

## Proof
Sol executor owns process helper/tests; main route/integration (or disjoint
executor after packet). Preflight Windows process corpus before spawn edits.
NEW tests/media-merge.test.ts with tiny deterministic image/video fixtures,
argv, min/max/bytes, symlink/traversal, missing tools, abort before/during job,
timeout cleanup, concurrent output uniqueness and safe errors.
Run actual ffmpeg merge where tool exists; no fake pass if missing.
Tests must show count rejection before spawn and owned artifact cleanup.
Full root gates, CodeQL and source review. Update structure/03/06/01.
If required tool unavailable, record gap and publish draft pending actual proof.
