# 260929 Release hardening and desktop-first site — plan

The last two releases stopped halfway for two unrelated reasons, and both times the
rest was finished by hand. v3.23.2 (run 36319990726) failed because a PR merged into
dev during the release and the stable publish demanded that dev point exactly at the
release commit. v3.24.0 (run 36544518997) failed because the `desktop-v*` tag ruleset
lets only admins create tags, so the workflow token could not push `desktop-v3.24.0`.
This unit makes the release finish on its own in both situations, adds a resume path
for anything that still stops midway, and then moves the desktop app to the top of
the landing page. It ends with a real release through the new pipeline.

## Loop spec

| Field | Value |
|---|---|
| Loop archetype | satisfy-spec, docs-first multi-cycle (wp0 roadmap, wp1-wp3 build) |
| Trigger | User: harden fully, polish the site so the desktop app leads, deploy; Kimi subagents unlimited |
| Goal | A release that survives a moving dev and creates its desktop tag from CI; a resumable tail; a desktop-first landing page; a live release proving both |
| Non-goals | Product runtime/UI outside `site/`; the local launchd ima2 service on port 3333; OpenCodex; secrets other than the new deploy key; rewriting the cut job; removing the npm-stable approval |
| Verifier | `npm run typecheck`, `npm run lint`, `node --test tests/release-pipeline-contract.test.ts tests/release-command.test.ts` (via `npm test`), `actionlint .github/workflows/release.yml .github/workflows/publish.yml`, `npm --prefix site run build`, headless screenshots, PR checks, dev CI run, release run, `npm view ima2-gen@latest version gitHead`, `gh release view` |
| Stop condition | Release vNEXT is live on npm latest, GitHub release, desktop-vNEXT with assets + SHA256SUMS, Pages redeployed; or a BLOCKED/NEEDS_HUMAN outcome below |
| Memory artifact | This unit (000-030) plus `.codexclaw/goalplans/` ledger |
| Expected terminal outcomes | DONE (live release, every criterion evidenced); BLOCKED (GitHub refuses an admin change from this account); NEEDS_HUMAN (desktop signing credentials fail); UNSAFE (a step would touch port 3333 or non-release secrets) |
| Escalation condition | Ruleset/deploy-key change refused; a merge conflict landing the version commit on dev; signed build failure for credential reasons |

HOTL resource bounds: tool scope is local git/npm/node, `gh` for this repository
(including admin settings for one deploy key, one environment secret and one
ruleset bypass entry), Kimi subagents; write scope is this worktree plus those three
GitHub settings; no token or wall-clock budget was set by the user.

## Evidence

- Ruleset 23844976 "Protect desktop release tags": include `refs/tags/desktop-v*`,
  rules creation/update/deletion, bypass only RepositoryRole 5 (admin). No deploy keys.
- Branch ruleset 22470316 covers main/preview/dev with only the deletion rule, so
  a bot merge push to dev is allowed.
- `scripts/release-contract.mjs` `validateRemoteRefs` (line 187) requires
  main, dev, preview and the tag to equal the SHA; pinned by
  `tests/release-pipeline-contract.test.ts` line 90.
- `.github/workflows/release.yml` tag job pushes main+dev+tag atomically (line 238),
  then pushes `desktop-v` with the workflow token (line 259) and dispatches desktop.yml.
- `desktop.yml` also triggers on `push: tags: desktop-v*` with
  `concurrency: desktop-${{ github.ref }}`, `cancel-in-progress: true`.
- `scripts/release.mjs` parses `--yes` but calls `ctx.ask` unconditionally (lines 153, 280).
- `scripts/wait-publish-run.mjs` `pickRun` adopts any dispatch above the mark and
  gives discovery 3 minutes.
- Site: landing order Hero, TwoWorkflows, LatestCapabilities, WhyBranch,
  LocalAndOAuth, Marquee, InstallFooter, FAQ. Desktop downloads live only in
  `InstallFooter` and the global `ReleaseBanner`; Hero leads with an npm command.
  Download URLs resolve client-side in `site/src/scripts/desktopRelease.ts`.

## Architect consultation (Kimi, handle 01a0ec98-b0dd-7250-9c78-922eccbadacb)

Proposal decisions and main dispositions:

| ID | Proposal | Disposition |
|---|---|---|
| D1 | Write deploy key, secret on npm-stable, DeployKey bypass, SSH push, drop the desktop dispatch | Accepted; amended: the resume path dispatches desktop.yml only when the tag already existed and no published desktop release exists |
| D2 | Stable: tag exact, main/dev/preview ancestor; preview publish exact | Accepted |
| D3 | Atomic main+tag, then land on dev by fast-forward or merge with retry | Accepted as a new `release-cut.mjs land-dev` command with a pure planner |
| D4 | Separate `resume` job | Amended: one tag job serves both modes, normal-only steps gated by `inputs.resume_version == ''`, so the tail exists once |
| D5 | `--yes` wraps ask; `resume X.Y.Z` first argument | Accepted; plus watchDesktop returns success when the desktop release is already published |
| D6 | Test map | Accepted |
| F2 | pickRun filters by run title | Accepted |
| F3 | Recheck refs only when actually publishing | Accepted for the stable job |
| F7 | 3 minute discovery | Accepted, raised to 10 minutes |
| F1, F4, F5, F6 | Double approval, single-flight preview, fire-and-forget desktop, cut recovery | Recorded; F1 is handled by `--approve` and resume, F4 bounds resume to the latest cut, F5 by watchDesktop, F6 out of scope |

Reflection: see the end of this file after the architect's check.

## Phase map (dependency order)

| Work-phase | Doc | Delivers | Proof |
|---|---|---|---|
| wp0 | this file + 010-030 | Roadmap | Kimi reviewer audit |
| wp1 | 010_release_pipeline.md | Hardened release scripts, workflows, GitHub settings, docs | typecheck, lint, release tests, actionlint, gh api reads, PR fast gate |
| wp2 | 020_site_desktop_first.md | Desktop-first landing page | site build, screenshots, PR fast gate + screenshot gate |
| wp3 | 030_delivery.md | Release through the new pipeline | run ids, npm, GitHub releases, Pages |

wp2 depends on wp1 only for merge order; the site deploys from the release SHA
(`pages.yml` checks out `release_sha`), so both must be on dev before wp3.

## Source of truth sync

`CONTRIBUTING.md` "Releasing (maintainers)" is the release SoT and is patched in wp1.
`CHANGELOG.md` gets entries in wp1 and wp2.


## Reflection record

Same architect (01a0ec98-b0dd-7250-9c78-922eccbadacb) answered ALIGNED for plan revision
000/010/020/030 as first written; its five gaps and two minor notes are folded into
010 "Amendments after architect reflection". No design decision changed, so no second
reflection round is needed.

