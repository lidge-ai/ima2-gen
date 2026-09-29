# wp5 — Merge to dev and release preparation

1. Push `codex/260929-background-runtime` to `origin` (lidge-ai/ima2-gen), open PR → `dev`. Body: problem, behaviour, validation. No UI screenshot needed (`desktop/` is outside the gate's `ui/`, `public/`, `assets/` paths).
2. Wait for `PR fast gate`; fix forward until green. Merge (squash, repository convention).
3. Observe post-merge `CI` on `dev`; fix forward if red.
4. Release prep: follow the current pipeline (`devlog/_plan/260927_release_pipeline_simplify`, `.github/workflows/release.yml`, CONTRIBUTING release section). Write release notes for the next minor (new CLI commands = minor), open the dev→main release PR with the notes, wait for its checks. Do not merge it; do not dispatch `release.yml`.
5. Close the unit: move to `_fin/` only after release (not in this goal); record status in `devlog/_plan/README.md`.

wp5 A fold (reviewer GO-WITH-FIXES, 1): the dev→main diff carries #331's `ui/` changes, so the release PR description embeds #331's before/after screenshots. The eventual promotion is a merge commit (release-cut preflight requires main ⊇ dev); that merge and `release.yml` stay with the maintainer.

## Outcome (2026-09-29)

- #335 squash-merged to dev as f0990fea; post-merge CI red only on Windows (three test-side path/handle issues).
- #336 fix-forward (tests + runtime-cli reaps a timed-out CLI) proven by a dispatched full CI on its head (run 36536135494, Windows legs green), squash-merged as 88f89b68.
- dev CI at 88f89b68: CI, Agy filesystem, Desktop build, CodeQL all success. Local gates at the same tree: npm test 3919/0.
- Release PR #337 dev → main, "Release: … (v3.24.0)", generated notes + #331 screenshots, all checks green. Not merged; release.yml not dispatched. Promotion: merge commit, then release.yml bump=minor expected_sha=<merge>.
- Not verified: packaged GUI click-through of the takeover prompt/tray item; live Windows desktop run.
