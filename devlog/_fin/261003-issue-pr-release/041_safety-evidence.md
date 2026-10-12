# wp4 dry-run safety evidence

Bounded executor result: PASS, frozen for main review. This is local wrapper
verification, not publication or hosted CI proof. Owning plan: 040_release.md.

## Change and boundary

Changed paths:

- scripts/release.mjs: ensurePromoted rejects --dry-run with ExitError(2) after
  the zero-ahead return and before --promote handling or any PR lookup.
  The approvals comment now accurately describes dry/canary validation.
- tests/release-command.test.ts: five additional executed cases; original
  assertions retained. scriptedRunner records attempted commands before
  response matching, including unexpected commands.
- CONTRIBUTING.md: hosted dry validation requires promoted main and publishes
  no branches/tags/packages; canary creates/cleans a candidate ref and dispatches
  CI, while --promote with canary really promotes.
- devlog/_plan/261003-issue-pr-release/041_safety-evidence.md: this evidence.

C4 release surface; parent owns PABCD, independent review, broad gates, git,
remote operations, release, CHANGELOG and audit evidence metadata. No expansion
of executor write scope was needed. Source files remain below 500 lines
(release.mjs 450, release-command.test.ts 421); new helper and test bodies are
below 50 lines. Existing unrelated oversized test callbacks were not refactored.

Threat model: the asset is main/release integrity, the entrypoint is the
maintainer CLI, and the boundary is dry-run intent crossing into authenticated
gh/git mutation. The observed failure needs no hostile actor: an authorized
maintainer using --promote --dry-run --approve --yes could merge a promotion.
The guard prevents that wrapper path before PR reads/writes. It is not GitHub
policy enforcement and cannot prevent direct gh or git use. Existing repository
and environment gates remain main's release controls. No credentials or new
dependencies were introduced.

Search/read evidence: rg terms scriptedRunner, ensurePromoted, dry.run, canary
in release.mjs, release-command.test.ts and release.yml; read CONTRIBUTING and
040. Reused scriptedRunner/BASE_RESPONSES. Doing nothing, deleting promotion,
or configuring flags cannot preserve promotion while enforcing the requested
dry-run contract; the four-line guard is sufficient. The new test-only
promotionRunner composes existing fixtures and stops at dispatch; no production
abstraction was added.

## RED before production change

Command: `node --import tsx --test tests/release-command.test.ts`

Exit 1: 23 tests, 21 passed, 2 failed, 0 skipped/cancelled.
Both `refuses dry-run promotion before PR lookup (open PR: true/false)`
failed the expected exit-code-2 predicate with:

```text
AssertionError [ERR_ASSERTION]: The validation function is expected to return "true". Received false
Caught error:
Error: injected dispatch boundary
```

The fully injected runner allowed the old code through an existing-PR merge
or PR creation/merge into the dispatch boundary. No command escaped the runner.
The real/canary compatibility and both aligned-main variants already passed.

## GREEN and static verification

- `node --import tsx --test tests/release-command.test.ts`: exit 0;
  23 tests, 8 suites, 23 passed, 0 failed/skipped/cancelled. Same tests after
  adding the guard and formatting the parameterized aligned-main case.
- `npm run typecheck:tests`: exit 0 (`tsc --noEmit -p tsconfig.tests.json`).
- `node node_modules/eslint/bin/eslint.js scripts/release.mjs tests/release-command.test.ts`:
  exit 0 with one warning that tests/release-command.test.ts has no matching
  ESLint configuration. This is not test-file lint coverage.
- `node node_modules/eslint/bin/eslint.js scripts/release.mjs --max-warnings 0`:
  exit 0, no output. Tests are covered by the required test typecheck.

Negative cases assert the entire command sequence is exactly auth status,
fetch main/dev/tags, then rev-list. Thus PR list/create/merge, workflow dispatch,
deployment approval and git push are never attempted, even with all four flags.
Aligned main dispatches exactly one release.yml run with dry_run=true and
expected_sha, with no PR/tag/push/deployment calls. It passes both without and
with --promote --approve. Normal and canary promotion merge PR999, fetch updated
main, and pass its distinct ccccc... SHA as expected_sha; both intentionally
stop at the injected dispatch boundary and make no publication-success claim.
Existing resume coverage passes, including the authorized temporary local git
fixture. That fixture only operates under its own mkdtemp root.

Frozen SHA256 fingerprints:

```text
fdf3bede850c4e198dbd327a963188d403528ebea0ba67dd40e2a3fc53b92741  scripts/release.mjs
1398baac27a35106ee38a9986f8cd00ba9cf05efc018e0f5d5b5aaedce70f2d5  tests/release-command.test.ts
e5901aaf51c2f4af4537554e3dc1975efc48677f840a8b535092640f6686238b  CONTRIBUTING.md
```

No executor git commands against the shared repository, real gh calls, real
release invocation, remote writes, installs, app restarts, goal/FSM operations
or child dispatch occurred. Full gates, independent review, committed diff
checks, inventory, exact-head hosted CI, merge and publication remain main-owned.
