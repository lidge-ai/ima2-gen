# 010 wp1 — Release pipeline hardening

Depends on: 000. Class C4 (release surface). Every change below is exact; line
numbers are from `origin/dev` 6e4e55e2.

## 1. `scripts/release-contract.mjs` (MODIFY)

`validateRemoteRefs` (line 187) gains a `contains(ancestor, descendant)` predicate.

Before:
```js
export function validateRemoteRefs({ ref, sha, refs }) {
  const required = ref === "refs/heads/preview" ? ["preview"] : ref.startsWith("refs/tags/") ? ["main", "dev", "preview", ref.slice("refs/tags/".length)] : [];
  if (!required.length) throw new Error(`unsupported publish ref ${ref}`);
  for (const name of required) {
    if (refs[name] !== sha) throw new Error(`remote ${name} is ${refs[name] || "missing"}, expected ${sha}`);
  }
}
```
After:
```js
export const STABLE_BRANCHES = ["main", "dev", "preview"];

export function validateRemoteRefs({ ref, sha, refs, contains }) {
  if (ref === "refs/heads/preview") {
    if (refs.preview !== sha) throw new Error(`remote preview is ${refs.preview || "missing"}, expected ${sha}`);
    return;
  }
  if (!ref.startsWith("refs/tags/")) throw new Error(`unsupported publish ref ${ref}`);
  const tag = ref.slice("refs/tags/".length);
  if (refs[tag] !== sha) throw new Error(`remote ${tag} is ${refs[tag] || "missing"}, expected ${sha}`);
  if (typeof contains !== "function") throw new Error("a stable ref check needs a contains() predicate");
  for (const name of STABLE_BRANCHES) {
    if (!refs[name]) throw new Error(`remote ${name} is missing, expected it to contain ${sha}`);
    if (!contains(sha, refs[name])) throw new Error(`remote ${name} (${refs[name]}) does not contain ${sha}`);
  }
}
```
Add next to `remoteRefMap`:
```js
function gitContains(ancestor, descendant) {
  return run("git", ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}
```
Callers `assertRemoteRefCommand` (line 431) and `prepareCommand` (line 455) pass
`contains: gitContains`.

## 2. `scripts/release-cut.mjs` (MODIFY)

Add two pure functions and two commands.

```js
/** How the version commit reaches dev after main and the tag landed. */
export function planDevLanding({ devContainsSha, shaContainsDev }) {
  if (devContainsSha) return "noop";
  if (shaContainsDev) return "fast-forward";
  return "merge";
}

/** A resume may only finish a version whose tag, package version and main agree. */
export function assertResumable({ version, sha, packageVersion, mainContainsSha }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) problems.push(`resume version must be stable X.Y.Z (got ${version})`);
  if (!FULL_OID.test(String(sha || ""))) problems.push(`tag v${version} does not exist on the remote`);
  else {
    if (packageVersion !== version) problems.push(`package.json at v${version} is ${packageVersion ?? "(unreadable)"}`);
    if (!mainContainsSha) problems.push(`origin/main does not contain v${version} (${sha})`);
  }
  return problems;
}
```
Commands (added to `COMMANDS`, usage string updated):
- `land-dev <sha> <version>` — up to 3 attempts: `git fetch origin dev`; plan with
  `contains(sha, origin/dev)` and `contains(origin/dev, sha)`; `noop` logs and returns;
  `fast-forward` runs `git push origin <sha>:refs/heads/dev`; `merge` runs
  `git checkout -B release-dev-landing origin/dev`,
  `git merge --no-ff --no-edit -m "[agent] chore: land release v<version> on dev" <sha>`
  (on conflict: `git merge --abort`, fail with "merge <sha> into dev by hand, then
  npm run release -- resume <version>"), then `git push origin HEAD:refs/heads/dev`.
  A rejected push refetches and retries; never `--force`. Sets the bot identity first.
- `resume-guard <version>` — `git rev-list -n1 refs/tags/v<version>` (empty when absent),
  `git show <sha>:package.json` version, `contains(sha, origin/main)`;
  `assertResumable`; emits `version` and `sha` to `GITHUB_OUTPUT`.

## 3. `scripts/wait-publish-run.mjs` (MODIFY)

- `pickRun(runs, afterRunId, title)`: extra filter `!title || run.displayTitle === title`.
- `listRuns` JSON fields add `displayTitle`.
- `DISCOVERY_TIMEOUT_MS` 3 → 10 minutes.
- CLI: `wait <afterRunId> <label> [timeoutMinutes] [runTitle]`.

## 4. `.github/workflows/release.yml` (MODIFY)

Inputs: add
```yaml
      resume_version:
        description: 'Resume an already-tagged X.Y.Z: skip the cut, finish dev, desktop, stable publish and Pages (needs dry_run=false)'
        required: false
        default: ''
        type: string
```
New first job:
```yaml
  refuse-dry-resume:
    name: Refuse a resume that is not a real release
    if: inputs.resume_version != '' && inputs.dry_run != 'false'
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo "resume_version needs dry_run=false; a resume only finishes a real release"
          exit 1
```
`cut`: add `if: inputs.resume_version == ''`. Its preview wait passes the title
`"Publish refs/heads/preview"` as the fourth argument.

`tag` job:
- `if: ${{ !cancelled() && inputs.dry_run == 'false' && (inputs.resume_version != '' || (needs.cut.result == 'success' && needs.cut.outputs.dry_run == 'false')) }}`
- checkout `ref: ${{ needs.cut.outputs.sha || format('refs/tags/v{0}', inputs.resume_version) }}`
- new step `id: target` "Resolve the release version and SHA": resume →
  `node scripts/release-cut.mjs resume-guard "$RESUME_VERSION"`; cut → echo
  `version`/`sha` from `needs.cut.outputs`. Every later step reads
  `steps.target.outputs.version|sha`.
- "Refuse to tag if the remotes moved", "Re-check the preview proof" and the atomic
  push get `if: inputs.resume_version == ''`. The atomic step is renamed
  "Create and atomically push main and the tag" and drops `"$SHA:refs/heads/dev"`.
- new step "Land the release on dev": `node scripts/release-cut.mjs land-dev "$SHA" "$VERSION"` (both modes).
- "Push the desktop release tag" gets `id: desktop_tag`, env
  `DESKTOP_TAG_DEPLOY_KEY: ${{ secrets.DESKTOP_TAG_DEPLOY_KEY }}`; keeps the
  existing-tag SHA check (echo `pushed=false`); otherwise fails fast when the secret is
  empty, writes the key to `~/.ssh` (0600), writes known_hosts with GitHub's pinned
  ed25519 host key (`gh api meta`: `AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl`),
  pushes `git push "git@github.com:${GITHUB_REPOSITORY}.git" "$SHA:refs/tags/desktop-v$VERSION"`
  with `GIT_SSH_COMMAND="ssh -i … -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=…"`,
  removes the key, echoes `pushed=true`. The deploy-key push fires desktop.yml's
  `push: tags` trigger.
- "Start the desktop release build" gets `if: steps.desktop_tag.outputs.pushed != 'true'`
  and skips when `gh release view desktop-v$VERSION --json isDraft --jq .isDraft` prints
  `false`; otherwise dispatches as today (keeps `continue-on-error`).
- new step `id: stable_state` "Check whether the stable release already landed":
  `done=true` only when `npm view ima2-gen@$VERSION gitHead` = SHA, npm latest =
  VERSION and `gh release view v$VERSION` succeeds.
- high-water mark, stable dispatch and wait get `if: steps.stable_state.outputs.done != 'true'`;
  the wait passes the title `"Publish refs/tags/v$VERSION"`.
- Summary and Pages use `steps.target.outputs`; the summary adds
  `resume: npm run release -- resume <version>`.

## 5. `.github/workflows/publish.yml` (MODIFY)

In `publish-stable` only: move "Recheck live release refs" below "Guard immutable
registry version" and gate it with `if: steps.registry.outputs.should_publish == 'true'`,
so an already-published version is verified instead of failing on a moved ref.
`publish-preview` keeps its order.

## 6. `scripts/release.mjs` (MODIFY)

- `parseArgs`: first argument `resume` takes `X.Y.Z` and returns
  `{ mode: "resume", version, flags }` (refuses `--dry-run`, `--canary`, `--promote`);
  bumps return `{ mode: "cut", bump, flags }`.
- `runRelease`: `ask: flags.has("--yes") ? () => Promise.resolve(true) : deps.ask ?? confirm`.
- Resume flow: no promotion; high-water mark; ask "Resume v<version>?"; dispatch
  `gh workflow run release.yml -f bump=patch -f dry_run=false -f resume_version=<version>`;
  watch as today; then `watchDesktop`.
- `watchDesktop`: each round first reads `gh release view desktop-v<version> --json isDraft`;
  `isDraft: false` returns `"success"` (the release is already public).
- USAGE mentions `resume X.Y.Z`.

## 7. GitHub settings (admin, via `gh`)

1. `ssh-keygen -t ed25519 -N "" -C "ima2-gen release.yml desktop tag" -f /private/tmp/ima2rh/desktop_tag_key`
2. `gh repo deploy-key add /private/tmp/ima2rh/desktop_tag_key.pub -R lidge-ai/ima2-gen --allow-write --title "release.yml desktop-v tag push"`
3. `gh secret set DESKTOP_TAG_DEPLOY_KEY --env npm-stable -R lidge-ai/ima2-gen < /private/tmp/ima2rh/desktop_tag_key`
4. `gh api -X PUT repos/lidge-ai/ima2-gen/rulesets/23844976` with bypass actors
   `[{actor_id:5, actor_type:"RepositoryRole", bypass_mode:"always"}, {actor_id:null, actor_type:"DeployKey", bypass_mode:"always"}]`,
   other fields unchanged.
5. Delete the private key file. Proof: `gh api …/keys`, `gh secret list --env npm-stable`,
   `gh api …/rulesets/23844976 --jq .bypass_actors`.

Bypass record (PLAN-BYPASS-NAMED-01): tier E-settings; surface GitHub ruleset;
known bypass: repo admins and any deploy key; residual risk: the write key could push
branches, limited by living only in the reviewer-gated npm-stable environment;
wording: "restricted to admins and the release deploy key".

## 8. Tests (MODIFY)

`tests/release-pipeline-contract.test.ts`:
- Replace "requires every live stable ref…" (line 90): tag exact; main/dev/preview at
  descendants pass with a `contains` stub; dev not containing fails
  (`/does not contain/`); missing `contains` fails; preview publish exact.
- `planDevLanding` three outcomes; `assertResumable` pass + four refusals.
- `pickRun` with a title ignores a foreign dispatch above the mark.
- Workflow shape: tag job `if` contains `inputs.dry_run == 'false'` and never `!= 'true'`;
  atomic push block has no `refs/heads/dev`; land-dev step between atomic push and
  desktop tag; desktop tag uses `DESKTOP_TAG_DEPLOY_KEY`, `StrictHostKeyChecking=yes`
  and the pinned key; desktop dispatch gated on `pushed != 'true'`; cut gated on
  `resume_version == ''`; refuse-dry-resume job; stable dispatch gated on
  `stable_state`; `release-cut.mjs` contains no `--force`.
- Update "pushes or verifies the desktop tag…" (line 997) for the new step names.
- publish-stable: recheck after guard and gated by `should_publish`.

`tests/release-command.test.ts`:
- resume parse, bad version, `--promote` refusal.
- `--yes` never calls an `ask` that throws.
- resume dispatch argv; watchDesktop success on a published desktop release.

## 9. Docs (MODIFY)

- `CONTRIBUTING.md` "Releasing (maintainers)": dev may move during a release;
  desktop tag comes from the deploy key; `npm run release -- resume X.Y.Z`.
- `CHANGELOG.md`: date the 3.24.0 heading 2026-09-29; add `## [Unreleased]` with a
  Changed entry for the release pipeline.

## Acceptance (activation scenarios)

| Path | Trigger in C | Observable effect |
|---|---|---|
| dev moved | unit test: dev at descendant, contains stub true | no throw |
| dev lost the SHA | contains stub false | throws "does not contain" |
| land-dev merge | pure planner: neither contains | returns "merge" |
| resume guard | tag missing / version mismatch / main lacks SHA | problem strings |
| --yes | ask throws, `--yes` passed | runRelease completes |
| desktop already public | scripted `gh release view` isDraft false | watchDesktop "success" without run list |
| deploy-key push | real release in wp3 | tag job step log "pushed=true" and a push-event desktop run |
| stable already landed | real resume or rerun in wp3 if needed; otherwise shape test | skip of dispatch |

Verifiers (run at P): `npm run typecheck` exit 0 and `actionlint` exit 0 on origin/dev;
`node --test` reads the two test files directly (target is a direct argument).


## Amendments after architect reflection (ALIGNED, 5 gaps + 2 minor)

- G1 `stable_state`: every probe is failure tolerant —
  `GITHEAD=$(npm view "ima2-gen@$VERSION" gitHead 2>/dev/null || true)`,
  `LATEST=$(npm view ima2-gen@latest version 2>/dev/null || true)`,
  `gh release view "v$VERSION" >/dev/null 2>&1 && HAS_GH=1 || HAS_GH=0`; default `done=false`.
- G2 desktop dispatch: `STATE=$(gh release view "desktop-v$VERSION" --json isDraft --jq .isDraft 2>/dev/null || echo missing)`;
  skip only on `false`; also skip when `gh run list --workflow desktop.yml --branch "desktop-v$VERSION" --json status`
  shows a run that is not completed (minor 6), so a healthy in-flight build is not cancelled.
- G3 `watchDesktop`: the release probe is wrapped in try/catch; a throw counts as "not published yet".
  Test adds the missing-release case (runner throws for `release view`).
- G4 order in the tag job: checkout → setup-node → "Fetch release branches and tags" → "Resolve the release version and SHA" (`id: target`) → guards.
- G5 shape test pins `!cancelled()` and `needs.cut.result == 'success'` in the tag job `if`.
- minor 7: resume branches before `ensurePromoted`; usage text never interpolates an undefined bump.


- Audit N5: the ruleset PUT is read-modify-write: GET the ruleset, resend name, target, enforcement, conditions, rules and the new bypass_actors.
- Audit N4: anchors drift by a line or two (validateRemoteRefs 188, desktop push 260, InstallFooter script 75-122); names are authoritative.

## wp1 audit fold-back (reviewer GO-WITH-FIXES, blockers=0)

- R1 G2 literal: `RUNNING=$(gh run list --workflow desktop.yml --branch "desktop-v$VERSION" --limit 30 --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo 0)`; skip when `STATE = false` or `RUNNING != 0`. Shape test pins `--branch "desktop-v$VERSION"` and `select(.status != "completed")`.
- R2 shape test on the `stable_state` block: `gitHead 2>/dev/null`, `HAS_GH=0`, `done=false` default, `>> "$GITHUB_OUTPUT"`.
- R3 shape test: `id: target` precedes "Refuse to tag"; after it no tag-job step reads `needs.cut.outputs.version` or `needs.cut.outputs.sha` except the target step itself.
- R4 refuse-dry-resume test pins the exact `if`.
- R5 publish-preview recheck keeps no `should_publish` gate (doesNotMatch).
- R6 resume dispatch test asserts no `gh pr list` / `rev-list --count` call.


## B-phase amendment: D1 → D1' (GitHub refused both CI-side tag credentials)

Observed in B (2026-09-29):
- `gh repo deploy-key add … --allow-write` → HTTP 422 "Deploy keys are disabled for this repository";
  `gh api orgs/lidge-ai` → `deploy_keys_enabled_for_repositories: false` (org-wide policy).
- Ruleset PUT with `{actor_id:15368, actor_type:"Integration"}` → 422 "Actor GitHub Actions
  integration must be part of the ruleset source or owner organization".
- `structure/06-infra-operations.md` line 190 explains the creation restriction: without it any
  push-access actor can mint the tag that spends the signing secrets. So the rule stays.

Nothing was created: no deploy key, no secret, ruleset unchanged. The local key pair was deleted.

D1': the tag job only checks `desktop-vX` (id `desktop_tag`, output `present`), never pushes it.
`scripts/release.mjs` (run by an admin, the documented release path) polls
`git ls-remote --tags origin refs/tags/vX refs/tags/desktop-vX` while it watches the run and
pushes `git push origin <sha>:refs/tags/desktop-vX` once `vX` exists (`desktopTagAction`:
wait/push/done/conflict). A user push fires desktop.yml's push trigger. The CI dispatch step runs
only when the tag is present (resume, or release.mjs was faster) and keeps the STATE/RUNNING skip.
Read/push failures are logged and retried; a conflict stops the watcher.
Alternative left to the user: enable deploy keys for the org and move the push into CI.
Criterion c-5 is re-scoped to "ruleset kept admin-only; no new credential needed", observed via gh api.


D1' reflection (same architect, ALIGNED) folded: a GH013 rule rejection stops the push retries
and names the admin requirement (`isRuleRejection`); the CI notice names the admin requirement;
the stale deploy-key comment is gone. Risk kept on record: desktop-vX is pushed when vX lands,
before the stable publish finishes, so a release that fails afterwards can leave a signed desktop
*draft* for a version npm never shipped. Publication still needs desktop-production approval, and
a resume completes the npm side.
