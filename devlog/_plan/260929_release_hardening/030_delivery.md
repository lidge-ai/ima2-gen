# 030 wp3 — Delivery through the hardened pipeline

Depends on: 010 and 020 merged to dev. Class C4 (release).

1. Confirm post-merge `CI` on dev is green for the dev tip (run id recorded).
2. `npm run release -- patch --promote --approve --yes` from this worktree with
   `gh` signed in. Expected: promotion PR merged, release.yml run with
   `expected_sha`, cut reuses main push CI (version-only), preview publish, tag job
   pushes main+tag, lands dev (noop or merge), release.mjs pushes `desktop-vX` from this
   machine after fetching `refs/tags/vX`, a push-event desktop.yml run starts, stable publish,
   Pages dispatch. `--approve` approves npm-stable (twice) and desktop-production.
3. If any step stops: `npm run release -- resume X --approve --yes`, which exercises
   the resume path for real.
4. Verify:
   - `npm view ima2-gen@latest version gitHead` = X / release SHA
   - `gh release view vX` (Latest) and `gh release view desktop-vX --json isDraft,assets`
     (non-draft, dmg/exe/AppImage/deb + SHA256SUMS.txt)
   - desktop.yml run for `desktop-vX` has event `push` (the maintainer push) and succeeded
   - Pages run success and the live site shows the desktop hero
     (`https://lidge-ai.github.io/ima2-gen/` screenshot)
5. Record run ids and outcomes in `040_outcome.md`, move the unit to `devlog/_fin/` in a
   follow-up docs PR only if requested; otherwise leave it in `_plan` with the outcome.

Never touch the local launchd ima2 service on port 3333.


## wp3 P amendment (after wp1 D1' and wp2)

- Version: `npm run release -- patch --promote --approve --yes` → v3.24.1 (release pipeline and
  site changes, no product runtime change).
- Precondition: post-merge `CI` on dev tip e9747cc4 green (run id recorded in 040).
- The desktop tag comes from this machine: `release.mjs` runs as `lidge-jun` (org admin), polls
  `git ls-remote` while the run is watched, fetches `refs/tags/v3.24.1` and pushes
  `desktop-v3.24.1`. Expected evidence for c-3: the tag job log shows "Check the desktop release
  tag" with present=false (or true if the push won the race), desktop.yml for desktop-v3.24.1 has
  event `push` and exactly one non-cancelled run, and "Land the release on dev" logs noop or
  fast-forward (merge if a PR landed meanwhile).
- Approvals: `--approve` approves npm-stable (tag job and publish-stable) and desktop-production.
- Failure handling: any stop after the tag → `npm run release -- resume 3.24.1 --approve --yes`.
- Never touch the local launchd service on port 3333; the release does not restart anything locally.

wp3 audit (Kimi reviewer, VERDICT: PASS) folded: before the run, record
`gh repo view --json nameWithOwner` = lidge-ai/ima2-gen (this worktree also has a fork remote);
run the release under `caffeinate -dimsu` so the watcher keeps approving through the window;
start only after dev CI on e9747cc4 is green.

## wp3 B amendment: the first real run stopped between main and the tag

Run 36567557657: main push CI for the promotion commit was red on Windows only (EBUSY in a temp DB
cleanup, then a timing flake); the cut refused to reuse it, as designed. After two reruns it went
green (attempt 3) and release run 36573038192 cut v3.24.1: version commit d71f73cb on main and
preview, preview package 3.24.1-preview.260929.36573790959.1 published at 13:27:06Z. npm kept
answering E404 for that version past the 15-minute registry proof window (last miss 13:42:14Z), so
publish-preview and then the cut failed. No tag exists, so neither resume (needs vX) nor a new cut
(would burn 3.24.2) finishes 3.24.1.

Fix in this phase (C4, release):
1. scripts/release-contract.mjs: REGISTRY_PROOF_TIMEOUT_MS 15 → 35 min, MAX 20 → 45 min.
   publish.yml verify steps 26 → 51 min; release.yml preview wait 100 → 130 min; stable wait
   80 → 130 min; tag job timeout 90 → 150 min. Cut job stays 240 (45 + 45 + 130 + 20).
2. Resume mints a missing tag: resume-guard, when refs/tags/vX is absent, takes the commit on
   origin/main whose subject is exactly "[agent] chore: release vX", requires package.json X,
   main containing it and the npm preview proof (gitHead = SHA, version X-preview.*), and emits
   mint_tag=true. The tag job checks out main in resume mode and runs a new step "Create the
   missing release tag" (GITHUB_TOKEN may push v* tags) before landing dev.
3. Tests, CONTRIBUTING, CHANGELOG. PR to dev, then promote dev → main (the dispatched workflow comes
   from main), then npm run release -- resume 3.24.1 --approve --yes.
The Windows cleanup flake is wp4.

## wp3 B amendment 2: the resumed stable publish ran on main, not on the tag

Resume run 36580960098 minted v3.24.1 at d71f73cb, landed dev (merge bb3cff29), and release.mjs
pushed desktop-v3.24.1 (desktop.yml 36581120764, event push, one run; desktop-production approved
by hand with the same API call --approve makes, because release.mjs stops watching after a failed
run). Publish run 36581080410 failed in "Install-smoke the exact release artifact": the tarball
gitHead d71f73cb was compared with GITHUB_SHA a086d88a, the main tip the dispatch ran on. That only
held while main sat exactly on the release commit.
Fix: release.yml dispatches publish.yml with --ref on the published ref (--ref vX for stable,
--ref preview for preview), and tests/package-install-smoke.mjs compares with PUBLISH_SHA (falling
back to GITHUB_SHA). The 3.24.1 smoke runs from the tag's own tree, so only the --ref change helps
3.24.1; the smoke fix protects later releases. Then promote and resume 3.24.1 again.
