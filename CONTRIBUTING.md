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

Cross-platform validation is post-merge. Pushes to `dev` run the full
`CI` workflow — Ubuntu, Windows, and macOS jobs —
plus the `Agy artifact filesystem check` matrix and the unsigned macOS
desktop build. A job-level changes filter skips these on pushes that touch
no relevant path, so docs-only merges still land green. The aggregate `ci`
job fails when any requested leg is missing or red.

A red `dev` run is a regression to fix forward on `dev` — not a signal to
revert the merge or re-run the PR gate. CodeQL keeps running on pull
requests because it is the pre-merge security scan.

## Releasing (maintainers)

`dev` is the only long-lived source and release branch. A successful push-event
`CI` run on `dev` triggers `release.yml` automatically with `bump=patch`.
The workflow resolves the current dev head before installing dependencies and
skips an already published, release-subject, or strictly older head. Automatic
runs must match the current dev SHA; a queued stale run cannot release newer or
older work. Ordinary dev pushes do not trigger `publish.yml` directly.

Maintainers can run the same exact-SHA path manually with `gh` signed in:

```bash
npm run release -- patch --approve --yes   # or minor / major
```

`scripts/release.mjs` fetches `origin/dev`, dispatches `release.yml --ref dev`
with `expected_sha`, watches this run, approves only its `npm-stable` and
`desktop-production` deployments with `--approve`, and keeps watching until
the desktop release is published. `--dry-run` verifies without moving dev,
tags, or packages. `--canary` also creates and cleans up a leased candidate ref
so the exact-candidate CI path is exercised. The retired `--promote` flag and
all dev-to-main promotion PRs are gone.

The cut verifies the version commit before moving dev. A version-only commit
may reuse a complete green dev push CI; otherwise a leased candidate ref proves
exact-SHA CI. Dev then advances to the version commit so the dispatched preview
can require `refs/heads/dev == publish_sha`. After preview proof and the
`npm-stable` approval, one atomic push reasserts dev and creates `vX.Y.Z`.
Dev is frozen between the version push and stable tag. Stable publication still
verifies the tested tarball, npm gitHead, immutable versions, integrity and
Sigstore provenance before creating the GitHub Release and deploying Pages.

If dev moves before the tag, the cut fails closed. Finish the existing release
without cutting another version:

```bash
npm run release -- resume X.Y.Z --approve --yes
```

Resume bypasses the no-op resolver, finds the release tag or exact release-subject
commit on dev, requires dev to contain that SHA, and mints only a missing tag before
finishing stable publish, desktop and Pages. An untagged resume also requires the
npm preview gitHead proof. Run it before another cut replaces that preview proof.

`desktop-v*` tags remain admin-only. The workflow token cannot create them, so
`scripts/release.mjs` pushes `desktop-vX.Y.Z` at the exact stable commit from
the maintainer machine and approves `desktop-production`. Never point that tag
at another commit.

Repository migration retargets every open PR to dev, makes dev the default
branch, narrows branch deletion protection to dev, and only then deletes the
remote `main` and `preview` branches. Dependabot also targets dev.
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
