# WP4 — release pipeline recurrence hardening

Date: 2026-07-10
Class: C4 (release, registry authentication, package supply chain)
Branch: `dev` implementation; promotion ends with `main`, `dev`, and `preview`
at the same release commit.

## Loop spec

- **Archetype**: spec-satisfaction repair loop.
- **Trigger**: v2.0.8-v2.0.12 created remote tags/releases before deterministic
  install, test, and package-install failures completed; the user asked for
  structural/OIDC stabilization so this does not recur.
- **Goal**: create the release commit first, then create no stable tag or GitHub
  Release until that exact release-commit SHA passes a preview candidate publish;
  OIDC publishes only a checksum-recorded
  tarball that passed install smoke; completion waits for npm dist-tag,
  `gitHead`, integrity, and provenance proof.
- **Non-goals**: no app/UI behavior changes, no unrelated third-party dependency, no
  npm trusted-publisher identity/environment change, no GitHub ruleset change,
  no removal of the vendored `openai-oauth` patch.
- **Verifier**: release-contract unit/activation tests; npm 11 and npm 12 clean
  installs; full typecheck/inventory/test/build/package-install gates; live
  preview and stable GitHub Actions; npm registry metadata and attestation API.
- **Stop condition**: candidate and stable workflows are green; `preview` and
  `latest` point at packages whose `gitHead` is the same release-commit/tag SHA
  and whose integrity matches their workflow manifests; provenance proves the
  expected repository, `.github/workflows/publish.yml`, push event, source ref,
  source commit, and GitHub-hosted run identity; remote
  `main/dev/preview` resolve to the same release SHA at publish time (later
  descendant work is preserved, never rewound); this unit moves to `_fin`.
- **Memory artifact**: this document, `release-manifest.json` uploaded by the
  workflow, C-phase command evidence, and the D closeout appended here.
- **Expected terminal outcomes**: DONE; or BLOCKED if npm rejects the registered
  workflow identity/OIDC token despite the locally verifiable contract.
- **Escalation condition**: stop before publishing if the candidate SHA is not
  promotable to `main`, a tag is not contained in `origin/main`, a tested
  tarball digest changes, or registry/provenance identity disagrees with the
  workflow manifest.

## Previous D continuity

WP1-WP3 closed with GPT-5.6 model surfaces live, the patched OAuth proxy packed,
Luna/Terra image generation passing, v2.0.13 published to `latest`, a preview
package published, and devlog lanes cleaned. The next-direction evidence is the
failed v2.0.8-v2.0.12 release sequence: the release mechanism itself must prevent
remote release state from preceding verification.

## Evidence and root causes

### Live run taxonomy

| Versions | Failure class | Earliest missing guard |
|---|---|---|
| v2.0.8-v2.0.10 | npm 12 silently blocked `better-sqlite3`, `esbuild`, and `sharp` install scripts; fail-open rebuild did not restore bindings | exact npm runtime + explicit install policy + native import smoke before tests |
| v2.0.8-v2.0.11 | four deterministic stale contract assertions failed every CI lane | full `npm test` before stable tag/release |
| v2.0.12 | `openai-oauth` remained a `file:vendor` dependency without complete bundle metadata; packed install exited 254 | manifest/lock bundle parity + exact tarball install smoke |
| all five | `release.sh` created/pushed release state before CI/publish gates | preview candidate pass before version/tag/main promotion; wait for npm after tag push |

Run IDs and source URLs are recorded in the P-phase evidence ledger for session
`019f4847-431f-78d1-ac03-59d584b1d467`. npm's official trusted-publishing docs
require npm >=11.5.1, Node >=22.14, `id-token: write`, a GitHub-hosted runner,
and an exact registered workflow filename. The same docs use tag-push publishing
and state that trusted publishing automatically emits provenance for public
packages. Sources:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers
- https://github.com/openai/codex/releases/tag/rust-v0.144.1

### Threat model

- **Assets**: npm `latest`/`preview` dist-tags, immutable package versions,
  package bytes/provenance, Git tags/releases, and `main/dev/preview` refs.
- **Entrypoints**: local release scripts, `preview` pushes, stable `v*` tag
  pushes, GitHub Actions artifacts, and npm OIDC token exchange.
- **Trust boundaries**: local Git/gh → GitHub refs; checkout/build job → workflow
  artifact; publish job → npm registry; npm attestation → completion claim.
- **Failure/attacker capability**: wrong branch invocation, manual/arbitrary ref,
  prerelease tag, concurrent preview rerun, stale generated files, dependency
  script suppression, vendor bundle drift, artifact replacement, or OIDC issued
  to a broader-than-needed job.
- **Controls**: exact event/ref matrix, main ancestry, strict clean/tree-drift
  checks, unique run-based preview SemVer, exact Node/npm pins, explicit npm 12
  script allowlists, fail-closed native import, one packed artifact with digest,
  `id-token: write` only on the publish job, exact-ref/commit provenance
  read-back, and a completion-only recovery mode that cannot publish or move tags.

## Necessity gate and structural decision

- **Do nothing rejected**: v2.0.13 succeeded only after three release repairs;
  the unsafe ordering and preview collision paths remain executable.
- **Delete/configure/reuse**: reuse `publish.yml`, `release.sh`,
  `release-preview.sh`, and `package-install-smoke.mjs`; remove the stale direct
  publish behavior and `workflow_dispatch`; configure npm 12 `allowScripts`.
- **New owners justified**: add `scripts/release-contract.mjs` because event
  classification, preview versioning, tarball identity, registry verification,
  and workflow waiting are currently duplicated shell/YAML logic with no testable
  owner. Keep artifact parsing/digest and npm signature verification in the narrow
  `release-artifact-contract.mjs` and `registry-signature-proof.mjs` modules so
  every owner remains below the 500-line repository limit. No generic utility
  module is introduced.
- **Chosen boundary**: GitHub tag push triggers stable OIDC publish; GitHub
  Release is created only after registry proof. Preview remains a branch push in
  the same registered workflow file. The package job has no OIDC permission; the
  publish job receives the tested artifact and the short-lived token.
- **Rejected alternative**: keep `release: published` as the npm trigger. It
  necessarily exposes a GitHub Release before package validation/publish can
  finish, recreating the observed orphan-release state.

## Diff-level plan

### Release contract and workflow

- **NEW `.node-version`** — exact GitHub release runtime (`24.17.0`), separate
  from the package compatibility floor (`engines.node >=20`).
- **NEW `scripts/release-contract.mjs`** — exported pure contract functions and
  CLI subcommands:
  - classify only `refs/heads/preview` and stable `refs/tags/vX.Y.Z` push events;
  - reject manual/arbitrary refs, prerelease stable tags, tag/version mismatch,
    and tag SHA not contained in `origin/main`;
  - create unique preview SemVer with UTC date + `GITHUB_RUN_ID` +
    `GITHUB_RUN_ATTEMPT`, using package version when it is ahead of npm latest
    and next patch otherwise;
  - skip preview publishing when a tagged stable commit is merely synced back
    to the preview branch after `latest` already points to that version/SHA;
  - pack once, require both bundled dependencies, persist filename/version/
    SHA-512/integrity/git SHA in `release-manifest.json`, and verify the digest
    after artifact download;
  - wait for the matching workflow run and verify npm version, dist-tag,
    `gitHead`, integrity, and provenance before returning success;
  - decode the SLSA DSSE payload and require repository
    `lidge-ai/ima2-gen`, path `.github/workflows/publish.yml`, event `push`,
    exact source ref, exact resolved Git commit, GitHub-hosted builder, run URL,
    and subject SHA-512 equal to the release manifest;
  - expose completion-only verification used by `release.sh finalize`: require
    npm `latest` version/`gitHead`, immutable tag, and local HEAD to agree before
    GitHub Release creation or branch synchronization is allowed.
- **MODIFY `.github/workflows/publish.yml`**:
  - trigger on `push` to `preview` and stable `v*` tags only; delete
    `workflow_dispatch` and `release: published`;
  - channel-aware concurrency: cancel superseded preview runs, never cancel a
    stable tag run;
  - split `prepare -> package -> publish` plus `verify-existing`; only `publish` gets
    `id-token: write`;
  - pin Node from `.node-version` and npm from `packageManager`, use `npm ci`
    for root/UI, remove fail-open rebuild, and run native import immediately;
  - run source gates, pack once, install-smoke that exact tarball, generate an
    SBOM, upload/download the artifact, publish that tarball, then registry and
    provenance read-back.
- **MODIFY `.github/workflows/ci.yml`** — run on `dev` and `main`; use explicit
  Node/npm include lanes (`22.23.0 + npm 11.18.0`, `24.17.0 + npm 12.0.0`) on
  Ubuntu/Windows; use `npm ci` for UI and add native/install-policy gates.

### Local promotion flow

- **MODIFY `scripts/release-preview.sh`** — remove version commits, local
  `npm publish`, tags, main push, and prerelease creation. Require a clean
  promotable source SHA, run `verify:release` unless the caller already proved
  that exact SHA, push `HEAD:preview`, then wait for the preview package whose
  `gitHead` matches the SHA.
- **MODIFY `scripts/release.sh`** — require `main`, clean tracked+untracked tree,
  `origin/main` as an ancestor of HEAD, `origin/dev == HEAD`, and
  fast-forward-safe `preview`; determine the target version, create the
  `[agent] chore: release vX.Y.Z` commit locally, run full release verification
  on that commit, and fail if builds dirty tracked artifacts; push that exact
  release-commit SHA to preview and wait; only then tag the same SHA, atomically
  push main+dev+tag, wait for `latest`, create the GitHub Release, and reconcile
  dev+preview without rewinding descendants. No local npm credentials/publish. Add an explicit
  `release.sh finalize X.Y.Z` recovery mode that performs only registry/
  provenance verification, idempotent GitHub Release create-or-reuse, evidence
  attachment, and atomic dev/preview sync; it refuses to run if npm `latest`,
  `vX.Y.Z`, and HEAD do not already identify the same SHA, and it never invokes
  npm publish or creates/moves a tag.

### Dev → main handoff (same-SHA prerequisite)

- WP4 implementation is committed and pushed on `dev` first.
- Before stable release, fetch all three remote branches, switch the existing
  local `main`, and fast-forward it to `origin/dev` with `git merge --ff-only`.
  No merge commit, squash, cherry-pick, or rebase is allowed in this handoff.
- `release.sh` verifies `origin/dev == HEAD` before creating the one release
  version commit. The release commit then becomes the candidate SHA: preview
  publishes it first; the stable tag and `main` point to the exact same SHA;
  completion syncs `dev` and `preview` to it.

### Package and install policy

- **MODIFY `package.json` + `package-lock.json`**:
  - exact `packageManager: npm@11.18.0`;
  - exact `@openai/codex: 0.144.1` (current stable release, replacing
    non-deterministic `latest`);
  - promote the already-resolved `zod: 3.25.76` peer to an explicit runtime
    dependency so the bundled OAuth CLI resolves in consumer installs;
  - synchronize `bundleDependencies` so `progrok` and `openai-oauth` are in
    both manifest and lock root;
  - add pinned npm 12 `allowScripts` entries for reviewed native/build packages;
  - add `test:native-deps`, `test:install-policy`,
    `verify:release:source`, and `verify:release`; make `prepublishOnly` reuse
    the canonical release gate.
- **MODIFY `ui/package.json` + `ui/package-lock.json`** — pinned npm 12
  `allowScripts` for UI build dependencies with install scripts.
- **NEW `scripts/check-install-policy.mjs`** — compare every lockfile
  `hasInstallScript` dependency with exact approved entries and reject missing
  or stale approvals; also assert manifest/lock bundled-dependency parity. The
  custom checker supplements rather than replaces npm 12's own
  `approve-scripts --allow-scripts-pending` oracle.
- **MODIFY `tests/package-install-smoke.mjs`** — accept an externally packed
  tarball, preserve npm failure logs, pass explicit npm 12 global/local install
  approval, assert both bundled CLIs, and inspect the installed OAuth package
  for the ima2 patch metadata/header/version-floor markers.
- **MODIFY platform installers and mirrored `site/public` copies** — when npm
  major is 12+, pass `--allow-scripts=ima2-gen,better-sqlite3,sharp` to global
  install and require `ima2 doctor` to pass before launching the server.

### Regression tests, local state, and source of truth

- **NEW `tests/release-pipeline-contract.test.ts`** — activation matrix for
  valid/invalid events and refs, main ancestry failure, same-day/rerun preview
  uniqueness, post-release preview skip, manifest-integrity mismatch, package
  install-policy drift, and source assertions that direct local publish/manual
  OIDC paths cannot reappear.
- **MODIFY `.gitignore`** — ignore `.codexclaw/` so strict untracked-file release
  preflight can include every real source file without being blocked by local
  session evidence.
- **MODIFY `CHANGELOG.md`, `docs/README.ko.md`,
  `structure/06-infra-operations.md`** — document the candidate → tag publish →
  registry proof → GitHub Release → branch sync order, exact toolchain, npm 12
  installer policy, tested-artifact identity, and current test count.
- **MODIFY `devlog/_plan/README.md`, `structure/07-devlog-map.md`, this unit** —
  record C evidence and move the completed unit `_plan` → `_fin` only after the
  live release proof passes.

## Activation and acceptance matrix

| Conditional path | Trigger | Observable proof |
|---|---|---|
| preview publish | push untagged candidate SHA to `refs/heads/preview` | unique prerelease published; dist-tag `preview`; `gitHead == SHA` |
| preview collision guard | two prepares with same date/base but different run ID/attempt | two unequal valid SemVer strings |
| post-release sync skip | preview push of stable-tagged SHA already at npm latest | prepare output `should_publish=false`; no registry write |
| stable publish | push `vX.Y.Z` whose version matches package and SHA is in origin/main | exact tested tarball at `latest`; integrity and `gitHead` match |
| event/ref rejection | manual event, arbitrary branch, prerelease tag, mismatch, non-main tag | contract command exits nonzero before OIDC/artifact publish |
| OIDC permission | publish job only | `ACTIONS_ID_TOKEN_REQUEST_URL` absent in package job and present in publish job |
| provenance identity | published preview/stable package | npm signature audit verifies Sigstore; decoded DSSE proves schema, repo, workflow path, `push`, exact ref, exact commit, original GitHub-hosted run/attempt, and manifest SHA-512 |
| npm 12 script policy | clean root/UI `npm ci` under npm 12 | npm's pending-approval command returns an empty set; custom parity check, native import, and UI build pass |
| vendor bundle guard | remove either bundled name or patch marker in fixture/source | focused contract fails before pack/publish |
| artifact identity | mutate downloaded tarball after manifest creation | verify command rejects digest; registry integrity equals manifest on success |
| local branch guard | invoke stable release outside main or with dirty/unpushed/divergent refs | script exits before preview/tag/push |
| completion-only recovery | npm succeeded but local process stopped before release/sync | `release.sh finalize X.Y.Z` creates/reuses only matching GitHub Release/evidence and syncs branches; mismatch fails without registry/tag writes |

Cross-channel identity acceptance: `npm view ima2-gen@preview gitHead`,
`npm view ima2-gen@latest gitHead`, `git rev-list -n1 vX.Y.Z`, and the local
release commit must all be byte-identical SHA strings.

## Verification commands

```text
node --test --import tsx tests/release-pipeline-contract.test.ts
npm run test:install-policy
npm run test:native-deps
npm run typecheck
npm run typecheck:tests
npm run test:inventory
npm test
npm run verify:release
npm audit --audit-level=high --omit=dev
npx --yes --package npm@12.0.0 npm approve-scripts --allow-scripts-pending --json
npx --yes --package npm@12.0.0 npm --prefix ui approve-scripts --allow-scripts-pending --json
bash -n scripts/release.sh scripts/release-preview.sh
```

CI/live proof:

```text
gh run watch <preview-run> --exit-status
npm view ima2-gen@preview version gitHead dist.integrity
gh run watch <stable-tag-run> --exit-status
npm view ima2-gen@latest version gitHead dist.integrity
GET https://registry.npmjs.org/-/npm/v1/attestations/ima2-gen@<version>
git ls-remote origin refs/heads/main refs/heads/dev refs/heads/preview
```

## Rollback/recovery

- Before tag push: a failed preview candidate leaves npm `latest`, remote main,
  stable tags, and GitHub Releases unchanged. Its release commit may exist only
  on local main and remote preview; fix forward without changing its version,
  rerun verification, and preview the new exact SHA before tagging.
- After atomic main+tag push but before npm success: no GitHub Release exists;
  preserve the failed tag as evidence, fix forward, and release the next version
  (npm versions/tags are never rewritten).
- After npm success: registry versions are immutable. If branch sync or GitHub
  Release creation fails, run `./scripts/release.sh finalize X.Y.Z`; its
  precondition is npm `latest gitHead == vX.Y.Z SHA == HEAD`, and it cannot
  republish or create/move the stable tag.

## B implementation evidence — 2026-07-10

The release surface now has one tested owner, `scripts/release-contract.mjs`.
It classifies push refs, generates collision-free preview versions, injects the
source SHA into the package tarball, records and rechecks SHA-512, waits for the
matching Actions run, and validates exact npm metadata plus SLSA repository,
workflow, ref, commit, original run/attempt, builder, subject, and digest identity.
`publish.yml` is split into prepare/package/publish/verify-existing jobs and grants
`id-token: write` only to publish. Local scripts contain no executable
`npm publish` path and require the pinned Node/npm pair.

Independent Sol review found and the implementation closed additional release
blockers: stable publishing now requires signed npm preview proof plus exact
`main/dev/preview/tag` refs; already-published reruns execute a verify-only job;
finalization derives the original attempt from provenance and no longer scans a
30-run window; remote tags are verified and GitHub Release creation uses
`--verify-tag`; descendant branch work is preserved instead of rewound; every
GitHub Action is pinned to a full commit SHA. npm CLI signature audit now
cryptographically verifies the package's Sigstore provenance in addition to the
explicit in-toto/SLSA field checks.

A final Sol rerun audit exposed two additional P1 recovery defects. npm 12 emits
keyed-object JSON from `npm pack --json`, while npm 11 emits an array; the shared
artifact parser now accepts both shapes and the real npm 12 tarball smoke passes.
GitHub's failed-job-only rerun preserves successful `prepare` outputs, so a
publish job that had already written npm could otherwise try the immutable
version again. The publish job now performs a live registry guard immediately
before `npm publish`: an existing package must match artifact integrity,
dist-tag, `gitHead`, and signed original provenance before publish is skipped;
only a previously absent version may publish, and that path must prove the
current Actions run/attempt. Full-workflow stable reruns retain the separate
`verify-existing` path.

Activation work found and closed three defects that source-only tests did not
expose:

- the bundled OAuth CLI needed its already-resolved `zod@3.25.76` peer promoted
  to a direct runtime dependency;
- stale local `node_modules/@openai/codex@0.136.0` correctly caused CycloneDX
  generation to fail against the `0.144.1` lock until a clean `npm ci`;
- npm 12 accepts `--allow-scripts` for global installs but requires a project
  `allowScripts` manifest for project-scoped tarball installs, so package smoke
  now models that distinction explicitly.
- preview run `29065289126` proved the package/OIDC preconditions but exposed an
  npm package-spec ambiguity: `release-artifact/file.tgz` was parsed as a GitHub
  shorthand and attempted SSH `git ls-remote`. The workflow now publishes the
  explicit local path `./release-artifact/file.tgz`, and the source contract
  prevents that prefix from regressing.
- dev CI run `29066079916` exposed two cross-platform contract splits before
  stable promotion: Windows cannot execute `.cmd` shims through bare
  `spawnSync`, and the older package-content smoke still assumed npm 11's array
  JSON. npm subprocesses now invoke `npm-cli.js` through Node via
  `npm-subprocess.mjs`; bundled CLIs execute their declared JS bins instead of
  shell shims. Both release and package-content smoke reuse the same npm 11/12
  artifact parser, with no `shell: true` argument-flattening path.

Local evidence:

- Node `24.17.0`, npm `11.18.0`: `npm run verify:release` passed typechecks,
  inventory, UI/server/CLI builds, 1087/1087 tests, package lint, install policy,
  audit with zero vulnerabilities, and installed-tarball server smoke.
- npm `12.0.0`: clean root/UI `npm ci`, native imports, pending-script oracle,
  UI build, typecheck, release-contract tests, keyed-object package packing,
  project-scoped tarball install, and registry-style global install all passed.
- `release-contract pack` produced a digest-verified tarball with embedded
  `gitHead`, both bundled CLIs, direct `zod`, and a valid CycloneDX 1.5 SBOM;
  the exact artifact passed the installed-package server smoke.
- preview run `29066108224` published
  `2.0.14-preview.260710.29066108224.1` from `c5b1972`, then verified the
  dist-tag, embedded `gitHead`, SHA-512 integrity, exact run/attempt provenance,
  and npm Sigstore signature. This is the first live activation of the hardened
  tested-artifact/OIDC path.
- `actionlint`, YAML parse, shell syntax, installer mirror parity, module-size
  limits, and
  `git diff --check` passed. Windows PowerShell execution remains delegated to
  the required Windows CI lanes.

Live preview/stable run URLs, npm versions/integrities, and final branch SHA are
recorded in D after remote activation.

## A-round 1 synthesis

Reviewer verdict: FAIL, three blocking root causes. All are accepted and folded
into the plan above.

1. **Same-SHA contradiction — accepted**: the earlier order previewed the
   pre-version source and then created a different stable release commit. The
   amended order creates the release commit first, previews that exact SHA, and
   tags/publishes the same SHA. The dev → main fast-forward handoff is now
   explicit.
2. **Weak provenance proof — accepted**: workflow filename alone cannot prove
   the intended activation. The amended contract decodes the SLSA attestation
   and verifies event, ref, resolved commit, repository, builder/run, and subject
   digest.
3. **Recovery was prose-only — accepted**: `release.sh finalize X.Y.Z` is now a
   named completion-only operation with registry/tag/HEAD identity preconditions
   and no publish/tag mutation path.

Medium residuals were also accepted: C now invokes npm 12's own pending-script
oracle for root and UI, and the branch handoff preserves SHA identity. The Codex
pin was rechecked immediately before implementation: npm and the official
openai/codex release both report stable `0.144.1` on 2026-07-10.

## C extension checkpoint — 2026-07-10

Terminal outcome: **REOPENED BEFORE ARCHIVE** after a Windows update regression
was reported.

The hardened release flow completed end to end from the release commit
`bea7ae5b5ea0a6e9039732794d2bdeb939e429b3`:

- preview run `29067112427` published
  `2.0.14-preview.260710.29067112427.1` with `gitHead == bea7ae5`,
  integrity `sha512-UcsSCayYLtUdKTFVnGSB7dMv2HmBqhOH64tE2PoJ+LiNKMi5+stxESyPE2RjaZxi8DswvL9MGuc4Yuo4/4s2LQ==`,
  and verified npm/Sigstore provenance;
- stable run `29067267628` published `ima2-gen@2.0.14` to `latest` with
  `gitHead == bea7ae5`, integrity
  `sha512-qkNuz/hfvR9SEACQABjOOiMhaVpj/F7ysUXkQb50autCgrwTYOkDL7rhMlZIh5Grdw47nq87BSaJCWh21HfViA==`,
  and verified npm/Sigstore provenance;
- `refs/heads/main`, `refs/heads/dev`, `refs/heads/preview`, and
  `refs/tags/v2.0.14` all resolved to `bea7ae5` at publish completion;
- release-commit CI runs `29067267405` (`dev`) and `29067267733` (`main`)
  succeeded. The dev run exercised Ubuntu and Windows with Node 22/npm 11 and
  Node 24/npm 12, including real package-install smoke in all four lanes;
- GitHub Release `v2.0.14` was created only after registry proof and carries
  `release-manifest.json` plus `sbom.cdx.json` as evidence assets.

Independent post-release commands repeated the registry, tag, integrity,
provenance, branch, CI, and GitHub Release checks. `release.sh patch` exited 0
only after all of those checks and branch reconciliation completed.

Published-package runtime activation also passed after restarting ima2-gen
`v2.0.14` on `http://127.0.0.1:3333`:

- Luna request `req_cli_gen_mreejnnx_fotkio` used provider `oauth`, model
  `gpt-5.6-luna`, and quality `medium`; it returned HTTP 200 with one image in
  22.6 seconds. The PNG is 1402x1122 with SHA-256
  `56e15ea5615982b9990f0ec1b482728e20f6b0cf67ea12d5dee9c3ad6b92273f`.
- Terra request `req_cli_gen_mreen9m1_n6foap` used provider `oauth`, model
  `gpt-5.6-terra`, and quality `medium`; it returned HTTP 200 with one image in
  63.0 seconds. The PNG is 1122x1402 with SHA-256
  `318928b86e3bfafec8ebb9d699b4673448c96459690c2617eb0982a87e1c089e`.
- The final service runs under launchd label `io.ima2.server`; `ima2 ping`
  reports `v2.0.14` healthy with zero active jobs after generation.

The previous invalid-parameter failure is closed at unit, package, OIDC workflow,
registry, and live runtime levels. The unit remains in `_plan` until the Windows
package-local OAuth corrective release is independently proven.

### Windows package-local OAuth root cause

The `v2.0.14` tarball contains both `@openai/codex` and `openai-oauth`, so package
omission was rejected. The Windows global install exposes only `ima2.cmd` at the
prefix root; the dependency's `codex.cmd` stays inside
`ima2-gen/node_modules/.bin`. `codexDetect.ts` searched global PATH instead of
that package-local dependency, then attempted to execute `.cmd` directly even
though Node 24 on Windows rejects that path with `EINVAL`/`ENOENT`. The device
login route had the same direct-shim defect, while the release server smoke set
`IMA2_NO_OAUTH_PROXY=1` and never exercised either path.

The fix resolves each dependency's declared JavaScript `bin` from its installed
package manifest and invokes it with `process.execPath`. Status, setup/login,
Switch Account device auth, and proxy startup no longer depend on PATH, `npx`,
or `.cmd` shims. A first implementation incorrectly accepted keyring-only Codex
authentication; independent Sol review rejected it because the bundled
`openai-oauth` package enumerates filesystem candidates and exits when no
`auth.json` exists. The final implementation separates general Codex auth from
proxy readiness, forces `cli_auth_credentials_store="file"` for both login
flows, passes the detected file explicitly with `--oauth-file`, and diagnoses
keyring-only sessions without starting a false-ready proxy. A new release
`windows-consumer` gate updates an isolated real global install with the exact
release tarball on Node 22/npm 11 and Node 24/npm 12 before OIDC publish is
allowed.
