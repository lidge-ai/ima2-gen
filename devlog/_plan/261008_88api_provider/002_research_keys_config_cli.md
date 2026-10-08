# keys config cli — read-only research (2026-10-08)

Source: sol research subagent, read-only inspection of origin/dev dbc32888. Line numbers refer to that tree.

Read-only inspection completed; no files, Git state, builds, or tests changed. The main gaps are independent credential addressing, secret redaction, media-specific readiness, and hard-coded provider assertions.

For the edit points below, `88api` denotes the lane/vendor. **Proposed credential route IDs** are `api88-image` and `api88-video`, preserving the existing `{ apiKey }` request and flat status-entry contract.

1. **Configuration and credential loading**

| File / lines | Existing snippet | Required change |
|---|---|---|
| [config.ts:54–80](config.ts:54) | `env.IMA2_CONFIG_DIR || join(homedir(), ".ima2")`; candidates include package `.ima2/config.json` | Keep existing locations and precedence. Persist credentials as top-level `api88ImageKey` and `api88VideoKey`; persist non-secret provider settings under `api88Provider`. |
| [config.ts:86–100](config.ts:86) | `firstDefined(envVal, fileVal) ?? fallback` | Use `pickStr(env.IMA2_88API_BASE_URL, fileCfg.api88Provider?.baseUrl, "https://api.88api.ai")`. Empty strings fall through; this helper does not trim values. |
| [config.ts:441–456](config.ts:441) | `globalBaseUrl: pickStr(env.IMA2_MINIMAX_GLOBAL_BASE_URL, ...)`; `baseUrl: pickStr(env.IMA2_NAI_BASE_URL, ...)` | Add an analogous `api88Provider` block for base URL, image/video defaults, and required timeouts. MiniMax’s default base **includes `/v1`**; NovelAI’s base is a host. The specified 88api default is a host, so adapters must append `/v1/...` exactly once. |
| [server.ts:119–135](server.ts:119) | `process.env.ATLASCLOUD_API_KEY`; `cfg.atlasCloudApiKey` | **AtlasCloud credentials are not read by `config.ts`.** Add independent loaders using `IMA2_88API_IMAGE_KEY` → `api88ImageKey` and `IMA2_88API_VIDEO_KEY` → `api88VideoKey`, with the same config-file fallback locations. Do not treat the two environment variables as interchangeable aliases. |
| [server.ts:384–388, 429–437](server.ts:384) | `await loadAtlasCloudApiKey()`; `atlasCloudApiKey`, `atlasCloudApiKeySource`, `hasAtlasCloudApiKey` | Load both credentials at boot and assign separate key/source/presence fields to runtime context. |
| [lib/runtimeContext.ts:63–71, 157–165, 226–234](lib/runtimeContext.ts:63) | `atlasCloudApiKey: string \| undefined` plus source/boolean fields | Add `api88ImageKey`, `api88ImageKeySource`, `hasApi88ImageKey`, and the video equivalents in the interface, context normalization, and test-context defaults. |
| [lib/configKeys.ts:75–79](lib/configKeys.ts:75) | `/token\|secret\|apikey\|password/i` | **Neither `api88ImageKey` nor `api88VideoKey` matches this regex.** Add both to `ALWAYS_REDACT`; otherwise `ima2 config ls`, including JSON output, exposes persisted keys. |
| [lib/configKeys.ts:3–73](lib/configKeys.ts:3) | `WRITABLE_CONFIG_KEYS`; `KEY_TO_ENV` | Add `api88Provider.baseUrl` and supported default/timeout settings if CLI configuration is intended. Map base URL to `IMA2_88API_BASE_URL`. Keep credentials outside the general writable set; `config set` currently prints values and environment overrides verbatim. |

Expected persisted shape:

```json
{
  "api88ImageKey": "<image credential>",
  "api88VideoKey": "<video credential>",
  "api88Provider": {
    "baseUrl": "https://api.88api.ai"
  }
}
```

Existing key storage is plaintext JSON with atomic replacement: [lib/configFileStore.ts:13–18, 24–43](lib/configFileStore.ts:13) creates directories with `0700`, writes the temporary file with `0600`, and serializes mutations. Reuse this writer so saving one key preserves the other.

2. **Key routes and the second credential**

| File / lines | Existing snippet | Required change |
|---|---|---|
| [lib/providers/types.ts:1–3, 17–31](lib/providers/types.ts:1) | `KeyProviderId = "openai" \| ...`; `credentials: readonly ProviderCredential[]` | Add two credential vocabulary IDs and vendor `"88api"`. The manifest already supports multiple credentials; no new credential container is necessary. |
| [lib/providers/registry.ts:154–164](lib/providers/registry.ts:154) | `credentials: [{ kind: "api-key", keyVocabulary: "atlascloud", ... }]` | Declare **two** API-key entries, each with its own vocabulary, exact environment variable, and config key. Do not inherit AtlasCloud’s `apikey-` prefix. Omit `keyPrefix` unless verified for 88api. |
| [routes/keys.ts:6–60](routes/keys.ts:6) | `KeyProvider`; `KEY_PREFIX_MAP`; `VALIDATE_URL_MAP`; `CONFIG_KEY_MAP`; `isKeyProvider` | Add both credential IDs to every exhaustive map/guard. Map them separately to `api88ImageKey` and `api88VideoKey`. An empty prefix array accepts any non-empty key. |
| [routes/keys.ts:68–88](routes/keys.ts:68) | `keySourceForProvider(...)`; hard-coded status loop | Read each runtime credential/source independently and emit two status entries. Suggested entries: `status["api88-image"]`, `status["api88-video"]`. |
| [routes/keys.ts:185–250](routes/keys.ts:185) | `{ apiKey }`; `.trim()`; max `512`; validation timeout `10_000` | Retain format/size limits and validate the selected credential against the **configured 88api base URL**. An image key must never validate using the stored video key or vice versa. |
| [routes/keys.ts:35–38, 212–243](routes/keys.ts:35) | `resolveMinimaxValidateUrl(ctx)`; generic Bearer validation | Add a dynamic 88api validation-URL resolver. If `/v1/models` is the agreed authentication probe, append it to the configured host and use Bearer authentication. Its availability for **both credential classes is not established by the supplied context**; do not substitute billed generation as a key-save probe. |
| [routes/keys.ts:253–292](routes/keys.ts:253) | `existing[CONFIG_KEY_MAP[provider]] = trimmed`; runtime hot-update branches | Add separate hot updates for image and video fields, sources, and booleans. Adapters must read live context so saving a key takes effect immediately. |
| [routes/keys.ts:295–337](routes/keys.ts:295) | `source === "env"` → `ENV_KEY_IMMUTABLE`; delete mapped key | Delete only the selected credential and clear only its runtime fields. Preserve the sibling credential. |
| [lib/providers/types.ts:24–30](lib/providers/types.ts:24) | `validateUrlIsFallback?: boolean` | Set this on both credentials when their manifest URL is a default and runtime resolves the configurable host. **This flag is metadata, not executable URL resolution.** |

Masking is already suitable: [routes/keys.ts:63–65](routes/keys.ts:63) returns `***` for keys of length ≤10, otherwise first four characters + `..` + last two. Status `valid: !!key` means presence, **not a fresh upstream validation result**.

One existing behavior deserves an explicit decision: PUT currently permits saving over an env-sourced credential and changes live source to `"config"`; restarting restores environment precedence. DELETE then follows the live source. Avoid accidentally claiming PUT has environment immutability.

3. **UI credential status handoff**

These are necessary adjacent edits for the UI owner:

| File / lines | Existing snippet | Required change |
|---|---|---|
| [ui/src/hooks/useKeyStatus.ts:5–14](ui/src/hooks/useKeyStatus.ts:5) | `Record<"openai" \| ... \| "vertex", KeyStatusEntry>` | Add both credential status IDs, each retaining `configured`, `source`, `valid`, `maskedKey`. |
| [ui/src/components/ApiKeyInput.tsx:6, 32–35, 55–57](ui/src/components/ApiKeyInput.tsx:6) | provider union; PUT/DELETE `` `/api/keys/${provider}` `` | Widen the union for both IDs. The existing request body and endpoint construction then work unchanged. |
| [ui/src/components/AccountSettings.tsx:207–215](ui/src/components/AccountSettings.tsx:207) | one AtlasCloud `<ApiKeyInput>` | Add distinct image-key and video-key inputs, each bound to its own status entry and localized label. |
| [ui/src/hooks/useProviderAvailability.ts:51–55, 82–85](ui/src/hooks/useProviderAvailability.ts:51) | `keyStatus?.atlascloud?.valid === true` | Add 88api availability using the relevant media credential. A single “both keys required” boolean would unnecessarily disable image-only or video-only configurations. |

4. **Model catalog, CLI defaults, and resolution**

| File / lines | Existing snippet | Required change / invariant |
|---|---|---|
| [routes/models.ts:190–209](routes/models.ts:190) | `adapter.listModels().map((model) => model.id)` → `image`; `video: []` | Add an 88api lane partitioning models by `kind`, with separate image/video defaults. Do not copy AtlasCloud’s image-only projection. |
| [routes/models.ts:77–85](routes/models.ts:77) | entries retain only `id`, `label`, `capabilities` | This helper does **not** propagate `supports.generate`, visibility, or an execution lock. Explicitly exclude the three unverified Grok entries from public catalog, or project `executable: false`/`lockReason` through a richer helper. Registry presence alone must not make them executable. |
| [routes/models.ts:309–325](routes/models.ts:309) | `Record<CoreProviderId, ModelLaneDto>`; `lanes[id].surfaces = ...` | Add the lane entry. Otherwise registry expansion causes a type failure and potentially `lanes[id]` dereference failure. |
| [routes/models.ts:39–48](routes/models.ts:39) | one lane `status`; shared image/video catalog | Define partial credential readiness. Recommended: lane ready when either media is usable, with unavailable models locked by missing media credential. Otherwise image-only and video-only use cannot both be represented correctly. |
| [bin/lib/modelResolver.ts:31–42, 54–95](bin/lib/modelResolver.ts:31) | lanes derive from registry; `entry.id === model`; `entry.executable === false` | Lane registration propagates automatically. Exact comparison preserves spaces, uppercase, and CJK. Add tests for both credentials’ partial readiness and hidden/locked models. |
| [bin/lib/modelResolver.ts:106–119, 186–195](bin/lib/modelResolver.ts:106) | `NO_DEFAULT_MODEL`; first-slash namespace split; `laneInfo.defaults[kind]` | Supply valid image/video defaults in the lane DTO. With no explicit lane and no persisted CLI default, preserve `NO_DEFAULT_MODEL`; do not silently choose 88api. |
| [bin/commands/defaults.ts:187–229](bin/commands/defaults.ts:187) | `value.slice(slash + 1)`; exact catalog membership; `defaults.${kind}` | Existing `defaults set image/video` accepts quoted targets such as `"88api/SD2.5 720P"` byte-exactly. **But validation checks only lane readiness and membership**, not `entry.executable`; add the lock check if unavailable entries remain listed. |
| [bin/commands/defaults.ts:21–22, 124–142](bin/commands/defaults.ts:21) | `MODEL_KEYS = ["imageModels.default", "apiProvider.defaultImageModel"]` | Keep `defaults set model/reasoning` scoped to OAuth/OpenAI as documented. 88api uses `defaults set image/video`; no automatic widening is needed. |
| [bin/commands/models.ts:48–65, 89–98](bin/commands/models.ts:48) | `Object.entries(catalog.lanes)`; fetch `/api/models`; `executable !== false` | No provider enum edit needed. Correct lane DTO projection automatically exposes 88api through `ima2 models --lane 88api`. |
| [bin/lib/model-aliases.ts:7–10](bin/lib/model-aliases.ts:7) | only `luna/sol/astra` aliases; otherwise return original string | Existing 88api IDs retain case/spacing/CJK. Do not add lowercasing, whitespace normalization, or model-name URL encoding to JSON/multipart model fields. |
| [bin/commands/gen.ts:28–30, 171–181, 315–316](bin/commands/gen.ts:28) | derived provider list; resolver; `model: context.target.model` | Provider routing is derived already; preserve resolved ID in request body. |
| [bin/commands/video.ts:25–31](bin/commands/video.ts:25) | `...deriveVideoProviderIds()` | Register the 25 models as `kind: "video"`; video CLI/help then includes the lane automatically. |
| [bin/lib/videoMcp.ts:105–125, 142–145](bin/lib/videoMcp.ts:105) | global duration `1..15`, resolutions `480p/720p/1080p`, max seven refs | Audit these shared restrictions against 88api models; they may reject valid provider-specific options. Model forwarding itself is exact. Grok’s later 1080p rule already passes non-Grok IDs through at [lib/imageModels.ts:391–395](lib/imageModels.ts:391). |
| [bin/commands/edit.ts:14–16, 73–78](bin/commands/edit.ts:14) | derived provider/model sets | Automatically picks up registry models, but its global model set includes unverified entries. Require lane-specific rejection downstream. `multimode.ts:16–18,126–128` and `node.ts:14,94–96` also derive providers and forward model strings. |
| [bin/ima2.ts:439–498](bin/ima2.ts:439) | command dispatch includes `config`, `defaults`, `models`; no `keys` | **There is no standalone `ima2 keys` command.** `ima2 config keys` lists writable configuration names, not stored provider credentials. Add a new command only if parent explicitly includes it in product scope. |
| [bin/lib/doctor-providers.ts:122–171](bin/lib/doctor-providers.ts:122) | loops all `provider.credentials`; `resolveValidateUrl` special-cases MiniMax | Two credential checks are already structurally supported. Add dynamic 88api URL resolution and distinguish image/video in diagnostic text, which currently labels both only by lane. |

`ima2 providers` merely prints `/api/providers` ([bin/commands/observability.ts:67–73](bin/commands/observability.ts:67)). That endpoint is an older OAuth/OpenAI projection, not a registry lane list ([routes/health.ts:38–47](routes/health.ts:38)); advertising 88api there requires a separate status-contract expansion.

**Runtime catalog answer:** AtlasCloud `listModels()` returns registry models directly ([lib/providers/adapters/atlascloud.ts:57–60](lib/providers/adapters/atlascloud.ts:57)); there is no hosted `/v1/models` intersection in this path. Runtime catalogs exist for Comfy workflows and connected MCP tools (`routes/models.ts:262–303,389–399`). Existing `/v1/models` calls serve authentication/status/canaries. Keep 88api’s curated catalog independent of an upstream list that might omit image/video IDs.

5. **Canaries and documentation**

| File / lines | Existing snippet | Required change |
|---|---|---|
| [scripts/provider-canary.mjs:25–34, 100–111](scripts/provider-canary.mjs:25) | `CANARY_ENDPOINTS`; AtlasCloud one-key probe | Add the agreed default authentication endpoint and independently probe both credentials at the configurable host. Report a missing credential as skipped; one successful image-key probe must not claim video-key coverage. Preserve the no-generation/no-mutation contract. |
| [scripts/provider-canary-live.mjs:80–136, 151–159](scripts/provider-canary-live.mjs:80) | each lane has one `env`; `generate(key)` / `edit(key)` | One `env` cannot represent both media credentials. Add operation-specific credential selection or explicit subresults. GPT image generation uses `/v1/images/generations`; edits require multipart, so `postJson` cannot be reused for them. Gemini image probes use `/v1/chat/completions`; video needs POST `/v1/videos` plus polling GET `/v1/videos/{id}`. Never use `/v1/responses`. |
| [scripts/provider-canary-live.mjs:139–143](scripts/provider-canary-live.mjs:139) | `PRE_RELEASE_LANES = ["api", "grok-api"]` | Weekly derives all live lanes; pre-release stays two representative lanes unless parent changes that scope. |
| [docs/API.md:61–69, 409–411](docs/API.md:61) | provider bullets; OpenAI Responses edit description | Add 88api family routing, dual keys, base override, exact IDs, hidden Grok status, and supported edit behavior. Qualify “API-key uses Responses” statements as **OpenAI** API-key behavior. |
| [docs/API.md:558–561, 979–984, 1090, 1201–1210](docs/API.md:558) | video provider enum; key provider list; “ten core lanes” | Add video lane/options, both key route IDs/status entries, configuration names, validation behavior, lane defaults, hidden-model and partial-readiness semantics. Preserve “Web UI only” key-management wording unless CLI key management is implemented. |
| [structure/03-server-api.md:71–76, 88, 114–115, 423–436](structure/03-server-api.md:71) | key rows; provider paragraph; legacy-family list; catalog contract | Mirror the API changes and actual adapter/execution ownership. Add only implemented 88api errors to the error table around line 706. |
| [structure/03-server-api.md:738](structure/03-server-api.md:738) | provider-addition sync checklist | Parent handoff also needs `docs/CLI.md`, README env table, and structure docs 00/02/04/06; these are outside this leaf’s requested documentation area. |

The static capability model projection also has hard-coded lane arrays at [lib/capabilities.ts:119–129](lib/capabilities.ts:119). Add an explicitly lane-scoped 88api projection if that legacy discovery surface must expose it. Never serialize full config containing credentials.

6. **Assertions that break or need extension**

| File / lines | Existing assertion/snippet | Required update |
|---|---|---|
| [tests/provider-registry-contract.test.ts:17–19](tests/provider-registry-contract.test.ts:17) | exact ten-provider ID array | Add new lane in registry order. Add two-credential/config/env assertions. Error prefix must satisfy `/^[A-Z][A-Z0-9_]*_$/`; `API88_` does. |
| [tests/provider-registry-parity.test.ts:14–24, 43–53](tests/provider-registry-parity.test.ts:14) | `CORE_IDS`; `CLI_IMAGE_MODELS`; exact model-union equality | Extend IDs and model union. The CLI union currently includes **all image models**, not only executable ones. |
| [tests/provider-registry-parity.test.ts:59–68, 102–115](tests/provider-registry-parity.test.ts:59) | exact reference maps; exact mask-rejection matrix | Add 88api’s verified limits/mask policy. The per-model mask assertion assumes homogeneous lane behavior and may need refinement for mixed or locked image models. |
| [tests/models-endpoint-contract.test.ts:119–137, 178–179](tests/models-endpoint-contract.test.ts:119) | runtime fixture fields; exact lane keys | Add two fixture keys and lane enumeration; cover neither/image-only/video-only/both, defaults, 7 visible versus 10 registered image models, and 25 video IDs. |
| [tests/capabilities-lane-contract.test.ts:41–43](tests/capabilities-lane-contract.test.ts:41) | exact `providerSurfaces` keys | Add lane. |
| [tests/provider-surface-support.test.ts:23–40](tests/provider-surface-support.test.ts:23) | `Record<CoreProviderId, MatrixRow>` | Add verified 88api surface matrix; otherwise typecheck fails. |
| [tests/provider-adapter-v1-contract.test.ts:33–68, 119–148](tests/provider-adapter-v1-contract.test.ts:33) | one shared key per lane; expected auth reason; filename `${adapter.laneId}.ts` | Add both keys and missing-auth expectation; extend partial-auth coverage. Ensure adapter filename matches lane ID or update this filename assumption. Model literals belong in registry, not adapter source. |
| [tests/doctor-provider-contract.test.ts:21, 40–43](tests/doctor-provider-contract.test.ts:21) | mock config lacks `api88Provider`; `lanes.length === 10` | Extend mock config for dynamic validation resolver; change count to 11; verify each key independently and credential-specific diagnostics. |
| [tests/provider-canary-parity.test.ts:17–35, 49–54](tests/provider-canary-parity.test.ts:17) | parser key regex `[a-z]+`; hard-coded vendor mapping; endpoint keys must be registry IDs | Numeric lane IDs and proposed hyphenated credential IDs **are not parsed**. Update parser/mapping or replace text parsing with structured endpoint contracts. Keep endpoint keys as real lanes; credential subresults need separate identifiers. |
| [tests/provider-canary-live-contract.test.ts:63–83](tests/provider-canary-live-contract.test.ts:63) | two pre-release lanes; single `env`; `/^CANARY_[A-Z_]+$/` | `CANARY_88API_*` **fails this regex**. Permit digits and update operation-specific credential schema; credential aliases cannot masquerade as extra registry lanes. |
| [tests/cli-model-resolver.test.ts:170–195](tests/cli-model-resolver.test.ts:170) | AtlasCloud default resolution; `NO_DEFAULT_MODEL` grouped roster | Add exact space/uppercase/CJK IDs, namespaced defaults, partial credential state, lock rejection, and cross-lane ambiguity tests. |
| [tests/provider-execution-boundary.test.ts:8–23](tests/provider-execution-boundary.test.ts:8) | hard-coded surface lane lists and concrete transport map | Execution owner must add 88api coverage and assert no `/v1/responses` calls. |
| [tests/comfy-cli-contract.test.ts:68](tests/comfy-cli-contract.test.ts:68) / [tests/cli-feature-parity-contract.test.ts:132](tests/cli-feature-parity-contract.test.ts:132) | literal provider strings in documentation regexes | Update when widening the documented enum. |
| [scripts/generate-provider-types.mjs:34–56, 65–69](scripts/generate-provider-types.mjs:34) | registry-generated frontend IDs/models/surfaces; stale-output check | Parent must regenerate `ui/src/generated/providers.ts`; registry test command includes `--check`. The generator emits all per-provider image IDs, so hidden models need explicit UI filtering. |

Additional negative contracts should cover secret redaction, key-save/delete isolation, base URL override, validation failures, and exact model forwarding. Existing [tests/minimax-key-validation-route.test.ts:81–141](tests/minimax-key-validation-route.test.ts:81) provides a route-test pattern.

Memory supplied the registry-ownership pointer; all findings above were checked against the current source. Upstream validation availability and runtime behavior remain untested under this leaf’s restrictions.



