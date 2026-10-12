# Live triage, 2026-10-03

Baseline dev: 862e0bd73f59a3b419503a9dec39b6f83ef2bed6. Live `gh issue list` showed #351/#338/#150; `gh pr list` showed #360–364, all targeting main.

| Item | Disposition and evidence |
|---|---|
| #351 | Accept. lib/oauthImages.ts:262 creates retry budget without a whole-job deadline; responsesTransport.ts external abort classification needs timeout preservation. Include readiness, retry wait and parallel rendering. |
| #338 | Defer. inflight.ts:110 stores truncated prompt and summary, not executable payload; db.ts:63 lacks execution leases; server.ts:501 kills workers before drain. Durable admission, leasing, duplicate billing prevention and file retention must be designed together. Current maintainer comment 5894907057 requires this larger contract. |
| #150 | Defer. lib/providers/adapters/index.ts:19 registers 7 adapters, types.ts:44 readiness remains synchronous; optional image methods and provider/UI branches remain. Current maintainer comment 5894907458 keeps RFC deferred. |
| #360 | Review/carry XYFlow 12.11.6 → 12.12.0 and system 0.0.83; UI build and Node interaction checks. |
| #361 | Review/carry MCP SDK 1.30.1, Codex 0.158.0 and lock updates for dotenv/OpenAI/sharp. Preserve current package version and unrelated pins. |
| #362 | Review/carry ESLint 10.11.0 and typescript-eslint 8.70.1; lint proves compatibility. |
| #363 | Review/carry CodeQL action 2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 (4.38.2). Preserve permissions/triggers. |
| #364 | Review/carry fork head 3949f8b62026af29a227693d3a0e63d885bbe5e0. Existing screenshot gate succeeds but PR backend/frontend jobs are absent; fresh carry gets complete CI. No PR review comments existed at inspection. |

Issue discovery: inherited child 01a1020d-62cc-7372-ac4c-065b23630e64. Main accepted findings after inspecting oauthImages entry and current refs. #364 native stack membership response was empty; refresh all selected PR topology before publication/merge.

No source issue is closed merely on the strength of this triage. Dependency/source PRs close only after the exact carried behavior lands; retain upstream authorship in carry commits and cross-link the replacement.

All selected PRs #360–364 were rechecked with the GitHub stacks endpoint before intake: each returned [] and each base remains main; heads match the pinned companions. #360–363 are same-repository, #364 is fork-owned. No native membership was changed.
