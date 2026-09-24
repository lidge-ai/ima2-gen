# 070 Phase 7 — PR, CI, merge into dev

1. Rebase codex/brand-refresh on the latest origin/dev; run fresh: npm run typecheck, npm run typecheck:tests, npm test, npm run test:inventory, ui build, site build.
2. Screenshots (sidebar, loading, onboarding, star dialog, site install) go to the orphan `pr-assets` branch under `brand-refresh/`, never the PR branch; linked by commit SHA (AGENTS.md "Pull requests").
3. `gh pr create --base dev --head codex/brand-refresh --body-file <tmp>`: problem, behavior change, screenshots, validation.
4. Wait for `PR fast gate` and `screenshot-gate` on the exact head; inspect jobs per DEV-CI-EVIDENCE-01.
5. `gh pr merge --squash`; observe the post-merge CI workflow on dev for the merge SHA.

Authority: user message 2026-09-25 "dev에 머지해놔" (push + PR + merge into dev). No tag, release, version bump or npm publish.

