# PR #434 review #4 (image lane) — retired ids lost their low default at the routes

Finding (fresh Terra review #4 image lane, head 5b79da8b, major): generate, edit,
multimode and node routes destructure `quality = "medium"` before the Grok resolver
runs, so a caller naming a retired id (`grok-imagine-image-quality` / `-pro`) or a
retired saved config default without a quality sent 2.0 + medium. The R5 note in
000_plan.md claimed the resolver inside the adapters keeps `low`; that was true only for
a direct adapter caller, never through a route. Native 2.0 without quality likewise sent
medium instead of the planned auto.

## Change

- `lib/grokImageQuality.ts` `grokRouteQuality(provider, model, requested, normalized)`:
  on a Grok lane, when the request carried no `quality` string, a retired id resolves to
  `low` and native 2.0 to `auto`; an explicit quality always wins (plan R1-F1/R2-F2).
- Applied after provider options resolve the model in lib/generatePipeline.ts,
  routes/edit.ts, lib/multimodePipeline.ts, lib/nodeGeneration.ts (re-exported through
  lib/imageModels.ts so no file over 500 lines grows).
- UI and agent: both always send a quality the user can see (the composer quality knob is
  shown for Grok; agent turns fall back to the stored agent setting), so explicit
  precedence applies there; no hidden rewrite of a visible choice.
- config.ts: planner list compacted (570 -> 568) so the 4.7 entry does not grow it.

## Evidence

- Failing-first aec78c4d `tests/grok-retired-image-quality-routes.test.ts`: on the parent,
  7 failed (retired id w/o quality on classic/node/multimode/edit, retired config default,
  native 2.0 auto on classic/edit), 4 explicit-quality controls passed. After the fix:
  11/11 pass.
