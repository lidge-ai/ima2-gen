# 020 wp2: SVG decision

Builds on 001 §3 and wp1 (L exists on the API lane).

## Decision

1. Lane/model gate unchanged: SVG stays API-key lane + `gpt-image-2.6-flare|sunburst` only (`lib/imageOutputFormats.ts` resolveSvgOutput). Evidence: OAuth backend returns PNG for `output_format: svg` even with 2.6-flare + svg.model (001 §1, live); the 2.5 pair is not documented for SVG; Gemini/Imagen, xAI, MiniMax, Antigravity document no SVG output (001 §3).
2. Author model default (`DEFAULT_SVG_MODEL`, config.ts:30):
   - If the optional API-key handoff arrives: one live `POST /v1/images/generations` (`gpt-image-2.6-flare`, n=1, quality low, 1024x1024, `output_format: "svg"`, `svg: {model: "gpt-6-luna"}`). 200 with `output_format: "svg"` + `svg_usage.model == gpt-6-luna` ⇒ set `DEFAULT_SVG_MODEL = "gpt-6-luna"` and update CLI help/docs; any 4xx naming svg.model ⇒ keep.
   - Without a key: keep `gpt-5.6-luna`, the only author model live-verified (PR #425, funded key, 200 + svg_usage), still listed on the API with no shutdown date. Record the rationale next to the constant and in docs; `IMA2_SVG_MODEL` / `--svg-model gpt-6-luna` remain the opt-in.
3. `svgReasoningEffort` without `svgModel`: since #425 every SVG request carries `svg.model` (the default), so the `SVG_REASONING_REQUIRES_MODEL` rejection (imageOutputFormats.ts:119-121) no longer reflects the API. Change: effort alone applies to the effective (default) author model. Failing-first test in `tests/svg-output-contract.test.ts`: `resolveImageOutput({format:"svg", provider:"api", imageToolModel:"gpt-image-2.6-flare", svgReasoningEffort:"low"})` returns `fields.svg = {model: <default>, reasoning: {effort: "low"}}` (fails on base with SVG_REASONING_REQUIRES_MODEL). Remove the error code from any error-class coverage list and docs that mention it (`rg SVG_REASONING_REQUIRES_MODEL`).
4. Header comment of `lib/imageOutputFormats.ts`: cite the 2026-11-21 recheck (OAuth PNG fallback, 2.6-only) and the reference wording "Supported efforts depend on the selected author model".

## Acceptance (wp2)

- New SVG test fails on base, passes after change; existing SVG tests green.
- Docs (docs/API*.md, docs/CLI*.md, docs/FAQ*.md SVG passages, skills/ima2/SKILL.md) state: API-key lane + Images 2.6 only; author default and how to override; effort works with the default author.
