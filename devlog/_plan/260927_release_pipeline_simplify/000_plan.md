# 260927 release pipeline simplify — roadmap

Loop-spec: HOTL goal (session 01a0e2ec-3e1a-7a83-899d-0edcd1d3471c). Class C3 (CI/release
contracts, no app runtime change). Tool scope: gh (read, PR create/merge to dev, push to
codex/ branches and PR #331 branch), Kimi subagents. Write scope: .github/workflows, scripts,
ui/playwright.config.ts, package.json scripts, tests/*contract*, CONTRIBUTING.md, structure/06,
this devlog unit. Out: app features, real release/publish, main/preview pushes, repo
settings/environments/secrets. Wall clock: this session.

## Problem (measured 2026-09-27)

| Stage | Run | Wall time | Dominant step |
|---|---|---|---|
| PR Fast Gate | 36318668408 | 19m | frontend e2e 17m18s (Playwright workers:1, 270 tests serial) |
| PR Fast Gate | 36317938255 | 15m | frontend e2e 12m19s |
| Release (v3.23.1) | 36295910420 | 62m | cut 49.5m, tag 12m |
| - candidate CI | 36296122347 | 23m | frontend e2e 22m (same suite as PR) |
| - publish preview | 36297248576 | 22m | package 4.7m, windows-consumer 7.4m, publish+registry proof 9.3m |
| - publish stable | 36298347663 | 11.4m | package 5.1m (full verify:release:source again), publish 4.2m |
| main push CI | 36295909631 | 20m | ran concurrently with candidate CI on the same tree (promotion merge) |
| Desktop tag | 36298639065 | 11m | started by a hand-pushed desktop-v tag after the release |
| Pages | 36299128689 | 1.5m | hand-dispatched after the release |

Human/agent steps per release today (devlog/_fin/260926_pr325_merge_release/030):
promotion PR dev->main, dispatch release.yml with expected_sha, approve npm-stable twice,
push desktop-vX tag, approve desktop-production, dispatch pages.yml with sha/version.

## Comparison

- OpenCodex: release never re-runs tests; publish requires a green push-event CI run for
  the exact SHA; artifacts built once and verified by receipt; one local command
  (`bun run release`) bumps, pushes, waits for CI, dispatches and watches. ~18m release.
- cli-jaw: desktop assets build in a separate workflow started by the release, in parallel
  with npm publish.
- Aside research (Playwright docs, npm trusted publishing docs, GitHub docs): parallelize or
  shard Playwright instead of caching browsers; reuse the CI result of the same content
  instead of re-running; keep a single publish workflow file because npm trusted
  publishing binds to its filename; run desktop builds in parallel with npm publish.

## Decisions

- D1 Parallel e2e: Playwright runs spec files on several workers on CI (fixtures already
  isolate each app: mkdtemp home, dynamic loopback port, per-worker runtime build).
  Serial local default stays. Evidence comes from the PR run itself (the suite refuses to
  run outside GitHub-hosted Linux runners, appServer.ts:121).
- D2 Reuse main CI in the release cut: when the version commit changes only
  package.json/package-lock.json and a push-event ci.yml run on main for the parent SHA
  succeeded with test/windows/macos-install/e2e all actually run, the cut skips the
  candidate CI dispatch. It waits for that run if still in progress. A red run fails the
  cut. Anything else (no run, docs-only skipped jobs, canary mode) falls back to today's
  candidate CI path. verify:release on the exact SHA before main moves stays.
- D3 Stable package job builds and packs without re-running the full source suite: the
  same gitHead already passed verify:release:source on the preview lane, and prepare
  re-verifies that preview proof for the latest channel (same rationale as the existing
  windows-consumer skip). Install smoke of the exact tarball stays.
- D4 Desktop release in parallel: the tag job pushes desktop-vX at the same SHA and
  dispatches desktop.yml on that tag ref right after the atomic main/dev/tag push, so
  desktop builds while npm stable publishes. desktop.yml accepts a workflow_dispatch on a
  desktop-v tag ref as the release path (draft_release/publish conditions widen from
  push-only to tag ref). desktop-production approval stays.
- D5 Pages auto-dispatch: after the stable publish succeeds, the tag job dispatches
  pages.yml on main with the release sha/version.
- D6 One command: `npm run release -- <patch|minor|major>` (scripts/release.mjs) checks
  promotion state (dev ahead of main -> opens/merges the promotion PR with --promote),
  dispatches release.yml with expected_sha, watches the run, and approves the pending
  npm-stable / desktop-production deployments for this release when run with --approve.
- Kept (safety contracts): publish.yml stays the only id-token holder and the npm
  trusted-publishing file; both npm-stable approvals (tag job and publish-stable) and
  desktop-production remain; preview publish + preview proof before tagging; exact-SHA
  correlation, assert-remotes-unmoved, atomic push; registry/provenance proof.
- Rejected: dropping the preview lane (removes the preview proof contract); npm dist-tag
  promotion of one tarball (preview version string differs; OIDC dist-tag support
  unverified); removing the second npm-stable approval (it guards hand-pushed tags and no
  unforgeable signal distinguishes release.yml dispatches).

## Work phases

| wp | doc | outcome | depends |
|---|---|---|---|
| wp1 | 000_plan.md | this roadmap | - |
| wp2 | 010_wp2_pr_ci_speed.md | D1 + PR gate cleanup | wp1 |
| wp3 | 020_wp3_release_flow.md | D2-D6 + docs | wp1 |
| wp4 | 030_wp4_merge.md | PR to dev, green, merge; #331 merge; post-merge dev CI | wp2, wp3 |

## Expected after

PR gate ~19m -> ~7m (e2e bound by worker count). Release ~62m (+11m desktop +manual steps)
-> ~30m with desktop in parallel: cut = setup 2 + verify 4 + main CI reuse (0 when already
green) + preview publish ~21; tag = stable ~7 + pages. Human steps: one command plus the
existing approvals, which the command can grant.

