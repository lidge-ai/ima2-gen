# Release safety and publication

Depends on wp3 and successful post-merge integration. C4; existing gh credentials and repository workflows only. No token/cost/time budget was set. User explicitly authorized dev merges and deployment; scope includes this repository's npm-stable and desktop-production approvals, not unrelated pending deployments. No global CLI/app update or running desktop restart.

## Exact safety delta before release

MODIFY scripts/release.mjs in ensurePromoted after `if (ahead === 0) return;`, before checking --promote or reading promotion PRs:

```diff
   if (ahead === 0) return;
+  if (ctx.flags.has("--dry-run")) {
+    ctx.log("Dry-run requires dev to be promoted already; refusing to create or merge a promotion PR.");
+    throw new ExitError(2);
+  }
   if (!ctx.flags.has("--promote")) {
```

MODIFY tests/release-command.test.ts using existing scriptedRunner/BASE_RESPONSES fixtures: dev ahead + --promote --dry-run --approve --yes rejects with code 2; calls contain no pr create/merge, workflow run, pending deployment approval or git push. Dev aligned + same switches dispatches only dry_run=true with no promotion, tags or approval. Real --promote --yes still merges then dispatches expected_sha from changed origin/main. Test red before patch and green after. No actual release command is used as a test fixture.

MODIFY CONTRIBUTING.md release paragraph:

```diff
-and keeps watching until the desktop release is published. Add --dry-run to verify without touching any remote,
+and keeps watching until the desktop release is published. --dry-run runs a hosted validation workflow on already-promoted main without publishing branches, tags or packages; it refuses when dev needs promotion.
```

Preserve real/canary/resume behavior. Explain --canary creates a candidate ref and dispatches CI, and --promote with canary performs real promotion. This is a guard in the maintainer wrapper only (E7 application command), bypassable by direct gh workflow/PR operations; not repository enforcement. Final enforcement remains existing repository checks and protected environments.

## Verification and merge

Run node --import tsx --test tests/release-command.test.ts and npm run typecheck:tests. Inspect full diff and independent reviewer verdict. Publish safety repair as ordinary dev PR; wait for exact-head expected CI, merge, then inspect dev CI. Update source docs/CHANGELOG for all completed selected slices. Audit high/critical findings are blockers: no ignoring vulnerabilities to release. Scheduled audit 37111866226 was reported red on old main; re-evaluate the updated dependency set and fix any still-applicable findings through a documented amendment.

## Publication runbook

1. Refresh dev/main, open PR heads and unresolved review threads. Pin accepted dev code SHA and compare its post-merge CI/Agy/desktop/CodeQL run events, attempts and actual jobs. Required checks must finish successfully.
2. Create or reuse an ordinary dev→main promotion PR after the safety PR lands. Its checks may overlap dev post-merge CI on the same frozen head (WP4-ARCH06, aligned and independently audited); merge requires both sets to pass. Attach it to the task. Require its own expected exact-head Fast Gate, CodeQL and applicable screenshot checks; inspect review threads and native membership. Merge with `gh pr merge --merge --match-head-commit VERIFIED_DEV_SHA`, without --admin or branch deletion. A changed head/base requires revalidation.
3. Verify main contains both reviewed dev and preview by ancestry (SHA equality is not required), and wait for applicable main push checks. Then run `GH_REPO=lidge-ai/ima2-gen GH_HOST=github.com npm run release -- patch --approve --yes` in managed background, omitting --promote: newly unpromoted dev work must cause refusal. The wrapper pins expected_sha, publishes preview, tags, lands dev, publishes npm, pushes the desktop tag and approves only this version's npm-stable/desktop-production. Dispatch/wrapper success is not full publication proof.
4. If interrupted after cut, use `npm run release -- resume X.Y.Z --approve --yes` for the same version, after reading current tag/main/npm proof. Do not bump a second time to hide partial release.
5. Verify npm view ima2-gen@X.Y.Z version gitHead dist.integrity dist.tarball plus latest; GitHub vX.Y.Z/desktop-vX.Y.Z tags, published desktop release assets/checksums, workflow builder identities, and Pages build/deploy result. Require desktop mirror_update_manifests SUCCESS and inspect all four latest*.yml assets on vX.Y.Z: their version/file URLs must resolve to the matching desktop-vX.Y.Z assets. Public desktop release alone is insufficient because mirroring runs afterward. Use repository package-install/published UI smoke against released artifact; do not install globally. Record artifact digests and rollback path (previous immutable version/release retained; corrective release if needed).
6. Archive unit to devlog/_fin/261003-issue-pr-release after evidence closes; update active ledger and final summary. Report platform boundaries: hosted package/build proof does not establish real NSIS/Squirrel update installation.

## Formal wp4 P revalidation

Previous D completed wp3 PR371 at bacf9e95; this cycle closes safety and publication. Fresh registry: latest3.26.1, gitHead8c27479c; main and preview both8c27479c; devbacf9e95. Recent release.yml runs are completed, with no active cut observed. Provisional next version3.26.2 is rechecked immediately before execution; the workflow owns manifest bumping. Write CHANGELOG.md entry for OAuth job/retry deadline, composer feedback/sound chips, selected dependency updates, dry-run guard, and the exact time-limited unreachable braces exception; do not call raw root audit clean.

Architect WP4-ARCH01..05 proposals accepted. Candidate audit's missing update-manifest gate is folded into step5 above. Actual npm OIDC/release provenance, desktop asset checksum validation and mirror job, Pages build/deploy for releaseSHA, and published-ui-smoke.yml artifact_kind=published/version/SHA are all separate acceptance evidence. If mirroring or Pages fails after publication, repair that failed stage at the same version and reverify; no new bump hides partial work.

Applicable security review is scoped to these changes and publication boundaries, not an ASVS certificate: existing credentials only, exact head/ref checks, no unreviewed promotion, only two named environments for this version, no secret/client material in diffs/screenshots, dependency gate under its existing evidence-backed exception policy, immutable prior release retained as rollback/containment evidence. No live user app installation/update or paid provider generation is claimed.

P proof: npm3.26.2 lookup returnedE404 and neither v3.26.2 nor desktop-v3.26.2 remote tag exists. Current account hasADMIN onlidge-ai/ima2-gen; main ruleset inspection reports deletion protection only. No release.yml runs were in_progress or queued. Scope GH_REPO/GH_HOST per invocation because this checkout also has a secondary remote; do not change persistent CLI configuration. Baseline dry-run probe with a fully injected runner recorded an attempted `gh pr merge999 --merge`; no real git/gh command ran. This confirms the defect before production changes.

Archival provenance maintenance: main also changes only the `evidence` text in scripts/audit-exceptions.json from the movable012 plan path to its verified immutable GitHub commit URL at055f9cd0e6ceb839d51ce4179922c667a6ef0969. `git cat-file -e` confirms that evidence file exists in the merged commit. Package/GHSA/scope/reason/expiry and all audit logic stay identical. This keeps evidence reachable when the completed unit moves to_fin; final archival can then be docs-only. Main owns this metadata and CHANGELOG; the bounded executor owns release.mjs, release-command tests and CONTRIBUTING.
