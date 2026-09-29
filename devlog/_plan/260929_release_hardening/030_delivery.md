# 030 wp3 — Delivery through the hardened pipeline

Depends on: 010 and 020 merged to dev. Class C4 (release).

1. Confirm post-merge `CI` on dev is green for the dev tip (run id recorded).
2. `npm run release -- patch --promote --approve --yes` from this worktree with
   `gh` signed in. Expected: promotion PR merged, release.yml run with
   `expected_sha`, cut reuses main push CI (version-only), preview publish, tag job
   pushes main+tag, lands dev (noop or merge), pushes `desktop-vX` with the deploy key
   (`pushed=true` in the log), a push-event desktop.yml run starts, stable publish,
   Pages dispatch. `--approve` approves npm-stable (twice) and desktop-production.
3. If any step stops: `npm run release -- resume X --approve --yes`, which exercises
   the resume path for real.
4. Verify:
   - `npm view ima2-gen@latest version gitHead` = X / release SHA
   - `gh release view vX` (Latest) and `gh release view desktop-vX --json isDraft,assets`
     (non-draft, dmg/exe/AppImage/deb + SHA256SUMS.txt)
   - desktop.yml run for `desktop-vX` has event `push` (deploy-key trigger) and succeeded
   - Pages run success and the live site shows the desktop hero
     (`https://lidge-ai.github.io/ima2-gen/` screenshot)
5. Record run ids and outcomes in `040_outcome.md`, move the unit to `devlog/_fin/` in a
   follow-up docs PR only if requested; otherwise leave it in `_plan` with the outcome.

Never touch the local launchd ima2 service on port 3333.

