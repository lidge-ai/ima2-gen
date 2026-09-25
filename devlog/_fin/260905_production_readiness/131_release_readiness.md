# WP13 release readiness — pending integration

Status: **NO-GO for release until the gates below complete.** This is a live
readiness record, not evidence that the PRs or package are already released.

## Source and scope

Development candidate at WP12s close: b1432ba38b377d8732d94a9e17301e94eb988a03.
Release preparation is on codex/prod-wp13-release; new CLI/provider-auth correction
and bounded installed-artifact UI observation need their own final-head checks.
Do not reuse b143 as proof of those changes. Main owns all mutations.

## Current layer proof, before merge

All18 PR heads and associated full-CI runs were read live and matched exactly.
The historical job count grows with the implemented workflow; this is not a claim
that every early layer had the later six-job matrix. Current cumulative b143
passed all6 jobs and266 E2E cases. Re-read heads/checks/reviews before any merge.

| PR | Head branch | Current base | Reviewed head | Exact-head full CI | Landing |
|---|---|---|---|---|---|
| 199 | codex/prod-prereq-nai | dev | 2d8af5c3c77b5044f8201de3260a95b6b9e2912d | [34026761774](https://github.com/lidge-ai/ima2-gen/actions/runs/34026761774) success | Not merged |
| 198 | codex/prod-wp00-roadmap | codex/prod-prereq-nai | 5f4170b0c9fbb0d8774a6b29f6993c8580a1d18f | [34026761568](https://github.com/lidge-ai/ima2-gen/actions/runs/34026761568) success | Not merged |
| 200 | codex/prod-wp01-capabilities | codex/prod-wp00-roadmap | 99f27afe9a810fdf6db9b96c2a9ec6e5ff7c6adb | [34026761569](https://github.com/lidge-ai/ima2-gen/actions/runs/34026761569) success | Not merged |
| 201 | codex/prod-wp02-selection | codex/prod-wp01-capabilities | 1d876b7004fac9a3bc846adf363fe89c22729540 | [34026761635](https://github.com/lidge-ai/ima2-gen/actions/runs/34026761635) success | Not merged |
| 202 | codex/prod-wp03-execution | codex/prod-wp02-selection | 383f0c393ed4ff6977839ce721698841a8d6c6fd | [34026763546](https://github.com/lidge-ai/ima2-gen/actions/runs/34026763546) success | Not merged |
| 203 | codex/prod-wp04-openai | codex/prod-wp03-execution | 5d6fc708c0ef1197c22f9bbb5afab4a0a3088ad6 | [34026763094](https://github.com/lidge-ai/ima2-gen/actions/runs/34026763094) success | Not merged |
| 204 | codex/prod-wp05-grok | codex/prod-wp04-openai | 05a0fb26b446fa442897a573de408ec7dfcb4609 | [34026763151](https://github.com/lidge-ai/ima2-gen/actions/runs/34026763151) success | Not merged |
| 205 | codex/prod-wp06-google | codex/prod-wp05-grok | 7c5a40bb082fd7936c00d45f472dd856927160ea | [34026763299](https://github.com/lidge-ai/ima2-gen/actions/runs/34026763299) success | Not merged |
| 206 | codex/prod-wp06m-video-bounds | codex/prod-wp06-google | b60b3441ea72198cce14413c138dcab3ea958f69 | [34026764879](https://github.com/lidge-ai/ima2-gen/actions/runs/34026764879) success | Not merged |
| 207 | codex/prod-wp06s-agy-artifacts | codex/prod-wp06m-video-bounds | f8fdb3a975b6f834eab9ebb4b4f3ac97e4600c78 | [34026765052](https://github.com/lidge-ai/ima2-gen/actions/runs/34026765052) success | Not merged |
| 208 | codex/prod-wp07-jobs | codex/prod-wp06s-agy-artifacts | 59c088cf7ef1448e845e89833ad62b9cbc0c6ca8 | [34026764881](https://github.com/lidge-ai/ima2-gen/actions/runs/34026764881) success | Not merged |
| 209 | codex/prod-wp08-composer | codex/prod-wp07-jobs | 849b3df31e8585487e4baa2cb0c5d1e14609dcd6 | [34026765261](https://github.com/lidge-ai/ima2-gen/actions/runs/34026765261) success | Not merged |
| 210 | codex/prod-wp08c-provider-display | codex/prod-wp08-composer | ed885032fb07977a5e5625119578ade73078b6a9 | [34026766734](https://github.com/lidge-ai/ima2-gen/actions/runs/34026766734) success | Not merged |
| 211 | codex/prod-wp09-journeys | codex/prod-wp08c-provider-display | 3e704f9402ce76f63d66f1b42af6b2464a4c5b72 | [34026766800](https://github.com/lidge-ai/ima2-gen/actions/runs/34026766800) success | Not merged |
| 212 | codex/prod-wp10-diagnostics | codex/prod-wp09-journeys | 1e2e05ae186cd618d8973434d95439491699d52e | [34026766960](https://github.com/lidge-ai/ima2-gen/actions/runs/34026766960) success | Not merged |
| 213 | codex/prod-wp11-installation | codex/prod-wp10-diagnostics | 6607dc6417bf41e706360bfe03c975ff51871657 | [34026766753](https://github.com/lidge-ai/ima2-gen/actions/runs/34026766753) success | Not merged |
| 215 | codex/prod-wp12-readiness | codex/prod-wp11-installation | 2f8b4823a2462db07b6dcc280e397817cc437956 | [34031781195](https://github.com/lidge-ai/ima2-gen/actions/runs/34031781195) success | Not merged |
| 217 | codex/prod-wp12s-lan-security | codex/prod-wp12-readiness | b1432ba38b377d8732d94a9e17301e94eb988a03 | [34044138017](https://github.com/lidge-ai/ima2-gen/actions/runs/34044138017) success | Not merged |

Native stack216 contains199,198,200–213,215;215 is still draft.217 is a separate
manual child. Native-stack operation is gated on the explicit owner answer; do
not infer it from a general merge request. No stack membership changes proposed.
199 and198 are prerequisite/docs; the remaining16 are implementation layers.
Release-prep/promotion PRs do not pad that count.

Snapshot sources: ignored wp13/pr-preflight.json and ci-preflight.json. Merge SHAs
will be written only after actual readback and fresh origin/dev ancestry proof.

## Baseline and rollback

- main/preview: d2afe6b2aa7d006e2cd9765aa632714f96435db2.
- dev:66a4f9989e14f8bacd657f7d6c7c82599ae8ecb4 (approved history prerequisite214).
- Stable registry/GitHub Release:v3.13.1; preview version
  3.13.1-preview.260904.33885929065.1 identifies the same d2afe6b2 source.
- Previous stable integrity:
  sha512-88C+Y0+ImW4Huh+ECfCOunuDFgp17OYZcuSE7Y4NoaH4GmlezkXcyaR//DU6hdhEz1MhCMgn/2L7O6Ig3mgwtg==.
- Package rollback is reinstalling that immutable version; no tag rewrite or
  silent latest rollback. Pages is forward-repair-only under its latest-bound
  compatibility gate. User media/config are never rolled back/deleted.

## Remaining GO gates

1. Bounded release-prep CLI correction and UI helper verified on their actual
   final head, including original provider error identity and reserved/generic
   auth safety. Candidate UI exercise is not published proof.
2. Resolve actual review comments; no unresolved reachable High/Critical issue.
   WP12 triage remains applicable only where source is unchanged.105 was repaired
   and its residual warning owner-authorized after b143 tests;106 source-fixed.
3. Native operation authority, all current layer heads/checks/ancestry and review
   state. Then bottom-up actual merges into dev, with >=10 implementation receipts.
4. Release-prep child and dev->main promotion reviewed and merged normally.
   main must contain dev/preview. Freeze the exact integrated main SHA.
5. Canonical release.yml cut (planned minor from observed3.13.1, not a pre-minted
   version), candidate CI, preview publish/proof, allowed stable environment
   approvals, stable publish and GitHub Release. No direct npm publish.
6. Exact stable/preview metadata, tag/main/dev/preview, artifact SHA-512 and signed
   original publisher provenance. Existing finalizers must actually pass.
7. Published-kind installed UI smoke with driver/product identity kept distinct;
   original screenshots directly read. Actual deployed Pages workflow and
   installer byte/hash parity with that release source.

## Evidence discipline

P preflight:34 release-contract tests and pinned-toolchain check passed. Baseline
guard correctly refused this feature checkout; no release-ready claim follows.
Future identifiers are pending, not fabricated receipts. No paid generation,
personal app/account/3333 probes, forced shared refs, branch deletion, rule bypass,
new testing platform or **heartbeat automation**. Source-only judgments and
synthetic-provider UI evidence are not live provider/deployment proof.
