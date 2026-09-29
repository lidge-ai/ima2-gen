# 050 Outcome — v3.25.0 and the issue/PR train

Every open item got a decision, both contributor PRs landed after independent gpt-6-sol review,
and v3.25.0 shipped on every channel in one release run with no stop and no resume.

| Item | Decision | Evidence |
|---|---|---|
| PR #340 mask preservation | Merged after fixes | Merge 23f8c78a; head b1b9b46c, PR fast gate green; maintainer commits 89762055 (RGBA blend, 4096² cap, serial composites), b1b9b46c (#350 temp-cleanup contract) |
| PR #339 OAuth 429 backoff | Merged after fixes | Merge ad8dc0ad; head 793e49c8, PR fast gate green; maintainer commit 793e49c8 (cancel wins over a 429, deterministic cancel test) |
| Issue #338 job persistence | Accepted; contributor implements | issuecomment-5894907057 with the queue/lease/drain/test contract |
| Issue #150 Provider Adapter RFC | Kept open, deferred | issuecomment-5894907458 (premise updated: ten lanes) |
| Follow-up from #339 review | Opened | #351 job-wide OAuth deadline |
| CHANGELOG | 3.24.1 and 3.25.0 headings | PR #352, squash 2507b6f9 |

| Channel | Evidence |
|---|---|
| dev CI | 36600242940 (#340 merge 23f8c78a), 36602268160 (#339 merge ad8dc0ad, full), 36604168400 (final tip 2507b6f9); all success |
| Promotion | PR #353 → main bf049182; main push CI 36606036148 success |
| Release | release.yml 36606042995 success (cut, npm-stable approved, tag job) |
| npm | preview 3.25.0-preview.260929.36607868101.1 (publish 36607868101); latest 3.25.0, gitHead 057de2c0 = v3.25.0 = "[agent] chore: release v3.25.0" (publish 36610063576 on ref v3.25.0) |
| GitHub release | v3.25.0 Latest |
| Desktop | desktop-v3.25.0 pushed by release.mjs; desktop.yml 36610077562, event push, one run, success; non-draft with dmg, zip, win x64/arm64 exe, linux AppImage/deb x64/arm64, latest*.yml, SHA256SUMS.txt |
| Pages | pages.yml 36611182371 success; the site's release query resolves to desktop-v3.25.0 (mac-arm64.dmg) |
| Refs | dev, main and preview all contain 057de2c0 (dev tip is the release commit, fast-forward landing) |

Reviews: Confucius (#340), Wegener (#339), Carson (#338/#150 and roadmap reflection), Faraday
(roadmap audit FAIL → NEAR-PASS), all gpt-6-sol.

What did not improve: the first #340 gate failed because the contributor branch predated #350's
temp-cleanup contract; the plan's focused test list did not include that contract. Later units ran
the full `npm test` locally before pushing, which caught nothing further but is the cheaper check.
Masked edits above 4096 × 4096 save the provider result unpreserved (logged); a pre-dispatch cap
remains a possible edit-route change. An OAuth job still has no single deadline (#351).
The hardened pipeline from 260929_release_hardening ran end to end for the first time without a
resume; this is one run, not proof the resume paths are unnecessary.
