# 050 wp5 — dev->main promotion, release, Pages, published-artifact visual proof (C4)

Consumes 130_merge_and_release.md (now in _fin/260905_production_readiness) as the
procedure source; this doc lists only the deltas and exact commands.

## Preconditions
- wp1-wp4 PRs merged into dev; wp2 merged into main and synced into dev.
- `git fetch origin; git merge-base --is-ancestor origin/main origin/dev` true.
- `gh pr list --state open` empty.

## Steps
0. Release content BEFORE the cut (release-cut.mjs:169 only bumps package manifests):
   on a branch from dev, convert CHANGELOG `## [Unreleased]` to `## [<V>] - <date>` with
   V = current version minor-bumped (3.15.0 unless main moved), add a fresh empty
   Unreleased, and update structure/06-infra-operations.md only if the procedure
   changed. PR to dev, merge. The cut then packages the versioned changelog.
1. Promotion PR: `gh pr create --base main --head dev --title "Promote dev to main (post-3.14.0 cleanup)"`
   body: list of merged PRs. Wait PR Fast Gate + CodeQL on exact head; dispatch
   `gh workflow run ci.yml --ref dev -f sha=<dev-head>` for the full matrix; merge with
   `--merge --match-head-commit`. Record integrated main SHA = M.
2. Release: `gh workflow run release.yml --ref main -f bump=minor -f dry_run=false -f expected_sha=M`.
   bump=minor because wp3 adds a user-visible lane (NAI quota) and a new error code.
   Poll `gh run list --workflow release.yml`; the `tag` job waits on environment
   `npm-stable`. Approve with `gh api -X POST repos/lidge-ai/ima2-gen/actions/runs/<id>/pending_deployments -f environment_ids[]=<id> -f state=approved -f comment="post-3.14.0 cleanup release, authorized 2026-09-08"`
   (environment id via `gh api repos/lidge-ai/ima2-gen/environments`). publish.yml's
   stable job is gated the same way; approve it too. If the account cannot approve
   (403) -> NEEDS_HUMAN.
3. Verify: `git fetch --tags`; `gh release view v<V>`; `npm view ima2-gen@latest version gitHead`;
   `npm view ima2-gen@preview version gitHead`; all == release SHA R; main/dev/preview == R;
   `node scripts/release-contract.mjs finalize-check <V> R` exit 0.
4. Pages: `gh workflow run pages.yml --ref main -f release_sha=R -f release_version=<V>`; wait;
   fetch https://lidge-ai.github.io/ima2-gen/install-mac.sh (+linux, windows.ps1) with
   `curl -sS -H 'Cache-Control: no-cache'` and `shasum -a 256` vs `git show R:site/public/<file>`.
   Known: the 2026-09-06 tag-ref dispatch failed while main-ref succeeded; use --ref main.
5. Published artifact: `TMP=$(mktemp -d); npm pack ima2-gen@<V> --pack-destination $TMP`;
   verify integrity vs `npm view ima2-gen@<V> dist.integrity`; `npm install -g --prefix $TMP/g $TMP/ima2-gen-<V>.tgz`;
   run with isolated `HOME=$TMP/home IMA2_PORT=<free> IMA2_CONFIG_DIR=...` (use the
   existing tests/package-install-smoke.mjs env contract: IMA2_PACKAGE_TARBALL) ->
   `curl /api/health` version == V.
6. Visual: Computer-use `cua.createBrowserTab("iab", "http://127.0.0.1:<port>", {visible:true})`;
   screenshot home, Settings > Account (NovelAI card present when a dummy token is set
   via /api/keys), Node mode. Save PNGs to .codexclaw/evidence/01a07ce8-b02b-7200-9bfc-300c549d3c70/.
7. Receipts after publication: 051_release_receipt.md in this unit (run ids, SHAs,
   digests, screenshot hashes), then move the unit to _fin at D of wp5. These are
   documentation-only commits delivered by a final PR to dev plus a main sync; their
   ancestry is recorded in the receipt and they do not alter the published artifact.

## Failure handling
Same rollback contract as 130 (never move latest backward; new cut for repairs).

## Accept: c-6, c-7, c-8.

## wp5 P revalidation (2026-09-08, tree d42678f9 = origin/dev after wp1-wp4)
Quoting wp4 D: #225 merged, #150 dispositioned open; direction unchanged.
Preconditions: main is an ancestor of dev (17 commits ahead); open PRs 0; open issues 1 (#150,
documented). package.json 3.14.0 -> release bump minor => 3.15.0 (new quota lane + new error
code, no breaking change). Environments: npm-stable and provider-canary-live reviewer =
lidge-jun (the gh account), npm-preview/github-pages unreviewed. Step 0 CHANGELOG cut is a
PR to dev (codex/p314-wp5-changelog) before the promotion PR.


## wp5 audit fold (round 1, gpt-6-astra, GO-WITH-FIXES blockers=2)
1. Approvals: read `repos/lidge-ai/ima2-gen/actions/runs/<run>/pending_deployments`, require exactly
   one entry with `environment.name == "npm-stable"` and `current_user_can_approve == true`, then
   POST with `-F "environment_ids[]=<id>"` (integer array), `-f state=approved`, `-f comment=...`.
   Two approvals: release.yml `tag` job (release.yml:174/187) and publish.yml `publish-stable`
   (publish.yml:272/283). "No pending", "cannot approve", or a failed run is never treated as done.
   The second wait is bounded to 80 min by release.yml:234.
2. Step 5 split: (a) `GITHUB_SHA=R IMA2_PACKAGE_TARBALL=$TGZ node --test tests/package-install-smoke.mjs`
   (the gitHead assertion only runs with both env vars; the smoke tears its server down);
   (b) separate `npm install -g --prefix $REL_TMP/g $TGZ`, `ima2 --version == V`, then serve with
   isolated IMA2_CONFIG_DIR/IMA2_GENERATED_DIR/IMA2_DB_PATH/IMA2_ADVERTISE_FILE and proxies
   disabled, assert `/api/health .version == V`, use that server for the Computer-use screenshots.
Residuals folded: rollback baseline for this run is 3.14.0 @ 36aa6fce (integrity recorded at
dispatch time), not 131's 3.13.1; main/preview already equal R when the first approval waits,
so a refused/timed-out approval must be recovered from the actual ref state, never reported as
"remotes untouched"; "all == R" means gitHead and refs (latest version 3.15.0, preview
3.15.0-preview.*); no manual publish dispatch or release-branch pushes while release.yml runs
(wait-publish-run.mjs picks the first dispatch after its watermark); pages.yml must dispatch
with --ref main (github-pages environment allows only branch main; the tag-ref run failed on
the environment protection rule) while checking out release_sha itself.

