# 030 wp3: gates, PR, review, merge

1. Fresh gates on the final head (000 Verifier list) with exit codes recorded in 040_closeout.md.
2. UI screenshot: build UI, run the app against a temp `IMA2_CONFIG_DIR` (never the real ~/.ima2), open the model picker for GPT OAuth and API key lanes in GOAT's browser, capture PNGs; commit them to the orphan `pr-assets` branch under `261121-gpt6x-lineup/` (never the PR branch) and embed raw.githubusercontent URLs by commit SHA in the PR body.
3. Push branch `codex/261121-openai-gpt6x-lineup` to origin (lidge-ai/ima2-gen fork remote as configured), open one PR to `dev`, link with goat_pull_request_link.
4. Fresh Terra review task (codex/gpt-6.1-terra, role review) over the PR diff; fix findings, re-review with continueFrom on the same reviewer; final pre-merge review by a new fresh Terra task.
5. Merge only when: final fresh review PASS, all PR checks green, 0 blocker findings → `gh pr merge --merge`; report merge commit SHA. No release, tag, release.yml or npm run release.
6. D: move this unit to `devlog/_fin/` only if the repo convention requires it at merge time (README hub row update).

