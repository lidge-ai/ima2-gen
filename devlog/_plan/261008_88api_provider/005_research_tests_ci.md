# tests ci — read-only research (2026-10-08)

Source: sol research subagent, read-only inspection of origin/dev dbc32888. Line numbers refer to that tree.

Read-only audit complete. No files changed; no builds or tests ran. The main breakpoints are exact provider lists, the doctor’s fixed count, adapter filename assumptions, and scanners that do not yet recognize `API88_` or credential names containing digits.

All links below refer to `/Users/jun/.codex/worktrees/8112/ima2-gen`. Line numbers reflect the shared tree inspected during this audit.

**Runner, inventory, and repository conventions**

| Edit point | Existing snippet / invariant | Required action |
|---|---|---|
| [scripts/run-tests.mjs:8](scripts/run-tests.mjs:8), lines 8–12, 19 | `readdirSync(testDir)`; `.filter((f) => /\.test\.[cm]?[jt]s$/.test(f))`; launches Node with module mocks and `tsx` | No provider-specific edit. Put new tests directly under `tests/`, named `*.test.ts`. Discovery is nonrecursive. The runner does **not** forward command-line arguments, so `npm test -- tests/foo.test.ts` does not select one file. |
| [package.json:20](package.json:20), lines 20, 26–27, 32, 44–45 | `"test": "node scripts/run-tests.mjs"`; `"test:inventory": "node scripts/classify-tests.mjs --check --fail-js-runtime"`; `"lint": "eslint"` | No script changes needed. `typecheck` uses `tsconfig.json`; `typecheck:tests` uses `tsconfig.tests.json`. `test:provider-registry` additionally checks generated provider types. |
| [scripts/classify-tests.mjs:21](scripts/classify-tests.mjs:21), lines 21–35, 40–75 | Runtime-import regex; sorted filename discovery; `existing !== output`; rejects JS test files | There is **no separate handwritten test registry**. After adding tests, regenerate the inventory with `node scripts/classify-tests.mjs`, then check it. Classification examines direct textual imports, not the transitive import graph. `_execution…` helpers are not inventoried. |
| [docs/migration/runtime-test-inventory.md:7](docs/migration/runtime-test-inventory.md:7) | `Total: 552 (runtime: 251, contract: 301)`; Atlas contract listed at line 39 | Regenerate totals and sorted sections after adding API88 test files. Do not hand-maintain counts. |
| [tsconfig.tests.json:18](tsconfig.tests.json:18) | `"tests/**/*.test.ts"` | New `.test.ts` files automatically enter test typechecking; imported helpers are followed. No include-list registration needed. |
| [eslint.config.mjs:6](eslint.config.mjs:6), lines 6–17, 52–81 | Explicit production TS/JS globs; no `max-lines` or function-length rule | No general automated 500-line enforcement was found. Root lint’s configured file globs omit `tests/**`. Follow the AGENTS convention manually. |
| [tests/cli-prompt-builder-contract.test.ts:68](tests/cli-prompt-builder-contract.test.ts:68) | `assert.ok(lines < 500)` | Enforces `<500` specifically for `bin/commands/prompt.ts`. |
| [tests/composer-feedback-contract.test.ts:84](tests/composer-feedback-contract.test.ts:84) | `composer.split("\n").length <= 500` | Enforces `≤500` specifically for `PromptComposer.tsx`. |
| [scripts/refresh-structure-line-counts.mjs:38](scripts/refresh-structure-line-counts.mjs:38) | Matches documented source-file rows and compares actual line counts | This is a documentation-drift check, not a maximum-size ratchet. Refresh affected existing rows in `structure/01-file-function-map.md`. Both PR-fast and full CI invoke its `--check`. |
| [scripts/check-new-blob-budget.mjs:7](scripts/check-new-blob-budget.mjs:7) | `DEFAULT_LIMIT = 5 * 1024 * 1024` | Separate Git-blob byte budget. No `scripts/test-layout/layout.json`, expected-layout inventory, or `NEW_OVERSIZED` test-layout ratchet was found in this repo. |

Exact commands, shown for the parent to run later from the repo root:

```sh
# Single existing test, with the canonical runner's flags:
node --experimental-test-module-mocks --import tsx --test tests/atlascloud-provider-contract.test.ts

# Single proposed new test:
node --experimental-test-module-mocks --import tsx --test tests/api88-provider-contract.test.ts

# Register new test files in the generated inventory:
node scripts/classify-tests.mjs
npm run test:inventory

npm run typecheck
npm run typecheck:tests
npm run lint
```

**Registry, adapter, capability, and catalog edit points**

| File / lines | Existing snippet and asserted invariant | 88api change |
|---|---|---|
| [tests/provider-registry-contract.test.ts:14](tests/provider-registry-contract.test.ts:14), lines 14–20 | `assert.deepEqual(ids, ["oauth", …, "atlascloud", …, "comfy"])`; unique IDs and exact order | Insert `"88api"` at the registry’s actual position. Add explicit assertions for vendor `"88api"` and two `api-key` credentials: `api88ImageKey` / `IMA2_88API_IMAGE_KEY`, and `api88VideoKey` / `IMA2_88API_VIDEO_KEY`. |
| Same file, lines 23–47, 80–95 | Prefix matches `/^[A-Z][A-Z0-9_]*_$/`; every non-OAuth credential has env vars; API keys have vocabulary; manifest-only additions flow through derivations | `API88_` already satisfies the prefix rule. Give both credentials truthful metadata. The derivation fixture needs no change. |
| [tests/provider-registry-parity.test.ts:14](tests/provider-registry-parity.test.ts:14), lines 14–25, 43–54 | `CORE_IDS`; `CLI_IMAGE_MODELS`; flattened models filtered only by `!id.includes("/")` | Update ordered core IDs. Add literal API88 image/video model-list assertions, with 10 image and 25 video registrations. Update the global CLI-image oracle with new unique IDs lacking `/`, in registry order. Spaces, uppercase, and CJK do not exclude a model; duplicate IDs across lanes appear once. |
| Same file, lines 59–68 | Exact image/video reference-limit objects | Add `"88api"` wherever its manifest declares a limit. Use documented API88 limits; Atlas’s `10` is not evidence for API88. An added `edit` limit currently lacks an equivalent exact-object test, so add coverage. |
| Same file, lines 98–120 | Exact sorted mask-rejection list; every image model’s `supports.mask` agrees with route policy | If masks are disabled, insert `"88api"` in sorted order. If supported for selected API88 models, this blanket lane-level oracle must be refined to represent that distinction. |
| [tests/provider-adapter-v1-contract.test.ts:33](tests/provider-adapter-v1-contract.test.ts:33), lines 33–68 | `atlasCloudApiKey: key`; `EXPECTED_AUTH_REASON` | Add `api88ImageKey: key` and `api88VideoKey: key` to `contextWith`; add `"88api"`’s exact missing-auth reason matcher. Add image-only, video-only, neither, both, and blank-key cases to establish independent credential behavior. |
| Same file, lines 91–132 | `adapter.listModels()` IDs equal **all** manifest model IDs; reads `../lib/providers/adapters/${adapter.laneId}.ts`; forbids quoted model literals in adapter source | The suite expects **`lib/providers/adapters/88api.ts`**, even if helpers use `api88` naming. Derive models from the manifest. If descriptors intentionally filter hidden/unverified models or image-only models, explicitly amend this equality contract; otherwise it requires all registered IDs. |
| Same file, lines 136–181, 213–221 | Live-context auth; normalized errors retain prefix/status; 401 nonretryable, 429/502 retryable; Atlas-style lanes own execution | Register the descriptor, normalize to `API88_`, and add `"88api"` to the `["nai", "minimax", "atlascloud", "comfy"]` execution-owner list. Do not add it to the descriptor-only or async-unregistered lists. |
| [tests/provider-surface-support.test.ts:23](tests/provider-surface-support.test.ts:23), lines 23–40 | `expected: Record<CoreProviderId, MatrixRow>` | **Typecheck break:** add a `"88api"` row for all five surfaces. Atlas’s `standard` row says video is absent, so copying it unchanged is incorrect. Pin supported/reference/mask/streaming/catalog facts independently. |
| Same file, lines 65–78, 81–104 | `deriveUnsupportedImageModelsFrom(REGISTRY)` equals `[]`; generated surface parity; literal reference caps | If the three unverified Grok rows use `supports.generate:false`, change the empty unsupported-model oracle to their exact deduplicated IDs. If hidden is separate metadata, this assertion remains unchanged. Add API88 reference-cap cases. Regenerate the UI projection. |
| [tests/capabilities-lane-contract.test.ts:40](tests/capabilities-lane-contract.test.ts:40), lines 40–43 | Exact `Object.keys(built.providerSurfaces)` | Insert `"88api"` in registry order. Add API88 to `EXPECTED_SURFACES` at lines 9–31 so local and disconnected-server serialization both pin its image/video facts. Local capabilities must still omit availability `lanes`. |
| [tests/models-endpoint-contract.test.ts:115](tests/models-endpoint-contract.test.ts:115), lines 115–140 | `withApp` accepts and forwards individual provider credentials | Extend options and context with both API88 keys, plus configurable base URL/configuration as needed. |
| Same file, lines 178–180 | Exact ordered `Object.keys(body.lanes)` includes core plus Runway/Higgsfield | Insert `"88api"` in canonical order. |
| Same file, lines 342–375, 434–443 | Atlas disconnected/ready DTO tests; `STATIC_IMAGE_SURFACES` says video unsupported | Add parallel API88 DTO tests: exact defaults, byte-exact IDs, registered versus exposed hidden-model policy, 25 video rows, per-model input roles/parameters, and all credential combinations. Give API88 its own surface oracle; do **not** place it unchanged into the image-only loop at line 434. |
| [tests/doctor-provider-contract.test.ts:40](tests/doctor-provider-contract.test.ts:40), lines 40–47 | Registry parity plus `assert.equal(lanes.length, 10)` | Change `10` to `11`; ensure local doctor emits the new lane. Add independent configured-key verification cases for image/video credentials and the configured base URL. |

The hidden-model distinction needs an explicit contract: current model derivations include every registration, and the CLI image derivation only excludes IDs containing `/`. Registration alone does not hide the three unverified Grok models.

**Execution and boundary edit points**

| File / lines | Existing snippet / invariant | 88api change |
|---|---|---|
| [tests/provider-execution-boundary.test.ts:8](tests/provider-execution-boundary.test.ts:8), lines 8–23 | Four explicit lane arrays; `atlascloud: "generateViaAtlasCloud"` transport map | Add `"88api"` to classic/node/edit/multimode arrays for implemented surfaces and map its actual concrete image export. Tests assert dispatch, option forwarding, native result identity, and single-to-sequence projection. These lists otherwise silently omit the new lane. |
| Same file, lines 193–223 | Grok live-key checks; MiniMax native-error identity | Add API88 counterparts for correct-key selection, mutation/removal, and native errors. Keep API88 outside the OpenAI/Responses branch and native Grok planner branch. |
| [tests/_executionBoundaryProbe.ts:11](tests/_executionBoundaryProbe.ts:11), lines 11–19, 68–79 | Transport export table; `mock.module(…namedExports…)`; fixture context | Register the new concrete helper/export in `transports` before importing execution modules. Supply synthetic API88 credentials where preparation checks auth. |
| Same file, lines 102–137 | Fixture uses `"grok-imagine-image-quality"` universally; explicit `rawLane` and edit-prefix lists | Give API88 a valid fixture model and assert it remains exact. If copying Atlas’s dispatch semantics, add `"88api"` to the raw-prompt and parent edit-prefix lists; adjust the hardcoded model oracle for its selected model. |
| Same file, lines 162–183 | Atlas transparent-field assertion; `["atlascloud", "minimax"]` parent-reference exception | Extend field assertions only for controls API88 actually supports. Pin parent/reference order. Atlas deliberately forwards all refs even in `parent-only`; preserve that exception only if API88 intentionally adopts it, otherwise assert effective refs. |
| [tests/_executionImportEdges.mjs:8](tests/_executionImportEdges.mjs:8), lines 8–12, 39–42 | `concreteOwners`; `adapterExecutionOwners` | Add API88 image transport helper(s) to concrete owners and `"lib/providers/adapters/88api"` to adapter owners. This prevents routes/pipelines bypassing the public execution seam. |
| [tests/provider-execution-imports.test.ts:44](tests/provider-execution-imports.test.ts:44), lines 44–57, 98–106, 318–347 | Explicit concrete-owner and adapter-owner arrays | Update both arrays alongside `_executionImportEdges.mjs`. The new adapter inherits actual-source checks and synthetic import/reexport/dynamic-import rejection tests. It must not import Responses execution, private legacy dispatch, other provider families, or routes. The four `EXECUTION_CALLERS` remain unchanged. |
| [tests/provider-execution-classic.test.ts:166](tests/provider-execution-classic.test.ts:166), lines 166–175, 270–294 | Atlas 502 receives no new outer OpenAI retry; alpha persistence test | No exhaustive lane list to fix. Add API88 concrete-route cases covering actual endpoints, errors, cancellation/persistence, and supported image format/background controls. Assert zero `/v1/responses` calls. |
| [tests/provider-execution-node.test.ts:367](tests/provider-execution-node.test.ts:367), lines 298–319, 367–391 | Provider-specific parent-only behavior; Atlas uploads parent plus refs using raw prompt | Add API88 root/child cases using its multipart/chat wire, parent/reference ordering, prompt policy, and exact model. Copy the behavioral oracle only where intended; Atlas’s upload endpoints are unrelated. |
| [tests/provider-execution-edit.test.ts:22](tests/provider-execution-edit.test.ts:22), lines 22–86, 89–135 | API masked edit and sidecar; Grok native result preservation; empty-result diagnostics | No full-provider list. Add API88 GPT multipart edits and Gemini chat-image edits, exact model/key assertions, supported mask behavior, output metadata, and empty/error cases. |
| [tests/provider-execution-multimode.test.ts:38](tests/provider-execution-multimode.test.ts:38), lines 38–110, 113–176, 179–355 | API async/legacy-SSE sequencing; native callbacks, diagnostics, failure/cleanup | No full-provider list. Add API88 async and legacy-SSE route cases proving the actual chosen sequence behavior, persistence, terminal counts, cancellation, and absence of Responses traffic. |
| [tests/provider-execution-routes.test.ts:193](tests/provider-execution-routes.test.ts:193), lines 193–250 | Missing/blank Grok key refuses before admission; surface-specific envelopes | No global list to fix. Add image-key-missing API88 cases across image surfaces and video-key-missing cases on video, including whitespace. Assert no upstream work and appropriate job admission/finalization. |
| [tests/provider-execution-harness.test.ts:282](tests/provider-execution-harness.test.ts:282) | Explicit ambient-secret exclusion examples | Add `IMA2_88API_IMAGE_KEY`, `IMA2_88API_VIDEO_KEY`, and `IMA2_88API_BASE_URL` to the assertion examples. Isolation already uses an environment allowlist; no provider registration is required. Preserve unmatched-request, abort, tracked-write, and cleanup guarantees. |
| [tests/provider-surface-boundary.test.ts:156](tests/provider-surface-boundary.test.ts:156), lines 156–180 | `["atlascloud", "ATLASCLOUD_MASK_UNSUPPORTED", "Atlas Cloud"]` | If API88 rejects masks, add its exact code/display-name tuple and synthetic context credentials. Rejection must precede mask validation/provider dispatch. If model-specific masks are supported, add separate positive/negative cases instead. |

**Errors, translations, limits, and canaries**

| File / lines | Existing snippet / invariant | 88api change |
|---|---|---|
| [tests/error-class-coverage.test.ts:34](tests/error-class-coverage.test.ts:34), lines 34–76, 115–148 | `/\b(?:MINIMAX\|GEMINI_API\|GROK\|AGY\|ATLASCLOUD\|NAI)_[A-Z0-9_]+\b/g`; emitted/mapped parity in both directions | Add `API88` to the scanner. Map every emitted error; exclude only genuine non-error constants such as API88 model/config constants. Without the scanner edit, new mapped literal errors can appear “dead.” Update `DYNAMIC_PROVIDER_CODE_SITES` if adding template-built codes or expanding shared prefix domains. |
| [tests/error-envelope-contract.test.ts:531](tests/error-envelope-contract.test.ts:531), lines 531–575 | Agent Atlas errors retain raw code and status-dependent class | No provider-count oracle. Add API88 HTTP/SSE/job/agent cases for auth, 429, 4xx, 5xx, polling failures/timeouts. Preserve each surface’s envelope shape and distinguish `code`, `rawCode`, `errorClass`. |
| [tests/server-code-preservation.test.ts:107](tests/server-code-preservation.test.ts:107), lines 107–138, 148–163 | Status-dependent Atlas/Grok classes; bad-request codes retain `INVALID_REQUEST` | Add API88 status-dependent request failures and any new bad-request/reference-cap codes. Assert normalization forwards status, preserves raw identity, and keeps application-level outer errors undecorated. |
| [tests/i18n-dictionary-contract.test.ts:90](tests/i18n-dictionary-contract.test.ts:90), lines 90–125, 239–261, 413–453 | Finite `option.fullLabelKey`, `laneKey`, readiness-label/error-card vocabularies; locale leaf parity | Add new keys to applicable finite resolvers: lane labels, model labels, readiness labels, and new error cards. Add every translation leaf to **en, ko, zh-Hant, zh-Hans**. New dynamic `t(expr)` call sites need explicit resolver entries; new dotted root keys are prohibited by the frozen legacy set. |
| [tests/reference-limits.test.ts:48](tests/reference-limits.test.ts:48) | Atlas cap `10`, tighter server cap wins | Add API88 image/edit/video tests using its actual limits. Preserve server-minimum and active-MCP precedence. No existing exact provider-union oracle here. |
| [tests/reference-limits-node-recovery.test.ts:166](tests/reference-limits-node-recovery.test.ts:166), lines 166–170, 194–196 | Unknown/prototype lanes retain fallback numeric cap and recover without leaked locks | No update required: `"88api"` is a core lane, so do not add it to the unknown-provider fixture. |
| [tests/provider-canary-parity.test.ts:21](tests/provider-canary-parity.test.ts:21), lines 21–44 | Route-key parser captures only `([a-z]+)`; `laneForVendor` maps credential vocabulary to lane | Extend parsing for actual API88 credential names, including digits/case/hyphens as applicable. Map both key vocabularies to `"88api"`. Add a free canary endpoint/probe only for the actual non-generation validation contract; test configurable-base resolution separately if source values are expressions. |
| [scripts/provider-canary.mjs:25](scripts/provider-canary.mjs:25), lines 25–31, 100–103 | Literal `CANARY_ENDPOINTS`; key-gated Atlas probe | If free-canary coverage is added, register `"88api"` and its actual safe validation URL/key handling. Existing parity verifies endpoint entries refer to real registry lanes; it does not require every registry lane to have a canary. |
| [tests/provider-canary-live-contract.test.ts:49](tests/provider-canary-live-contract.test.ts:49), lines 49–86 | Free canary forbids generation markers; paid lanes must declare env and probe; `/^CANARY_[A-Z_]+$/` | New registry lane alone needs no paid-canary change. If adding `CANARY_88API_…` or `CANARY_API88_…`, extend the env-name regex to allow digits. Preserve dispatch/budget controls and the two-provider pre-release tier. |

**CLI and core-selection edit points**

| File / lines | Existing snippet / invariant | 88api change |
|---|---|---|
| [tests/cli-model-resolver.test.ts:25](tests/cli-model-resolver.test.ts:25), lines 25–45, 170–175 | Synthetic `makeCatalog()` has explicit hosted lanes; Atlas default resolves with `transport:"core"` | Add API88 image/video catalog fixtures and defaults. Assert `88api/SD2.5 720P` and `88api/Seedance-2.0-720p官方版` resolve byte-exactly; provider-qualified ambiguity, kind mismatch, hidden-model policy, and partial credential readiness must not fall back to another lane. |
| [tests/core-selection-reconcile.test.ts:38](tests/core-selection-reconcile.test.ts:38), lines 38–48 | Literal fallback map, iterated using `CORE_PROVIDER_IDS` | **Automatic failure:** add API88’s exact default. Add explicit model-inference and credential-lane-preservation cases, especially IDs shared with native Grok/Gemini lanes. Preserve image/video selection and exact opaque IDs; hidden unsupported selections must follow deliberate policy. |
| Same file, lines 61–66, 104 onward | All-core idempotence; memory allowlisting | New lane automatically enters idempotence coverage after regeneration. Add API88 image/video memory cases, rejecting unsupported slots without inventing defaults. |
| [tests/core-selection-actions.test.ts:467](tests/core-selection-actions.test.ts:467), lines 458–481 | Explicit selectable-lane loop; every option’s hint belongs to its registry lane; values unique per lane | Add `"88api"` to the loop. Assert visible image/video choices, hidden Grok rows, lane hints, hydration, and switching with remembered selection. Literal Grok/Gemini examples elsewhere need no mechanical replacement. |
| [tests/core-selection-memory.test.ts:12](tests/core-selection-memory.test.ts:12), lines 12–23, 84–126 | Frozen historical persistence keys; whole-lane replacement; unrelated preferences preserved | No provider list to update. Add API88 round-trip cases for both kinds and CJK/space IDs. Reuse the existing memory schema/key; adding a provider does not require repointing historical keys. |
| [tests/core-selection-transport.test.ts:142](tests/core-selection-transport.test.ts:142), lines 142–169, 187–197, 214–230 | Selected hosted model survives serialization; literal dispatch/custom-size cases | Add API88 image serialization, video dispatch, and custom-size continuation cases. Selected model IDs must remain exact; a stale native Grok video value must not hijack the lane. |
| [tests/core-generation-mode.test.ts:8](tests/core-generation-mode.test.ts:8), lines 8–24 | Literal lane/mode cases | Add API88 image/multimode and selected-video cases. Its video mode cannot remain restricted to Grok/Comfy. |
| [tests/model-select-lane-gating.test.ts:31](tests/model-select-lane-gating.test.ts:31), lines 31–65 | Explicit lists reject stranded Comfy/Grok values; native selections stay visible | Add API88 to stale-selection cases and assert its own image/video selection is displayed byte-exactly. |

Additional provider enumerations/source contracts found:

- [tests/api-image-tool-model.test.ts:149](tests/api-image-tool-model.test.ts:149): `["oauth", …, "atlascloud"]` asserts non-API lanes ignore stale `imageToolModel`. Add `"88api"`; its GPT Images calls must not inherit OpenAI Responses tool-model selection.
- [tests/nai-client-options-contract.test.ts:146](tests/nai-client-options-contract.test.ts:146): explicit non-NAI list asserts NAI payload contributes `{}`. Add `"88api"`.
- [tests/node-studio-ui-contract.test.ts:289](tests/node-studio-ui-contract.test.ts:289): `adapterOwners` and call-oracle tuples enumerate Atlas/MiniMax/NAI node dispatch. Add API88’s real adapter/export and intended prompt expression.
- [tests/comfy-cli-contract.test.ts:68](tests/comfy-cli-contract.test.ts:68): exact contiguous CLI provider regex. Insert `88api` when updating `docs/CLI.md`.
- [tests/cli-feature-parity-contract.test.ts:132](tests/cli-feature-parity-contract.test.ts:132): exact legacy `--provider <auto|…|nai>` regex. Insert `88api`; retain separate `"api"` Responses semantics.
- [tests/cli-capabilities-contract.test.ts:30](tests/cli-capabilities-contract.test.ts:30): `["auto", ...deriveProviderIds()]` is already registry-derived; no list edit.
- [tests/provider-ui-polish-contract.test.ts:22](tests/provider-ui-polish-contract.test.ts:22): selector uses `CORE_PROVIDER_IDS`; no list edit.
- [tests/transparent-background-contract.test.ts:152](tests/transparent-background-contract.test.ts:152): source regex pins `supportsForcedTransparent: activeProvider === "atlascloud"`. Update the oracle if API88 joins that capability.
- API/OAuth-only execution tests and native Grok-only loops are family-specific contracts, not complete provider inventories; API88 must not be inserted into their Responses/planner expectations.

**Copying the Atlas HTTP contract**

[tests/atlascloud-provider-contract.test.ts:7](tests/atlascloud-provider-contract.test.ts:7) captures `originalFetch`; lines 9–11 restore it after every test. Lines 38–58 and 79–98 directly replace **`globalThis.fetch`** with a URL-dispatching stub. There is **no injected fetch parameter**. The stub records calls, parses string JSON bodies, inspects `FormData`, returns `Response.json`/binary responses, and throws on any unexpected URL.

Keep the Atlas tests intact; create API88-specific contracts using that pattern:

- GPT generation: exact `/v1/images/generations`, image bearer, JSON model.
- GPT editing: exact `/v1/images/edits`, multipart model and image fields; inspect `FormData` without JSON-parsing it.
- Gemini images: exact `/v1/chat/completions`, image bearer and appropriate multimodal body.
- Video: `POST /v1/videos`, then `GET /v1/videos/{id}`, using only the video bearer.
- Assert default/configured base URL, independent missing/blank credentials, exact uppercase/space/CJK model values, hidden/unverified Grok registrations, output normalization, upstream errors, polling failure/timeout, and cancellation.
- Make the stub fail explicitly on `/v1/responses`, incorrect keys, and all unexpected URLs. Assert the video key never authenticates image work and vice versa.

One fixture limitation: [tests/_videoExecutionFixture.ts:104](tests/_videoExecutionFixture.ts:104) pins authenticated traffic to `api.x.ai`, the Grok fixture bearer, and Grok POST paths. It cannot host API88 video/error-envelope tests unchanged. Add a dedicated API88 fixture or parameterize a separate API88 validation mode while retaining the existing Grok assertions.

