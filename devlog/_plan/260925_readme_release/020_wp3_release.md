# 020 wp3 — v3.21.0 release and deploy

## Outcome

npm `ima2-gen@latest` = 3.21.0 with gitHead at the release commit and provenance; GitHub Release v3.21.0 (Latest); `desktop-v3.21.0` public with the signed arm64 DMG, ZIP and SHA256SUMS; Pages rebuilt from the release commit.

## Runbook

1. Pre-check: `git ls-remote origin main dev preview`; origin/dev must contain origin/main; dev CI green at the head to promote.
2. Release PR `dev → main` titled "Release: brand refresh, onboarding, README (v3.21.0)"; wait for its checks; merge with `gh pr merge --merge --match-head-commit <sha>` (merge commit, matching #286 precedent).
3. `git fetch`; M = origin/main. After the merge main ⊇ dev and main ⊇ preview (`e78bbbaa`), which is what `release-cut.mjs preflight` requires; no dev fast-forward is needed. Freeze dev from here until the tag job finishes, because that job pushes main, dev and the tag atomically (`release.yml:212-221`) and a moved dev makes the push fail.
4. `gh workflow run release.yml --ref main -f bump=minor -f dry_run=false -f expected_sha=M`. The `cut` job commits 3.21.0, verifies, runs exact-SHA CI on `release-candidate`, promotes preview and proves the preview publish (`npm-preview` has no reviewer).
5. Approval 1 — release.yml `tag` job waits on `npm-stable` (`release.yml:180-187`). Approve with `gh api -X POST repos/lidge-ai/ima2-gen/actions/runs/<release run>/pending_deployments -F 'environment_ids[]=<npm-stable id>' -f state=approved -f comment=...` only after `cut` succeeded with the preview proof. The job then pushes main/dev/tag and dispatches publish.yml for `refs/tags/v3.21.0`.
   Approval 2 — publish.yml's stable job is gated on the same environment (`publish.yml:286-287`); approve its pending deployment the same way. On the known 120s registry-window E404, follow runbook 010 T1-6 (verify registry, `gh run rerun --failed`, re-approve); never re-dispatch release.yml.
6. Readback: `npm view ima2-gen@latest version gitHead`, `gh release view v3.21.0`.
7. Desktop: `git tag desktop-v3.21.0 <release sha> && git push origin refs/tags/desktop-v3.21.0`; desktop.yml builds, signs, notarizes, drafts; approve `desktop-production`; readback `gh release view desktop-v3.21.0` isDraft=false with dmg, zip, SHA256SUMS.
8. Pages: after npm `latest` reads 3.21.0 from the registry (`pages.yml:62` and `release-contract.mjs:638-648` verify the published artifact and tag), `gh workflow run pages.yml --ref main -f release_sha=<sha> -f release_version=3.21.0`; if it fails on registry propagation, wait and rerun the failed job. Readback run success and `curl` of the live site.
9. Refs after: main = preview = v3.21.0; dev contains it.

## Risks

- release.yml re-dispatch cuts 3.21.1; never re-run the whole cut after the tag exists.
- Screenshot gate applies only to PRs touching ui/, public/ or images under assets/; the dev→main PR carries README images, so its description embeds a screenshot too.

## Live state at wp3 P (2026-09-25 13:4x KST)

- origin/main = `233631affabc0f1fe46dda082f90acec4d1e3dde` (merge commit of #289, dev → main). main contains dev (`6e92b638`) and preview (`e78bbbaa`); remote `v3.21.0` absent.
- User instruction: merge #289 without waiting for its checks and track CI on dev. #289 was merged with `--merge --admin --match-head-commit 6e92b638` while its PR fast gate and dev CI were still running. A squash merge was declined because `release-cut.mjs preflight` requires main to contain dev.
- Incomplete-check record: dev CI run 36094301433 at `6e92b638` — Windows node 22.23.0 leg failed with a native access violation (exit 3221225477 / 0xC0000005) in `tests/transparent-background-route.test.ts`; Windows node 24, Ubuntu, macOS legs passed; frontend e2e still running. Same test passed at `01b53406`. Treated as a native flake; rerun of the failed job is tracked. release.yml runs its own exact-SHA CI on the candidate, which is the release gate.
- Dispatch: `gh workflow run release.yml --ref main -f bump=minor -f dry_run=false -f expected_sha=233631affabc0f1fe46dda082f90acec4d1e3dde`.
