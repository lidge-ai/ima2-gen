# wp5 — Merge to dev and release preparation

1. Push `codex/260929-background-runtime` to `origin` (lidge-ai/ima2-gen), open PR → `dev`. Body: problem, behaviour, validation. No UI screenshot needed (`desktop/` is outside the gate's `ui/`, `public/`, `assets/` paths).
2. Wait for `PR fast gate`; fix forward until green. Merge (squash, repository convention).
3. Observe post-merge `CI` on `dev`; fix forward if red.
4. Release prep: follow the current pipeline (`devlog/_plan/260927_release_pipeline_simplify`, `.github/workflows/release.yml`, CONTRIBUTING release section). Write release notes for the next minor (new CLI commands = minor), open the dev→main release PR with the notes, wait for its checks. Do not merge it; do not dispatch `release.yml`.
5. Close the unit: move to `_fin/` only after release (not in this goal); record status in `devlog/_plan/README.md`.

wp5 A fold (reviewer GO-WITH-FIXES, 1): the dev→main diff carries #331's `ui/` changes, so the release PR description embeds #331's before/after screenshots. The eventual promotion is a merge commit (release-cut preflight requires main ⊇ dev); that merge and `release.yml` stay with the maintainer.
