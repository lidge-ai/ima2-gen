# API image tool model choices

C2 bounded API/UI slice. Keep `model` / `imageModel` as the outer GPT reasoning
model and preserve all existing defaults. Add optional API-only `imageToolModel`
for `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`; omission retains upstream
selection. Only those selections enable image quality `xhigh` and `max`.

Reuse provider option normalization, Responses tools, generation persistence,
Select, and the existing CLI request builders. Invalid tool models return 400;
other providers ignore the field and normalize extended quality to medium.
Provider switches and persisted draft hydration apply the same scope.
Sidecars/history preserve the distinct tool model. No dependency or auth changes.

Owners inspected: `lib/providerOptions.ts:5`, `lib/oauthNormalize.ts:12`,
`lib/responsesTools.ts:1`, `lib/providers/adapters/openaiOperations.ts:42`,
`lib/providers/adapters/openaiExecution.ts:17`,
`ui/src/components/GenerationControlsPanel.tsx:83`,
`ui/src/store/storeGenImpl.ts:321`, `ui/src/store/storeNodeGenImpl.ts:206`.
Searches: imageToolModel, imageModel, normalizeOAuthParams, resolveProviderOptions,
generateViaResponses, postEdit, setQuality. Existing owners cover the slice;
configuration alone cannot expose or forward the missing request field.

Official contract supplied by main:
https://developers.openai.com/api/docs/guides/image-generation.md
Responses top-level model remains mainline GPT; image model belongs in tools[].model.
OAuth builtin contract remains separate:
https://learn.chatgpt.com/docs/image-generation.md

Verification: focused node:test serialized request/validation tests; root/UI
typechecks; `npm run test:inventory`; Playwright API selection/persistence/provider
switch smoke. Main owns full gates, review, builds, commits and delivery.
Baseline from main: root typecheck and test typecheck passed before implementation.

## Implementation evidence

Implemented the distinct optional field through four routes/adapters, CLI, UI
draft state and persistence, canvas edit, sidecars/history, existing XMP paths,
and API capability discovery. Non-API providers discard the field. Explicit API
2.5 selection allows xhigh/max; default/provider changes (including cross-tab
storage sync) reset extended quality. The existing price table does not describe
2.5, so selected 2.5 models display estimate unavailable.

Fresh focused checks (2026-09-22):

- `npm run typecheck`: pass.
- `npm run typecheck:tests`: pass.
- `cd ui; node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit`: pass.
- `cd ui; node node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`: pass.
- `node --import tsx --test tests/api-image-tool-model.test.ts tests/oauth-normalize.test.ts tests/core-selection-actions.test.ts tests/preset-restore-contract.test.ts`: pass, 25 isolated feature cases plus 27 adjacent cases.
- `node --import tsx --test tests/openai-execution-parity.test.ts`: passed as part of the earlier focused run, 24 isolated parity cases.
- `node --import tsx scripts/generate-contract-docs.mjs --check`: pass; no generated skill content changed.
- `npm run test:inventory`: pass; inventory regenerated.
- `node scripts/refresh-structure-line-counts.mjs`: current.
- `git diff --check`: pass.

Initial check failures were corrected: provider-options inferred return shape,
node request type, async-vs-SSE negative fixture, extracted preset-loader helper
bindings, and the core selection patch's expanded key list. Existing assertions
remain; coverage adds actual store reload/reset and history/embedded metadata.
Edit does not embed XMP in the existing implementation: it preserves upstream
bytes and retains provenance in sidecars/history, which the tests verify.

Parent owns full build-first suite, Playwright execution/screenshots, review and
delivery. `ui/e2e/api-image-tool-model.spec.ts` is added and typechecked, not yet
executed by this leaf. No paid upstream calls. Plan is ignored by the existing
`devlog/_plan/*` rule; parent will force-add it when staging.

## Integration verification

2026-09-22: root and test typechecks, server/CLI builds, UI fixture build,
test inventory and structure line-count checks passed. The complete built-source
suite passed: 3,542 tests, zero failures, seven existing skips (3,549 total).
The new route fixture passes 25 inner cases. Local Playwright execution was
refused by the existing GitHub-hosted-Linux isolation guard; PR frontend CI is
the required execution environment. Its selection artifact includes
`wp02-image25-selected.png`. No isolation guard was changed.
