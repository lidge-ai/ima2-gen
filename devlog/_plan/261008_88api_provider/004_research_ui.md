# ui — read-only research (2026-10-08)

Source: sol research subagent, read-only inspection of origin/dev dbc32888. Line numbers refer to that tree.

88api needs more than an AtlasCloud picker entry: current video selection, persistence, display, and submission explicitly assume Grok. Two credential statuses must remain independent, and readiness must use the key for the selected media kind. Read-only inspection completed; no files changed, builds or tests run.

All paths below are under `/Users/jun/.codex/worktrees/8112/ima2-gen`. Line numbers refer to inspected source.

1. **Generated provider/model types**

   - [ui/src/generated/providers.ts](ui/src/generated/providers.ts:6), lines **6–18, 85–91, 114–146, 168–171, 226–232**  
     Existing: `"atlascloud"`, `"video": []`, `VIDEO_MODEL_IDS`, `PROVIDER_REFERENCE_LIMITS`, `PROVIDER_SURFACE_SUPPORT`.  
     Generate a quoted `"88api"` entry, its 10 registered image IDs, 25 video IDs, actual reference limits, and supported surfaces, including video. These declarations do **not** create visible picker options automatically.

   - [scripts/generate-provider-types.mjs](scripts/generate-provider-types.mjs:34), lines **34–56, 59–73**  
     Existing: `loadTsModule("lib/providers/registry.ts")`, `model.supports.generate`, `JSON.stringify(value, null, 2)`.  
     Generator command: **`node scripts/generate-provider-types.mjs`**; freshness command: **`node scripts/generate-provider-types.mjs --check`**. [package.json:27](package.json:27) includes the freshness check in `test:provider-registry`. Neither command was executed. Register the backend manifest first, then regenerate; JSON serialization preserves spaces, uppercase and CJK. The generator currently exports no visibility or experimental metadata.

2. **Two keys and editable base URL**

   Credential endpoint names are not supplied by the task. A concrete compatible proposal is key vocabularies **`"88api-image"`** and **`"88api-video"`**, mapped by the backend to `api88ImageKey` / `api88VideoKey`. These are proposed API names, not existing endpoints.

   - [ui/src/hooks/useKeyStatus.ts](ui/src/hooks/useKeyStatus.ts:5), lines **5–14, 25–28**  
     Existing: `Record<"openai" | … | "atlascloud" | …, KeyStatusEntry>`.  
     Add both credential vocabularies, each retaining its own `configured`, `source`, `valid`, `maskedKey`. Do not collapse them into a single `88api.valid` boolean.

   - [ui/src/components/ApiKeyInput.tsx](ui/src/components/ApiKeyInput.tsx:5), lines **5–12, 31–35, 62, 141–160**  
     Existing: `provider: "openai" | … | "atlascloud" …`; PUT/DELETE `` `/api/keys/${provider}` ``; body `{ apiKey: key.trim() }`.  
     Extend the credential union with both vocabularies. Existing save/remove behavior can serve two separate inputs. Preserve independent environment-source handling. The status text currently derives “valid” from `configured`; add/use a `valid` prop if this section must show actual validation.

   - [ui/src/components/AccountSettings.tsx](ui/src/components/AccountSettings.tsx:177), lines **177–238**, AtlasCloud exemplar **207–215**  
     Existing: `<ApiKeyInput provider="atlascloud" … onSaved={mutateKeys} />`.  
     Add two inputs with distinct labels, placeholders and status entries. Add a third, ordinary `type="url"` field for the effective 88api base URL, defaulting to `https://api.88api.ai`; include save/error state and source information. The URL must persist in server configuration, not browser generation preferences.

   - [ui/src/components/VideoControlsPanel.tsx](ui/src/components/VideoControlsPanel.tsx:97), lines **97–118**, provides the existing configuration pattern:  
     `fetchApi("/api/config/grok-planner")` and PATCH with JSON.  
     There is no existing hosted-provider base-URL editor in the requested settings surface. Backend prerequisite: a read/update contract for 88api configuration, for example GET/PATCH `/api/config/88api`, returning the effective base URL and its source. Honor `IMA2_88API_BASE_URL` precedence. After key/URL saves, refresh key status **and** the lane catalog; refreshing only `mutateKeys` leaves sidebar catalog status stale.

   - [ui/src/hooks/useProviderAvailability.ts](ui/src/hooks/useProviderAvailability.ts:53), lines **13–19, 53, 82–85**  
     Existing: `atlasCloudKeyOk = keyStatus?.atlascloud?.valid === true`, returned `Record<Provider, ProviderAvailability>`.  
     Add `"88api"`. Retain separate image/video readiness facts, and derive the current operation’s `ok`/reason from the appropriate key. Image generation must work with only the image key; video generation with only the video key. Provider discovery/selection must remain possible when either kind is usable; requiring both keys would unnecessarily block partially configured lanes.

3. **Image identity, defaults and hidden models**

   - [ui/src/types.ts](ui/src/types.ts:12), lines **12, 17–26**  
     Existing: `Provider = CoreProviderId`, `ImageModel = ImageModelId`, `VideoModel = VideoModelId`; family types use prefixes such as ``Extract<ImageModelId, `openai/${string}`>``.  
     Generated unions will widen automatically. Derive an `Api88ImageModel` from `typeof PROVIDER_MODELS["88api"]["image"][number]`, intersected with supported image IDs where needed. Prefix extraction cannot represent this mixed GPT/Gemini/Grok catalog reliably. Extend `VideoResolutionUI` only if verified 88api capabilities require values beyond `480p | 720p | 1080p`.

   - [ui/src/lib/imageModels.ts](ui/src/lib/imageModels.ts:24), lines **24–59, 80–102, 109–154, 157–168**  
     Existing: `{ value, shortLabel, fullLabelKey, providerHint? }`, `ATLASCLOUD_MODEL_VALUES`, `getImageModelOptionsForProvider`, `isImageModel` checking visible options.  
     Add visible 88api image rows with `providerHint: "88api"` and exact wire IDs; add the provider-specific set/options branch and label resolution. Keep IDs separate from display labels. Scope family filtering by provider hint: `startsWith("grok-")` and Gemini membership filters would otherwise pull 88api rows into existing Grok/Gemini groups. Likewise, resolve shared IDs by **provider + model**, not the first matching value.

     There is **no existing `hidden` or `experimental` flag** in these option types. The smallest UI-only approach is to register all 10 models and omit the three unverified Grok rows from visible options. For explicit metadata, add lane-specific `hidden`/`experimental` fields and filter every picker consistently.

   - [lib/providers/types.ts](lib/providers/types.ts:54), lines **54–64**, and generator **43–44**  
     Existing model flags: `supports: { generate, edit, mask, streaming }`.  
     Capability flags are not visibility flags. `UNSUPPORTED_IMAGE_MODEL_IDS` is globally deduplicated by model ID: an unsupported 88api Grok model sharing an ID with supported xAI models will not become globally “unsupported.” Hidden/experimental policy must therefore belong to **lane + model**.

   - [ui/src/lib/api-comfy.ts](ui/src/lib/api-comfy.ts:108), lines **108–115, 170–184**  
     Existing runtime model fields: `id`, `label`, `description?`, `executable?`, `lockReason?`. Parser explicitly copies those fields.  
     `executable: false` represents a disabled row, not a hidden row. If visibility/experimental metadata comes from `/api/models`, extend this shared model type **and parser**; unknown fields currently disappear. Static core rows also need to consume the metadata.

   - [ui/src/lib/coreSelection.ts](ui/src/lib/coreSelection.ts:30), lines **30–35, 48–61, 86–87, 149–150**  
     Existing: `defaults: Record<Provider, ImageModel>`, inference list `["grok", "agy", "atlascloud", …]`, video allowed only for Grok lanes.  
     Add `"88api"` and a verified visible image default. Include its image membership in inference while retaining explicit-provider precedence for shared IDs. Replace video’s unconditional `"grok"` inference and Grok-only persistence gates with lane membership checks. Preserve 88api image/video choices independently. If “hidden” means unavailable to normal users, exclude those rows from normal selection/restoration too.

   - [ui/src/store/storeHelpers.ts](ui/src/store/storeHelpers.ts:368), lines **368–375**  
     Existing custom-size exclusion: `… state.provider === "atlascloud" … return null`.  
     Add `"88api"` when its adapter consumes hosted size options rather than the local custom-pixel normalization contract.

4. **Provider and model components**

   - [ui/src/components/GenProviderModelSelect.tsx](ui/src/components/GenProviderModelSelect.tsx:39), lines **39–54, 242–248, 295–318**  
     Existing: `{ value: "atlascloud", label: "Atlas" }`, `KNOWN_PROVIDER_LABELS.has(laneId)` guard.  
     Add `{ value: "88api", label: "88api" }`. Without it, `/api/models` can show the new lane, but it remains disabled and selection is rejected.

     Lines **180–181, 370–371, 407–414**: existing image rows are static, and video support is `(provider === "grok" || provider === "grok-api") && laneVideoCount > 0`, followed by global `VIDEO_MODEL_OPTIONS`. Add provider-scoped video options containing the 25 exact IDs; render them under 88api’s video group. Preserve `` `video:${id}` `` encoding and strip only the prefix at **288–289**. Do not normalize, lowercase or split model IDs on spaces.

     Lines **426–434**: the missing-selection fallback re-adds any unlisted non-Comfy value as enabled. Ensure a hidden experimental 88api selection cannot leak back through this fallback.

   - [ui/src/components/ImageModelSelect.tsx](ui/src/components/ImageModelSelect.tsx:37), lines **37–40, 164–169, 209–301, 303–332, 343–379**  
     Existing settings encoding: `` `${option.providerHint}:${option.value}` ``; label map contains `atlascloud`; legacy sidebar groups only GPT/Grok/Gemini plus Grok video.  
     Add 88api’s lane label and image rows to settings, with hidden filtering. If the sidebar variant remains supported, add an 88api group and provider-qualified video rows; select the hinted provider before its model, as the Gemini handlers already do at **269–270**. Update active-state keys/focus indexing accordingly. Gate reasoning controls to actual GPT planner lanes; 88api GPT-image models do not imply Responses/reasoning support.

   - [ui/src/components/settings/ProviderStatusSelect.tsx](ui/src/components/settings/ProviderStatusSelect.tsx:23), lines **23–35, 76–79, 151–167**  
     Existing: exhaustive `CORE_ENTRY_BY_ID: Record<Provider, CoreEntry>`, mapped from `CORE_PROVIDER_IDS`.  
     Add `"88api": { value: "88api", provider: "88api", method: "API" }`. Missing this entry breaks typing and produces an undefined mapped row. Adapt the selection gate for partial image/video configuration as described above.

   - [ui/src/components/ProviderReadinessPopup.tsx](ui/src/components/ProviderReadinessPopup.tsx:14), lines **14–25, 41–49, 89–114**  
     Existing: `atlascloud: "Atlas Cloud"`, first-match `IMAGE_MODEL_OPTIONS.find`, model display always `imageModel`, non-Grok branch shows reasoning/web search.  
     Add 88api’s label; resolve the active image/video model within its lane; show readiness for the corresponding key. Restrict reasoning/web-search facts to supported lanes so 88api does not inherit GPT planner claims.

   - [ui/src/components/ResultMetadataModal.tsx](ui/src/components/ResultMetadataModal.tsx:20), lines **20–30**  
     Existing: `atlascloud: "Atlas Cloud API"`.  
     Add `"88api": "88api API"`. Keep model metadata byte-exact.

   - [ui/src/components/home/HomePromptComposer.tsx](ui/src/components/home/HomePromptComposer.tsx:12), lines **12–23, 59–69**  
     Existing exhaustive `PROVIDER_LABELS: Record<Provider, string>` and `disabled: !availability.ok`.  
     Add `"88api": "88api"`; use partial-configuration readiness appropriately. Missing the map entry fails typing.

5. **Non-Grok video execution and controls**

   - [ui/src/lib/imageModels.ts](ui/src/lib/imageModels.ts:187), lines **187–204, 214–218, 234–236, 279–284**  
     Existing video recognizer accepts four Grok IDs; aliases fold to Grok 1.5; duration is globally ≤15 seconds; 1080p requires Grok 1.5; display encodes video only for Grok lanes.  
     Add provider-scoped 88api video recognition/options and preserve all 25 wire IDs unchanged. Restrict alias folding to xAI lanes. Make duration/resolution checks use verified lane/model capabilities; do not give new models Grok’s reference-duration ceiling. Extend display resolution to 88api video membership.

   - [ui/src/store/storeCoreSelectionImpl.ts](ui/src/store/storeCoreSelectionImpl.ts:59), lines **59–66**  
     Existing: `provider: current.provider === "grok-api" ? "grok-api" : "grok"` and `normalizeVideoModelValue(model) || GROK_VIDEO_MODEL_15`.  
     Preserve `"88api"` for its video models and choose its own default when entering video mode. A 88api ID must never fall back to Grok 1.5.

   - [ui/src/lib/coreGenerationMode.ts](ui/src/lib/coreGenerationMode.ts:12), lines **12–15**  
     Existing video mode gate names only Comfy/Grok.  
     Recognize an active supported 88api video selection; otherwise composer mode can incorrectly remain image/multimode.

   - [ui/src/store/storeVideoImpl.ts](ui/src/store/storeVideoImpl.ts:42), lines **42–48, 145–173, 218–232, 320–330, 341–354**  
     Existing `videoLaneFields` returns `"grok" | "grok-api" | "comfy"` and folds other providers to Grok.  
     Add an explicit 88api branch carrying its selected model unchanged. Both generate and animate use this helper. Replace animate’s fixed `duration: 5`, `resolution: "480p"`, `aspectRatio: "auto"` where incompatible with the selected 88api model. Populate generated video history with provider/model from the completion contract; current video item construction omits those top-level fields.

   - [ui/src/lib/api-generation.ts](ui/src/lib/api-generation.ts:275), lines **275–297, 299–318, 383**  
     Existing: `provider?: "grok" | "grok-api" | "comfy"` and `{ provider: "grok", ...payload }`.  
     Extend the request union; ensure 88api submissions always supply the provider explicitly. Completion types need provider/model fields if required for history above. Keep existing local `/api/video/generate` SSE transport; upstream `/v1/videos` submission/polling belongs to the backend adapter.

   - [ui/src/components/VideoControlsPanel.tsx](ui/src/components/VideoControlsPanel.tsx:17), lines **17–28, 55–95, 99–118, 124–150, 171–218**  
     Existing: two Grok model buttons, `DURATIONS = [3,5,8,10,12,15]`, fixed ratios/resolutions, 1080p automatically selects `GROK_VIDEO_MODEL_15`.  
     Use a provider-scoped selector for the 25 88api models and verified per-model duration/ratio/resolution options. For 88api, resolution changes must never switch to Grok. Retain `DurationSlider`; clamp/reset only against the selected model’s supported values. Gate xAI voice controls and Grok planner configuration to the appropriate lane. The current catalog parser discards model capabilities, so capability-driven controls require extending that contract or a shared static projection.

   - [ui/src/components/GenerationControlsPanel.tsx](ui/src/components/GenerationControlsPanel.tsx:174), lines **174–190, 220–240**  
     Existing compatibility fallback is GPT; mode toggle is `isGrok`; video entry selects `"grok-imagine-video"`.  
     Add 88api compatibility/control handling and image/video switching using its remembered/default video model. Its selected video can reuse the `VideoControlsPanel` branch after that panel becomes lane-aware.

   - [ui/src/components/composer/PromptComposerToolbar.tsx](ui/src/components/composer/PromptComposerToolbar.tsx:59), lines **59–62**, and [ui/src/lib/continueFromItem.ts](ui/src/lib/continueFromItem.ts:45), lines **45–46**  
     Existing: entering video chooses `"grok-imagine-video-1.5"`; toolbar exit chooses `DEFAULT_IMAGE_MODEL`.  
     Use the current lane’s remembered/default video and image choices; these shortcuts would otherwise switch away from 88api.

   - [ui/src/store/storePersistence.ts](ui/src/store/storePersistence.ts:242), lines **242–254**  
     Existing reload uses `normalizeVideoModelValue(p.model)` and a three-resolution whitelist.  
     Ensure 88api IDs survive reload through the new recognizer and lane reconciliation; extend the resolution whitelist if needed. [coreSelectionPersistence.ts:45–56](ui/src/store/coreSelectionPersistence.ts:45) already persists provider and selected video separately.

   - [ui/src/lib/referenceLimits.ts](ui/src/lib/referenceLimits.ts:35), lines **35–39**  
     Existing: every selected video uses `GROK_VIDEO_REF_LIMIT`.  
     Resolve video reference support and limits from the selected provider/model; image limits already use provider lookup.

   - [ui/src/store/storeTypes.ts](ui/src/store/storeTypes.ts:517), lines **517–520**  
     Existing comment explicitly says video normalization recognizes only Grok. Update this invariant after broadening static video selection.

   Existing video **edit/extend** contracts remain xAI-specific: [videoEditRequest.ts:10–15](ui/src/lib/videoEditRequest.ts:10), [videoExtendStream.ts:9–15](ui/src/lib/videoExtendStream.ts:9), [videoHistoryItem.ts:16](ui/src/lib/videoHistoryItem.ts:16). Registering 88api generation does not establish edit/extend support.

6. **Translations and misleading inherited copy**

   AtlasCloud anchors are identical across all four dictionaries:

   - [en.json](ui/src/i18n/en.json:811)
   - [ko.json](ui/src/i18n/ko.json:811)
   - [zh-Hans.json](ui/src/i18n/zh-Hans.json:811)
   - [zh-Hant.json](ui/src/i18n/zh-Hant.json:811)

   Existing keys: **811** `provider.atlasCloudApiKeyRequired`; **1455–1456** `settings.imageModel.atlasCloudGptImage2/Edit`; **1483–1486** `settings.apiKeys.atlascloud.label/placeholder`; video labels start **1514**.

   Add all four languages’ image/video key-required reasons, separate key labels/placeholders, provider/base-URL label/help/source/error text, visible image/video model labels, compatibility copy, and experimental text if displayed. Display names may be translated; wire IDs must not be.

   [SettingsWorkspace.tsx:212,220–247](ui/src/components/SettingsWorkspace.tsx:212) currently shows global `unsupportedHelp` claiming GPT uses Responses and falls through to reasoning settings for 88api. Add lane-specific handling. The 88api UI must describe Images/chat-completions/video APIs accurately; it must not imply `/v1/responses`.

7. **Fixtures and test invariants requiring attention**

   **Certain enumeration/type failures after adding the lane:**

   | File / lines | Existing snippet | Required adjustment |
   |---|---|---|
   | [composerComponent.tsx:63–66](ui/e2e/fixtures/composerComponent.tsx:63) | `availability(): Record<Provider, …>` | Add `"88api"` readiness fixture. |
   | [core-selection-reconcile.test.ts:38–46](tests/core-selection-reconcile.test.ts:38) | `expected = { … atlascloud: … }`; loop `CORE_PROVIDER_IDS` | Add independent 88api default expectation. |
   | [provider-registry-contract.test.ts:17–19](tests/provider-registry-contract.test.ts:17) | `assert.deepEqual(ids, […])` | Add canonical lane ID in registry order. |
   | [provider-registry-parity.test.ts:14,18–24,65–68,104](tests/provider-registry-parity.test.ts:14) | `CORE_IDS`, `CLI_IMAGE_MODELS`, exact reference/mask maps | Add IDs/models and actual reference/mask facts. CLI expectation must include new slashless IDs, preserving dedup/order. |
   | [provider-surface-support.test.ts:23–40](tests/provider-surface-support.test.ts:23) | `expected: Record<CoreProviderId, MatrixRow>` | Add 88api’s independent image/video surface row. |
   | [capabilities-lane-contract.test.ts:41–43](tests/capabilities-lane-contract.test.ts:41) | exact `Object.keys(built.providerSurfaces)` | Add `"88api"`. |
   | [models-endpoint-contract.test.ts:178–180](tests/models-endpoint-contract.test.ts:178) | exact `Object.keys(body.lanes)` | Add `"88api"` and independent catalog/status assertions. |
   | [provider-adapter-v1-contract.test.ts:61–69](tests/provider-adapter-v1-contract.test.ts:61) | `EXPECTED_AUTH_REASON` for every adapter | Add new adapter’s no-key reason and independently exercise image-only/video-only credentials. |

   **Fixtures/coverage and source-shape contracts:**

   - [j6Catalog.ts:31–39,54–55](ui/e2e/fixtures/j6Catalog.ts:31): add an 88api lane and both key statuses. This catalog already omits some providers intentionally; adding the registry alone does not expose 88api in J6 journeys. Add both/one/neither-key scenarios and the configuration endpoint fixture.
   - [appServer.ts:43,315–317](ui/e2e/fixtures/appServer.ts:43), [appIsolation.ts:36–46](ui/e2e/fixtures/appIsolation.ts:36), [stubUpstream.ts:3](ui/e2e/fixtures/stubUpstream.ts:3): real fixture startup only provisions MiniMax/OAuth modes. Extend these only for native 88api upstream journeys, using synthetic keys and a local base URL. Existing isolation rejects inherited `IMA2_*` variables.
   - [core-selection-actions.test.ts:200–210,451–479](tests/core-selection-actions.test.ts:200): add 88api preservation, exact-ID persistence and lane-option uniqueness cases. Adding shared model rows without fixing family filters can fail the existing uniqueness/hint assertions.
   - [model-select-lane-gating.test.ts:31–69,103–125](tests/model-select-lane-gating.test.ts:31) and [core-selection-transport.test.ts:192](tests/core-selection-transport.test.ts:192): extend with 88api video display/mode/wire tests and stale cross-lane rejection.
   - [duration-slider-contract.test.ts:28–33](tests/duration-slider-contract.test.ts:28): exact source regex requires `values={DURATIONS.filter((d) => d <= maxDuration)}`; capability-driven options require updating that assertion.
   - [agent-mode-frontend-contract.test.ts:14–38](tests/agent-mode-frontend-contract.test.ts:14): source assertions pin the three resolutions, 1080p Grok auto-switch and 720p reset. Preserve xAI behavior while making those assertions lane-specific.
   - [xai-video-model-alias-contract.test.ts:60–78](tests/xai-video-model-alias-contract.test.ts:60) and [video-ref2v-duration-contract.test.ts:40–64](tests/video-ref2v-duration-contract.test.ts:40): preserve xAI alias/duration behavior; add proof that 88api IDs remain unchanged and receive their own limits.
   - [i18n-dictionary-contract.test.ts:90–128,446–447](tests/i18n-dictionary-contract.test.ts:90): extend finite dynamic-key lists for model/lane labels. Renaming/adding dynamic `t(expr)` call sites also requires updating the exact signature registry. Existing lists do not automatically discover newly added model label keys.

Backend contract expansion is required for the two credential vocabularies, base-URL read/update API, visibility/capability projection if adopted, and video completion metadata. Those changes belong to the parent’s backend area.

