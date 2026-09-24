# 070 Phase 7 — PR, CI, merge into dev

1. Rebase codex/brand-refresh on the latest origin/dev; run fresh: npm run typecheck, npm run typecheck:tests, npm test, npm run test:inventory, ui build, site build.
2. Screenshots (sidebar, loading, onboarding, star dialog, site install) go to the orphan `pr-assets` branch under `brand-refresh/`, never the PR branch; linked by commit SHA (AGENTS.md "Pull requests").
3. `gh pr create --base dev --head codex/brand-refresh --body-file <tmp>`: problem, behavior change, screenshots, validation.
4. Wait for `PR fast gate` and `screenshot-gate` on the exact head; inspect jobs per DEV-CI-EVIDENCE-01.
5. `gh pr merge --squash`; observe the post-merge CI workflow on dev for the merge SHA.

Authority: user message 2026-09-25 "dev에 머지해놔" (push + PR + merge into dev). No tag, release, version bump or npm publish.


## wp7 P re-verification (HEAD 5352a3fd)

- origin/dev gained only the v3.20.0 release commit (e78bbbaa: package.json + package-lock.json version); rebase is expected to be clean. No open PRs target dev.
- Screenshots are committed on a detached worktree of origin/pr-assets at `/tmp/ima2-pr-assets` (commit 8a74cf43, `brand-refresh/01..10`), pushed to `pr-assets` before the PR body is written; the PR branch carries no screenshot files.
- PR fast gate (`.github/workflows/pr-fast.yml`): blob budget (`check-new-blob-budget.mjs --base HEAD^1`, 5 MiB per new blob; largest new blob is assets/brand/icon-1024.png ≈ 363 KB), structure line counts, provider types, native deps, install policy, typecheck x2, test:inventory, builds, npm test, lint:pkg, and the frontend e2e job (GitHub-hosted only; fixture pre-answers the star prompt). screenshot-gate reads the PR body.
- Merge: squash into dev (user authorization "dev에 머지해놔"), then watch the post-merge CI run on dev for the merge SHA.
