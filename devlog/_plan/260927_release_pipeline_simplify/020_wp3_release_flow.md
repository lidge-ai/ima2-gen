# wp3 — release flow (D2-D6)

## Change map

| File | Change |
|---|---|
| scripts/release-cut.mjs | New `version-only <base> <sha>` command: prints `version_only=true|false` (GITHUB_OUTPUT when set); true only when `git diff --name-only base sha` is a non-empty subset of {package.json, package-lock.json}. Pure helper exported for tests. |
| scripts/wait-ci-gate.mjs | New `reuse-push <baseSha> [timeoutMinutes]`: finds ci.yml push runs on main with headSha == baseSha (full SHA), waits while in progress, then classifies: success with jobs test*/windows*/macOS native installation/frontend e2e* all `success` -> reusable=true; failure/cancelled -> exit 1; missing run or skipped required jobs -> reusable=false. Exported pure `classifyPushRun(run, jobs)`. Transient gh failures retry like the existing poller. |
| .github/workflows/release.yml (cut) | After assert-clean: `version-only` step, then `Reuse the main push CI for the parent commit` (id reuse; skipped in canary mode so canary still exercises the candidate gate). Existing candidate steps (push candidate ref, ci_mark, dispatch, wait, cleanup) gain `steps.reuse.outputs.reusable != 'true'`. Timeout budget keeps the envelope (reuse wait 45 <= candidate wait 45). |
| .github/workflows/release.yml (tag) | After the atomic push: push `desktop-v$VERSION` at the SHA when absent, then `gh workflow run desktop.yml --ref desktop-v$VERSION -f platform=all`. After the stable publish wait: `gh workflow run pages.yml --ref main -f release_sha -f release_version`. Summary lists the dispatched runs. |
| .github/workflows/desktop.yml + desktop/scripts/desktop-build-policy.mjs | The release path is "ref is a desktop-v tag" for both push and workflow_dispatch: draft_release/publish conditions and the policy's tag-only publish rule accept a dispatch whose ref is refs/tags/desktop-v*. Branch dispatches still cannot release. desktop-production approval unchanged. |
| .github/workflows/publish.yml (package) | Preview channel keeps `npm run verify:release:source`; latest channel runs a new `npm run build:release` (ui:build + build:server + build:cli + lint:pkg) instead, then the same pack + install smoke. |
| package.json | `build:release`; `release` -> `node scripts/release.mjs`; release:patch/minor/major/dry/canary call the script. |
| scripts/release.mjs | One command: `npm run release -- <patch|minor|major> [--dry-run|--canary] [--promote] [--approve] [--yes]`. Fetches origin; if dev is ahead of main, stops unless --promote (then opens or reuses the dev->main PR and merges it with a merge commit, waiting until origin/main moves); dispatches release.yml with bump/dry_run/expected_sha; finds the run; polls; for pending deployments of that run (npm-stable) and of the desktop.yml run on desktop-vX and the publish.yml stable run, approves them when --approve is given, otherwise prints the approve command; exits with the run conclusion. Pure helpers (arg parsing, pending-deployment selection) exported and unit-tested; gh access injected. |
| CONTRIBUTING.md, structure/06-infra-operations.md | Release section: one command, what it automates, which approvals remain and why. |
| tests/release-pipeline-contract.test.ts, tests/desktop-signing-policy.test.ts, tests/package-global-update-smoke-contract.test.ts (as needed) | Contract updates for the new steps/conditions and unit tests for classifyPushRun, version-only, release.mjs helpers. |

## Safety invariants to keep (audit checklist)

- publish.yml remains the only workflow with id-token: write; publish filename unchanged.
- tag job keeps environment npm-stable before the atomic push; publish-stable keeps npm-stable.
- main moves only after verify:release on the exact SHA plus either the reused parent CI
  (version-only diff) or the candidate CI.
- Canary mode still exercises the candidate CI gate; dry_run=true changes no remote.
- desktop release still requires a desktop-v tag ref and desktop-production approval.

## Acceptance

- npm run typecheck, typecheck:tests, lint, test:inventory pass; node --test on the touched
  contract tests passes; actionlint (if installed) or YAML parse of all workflows passes.
- Unit tests show: classifyPushRun returns reusable only for a fully-run green push run;
  version-only rejects any file outside package.json/package-lock.json; the release
  helpers select only this release's pending deployments.
- Real end-to-end release is out of scope (no release is cut in this unit); first real use
  is the next release, recorded then.


## Audit fold (Kimi reviewer Locke, NEAR-PASS)

1. BLOCKER folded: the tag job fetches tags; when desktop-v$VERSION exists it must resolve
   to the release SHA or the job fails; it is created only when absent. Never dispatch on
   an unverified pre-existing tag.
2. Folded: classifyPushRun requires event == "push" and headBranch == "main" and the
   latest attempt; schedule/dispatch runs on the same SHA never count.
3. Folded: the release summary is written before the desktop/pages dispatches; both
   dispatch steps use continue-on-error and print the re-dispatch command, so a failed
   dispatch after npm publish does not fail the release.
4. Folded: desktop-signing-policy test replaced by "only a desktop-v tag ref reaches
   draft/publish for push and dispatch; branch dispatch never does"; build policy allows
   publish on dispatch only for refs/tags/desktop-v*; unit tests for both.
5. Folded: release-pipeline-contract extends ordering checks (version-only before both
   paths, reuse skipped for canary, every candidate step carries the reuse guard).
6. NIT folded: cancelled parent run -> reusable=false with reason (falls back to the
   candidate CI) instead of hard failure; only failure concludes red.
7. NIT folded: the "ci" aggregator job must be success as well.
8. NIT (wp2): measure the isolation project separately from the PR run log.
