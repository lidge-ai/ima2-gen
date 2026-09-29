# Contributing

## Local checks

Run these in order. Stop at the first red command.

1. `npm run typecheck`
2. `npm test`
3. `cd ui && npm run build` — only when the change touches `ui/`

`npm run verify:release:source` is optional before a PR. It chains native
deps, both typechecks, inventory, UI build, server/CLI build, the full
suite, package lint, install policy, and the audit gate. CI already runs
the release-relevant subset. Do not treat the full local chain as required.

## CI

Pull requests run one minimal contract: the `PR fast gate` check
(`pr-fast.yml`, Ubuntu only — backend suite plus frontend e2e; a `changes`
filter skips both for docs/devlog-only PRs). Keep it
fast; do not add Windows or macOS legs to it.

Cross-platform validation is post-merge. Pushes to `dev` (and `main` /
`preview`) run the full `CI` workflow — Ubuntu, Windows, and macOS jobs —
plus the `Agy artifact filesystem check` matrix and the unsigned macOS
desktop build. A job-level changes filter skips these on pushes that touch
no relevant path, so docs-only merges still land green. The aggregate `ci`
job fails when any requested leg is missing or red.

A red `dev` run is a regression to fix forward on `dev` — not a signal to
revert the merge or re-run the PR gate. CodeQL keeps running on pull
requests because it is the pre-merge security scan.

## Releasing (maintainers)

One command runs the whole release from a maintainer machine with `gh` signed in:

```bash
npm run release -- patch --promote --approve   # or minor / major
```

`scripts/release.mjs` merges the dev -> main promotion PR (`--promote`),
dispatches `release.yml` pinned to that main SHA, watches it, approves the
`npm-stable` and `desktop-production` deployments of this release
(`--approve`; without it the script prints the approve commands), and keeps
watching until the desktop release is published. Add `--dry-run` to verify
without touching any remote, `--canary` to also exercise the candidate CI gate,
and `--yes` to skip the confirmation prompts.

Inside `release.yml` the cut reuses main's push CI when the version commit only
changes `package.json`/`package-lock.json` (a dedicated candidate CI run is
dispatched otherwise), publishes the preview, then the tag job pushes `main` and
`vX.Y.Z` atomically and lands the release on `dev` (a fast-forward, or a merge
commit when PRs merged into dev during the release, so dev may keep moving). It
then verifies `desktop-vX.Y.Z` and runs the npm stable publish, and finally
dispatches the Pages deploy. The approvals stay on purpose: `npm-stable` gates the tag
and the stable publish, and `desktop-production` gates the public desktop
release.

`desktop-v*` tags start a signed build, so the "Protect desktop release tags"
ruleset lets only repository admins create them; the workflow token cannot. That
is why `scripts/release.mjs` pushes `desktop-vX.Y.Z` itself, from the
maintainer's machine, as soon as `vX.Y.Z` lands. The push starts the desktop
build in parallel with the npm stable publish. Run the release as a repository
admin; otherwise the script prints the `git push` command for an admin.

If a release stops after the tag landed (an approval timed out, dev could not be
merged, a publish or desktop step failed), finish it without a new version:

```bash
npm run release -- resume X.Y.Z --approve
```

Resume verifies that `vX.Y.Z` exists, that its `package.json` says `X.Y.Z` and
that main contains it, then runs only what is still missing: landing on dev, the
desktop tag and build, the stable publish (skipped when npm latest already has
that commit and the GitHub release exists), and the Pages deploy.

## Devlog

Implementation work belongs in a numbered unit under
`devlog/_plan/YYMMDD_slug/`. Do not add bare `PLAN.md` / `PHASES.md`
files.

## Pull requests

- Keep one logical change per PR.
- Do not publish, change dist-tags, dispatch release workflows, or merge
  from the PR itself unless that is the explicit task.
- Do not attach cookies, OAuth tokens, API keys, or generated base64.
- PRs that touch `ui/`, `public/`, or an image under `assets/` need a
  screenshot in the description; the `screenshot-gate` check re-runs on
  description edits until one is present. PR screenshots go in the pull
  request description, never on your branch: drag the image into the
  description editor, or, with push access, commit it to the `pr-assets`
  branch and link it by commit SHA (see that branch's README). Evidence
  images committed to a PR branch ride the merge into the integration
  branch. A maintainer can waive the gate with the `ui-screenshot-waived`
  label or a comment stating the change does not touch the UI.
