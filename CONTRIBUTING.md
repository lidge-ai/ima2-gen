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

