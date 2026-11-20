# 010 wp1: lineup swap (both OpenAI lanes)

Builds on 001. Base: dev bc6fbcde (fast-forwarded from 80745c49 after MiniMax #431 merged). Lineup L = [`gpt-6-luna`, `gpt-6.1-terra`, `gpt-6.2-sol`, `gpt-6.2-astra`] in this order on both lanes; default `gpt-6-luna` on both.

## 1. Legacy map (single source, both lanes)

MODIFY `lib/oauthLegacyModels.ts` → RENAME to `lib/openaiLegacyModels.ts`; export `LEGACY_OPENAI_IMAGE_MODELS` and `migrateOpenAIImageModel` (old names removed; update every importer listed by `rg -n "migrateOAuthImageModel|LEGACY_OAUTH_IMAGE_MODELS|oauthLegacyModels"`).

```ts
export const LEGACY_OPENAI_IMAGE_MODELS = {
  "gpt-6-sol": "gpt-6.2-sol",
  "gpt-6.1-sol": "gpt-6.2-sol",
  "gpt-6-astra": "gpt-6.2-astra",
  "gpt-5.6-sol": "gpt-6.2-sol",
  "gpt-5.6-terra": "gpt-6.1-terra",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.5": "gpt-6-luna",
  "gpt-5.4": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-6-luna",
};
```

Applies on the `oauth` and `api` lanes (never on grok/agy/gemini/other lanes). Every site that today migrates only when `lane === "oauth"` migrates for `oauth` and `api`:
`bin/lib/modelResolver.ts` laneModel; `lib/promptBuilder/requestSchema.ts` (normalizePromptBuilderModel, promptBuilderLaneModel); `lib/responsesDoctor.ts:459`; `lib/agentSettings.ts` modelForLane (both lanes migrate; the old "OAuth id not served by API → API default" branch disappears because the lists are equal); `lib/providers/adapters/openaiOperations.ts` requestModel (API branch: `migrateOpenAIImageModel(requested || apiProvider.defaultImageModel || API_FALLBACK_IMAGE_MODEL)`); `lib/imageModels.ts` (lines 88-100 helpers); `bin/commands/defaults.ts` validate/laneValue (API key: `apiProvider.defaultImageModel` stores the migrated id); `config.ts` (`imageModels.default` and `apiProvider.defaultImageModel` both wrapped in the migration); `lib/cardNewsPlannerClient.ts`, `lib/agentQuestionResponder.ts` (rename only).

UI mirror: MODIFY `ui/src/lib/coreSelection.ts` — `LEGACY_OAUTH_MODELS` → `LEGACY_OPENAI_MODELS` with the same map, applied when provider is `oauth` or `api` (line ~81); `defaults.api` → `"gpt-6-luna"`.

## 1b. Persisted ids: readers and replay (audit round 1, findings 1 and 3)

Historical metadata stays as recorded (history sidecars, `lib/historyList.ts:66` `model`, session graphs): provenance must show the model that actually ran. Migration happens where a stored id becomes a new request or a current selection:

| Reader | Path | Change |
|---|---|---|
| UI current selection (localStorage `ima2.imageModel` + generation defaults provider) | active loader `ui/src/store/coreSelectionPersistence.ts:40` loadCoreSelectionSnapshot → `ui/src/lib/coreSelection.ts` reconcileCoreSelection (line ~81) | legacy map applies when the reconciled provider is `oauth` or `api`, before `staticImage`. `storePersistence.ts` loadImageModel has no provider argument and no live caller (audit round 2): left unchanged |
| UI per-provider memory (`ima2.coreSelectionMemory.v1`) | `coreSelectionPersistence.ts:19` loadCoreSelectionMemory and saveCoreSelectionMemory → `coreSelection.ts:140-155` filterCoreSelectionMemory | migrate `row.image` by provider (`oauth`/`api` only) before the `staticImage` filter, so a remembered legacy id survives load and provider switching |
| Server request normalization (every generate/edit/multimode/node request, including history "reuse" that resends the stored id) | `lib/imageModels.ts` normalizeImageModel (82-104), `lib/providerOptions.ts:150-165` | migrate for `oauth` and `api`; API fallback = migrated `apiProvider.defaultImageModel` |
| Saved config | `config.ts` imageModels.default, apiProvider.defaultImageModel | wrapped in the migration |
| CLI | `bin/lib/modelResolver.ts` laneModel, `bin/commands/defaults.ts` | migrate for `oauth` and `api` |
| Agent / prompt builder / card news / doctor | `lib/agentSettings.ts`, `lib/promptBuilder/requestSchema.ts`, `lib/cardNewsPlannerClient.ts`, `lib/agentQuestionResponder.ts`, `lib/responsesDoctor.ts` | migrate for `oauth` and `api` |

Non-OpenAI lanes (grok, agy, gemini-api, minimax, nai, atlascloud, comfy) never pass through the map.

## 2. Registry and generated catalog

MODIFY `lib/providers/registry.ts`:
- oauth models → `gpt-6-luna` (aliases ["luna"]), `gpt-6.1-terra` (["terra"]), `gpt-6.2-sol` (["sol"]), `gpt-6.2-astra` (["astra"]), all OAUTH_IMAGES.
- api models → the same four ids, RESPONSES, no aliases (current api entries have none).
REGENERATE `ui/src/generated/providers.ts` with `node scripts/generate-provider-types.mjs` (never hand-edit).

MODIFY `bin/lib/model-aliases.ts`: luna→gpt-6-luna, terra→gpt-6.1-terra, sol→gpt-6.2-sol, astra→gpt-6.2-astra. Check whether "spark" in CLI help Aliases lines is still a real alias; keep help text consistent with `IMAGE_MODEL_ALIASES` + registry aliases.

## 3. Defaults

- `config.ts`: `apiProvider.defaultImageModel` default "gpt-6-luna"; `styleSheet.model` default "gpt-6-luna" (API-key client, Chat Completions supported per 001 §2); `DEFAULT_SVG_MODEL` untouched here (wp2). `GROK_PLANNER_MODELS` untouched (xAI-executed list, out of scope).
- `lib/imageModels.ts`: `API_FALLBACK_IMAGE_MODEL = "gpt-6-luna"`; `MODELS_WITHOUT_NONE_EFFORT = new Set(["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6-astra"])` (gpt-6-astra kept for an explicit legacy id reaching the coercion before migration); update the doc comment to cite 001 §1.
- `lib/promptBuilder/constants.ts`: `OAUTH_GPT_MODELS = API_GPT_MODELS = L`; `DEFAULT_PROMPT_BUILDER_MODELS.api = "gpt-6-luna"`.
- `lib/oauthProxy/generators.ts:40`, `lib/oauthProxy/multimodeGenerators.ts:49,196`: fallback "gpt-5.6-luna" → `FALLBACK_IMAGE_MODEL`.
- `lib/codexBackend/client.ts`: `CODEX_CLIENT_VERSION_FLOOR = "0.166.0"` (comment: lowest version measured to list gpt-6.2-*, 2026-11-21); `isLiteModel` fallback regex → `/^gpt-(6(\.\d+)?|5\.6)(-|$)/`.
- Comments naming the old lineup: `lib/imageBackgroundParam.ts:10`, `lib/styleSheet.ts:3`, `lib/oauthImages.ts`, `lib/codexBackend/normalize.ts:24`, `lib/providers/registry.ts:15`, `bin/commands/defaults.ts:132`, `lib/agentSettings.ts:11`.

## 4. UI

- `ui/src/lib/imageModels.ts` IMAGE_MODEL_OPTIONS: replace the nine GPT rows with four: `gpt-6-luna` "6l" `settings.imageModel.gpt6Luna`; `gpt-6.1-terra` "6.1t" `gpt61Terra`; `gpt-6.2-sol` "6.2s" `gpt62Sol`; `gpt-6.2-astra` "6.2a" `gpt62Astra` (no providerHint: both lanes list them). `API_PICKER_ORDER = L`. Fix comment at line 108 and 192.
- `ui/src/lib/agentModelOptions.ts`: three GPT rows → four rows for L with labels "GPT-6 Luna", "GPT-6.1 Terra", "GPT-6.2 Sol", "GPT-6.2 Astra" and the same shortLabels.
- i18n (en, ko, zh-Hans, zh-Hant): under `settings.imageModel` keep `gpt6Luna`, add `gpt61Terra`, `gpt62Sol`, `gpt62Astra`; remove `gpt6Sol`, `gpt6Astra`, `gpt56*`, `gpt55`, `gpt54*` if no other reader (`rg` first); keep key order parity across locales (tests/i18n-dictionary-contract).
- `ui/src/lib/provenance.ts:50` comment example only; update if it names a removed id.
- e2e fixtures/specs (`ui/e2e/**`) that hardcode removed ids: update to L.

## 5. CLI help, hints, ComfyUI bridge

`bin/commands/gen.ts`, `edit.ts`, `multimode.ts` (Default/Aliases lines), `video.ts:155` example (→ grok-4.5 only or gpt-6-luna if the planner accepts it; keep "e.g." truthful), `bin/commands/prompt-sub/build.ts:25` example (→ gpt-6-luna), `bin/commands/doctor.ts:93`, `bin/lib/error-hints.ts:5-6` (list L), `integrations/comfyui/ima2_gen_bridge/nodes.py:20` MODEL_OPTIONS → ["", *L].

## 6. Docs

README.md + docs/README.{ko,ja,zh-CN,zh-TW}.md, docs/CLI*.md, docs/API*.md, docs/FAQ*.md, site/src/pages/{,ko/}docs/{concepts/providers,reference/api,reference/cli,reference/config}.astro, structure/02,03,04,06 (07 only if it lists ids), skills/ima2/SKILL.md, AGENTS.md (only if it names ids), docs/migration/runtime-test-inventory.md (only if a renamed file is listed). Replace lineup tables/examples with L; document legacy migration in one sentence where the old text documented "GPT OAuth keeps only GPT-6". CHANGELOG is release-owned: do not edit.

## 7. Tests (failing-first, revised after audit round 1)

Commit A adds NEW `tests/openai-gpt6x-lineup-contract.test.ts` that imports only names that exist on base and exercises behavior surfaces, so every changed-behavior case fails on its own assertion (not on an import):

Changed behavior (each its own `test()`, must FAIL on base):
1. `deriveSupportedImageModels("oauth")` and `("api")` deep-equal L.
2. `canonicalizeImageModel` (bin/lib/model-aliases.ts): terra→gpt-6.1-terra, sol→gpt-6.2-sol, astra→gpt-6.2-astra.
3. `normalizeImageModel(ctx, id, "oauth")` for gpt-6-sol→gpt-6.2-sol, gpt-6-astra→gpt-6.2-astra, gpt-5.6-terra→gpt-6.1-terra, gpt-6.1-sol→gpt-6.2-sol.
4. `normalizeImageModel(ctx, id, "api")` for gpt-5.6-luna→gpt-6-luna, gpt-5.6-terra→gpt-6.1-terra, gpt-5.6-sol→gpt-6.2-sol, gpt-6-astra→gpt-6.2-astra, gpt-5.4-mini→gpt-6-luna; and with no model and a saved `apiProvider.defaultImageModel: "gpt-5.6-luna"` → gpt-6-luna.
5. Effort and model at the boundaries.
   - Normalization: `resolveProviderOptions` (lib/providerOptions.ts:17) for provider `api`, model gpt-6-sol, effort none → `{model: "gpt-6.2-sol", reasoningEffort: "low"}`; provider `api`, no model, config `apiProvider.defaultImageModel: "gpt-5.6-luna"` → gpt-6-luna.
   - API upstream body (history replay case, through the route): the route harness `tests/_executionRouteHarness.ts` (`run("classic", {upstream}, fixture => fixture.post(body))`, captured `fixture.calls[].body`) with a replayed request body `{provider:"api", model:"gpt-5.6-terra", prompt:"…"}` → captured upstream JSON `model === "gpt-6.1-terra"`; `{provider:"api", model:"gpt-6-sol", reasoningEffort:"none"}` → upstream model gpt-6.2-sol, `reasoning.effort === "low"`. The same case asserts that an existing history sidecar written before the request with `model: "gpt-5.6-terra"` is unchanged afterwards (provenance preserved).
   - OAuth upstream body: the fake-upstream server + temporary session file harness of tests/codex-backend-transport.test.ts (lines ~39-83) — `codexFetch("/v1/responses")` with model gpt-6.2-sol and effort none → the fake server receives `reasoning.effort === "low"`; with the fake catalog returning no models, the lite header is still sent for gpt-6.2-sol.
6. `isLiteModel("gpt-6.1-terra")` / `("gpt-6.2-astra")` true with an empty/failed catalog; `CODEX_CLIENT_VERSION_FLOOR` ≥ 0.166.0.
7. CLI resolver: `api/gpt-5.6-luna` → gpt-6-luna, `oauth/sol` → gpt-6.2-sol.
8. UI, using the esbuild-bundled persistence + MemoryStorage harness of tests/core-selection-memory.test.ts:
   - `reconcileCoreSelection({provider:"api", imageModel:"gpt-5.6-terra"})` → gpt-6.1-terra; `{provider:"oauth", imageModel:"gpt-6-astra"}` → gpt-6.2-astra.
   - `loadCoreSelectionSnapshot()` with `ima2.generationDefaults` provider `api` and `ima2.imageModel = "gpt-5.6-luna"` → imageModel gpt-6-luna (provider api).
   - `loadCoreSelectionMemory()` with an envelope `{version:1, lanes:{oauth:{kind:"image", image:"gpt-6-sol"}, api:{kind:"image", image:"gpt-5.6-sol"}}}` → oauth image gpt-6.2-sol, api image gpt-6.2-sol; then `selectCoreProvider` (ui/src/lib/coreSelection.ts:98) from a grok selection to `api` with that loaded memory restores imageModel gpt-6.2-sol.
9. Prompt Builder: api model list equals L; `normalizePromptBuilderModel("api","gpt-5.5")` → gpt-6-luna.

Controls (base-supported ids only, pass on base and after; separate `describe("controls")`): `resolveProviderOptions` api + gpt-6-astra + effort none → low (existing coercion); oauth gpt-6-luna + effort none stays none; explicit effort high unchanged; per-provider memory for `grok` with image `grok-imagine-image-2.0` and for `minimax` with `image-01` passes through unchanged; an unknown id is still rejected with the existing error code.

Post-implementation cases (added in commit B, not part of the base-failure list): api and oauth payloads with gpt-6.1-terra + effort none stay none; gpt-6.2-astra + effort none → low on both lanes.

Record the base failure list (expected: 1-9 fail, controls pass) in 040 before commit B.

Commit B (implementation): §1-§5 plus updates to existing tests that assert the old lineup; never delete a behavioral check without replacing it. Commit C (docs): §6.

## Acceptance (wp1)

- Commit A fails on base for reasons 1-9 (captured), passes after B.
- Stale-id check at the end of wp1 and again in wp3: `rg -n -i "gpt-6-sol|gpt-6-astra|gpt-6\.1-sol|gpt-5\.[456]" --glob '!devlog/**' --glob '!CHANGELOG.md' --glob '!node_modules' --glob '!**/*.js'`. Allowed hits, by path: lib/openaiLegacyModels.ts and ui/src/lib/coreSelection.ts (legacy maps); lib/imageModels.ts (MODELS_WITHOUT_NONE_EFFORT); config.ts (GROK_PLANNER_MODELS, out of scope; DEFAULT_SVG_MODEL until wp2 decides); bin/commands/gen.ts and docs SVG author-model lines (wp2); doc sentences that name legacy ids as migrating (README*, docs/FAQ*, docs/CLI*, docs/API*, site, skills/ima2); tests that assert migration. Anything else is a miss.
- Gates in 000 Verifier all exit 0.

