# 040 wp5 — Release v3.25.0

Class C4 (release). Depends on wp2 and wp3 merged.

1. CHANGELOG (small PR to dev): the release cut commits only package.json and the lockfile, so
   headings are written here. Move the current [Unreleased] entries (3.24.1 pipeline and site work)
   under `## [3.24.1] - 2026-09-29`, add `## [3.25.0] - 2026-09-30` with Added entries for #340 and
   #339 and the review fixes, and leave an empty `## [Unreleased]`.
2. Confirm full `CI` is green for the last code-merge tip on dev (the #339 merge) with every
   test job run, and pair it with the CHANGELOG-only final tip, whose path-filtered run may skip
   tests; record both run ids. A red job is rerun only when its log shows a known flake (Windows
   EBUSY/EPERM temp cleanup, timing); a failure that repeats or touches the merged code is fixed
   forward first. The release cut itself re-checks main push CI for the promotion commit.
3. `gh repo view --json nameWithOwner` = lidge-ai/ima2-gen, then
   `caffeinate -dimsu npm run release -- minor --promote --approve --yes`.
4. On a stop: `npm run release -- resume 3.25.0 --approve --yes`.
5. Verify: `npm view ima2-gen@latest version gitHead` with gitHead equal to the
   "[agent] chore: release v3.25.0" commit that v3.25.0 points at, `gh release view v3.25.0`,
   `gh release view desktop-v3.25.0 --json isDraft,assets`, desktop.yml run event push,
   Pages run success, live site download resolves to desktop-v3.25.0.
6. Record run ids in `050_outcome.md`.

Never touch the local launchd service on port 3333.
