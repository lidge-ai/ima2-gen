# 3.26.2 publication evidence

Published on 2026-10-04 KST from `48620f62b64a265b7e80f2089c4e0eab5d70fe6a`.
npm latest, the public desktop release, update manifests, and Pages are verified.
The installed npm artifact also passed its hosted UI smoke. No local app installation,
paid provider generation, or user-machine desktop update was performed.

## Accepted changes and gates

PRs #369 (dependencies/security), #370 (OAuth job/retry deadline), #371 (audio
feedback and sound-intent chips), and #372 (dry-run promotion guard) landed on dev.
Original PRs #360–364 were carried with attribution and closed as superseded.
Issue #351 is closed after publication; #338 and #150 remain open for the distinct
execution-recovery and provider-adapter designs documented in 001_triage.md.

The safety change passed 23 focused release-command tests, the canonical suite
(4,144 total, 4,141 pass, 3 skip, 0 fail), typechecks, lint, inventory and audit gate.
Independent implementation review passed. Real negative CLI QA on `2cbbe96e`
confirmed that dry-run promotion exits 2 without changing remote refs or releases.
The earlier HTTP and rendered interaction evidence remains in 000/025/032.

PR #372 merged as `28f8d996c29df8588bf54d08bc9136696fdacf7d` after its exact-head
gates passed. Dev push CI [37144710914](https://github.com/lidge-ai/ima2-gen/actions/runs/37144710914)
ran all eight jobs successfully; Agy 37144710918, CodeQL 37144710950 and the
path-filtered desktop workflow 37144710946 also succeeded. The desktop build matrix
was intentionally skipped on that safety-only push; the actual release matrix below ran.

Promotion PR #373 passed all four Fast Gate jobs in
[37144946035](https://github.com/lidge-ai/ima2-gen/actions/runs/37144946035), CodeQL
37144946036 and the latest screenshot gate 37145146291, then merged with a pinned
head as `28b06847c2efdf2d937c919e83a1dee684f85413`. No native stack membership or
unresolved review threads remained. Main push CI
[37145947274](https://github.com/lidge-ai/ima2-gen/actions/runs/37145947274) passed all
eight jobs; CodeQL 37145947326 passed. These are attempt 1 runs. The release commit
changes only package.json and package-lock.json version fields from this parent.

## Published artifact identity

The authorized command was `GH_REPO=lidge-ai/ima2-gen GH_HOST=github.com npm run release -- patch --approve --yes`.
No automatic promotion flag was used. The wrapper exited 0 and approved only this
release's npm-stable and desktop-production environments.

| Proof | Run, attempt 1 | Outcome |
|---|---|---|
| Release orchestration | [37146931390](https://github.com/lidge-ai/ima2-gen/actions/runs/37146931390) | Candidate verification, parent push-CI reuse, preview proof, stable tagging/publication succeeded |
| Preview publish | [37147197259](https://github.com/lidge-ai/ima2-gen/actions/runs/37147197259) | Source/package gates, Windows Node 22/24 consumers and registry proof passed |
| Stable publish | [37148405187](https://github.com/lidge-ai/ima2-gen/actions/runs/37148405187) | Exact package, npm latest, signed provenance and GitHub release passed |
| Desktop release | [37148429922](https://github.com/lidge-ai/ima2-gen/actions/runs/37148429922) | Five builds, verified draft, protected publication and manifest mirroring all passed |
| Pages | [37148910672](https://github.com/lidge-ai/ima2-gen/actions/runs/37148910672) | Both build and deploy passed; package doctor/publication gate bound version and SHA |
| Installed published UI | [37148971920](https://github.com/lidge-ai/ima2-gen/actions/runs/37148971920) | Acquisition, registry identity and installed-artifact smoke passed |

The stable package has gitHead `48620f62b64a265b7e80f2089c4e0eab5d70fe6a` and integrity:

```text
sha512-t+zGT6tIREV7gzUgwcBMtRHNoiNKCxaj3mCxkQpMyHIwmGr4xyS4fqkW1Qz6tkb/Rj7JNaKUIj/YnDv7EOgV8g==
```

Independent `release-contract.mjs verify-artifact` matched the downloaded tarball
to release-manifest.json. `verify-registry` returned `signatureVerified:true`,
latest 3.26.2 and publisher run 37148405187/attempt 1. Its provenance checks bind
`.github/workflows/publish.yml`, the source SHA and artifact digest to builder
`https://github.com/actions/runner/github-hosted`. SBOM is published with the release.

## Desktop, updates and site

[desktop-v3.26.2](https://github.com/lidge-ai/ima2-gen/releases/tag/desktop-v3.26.2)
is public with 17 assets. All 16 SHA256SUMS entries match GitHub's uploaded-asset
SHA-256 digests; the checksum file itself hashes to
`5ed716f87917a190621845d76619e7bdde62e656d589875ae488b5d4bc65d3a1`.
The macOS signature report is `ok:true`, with the matching source/tag/version and
no errors; its DMG/ZIP hashes also match public asset digests. Windows signing is
not asserted by this record.

The mirror job succeeded. GitHub Latest remains
[v3.26.2](https://github.com/lidge-ai/ima2-gen/releases/tag/v3.26.2), containing all
four latest*.yml files. Each matches its desktop original after only the documented
path rewrite, preserving payload hashes. All eight resolved installer/archive URLs
returned HTTP 200 to HEAD requests. This checks published bytes/metadata and download
availability; it is not a local installation or a real NSIS/Squirrel update test.

[Pages](https://lidge-ai.github.io/ima2-gen/) returned HTTP 200, and its 54,289-byte
root HTML exactly matched the deployed github-pages artifact (SHA-256
`3ef318ef58a6645c5912507aa5c90dc72e11c5076a86bf7e07b822b65e5c118c`).
An initial probe incorrectly expected a version literal in root HTML; source inspection
confirmed ReleaseBanner loads the desktop version dynamically. Artifact equality is
the observed deployment proof, not that rejected literal-presence assumption.

The installed UI acquisition and driver both bind the release SHA. Desktop 1157×826
and mobile 390×844 screenshots were downloaded and inspected; recorded browser/page
errors are empty, drafts remained editable, and contexts/browser were closed. The
smoke uses synthetic provider/status GETs, real health/auth/static files, and forbids
generation/mutations. It does not prove live provider generation. The earlier 16-case
sound-intent interaction matrix provides the changed-feature behavior proof.

## Evidence storage and residuals

Session-local raw receipts, workflow JSON, registry proof, checksums, manifests,
macOS signature report, Pages response/artifact and UI captures are in
`.codexclaw/release-3.26.2/` (ignored). Hosted artifacts remain attached to the runs
above; no screenshots or raw private logs were committed to the release branch.

Root raw audit retains five high and five moderate findings. The five high findings
are covered by the single tested unreachable braces path exception expiring
2026-10-17 UTC; this is not a clean raw root audit. UI raw audit is zero. The exception
keeps an immutable evidence URL and must be revalidated before expiry or dependency/
caller changes. Previous public v3.26.1 and desktop-v3.26.1 artifacts remain available
for an explicitly selected rollback; no rollback was executed. A later defect requires
a scoped corrective release, not replacement of the published npm version.
