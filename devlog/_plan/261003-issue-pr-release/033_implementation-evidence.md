# wp3 implementation and rendered evidence

Status: implementation frozen for independent review. Main owns commit, full root gates, hosted CI, screenshot publication, PR and merge. This record does not claim those steps completed.

## Delivered behavior

Sound presets are ordinary persisted composer chips. The picker keeps one managed sound chip; replace, same-button toggle, Clear and removal from the composer preserve unrelated/continuity chips and main text. The pure builder accepts an optional localized insertion-time name while retaining stable IDs, canonical prompt text and after-main placement. Existing names are not relocalized on locale changes. The picker uses same-file selection/button helpers; longest picker function is23 lines.

Four locales explain replacement and persistence, distinguish no-music from silence, and describe image attachment versus video CLI guidance truthfully. Uploaded audio remains rejected in every composer lane. The carry's VideoControlsPanel insertion and useComposerDrop behavior were reused unchanged; no backend field, new store slice or node-generation behavior was added.

The narrow-layout defect was reproduced before CSS changes and recorded in032. Existing video controls wrap rows but force six equal-width buttons;390px labels were ellipsized. Unique `.video-controls .sound-intent-picker` rules now use content-based button width and44px minimum height. Global option-row/button styles, design-system tokens and other controls were not changed. All seven visible labels fit at1280/390/320 in all four locales without assertion-threshold relaxation.

## Verification commands and results

All final commands below exited0:

```sh
npm --prefix ui run build
node --import tsx --test tests/video-sound-intent-contract.test.ts tests/video-sound-intent-ui-contract.test.ts tests/dropped-media-sorting-contract.test.ts
npm run typecheck:tests
node scripts/classify-tests.mjs
node scripts/classify-tests.mjs --check
node node_modules/eslint/bin/eslint.js ui/src/components/SoundIntentPicker.tsx ui/src/lib/videoSoundIntent.ts ui/src/lib/droppedMedia.ts
node ui/node_modules/@playwright/test/cli.js test -c .codexclaw/wp3-ui-playwright.config.ts
npm --prefix ui run test:e2e -- e2e/video-sound-intent.spec.ts --list
```

- UI production build and E2E TypeScript check pass; existing Vite chunk-size/mixed-import warnings remain.
- Focused root tests:12 passed,0 failed. The real composePrompt module is bundled with the real store entry order into an isolated VM with in-memory localStorage; no duplicate composition implementation or application-global storage modification.
- Browser:16 passed,0 failed,0 retries. Locally uses repository Playwright and installed Chrome via an ephemeral config; no new driver/install. Standard repository config discovers the new journey tests plus its isolation dependency. Hosted execution is pending main's CI gates, not claimed here.
- Inventory regenerated:251 runtime/301 contract tests.
- AST line-count audit: new/changed picker/builder/spec/fixtures are65/58/238/141/145 lines; respective largest functions23/11/26/14/27 lines. No new function reaches50 lines or file500 lines.

## Rendered matrix

- Select, replace, same-button toggle, Clear, and composer chip removal update aria-pressed truthfully.
- Ordinary before/after chips, continuity chip, live lineage and main text survive sound changes.
- Real GenerateButton → generateImpl → runVideoGenerateImpl constructs literal expected payload prompts for blank/custom/edited main text. Sound-only empty composer submits once; clearing it restores empty-prompt admission. Old sound text is absent, new text appears exactly once after main. No selected voice means no referenceAudios field.
- Real model buttons/public image-selection action and reload preserve chips, prompt and model. Reload does not reseed. Locale is explicitly set after every navigation because the isolation fixture resets it; no locale or runtime-lineage reload claim.
- Audio-only and mixed two-MP3/one-PNG drops exercise real DOM DataTransfer, metadata boundary, PNG decoding/compression and store attachment admission in image/base-video/1.5 modes. Audio produces one rejection per reason, mixed drop retains exactly one image, and no generation occurs. Base-video drop retains CLI guidance with no attachment/submission. Canonical/preview/dated aliases are tested directly in sorter/acceptAttr root tests.
- English/Korean/simplified/traditional Chinese labels, insertion-time chip names, translated audio errors, Voice-before-Sound ordering, Enter/Space activation and visible keyboard focus pass.12 screenshots inspected with view_image; button scrollWidth/clientWidth and viewport bounds pass without tolerance inflation.

## Isolation and cleanup

Reuse isolatedComponentTransport unchanged. Synthetic origin http://127.0.0.1:49155 has no listener. Three exact GET responses:assets?kind=element&limit=500, capabilities, config/grok-planner; exact document/JS/CSS/font assets only. Unexpected requests, POST/PATCH, SSE, sockets and workers fail.

Two importer-specific wrappers replace only postVideoGenerateStream from storeVideoImpl and readImageMetadata from storeReferenceImpl; metafile receipts prove the production picker/panel/composer/generation/store/compression modules and both wrappers. Video boundary records constructed payload and signal, then explicitly rejects with code GENERATION_CANCELED/status499. Actual finally persists empty inFlight, clears controller, resets activeGenerations/videoProgress and calls the recording polling action. Tests assert two polling-start calls per generation, no timer, no pending promises, and that calling real abortFlight after completion cannot abort the retained signal. No success-generation or wire-serialization proof is claimed.

All16 receipts show clean component unmount/page/context close, zero console/page errors and no unexpected transport. Repository runner exited0 and owns browser teardown. No app server/provider process, live3333 access, external network request, user browser profile or HOME/state modification occurred. Captures are intentionally retained outside tracked sources.

## Evidence paths

Workspace root: task-owned managed checkout.

Evidence directory:`.codexclaw/wp3-ui-evidence/` contains build.log, root-focused.log, typecheck-tests.log, inventory.log, lint-focused.log, playwright.log, repo-discovery.log, line-counts.json and summary.json. Summary records source SHA256s,14 capture hashes/dimensions and16 clean receipts. Per-scenario sound-evidence.json and layout JSONs are under test-results/. Baseline failures and inspected390px captures remain under layout-before/ plus layout-before.log.

Suggested immutable PR evidence images (not committed here):

- `.codexclaw/wp3-ui-evidence/sound-ko-1280.png`
- `.codexclaw/wp3-ui-evidence/sound-ko-320.png`
- `.codexclaw/wp3-ui-evidence/sound-en-390.png`

Other nine inspected screenshots use sound-{en,ko,zh-Hans,zh-Hant}-{1280,390,320}.png in the same directory. PNG signatures, nonempty size and exact viewport dimensions were verified; all show composited real components with synthetic fixture data.

## Test changes and boundaries

Removed source-string assertions about component implementation, replaced with rendered behavior; locale tests compare actual preset keys with all four dictionaries. Added dated-alias and exact prompt composition assertions. No skipped tests or lowered thresholds. Initial harness fixes addressed JSON import attributes, request-type property inspection, and browser-only store initialization order/localStorage in root VM; no production defensive code was added for these fixture errors.

Owner search/read inputs:composePrompt, insertedPrompts, useComposerDrop, postVideoGenerateStream, readImageMetadata, store persistence/core selection, flightAbortRegistry, existing composer/manager harnesses and isolatedComponentTransport. Reuse sufficed for runtime behavior and network guards; a dedicated component fixture was necessary because the older composer fixture resets chips on mount and replaces generate before real prompt construction.

No git/branch/commit/push, orchestration/goal commands, child dispatch, provider calls, package installs or app restart were performed by this worker. Full-app hosted checks, main root suite, screenshot upload, external writes and release remain main-owned.

## WP3ARCH07 node visibility repair and re-freeze

After main's exposure finding, the new real-setUIMode regression failed with node uiMode and one visible sound group (expected zero). Plato ALIGNED/Gibbs PASS were forwarded before the production edit. SoundIntentPicker now calls every hook before returning null for node mode. No chip mutation, generation change or new payload field.

Focused RED/ GREEN logs: `.codexclaw/wp3-ui-evidence/node-mode-red.log` (exit1) and `node-mode-green.log` (exit0,1 passed). Fresh UI build passed, picker ESLint passed (`lint-node-guard.log`), and the entire component suite passed16/16 (`playwright.log`,7.8s). The regression asserts video panel stays visible, sound group disappears, main/chips/composed prompt/live lineage remain unchanged, classic selection returns with aria-pressed=true, and request count remains zero. No raw fixture mode injection.

New inspected captures: `.codexclaw/wp3-ui-evidence/sound-node-mode.png` and `sound-classic-restored.png` in the same directory. All12 locale/viewport captures were recaptured after the guard; changed PNGs were reopened with view_image, byte-identical ones matched the already inspected captures. Current summary and source hashes refer to this final16-test run. The 12 focused root tests/typecheck results above precede this guard-only production change; fresh full root gates remain main-owned after this freeze.

Implementation re-frozen. No further product/test edits pending from this worker.
