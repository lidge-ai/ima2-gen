# WP13 P — merge and release revalidation

Class C4; satisfy-spec. Trigger: owner requires the complete roadmap, >=10
implementation PR merges, main/preview integration and actual deployment before
termination. Goal: deliver the verified studio and published installers, not
merely green source CI. Non-goals: new product features, test-framework expansion,
matrix/timeout/rule weakening, direct npm publish, forced shared refs, paid
generation, personal app/account/3333 access, and **all heartbeat automation**.
Memory/evidence:130, this amendment,131/132, goalplan/ledger and ignored wp13
snapshots. Verifiers: exact-head existing CI, registry/tag/provenance contracts,
installed-artifact UI and deployed installer bytes. Stop only after actual merge,
release and deployment proofs; pending approval/failed prerequisite is
NEEDS_HUMAN/NO-GO, not completion. Main owns every remote decision/action; Astra
high leaves may audit or implement disjoint bounded files, never release or spawn.
Main reclaims after two failed agents. Bounds: existing origin/account/hosted
Actions, task-owned temporary data, zero paid generations, no numeric token budget;
reassess this WP at4h and whole goal at72h.

## Continuity and live baseline

125_6 concludes: WP12s verified at b1432ba38b377d8732d94a9e17301e94eb988a03;
all6 CI34044138017 jobs, all3 PR34044139561 jobs, AgY34044139565, focused6HTTP+
33UI and exact CodeQL analysis1732180126 pass.266 full E2E cases passed.105's
real token-guess issue was repaired, then its residual custom-model warning was
owner-authorized/dismissed only after all gates passed.106 source assertion was
corrected;57 other open branch alerts retain WP12's source triage, not a blanket
waiver. Two final visual readers and main opened original artifacts. Historical
MCP timeout remains an explicitly approved follow-up, not a solved cause.

WP12s closed C->D->IDLE, c-15 met; WP13 entered P. Current local branch is the
new task-owned `codex/prod-wp13-release`, initially at b143. The preceding D doc
will be committed with this P documentation, not by moving PR217's verified head.
Untracked scripts/recording and user data remain untouched.

Live refs after fetch:

| Ref | SHA |
|---|---|
| origin/main |d2afe6b2aa7d006e2cd9765aa632714f96435db2 |
| origin/preview |d2afe6b2aa7d006e2cd9765aa632714f96435db2 |
| origin/dev |66a4f9989e14f8bacd657f7d6c7c82599ae8ecb4 |
| PR217 |b1432ba38b377d8732d94a9e17301e94eb988a03 |

dev's delta is the already-approved CI-history prerequisite214 and prior release
closeout docs. Existing stable GitHub Release is v3.13.1, non-draft/non-prerelease.
Registry latest3.13.1 and preview3.13.1-preview.260904.33885929065.1 both identify
d2afe6b2. Stable rollback integrity:
`sha512-88C+Y0+ImW4Huh+ECfCOunuDFgp17OYZcuSE7Y4NoaH4GmlezkXcyaR//DU6hdhEz1MhCMgn/2L7O6Ig3mgwtg==`.
Remote Pages is workflow-built at https://lidge-ai.github.io/ima2-gen/.
Repo allows merge commits and does not auto-delete branches. No settings changed.

## Actual topology / authority prerequisite

Successful REST inspection shows an existing **GitHub native stack216**, base dev,
open, ordered199,198,200,201,202,203,204,205,206,207,208,209,210,211,212,213,215.
PR215 is still draft at2f8b4823; PR217 is ready, manual child of215, `stack:null`.
The old130 legacy `gh pr merge` procedure cannot be used for those17 registered
members. Native opt-in is not inferred from generic stack/merge authority.
Main asked the owner specifically whether to use the existing native stack216;
its writes remain gated on that answer. No membership addition/removal/reorder is
proposed, and no unsupported legacy merge is attempted as a probe.

If authorized, verify each current head, all gates/reviews and ancestry, make215
ready during B, then request the native prefix ending at215 once via merge-async
with its reviewed head. Poll its returned operation UUID;202 is not merged.
Read back each of17 PR merge SHAs and prove ancestry in freshly fetched dev.
Then retarget217 to dev, inspect its layer-only diff/current synthetic merge
checks and merge normally with match-head guard. Keep all parent branches.
199/198 are prerequisite/docs and do not count;200–213 plus215/217 provide16
implementation PRs. Native denial/failure causes inspection, not dissolution,
admin bypass or silently switching methods.

The WP13 delivery PR will be a normal child of217. Publish only after audited B
changes; then retarget to dev after217 lands and merge on exact-head proof.
Promote dev to main via an explicit normal PR and complete-diff review. Re-read
refs; main must contain dev and preview before cutting. Do not push preview
manually ahead of canonical release: that branch push publishes. release.yml
already promotes the exact candidate to preview after its CI gate.

## Exact change map (no production feature change)

1. `CHANGELOG.md`: add a bounded production-readiness subsection to existing
   Unreleased, covering delivered provider/selection/lifecycle/composer/media/
   diagnostics/install/LAN changes and HTTP trusted-network limitation. Preserve
   historical entries; no invented published version/date. Minor bump is intended
   from observed3.13.1 (workflow owns actual version), subject to live recheck.
2. `131_release_readiness.md`, `132_release_receipt.md`, `000_plan.md`: record
   exact PR/base/head/merge/run proof, GO/NO-GO, rollback, publisher/deployment.
   No placeholders may be promoted to evidence; not-yet-created identifiers stay
   explicitly pending until actual operations return them.
3. `structure/06-infra-operations.md`: document only the final delivered published-
   artifact inspection invocation if added; existing publisher/Pages contracts stay.
4. Reuse `tests/package-install-smoke.mjs`'s already-owned installed server for the
   missing final **published artifact UI** proof. Add one opt-in call after first
   health success, before its existing kill/finally cleanup. Default source/publish
   smoke behavior is unchanged. `IMA2_PACKAGE_UI_OUTPUT_DIR` is test-process-only,
   not product config or a production test flag. No strict source-appProjection
   receipt is invented for an installed package.
5. One small `scripts/package-published-ui-smoke.mjs` helper exports
   `inspectPublishedUi({baseUrl,packageRoot,version,sourceSha,driverSha,artifactKind,outputDir})`. Reuse the
   existing pinned UI Playwright installation, a fresh browser/context and the
   installed package's actual assets. Bind health/version/package gitHead and
   loaded JS/CSS bytes to the installed `ui/dist` manifest; capture desktop1157x826
   and mobile390x844 NovelAI positive/negative inputs and visible toolbar. Fill
   synthetic text only, exercise toolbar by trial hit-test, do not generate or
   perform account/provider mutations. Record actual observations/timestamps and
   PNGs; close browser in finally. No new runner, dependency, broad test matrix,
   benchmark, fuzzer or parser/guard framework.
6. One manual-only `.github/workflows/published-ui-smoke.yml` executes that existing
   package smoke after stable publication. Inputs exact release_sha/version;
   read-only contents permission; existing pinned Node/npm/actions/Playwright.
   Checkout and record the workflow's exact **driver** SHA; product release SHA is
   a separate input verified against its tag/registry/provenance. Validate inputs,
   fetch the release manifest from GitHub and exact TGZ from the npm registry
   (`npm pack package@version --ignore-scripts` is artifact download only), then
   verify artifact bytes and registry/provenance
   with existing release-contract commands, then pass the verified TGZ and output
   directory to package-install smoke. Upload originals/JSON on completion/failure.
   No schedule/heartbeat and no publication/approval writes in this workflow.

   Observed v3.13.1 GitHub assets contain release-manifest.json and sbom.cdx.json,
   **not** a TGZ, so do not plan a nonexistent GitHub tarball download. Validate
   manifest name/version/gitHead/expected basename before path use, then use the
   existing digest verifier on the downloaded npm bytes. Source driver and installed
   product identities must both be recorded. The existing package smoke's GITHUB_SHA
   input is set to product RELEASE_SHA for that one child process; retain actual
   QA_DRIVER_SHA separately, never assert the driver checkout is the product.
   The new driver is first exercised against a **packed current candidate**, then
   against the new stable artifact. Published3.13.1 lacks the current required
   doctor installation mode, so it cannot reach this hook through the unchanged
   current package smoke. Do not skip that doctor check or add a historical
   compatibility path. Do not claim candidate screenshots prove publication.

This small opt-in capture is directly required by130's published-package UI exit
criterion; source ui/dist/J9 screenshots cannot prove what users install. It is
not a new general verification platform. If an equivalent existing invocation is
discovered, reuse it and drop this proposed helper rather than duplicate it.
No edits to release.yml, publish.yml, Pages gates, required-units or API/DB code.

Field chain for the only new test option: manual workflow writes
IMA2_PACKAGE_UI_OUTPUT_DIR -> package-install-smoke reads it -> passes explicit
args to capture helper -> PNG/JSON artifacts -> main/independent visual readback.
Absent option performs no browser work. No product serialization/reviver change.
Driver SHA and product release SHA follow distinct fields into the JSON receipt;
neither may be substituted for the other. The added helper is excluded by the
existing explicit npm files allowlist and adds no shipped runtime dependency.

## Conditional verification / known bypasses

- Wrong SHA/tag/manifest/digest: existing release-contract validation must fail
  before installed UI is trusted. Missing runtime/browser/manifest also fails;
  there is no source-UI fallback. Validate the helper with an existing packed
  candidate before relying on post-publish evidence where feasible; never label
  that pre-release run as published-package proof.
- UI absent/negative hidden/controls clipped or asset mismatch: capture failure,
  retain actual error, close owned browser/server; do not accept screenshot alone.
- Failed native merge/promotion/protection: stop that mutation, inspect returned
  state, never admin-bypass or force shared main/dev/preview.
- Publication already exists: immutable guard/verify-only recovery, never republish
  or move an existing stable tag. If source must change, new scoped PR/cut.
- Approval pending: exact authorized environment/run only; declined/absent approval
  is not success. Owner already authorized release approvals for this delivery.
- Pages delayed/mismatch: keep goal open until workflow succeeds and live installer
  bytes match release source. Forward repair only; no old-site rollback claim.

Evidence tiers: GitHub required checks and artifact digest comparison are executed
gates; main/reviewer source/visual judgments are human/model review, not unbypassable
enforcement. An authorized admin could bypass repository policy, but this task will
not. Screenshot stills do not certify arbitrary viewports, real provider billing,
production TLS certificate UX or every keyboard path. Zero paid calls remains hard.

## Verifier preflight actually performed

- `node --import tsx --test tests/release-pipeline-contract.test.ts`:34/34 pass,
  exit0. Reads actual release/publish/CI YAML and exported provenance/digest/event
  functions; no publishing or application runtime was invoked.
- `node scripts/release-contract.mjs assert-toolchain`:exit0, Node24.17.0/npm11.18.0.
- `node scripts/release-cut.mjs assert-baseline`:expected exit1 on this feature
  checkout because HEAD is not origin/main. The guard observes live named refs;
  this is NOT a release-ready result. Workflow will run it on integrated main.
- Registry latest/preview and GitHub Release/Pages metadata read directly above.
- Future release/manifest/installed UI finalizers are NOT RUN: future version and
  publisher artifacts do not exist yet. Their inspected entrypoints consume exact
  version/SHA/manifest paths. Canonical cut is an authorized B operation, not a
  verifier to execute during P.

## B/C/D delivery sequence

Audit this revalidation independently. In B implement only the listed notes and
bounded installed-artifact capture; verify syntax/targeted tests, checkpoint and
publish the child PR. Refresh all layer proofs and authority before native/manual
merges. Fold current review comments by code/evidence, not by expanding scope.
After dev/main integration and frozen GO, dispatch canonical release.yml on main
with bump=minor,dry_run=false,expected_sha=the exact integrated main SHA. Record
version commit, candidate CI, preview publisher, stable environment approvals,
stable publisher, signed artifacts and Release. Then run published UI and Pages
deploy; fetch public installer bytes with bounded cache bypass and compare hashes.

D closes only with actual16 implementation merges (minimum10), main/dev/preview/tag
agreement or explicitly explained later ancestry, canonical stable+preview registry
proof, installed artifact UI/readback and deployed Pages installer parity. Then
archive completed devlog once, update pointers, validate goalplan E8 and complete
the host goal. No further feature/test-framework work is opened to improve scores.

## Late PR217 review to fold during A

After217 became ready, Codex comment3944573198 identified a real producer/CLI
consumer mismatch at bin/lib/client.ts:50–65. checkAccess labels every401/403 as
LAN access, but lib/generationErrors.ts:139 and provider execution admission
legitimately produce provider credential401s. A loopback bad provider key must
not tell the operator to configure a LAN token. The earlier broad CLI mapping
plan does not rebut this producer evidence.

Add only `bin/lib/client.ts` and its existing `tests/cli-lan-auth.test.ts` to
the release-prep correction map: distinguish actual fixed LAN/Host/Origin guard
codes from provider-domain401/403, preserve actionable provider code/message and
downstream body handling, and retain safe generic/malformed auth refusal and
aborted-body semantics. No credential forwarding, origin binding, server/API/DB
schema, or new error framework. A scoped CLI reviewer is deriving the minimum
algorithm and negative proof before implementation. This supersedes130's blanket
no-code statement only for this concrete late compatibility finding. It lands
in the release-prep child, with cumulative exact-head checks before merge/cut;
WP12s's b143 proof is not retroactively called proof of the new correction.

## A fold — installed UI activation and candidate exercise

Both auditors independently rejected the3.13.1 driver-preflight assumption; accept
that finding and remove the claim, not the doctor gate. The one manual workflow
has an explicit acquisition choice `candidate|published` (default published).
This is not an old-version compatibility mode or a fallback after failed proof:
both paths run the identical unchanged installation smoke and UI helper.

- Candidate acquisition: exact driver checkout, existing pinned dependencies and
  Chrome; `release-contract.mjs pack` builds/packs that checkout and embeds its
  real gitHead. Verify the generated manifest/TGZ, label evidence `candidate` and
  pass its real SHA/version to the smoke. No registry/signature/publication claim.
- Published acquisition: explicit validated release version/SHA, exact tag match,
  GitHub manifest + npm TGZ, manifest-aware `verify-registry` (not just separate
  finalize/digest checks) and `verify-artifact`. Do not set
  IMA2_EXPECT_CURRENT_PROVENANCE=true: QA is not the publisher. Pin npm registry
  to registry.npmjs.org. Missing TGZ is a failure, never source-pack fallback.
- Workflow input -> acquisition -> test env -> helper args -> JSON carries
  artifactKind, product SHA/version, actual driver SHA and publisher identity
  when published. Goal completion requires published-kind proof; candidate-kind
  cannot satisfy that row. No change to standard source/publish CI matrices.

Concrete renderer activation, copied from existing J7/J6 contracts rather than
invented later: fresh context per1157x826 desktop and390x844 mobile; pre-navigation
synthetic localStorage keys `ima2.locale=en`, `ima2.onboardingDismissed=1`,
`ima2.uiMode=classic`, `ima2.workspaceProfile=default`,
`ima2.activeSessionId=wp02-session`, `ima2.imageModel=nai-diffusion-5-full`,
`ima2.generationDefaults={provider:nai,multimode:false}`. Seed only the owned origin.
Reuse the pure `readFixtures` data export from `ui/e2e/fixtures/j6Catalog.ts` for
catalog/provider/status responses; do not import its source-app lifecycle.
Native `/api/health`, `/api/auth/lan/session` and installed static JS/CSS remain
unmocked. Fulfill other known GET fixture shapes, explicitly cover history/events
as in J6, and fail unexpected API/external requests. Block all browser mutations,
especially generation/account actions. Never start withJ6/startApp/appProjection.

Desktop root: `.sidebar__scroll > .composer--sidebar`. Mobile: click
`button.mobile-app-bar__generate`, require `#mobile-generate-sheet[aria-hidden=false]`
and selected `#mobile-sheet-tab-prompt`, then use that sheet's visible composer.
Within either root fill `.composer__textarea` and `.negative-prompt__textarea`,
require both visible with preserved values, capture their bounds/scroll geometry
and toolbar. Scroll controls into view; trial-click only enabled
`.composer__toolbar button` controls, record disabled controls without enabling
them or submitting. Capture actual screenshots for main review of the original
spacing complaint. This is one non-generating flow at two sizes, not a new
provider/state/viewport permutation suite. Browser closes before existing
package-smoke server/root finally cleanup; evidence output is outside its removed
temporary install root. All capture assertions retain their real errors.

## A fold — provider-auth identity without server runtime imports

Accept CLI-AUTH-1 Medium. Read the actual producers, not just the bot's wording:
core auth401 includes four statusForErrorCode cases, and direct Grok admission
uses the **flat** `{error:string,code:string}` shape; nested `{error:{code,message}}`
is also used. HTTP status alone does not identify the LAN boundary.

Within checkAccess, parse an auth body once, outside the eventual throw. Recognize
flat and nested object envelopes explicitly; reserved LAN/Host/Origin codes have
priority and always use fixed safe text, even with malicious extras. Inconsistent
reserved status/code, malformed/unknown envelopes or aborted/unreadable bodies
use neutral fixed SERVER_ACCESS_DENIED with the observed401/403, never a fabricated
LAN identity, reflected unknown code or raw body. Success/non-auth bodies remain
unread. For a recognized server-domain code and nonempty string message, throw the
existing typed transport error preserving code/message/status and ordinary error
body contract. Recognition is not a guarantee against a compromised configured
server; true access envelopes/generic bodies still never expose their payload.
No clone-and-return of a consumed response or new error framework.

Main inspected the proposed import closure: generationErrors imports responsesParse,
which imports inflight/logger, so do not pull that owner into the minimal CLI
transport. Move the existing pure statusForErrorCode function unchanged into the
existing pure `lib/errors/providerMap.ts`, which imports only type data plus the
pure RESPONSE_DIAGNOSTIC_CODES owner. generationErrors imports and re-exports it
under its existing API and keeps its other diagnostic-code use unchanged. CLI
uses `statusForErrorCode(code,0)===401 || Object.hasOwn(PROVIDER_ERROR_MAP,code)`;
no new copied four-code registry or prefix/uppercase heuristic.

Exact added relocation/fixture paths: `lib/generationErrors.ts`,
`lib/errors/providerMap.ts`, and any already-existing standalone CLI emitter
(`tests/cli-lan-auth.test.ts`, `tests/cli-model-resolver.test.ts`) that must emit
the now-reachable pure map/responsesErrors modules. No extra runtime/config import
or fixture framework. Verify all consumers of statusForErrorCode retain its export.
Regression rows in the existing mock file: actual flat/nested provider401 and one
registered domain403, raw/SSE/MCP body/cleanup, poisoned true LAN/Host/Origin,
unknown/malformed envelopes, aborted401/403 body (generic access, never unreachable),
readable200 and preserved ordinary400/409/onePOST behavior. Literal expectations
come from real producer contracts, not the classifier under test.
