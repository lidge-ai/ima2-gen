# Delivery baseline, authority, and dispatch evidence
Date: 2026-09-05. Class: C4 delivery. Research only; no implementation changes.

## Repository identity
- Work root: /Users/jun/Developer/new/700_projects/ima2-gen.
- git worktree list reports the submodule administrative worktree path under
  /Users/jun/Developer/new/.git/modules/700_projects/ima2-gen; actual show-toplevel
  and command cwd are the work root above. Do not operate on the administrative
  path as though it were a second checkout.
- Source baseline: ecde2bc79cddc50ff0da38091c1ce0590383090c.
- origin: https://github.com/lidge-ai/ima2-gen.git. fml09 remote is out of scope.
- origin/dev: f499fc7d73c08f19be76fd5b111d163bfaf3c226.
- origin/main and origin/preview: d2afe6b2aa7d006e2cd9765aa632714f96435db2.
- dev-only predecessors: b7d597a2 and f499fc7d, both release evidence docs.
- ecde2bc7 is the earlier user-approved NovelAI geometry fix. It is an explicit
  stack prerequisite, not a new production-readiness WP and not counted toward ten.
- Current work branch: codex/prod-wp00-roadmap. Untracked scripts/recording is
  user work; stashes are preserved, never popped/cleared by this delivery.

## Current platform checks
gh repo view: lidge-ai/ima2-gen, default branch main, viewer ADMIN.
Repository settings: merge/rebase/squash all available; delete_branch_on_merge=false.
Rulesets query returned no entries. main/dev protection queries returned explicit
404 Branch not protected. These are observations, NOT permission to bypass future
protections; inspect again immediately before each merge. Do not change repo settings.
Open PRs 194-197 are Dependabot dependency updates, outside this scope.

## CI reality, not assumed platform defaults
- .github/workflows/pr-fast.yml:7-8 only triggers for PR bases main or dev.
  A PR based on codex/prod-wpNN-* does NOT receive that trigger.
- .github/workflows/ci.yml:11-16 accepts explicit input sha.
- Main test matrix checkout (ci.yml:39-53) honors and asserts input sha.
- E2E checkout (ci.yml:214) initially does not honor input sha.
- Interim safe dispatch: run ci.yml with --ref equal to the exact task-owned
  branch and input sha equal to that branch's full current tip. Then github.sha
  and explicit input match for all jobs. Never dispatch from main with another
  branch's SHA and claim all jobs checked that SHA.
- WP12 will strengthen every job's checkout identity and stacked PR CI coverage.
- scripts/wait-ci-gate.mjs:44 hardcodes release-candidate in listRuns; do not
  reuse its wait verb for production stack branches. Its full-SHA/run-correlation
  contract remains useful; use gh run view by discovered run ID for stack checks.

## Canonical release chain
release.yml starts from main, fetches dev/main/preview, then preflight checks
that main contains dev and preview (scripts/release-cut.mjs:53,147).
It creates a version commit in CI, runs verify:release, pushes a leased candidate
ref, dispatches exact-candidate CI, promotes main then preview, proves the preview
package, waits at npm-stable environment before stable tag, atomically updates
main/dev/tag, dispatches publish.yml and waits for a second npm-stable approval.
publish.yml is the sole publisher and OIDC owner. Do not direct npm publish,
mint tags manually, modify required-units provenance to evade it, or publish
before the stack is merged and its integration gate passes.
All these source facts must be rechecked at WP13's P.

## Verifier probes
- node --import tsx --test tests/release-cut.test.ts tests/release-contract.test.ts:
  exit 1, files do not exist. Rejected as invented verifier names.
- node --import tsx --test tests/release-pipeline-contract.test.ts:
  exit 0, 32 pass, 0 fail. Imports release-cut.mjs and release-contract.mjs,
  exercises baseline, artifact/provenance, candidate full-SHA correlation and
  package install policy. Does not prove any current remote release.
- npm run typecheck; npm run typecheck:tests; npm run test:inventory:
  previously refreshed during this task's assessment, exit 0. Rerun for each
  relevant source delta rather than reuse as current implementation evidence.
- macmini-cf SSH reachable; non-login shell shows git but no node/npm PATH.
  Do not conclude Node is absent or install tooling automatically. Full suites
  may simply use exact-head GitHub CI; remote runtime discovery is optional.

## Explicit user authority and resource boundaries
The request authorizes this task's docs/code, >=10 stacked implementation PRs,
push, bottom-up merge and canonical release. Task branch restacks may use exact
leases after refreshing heads. No force updates of shared dev/main, no reset,
no cleanup of unrelated worktrees/branches, no third-party settings changes.
User data/credentials never enter fixtures or artifacts. Generated images are
sensitive local data; visual acceptance uses isolated fixture media.
Paid image/video generations are NOT covered by unlimited subagent dispatch.
No budget acknowledgment for provider-canary-live may be sent without actual
spend authorization. Existing no-cost canary and stub-backed UI tests are distinct
proof classes, not substitutes for a live generation claim.

## Subagent incident and superseding rule
Four initial calls omitted both model and reasoning_effort as originally requested.
Their actual turn_context was gpt-5.6-luna/low; all four were stopped.
A no-op omitted-fields probe reproduced Luna/low after default settings were saved.
Explicit probe 01a06f50-395e-75d1-8db1-8154487d5e24 proved gpt-6-astra/high.
The user then confirmed priority applied and resumed execution. Therefore
explicit Astra/high supersedes the original omit-fields sentence; priority is
user-confirmed because the tool schema/rollout exposes no service-tier evidence.
New planning lanes 01a06f52-029c, -0379, -043b and -04f0 each independently have
turn_context model=gpt-6-astra effort=high. Do not mislabel Luna draft provenance.

## Final documentation persistence
This unit is ignored by default under devlog/_plan. Explicitly force-add only
this unit's text documents, not all ignored files. Compact Markdown evidence
is versioned. Large UI screenshots use the existing devlog/_artifacts convention
and CI upload retention; artifact receipt hashes and paths belong in versioned
check records. Never assume an ignored devlog has been published.
