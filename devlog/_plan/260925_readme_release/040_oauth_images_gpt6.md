# 040 GPT OAuth lane on openai-oauth 2.0: GPT-6 planner + Images API

User decision 2026-09-25: move the GPT OAuth lane to openai-oauth 2.0, keep only `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, then ship v3.21.0. The user pointed at how Codex and OpenCodex do it.

## How Codex and OpenCodex generate images with GPT-6

- Codex (`~/Developer/codex/018_codex-feature-flags/030_features/image-generation.md`): the model sees a client-side function tool `image_gen.imagegen` (`prompt`, up to 5 `referenced_image_paths`). The client executes it against the backend images API with `model="gpt-image-2"` fixed — generate without references, edit with them — and returns the result to the model.
- OpenCodex (`src/images/loop.ts`, `synthetic-tool.ts`, `fulfill.ts`, `src/server/images.ts`): a bounded media loop (3 rounds, 10 image calls per turn) gives the model a synthetic `image_gen` function tool, fulfills calls through `/images/generations` or `/images/edits`, and injects the result as a tool result.

## Live probes (this machine, ChatGPT OAuth)

| Probe | Result |
|---|---|
| openai-oauth 1.0.2 Responses, gpt-6-sol / gpt-6-luna | 400 "not supported when using Codex with a ChatGPT account" |
| openai-oauth 2.0.0 `/v1/models` | gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-*, gpt-5.5, gpt-image-2 (2.0 resolves the latest Codex client version) |
| 2.0 Responses + hosted `image_generation` tool, GPT-6 | tool is stripped (models with `useResponsesLite` get tools moved into an `additional_tools` developer item; `tools` deleted); forced choice → 400, unforced → text only ("image-generation tool isn't available") |
| 2.0 Responses + function tool `image_gen`, all three GPT-6 | each emits one `function_call` with an expanded prompt in 2-5 s |
| 2.0 Responses + `web_search` + `image_gen` | accepted, no error (model skipped search for that prompt) |
| 2.0 `/v1/images/generations` | image for any `model` value, including a nonexistent one: the backend renders with gpt-image-2 regardless |
| 2.0 `/v1/images/edits` multipart, `background=transparent` | PNG with real alpha (sips hasAlpha yes) |

## Design

OAuth lane only. The API-key lane keeps Responses + hosted `image_generation`.

1. **Plan** (skipped in Direct mode): `POST {oauth}/v1/responses`, `model` = selected GPT-6 model, developer prompt (existing GENERATE/EDIT/MULTIMODE prompts adapted to "call image_gen"), user content = reference/edit images as `input_image` + text, tools = `[web_search]` when search is on + function `image_gen` `{prompt, size?}` (single) or `{prompts: string[]}` (multimode, exactly N), `reasoning.effort` from the request, `stream: true`. Parse `function_call` arguments, `web_search_call` count, usage, any text. No function call → one retry with a stricter instruction, then `EMPTY_RESPONSE`-class error with the existing diagnostics shape.
2. **Render**: no source/reference images → `POST /v1/images/generations` JSON `{model:"gpt-image-2", prompt, size, quality, background, n:1}`; with images → `POST /v1/images/edits` multipart (`image` fields, at most 5: edit source first, then references, then the mask guide), same scalar fields. Multimode renders N prompts with bounded concurrency (3) and calls `onFinalImage` per image in order.
3. **Parameter mapping**: quality `low|medium|high` passes through, `xhigh|max` → `high`, `auto` → omitted; `moderation`, `partial_images`, `output_format` are not accepted by the OAuth images API — moderation and partials are dropped with a log field; the returned PNG is converted with sharp when the request asked for jpeg/webp so saved files keep the requested format. Masks stay guidance-only (as today, per the registry comment): the mask goes to the planner and as the last edit image with a text note.
4. **Result shape**: same as `postResponses` consumers expect — `{ images:[{b64, revisedPrompt}], usage, webSearchCalls, text }` — so routes, SSE, history and sidecars do not change. `revisedPrompt` = the planner's prompt.
5. **openai-oauth 2.0.0**: replace `vendor/openai-oauth-1.0.2-ima2.2.tgz` with the published `openai-oauth@2.0.0` (Apache-2.0) if the session-reload contract (`tests/oauth-proxy-session-reload.test.ts`, real binary vs fake upstream) passes; otherwise vendor 2.0.0 with the same ima2 patch. Update launcher flags only if the CLI differs (`--port`, `--oauth-file` confirmed), install policy allowlists, package smoke expectations.
6. **Models**: OAuth lane = `gpt-6-sol` (alias `sol`), `gpt-6-luna` (alias `luna`, default), `gpt-6-astra` (alias `astra`). Legacy OAuth ids (`gpt-5.6-luna|sol|terra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`) are accepted and normalized to the matching GPT-6 tier (sol→gpt-6-sol, astra stays, everything else → gpt-6-luna) so saved defaults, sessions and scripts keep working inside the same lane and billing. `gpt-5.3-codex-spark` and the `terra`/`spark` aliases go away. Prompt Builder, Agent planner, style sheet and card-news planner GPT options and defaults follow the same trio. The API-key lane keeps its current list.
7. **Docs**: README (5 languages), docs/CLI.md, site provider pages, structure docs, skills — OAuth lane described as "GPT-6 plans, gpt-image-2 renders".

## Files (expected)

`lib/oauthImages.ts` (new: plan + render + parse), `lib/providers/adapters/openaiOperations.ts` (branch), `lib/providers/registry.ts`, `lib/imageModels.ts`, `config.ts`, `bin/lib/model-aliases.ts`, `bin/lib/error-hints.ts`, `lib/promptBuilder/constants.ts`, `lib/imageBackgroundParam.ts`, `ui/src/lib/imageModels.ts`, `ui/src/lib/agentModelOptions.ts`, `ui/src/generated/providers.ts` (generator), i18n labels, `package.json`/lock, install-policy scripts, tests pinned to old ids, docs listed above.

## Verification

- New focused tests: plan payload shape (function tool, no hosted image tool), render routing (generations vs edits, ≤5 images), parameter mapping, multimode N prompts, legacy id normalization, registry/UI parity.
- Existing suites: `npm run typecheck`, `npm run typecheck:tests`, `npm test`, provider registry check, `cd ui && npm run build`, session-reload test against 2.0.
- Live: the demo runtime generates with each of the three models (generate, edit with transparent background, multimode 2) through the real 2.0 proxy.
- Hosted: PR fast gate, dev CI, then the release cut's candidate CI.

## Risks

- Behavior change on the OAuth lane: no partial previews, no moderation control, masks guidance-only (unchanged), one extra planner round trip (2-5 s). Documented in README and release notes.
- `ai@6` and `@ai-sdk/*` arrive as transitive deps of openai-oauth 2.0; install policy and package size checks must pass.
