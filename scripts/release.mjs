#!/usr/bin/env node
/**
 * One-command release (D6, 260927 release pipeline simplify): promotion check,
 * release.yml dispatch, run watch, and pending npm-stable / desktop-production
 * deployment approval. This replaces the manual sequence documented in
 * devlog/_fin/260926_pr325_merge_release/030 with one local command.
 *
 * Nothing here publishes directly: release.yml keeps the cut/tag/publish flow
 * and its exact-SHA guards, and publish.yml stays the only workflow holding
 * `id-token: write`. This script only fetches, dispatches, watches, and — with
 * --approve — approves the environments this release created.
 *
 * Usage: node scripts/release.mjs <patch|minor|major> [--dry-run|--canary]
 *          [--promote] [--approve] [--yes]
 *        node scripts/release.mjs resume <X.Y.Z> [--approve] [--yes]
 *
 * `resume` finishes an already-tagged version (dev landing, desktop tag and build,
 * stable publish, Pages) through release.yml's resume_version input.
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const BUMPS = ["patch", "minor", "major"];
const SWITCHES = ["--dry-run", "--canary", "--promote", "--approve", "--yes"];
// Only these two release environments may ever be approved from here; anything
// else pending on these runs is not ours to touch.
const RELEASE_ENVS = ["npm-stable", "desktop-production"];
const USAGE =
  "Usage: node scripts/release.mjs <patch|minor|major> " +
  "[--dry-run|--canary] [--promote] [--approve] [--yes]\n" +
  "       node scripts/release.mjs resume <X.Y.Z> [--approve] [--yes]";
// Switches that only make sense when cutting a new version.
const CUT_ONLY = ["--dry-run", "--canary", "--promote"];

class ExitError extends Error {
  constructor(code) {
    super("exit " + code);
    this.code = code;
  }
}

function parseFlags(rest) {
  const flags = new Set();
  for (const arg of rest) {
    if (!SWITCHES.includes(arg)) throw new Error(USAGE + "\n  (unknown flag: " + arg + ")");
    flags.add(arg);
  }
  return flags;
}

export function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (first === "resume") {
    const [version, ...flagArgs] = rest;
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
      throw new Error(USAGE + "\n  (resume needs a stable X.Y.Z version)");
    }
    const flags = parseFlags(flagArgs);
    const refused = CUT_ONLY.filter((flag) => flags.has(flag));
    if (refused.length) throw new Error(USAGE + "\n  (resume does not take " + refused.join(", ") + ")");
    return { mode: "resume", version, flags };
  }
  const bump = first;
  if (!BUMPS.includes(bump ?? "")) {
    throw new Error(USAGE + "\n  (first argument must be one of: " + BUMPS.join(", ") + ", resume)");
  }
  const flags = parseFlags(rest);
  if (flags.has("--dry-run") && flags.has("--canary")) {
    throw new Error(USAGE + "\n  (--dry-run and --canary are mutually exclusive)");
  }
  return { mode: "cut", bump, flags };
}

export function dryRunInput(flags) {
  if (flags.has("--dry-run")) return "true";
  if (flags.has("--canary")) return "canary";
  return "false";
}

export function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) throw new Error("not a semver version: " + version);
  const [, major, minor, patch, suffix] = match;
  const next =
    bump === "major"
      ? [Number(major) + 1, 0, 0]
      : bump === "minor"
        ? [Number(major), Number(minor) + 1, 0]
        : [Number(major), Number(minor), Number(patch) + 1];
  return next.join(".") + suffix;
}

export function selectPendingApprovals(pending, allowedEnvs = RELEASE_ENVS) {
  return (pending ?? [])
    .filter((item) => allowedEnvs.includes(item?.environment?.name))
    .map((item) => ({
      environmentId: item.environment.id,
      environmentName: item.environment.name,
    }));
}

// release.yml dispatches publish.yml on the default branch (the ref it publishes
// is an input, so headBranch reads "main"); publish.yml's run-name carries that
// ref, so only the stable run for refs/tags/v<version> matches — a recovery or
// preview dispatch in the same window does not. desktop.yml is dispatched on
// the desktop-v<version> tag ref. Run ids are repository-wide and increase
// monotonically, so anything at or below the mark belongs to an earlier release.
export function isOwnRun(run, { afterId, version, workflow }) {
  const id = Number(run.databaseId ?? run.id);
  if (!Number.isFinite(id) || id <= afterId) return false;
  if (workflow === "publish.yml") {
    return run.event === "workflow_dispatch" && run.displayTitle === "Publish refs/tags/v" + version;
  }
  return (run.headBranch ?? "") === "desktop-v" + version;
}

const defaultRun = (bin, args) =>
  execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * desktop-v tags are restricted to repository admins, so CI cannot mint them;
 * this script, run by a maintainer, pushes desktop-vX.Y.Z at the release commit
 * once vX.Y.Z exists. A user push fires desktop.yml's push trigger.
 */
export function desktopTagAction({ releaseTagSha, desktopTagSha }) {
  if (!releaseTagSha) return "wait";
  if (!desktopTagSha) return "push";
  return desktopTagSha === releaseTagSha ? "done" : "conflict";
}

/** Parses `git ls-remote --tags` output; a peeled "^{}" line wins over the tag object. */
export function parseRemoteTags(output) {
  const tags = {};
  const peeled = {};
  for (const line of String(output || "").split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref?.startsWith("refs/tags/")) continue;
    const name = ref.slice("refs/tags/".length);
    if (name.endsWith("^{}")) peeled[name.slice(0, -3)] = sha;
    else tags[name] = sha;
  }
  return { ...tags, ...peeled };
}

function ensureDesktopTag(ctx) {
  if (ctx.desktopTagDone || ctx.desktopTagBlocked || dryRunInput(ctx.flags) !== "false") return;
  const release = "v" + ctx.version;
  const desktop = "desktop-v" + ctx.version;
  let tags;
  try {
    tags = parseRemoteTags(ctx.run("git", [
      "ls-remote", "--tags", "origin", "refs/tags/" + release, "refs/tags/" + desktop,
    ]));
  } catch (error) {
    ctx.log("Could not read the remote tags (" + firstLine(error) + "); retrying.");
    return;
  }
  const action = desktopTagAction({ releaseTagSha: tags[release], desktopTagSha: tags[desktop] });
  if (action === "conflict") {
    throw new Error(desktop + " points at " + tags[desktop] + ", but " + release + " is " + tags[release]);
  }
  if (action === "push") {
    try {
      // CI minted vX.Y.Z; this clone does not have that commit until it fetches
      // the tag, and git cannot push an object it does not have.
      ctx.run("git", ["fetch", "--no-tags", "origin", "refs/tags/" + release + ":refs/tags/" + release]);
      ctx.run("git", ["push", "origin", tags[release] + ":refs/tags/" + desktop]);
    } catch (error) {
      if (isRuleRejection(error)) {
        // Not an admin: retrying cannot succeed, so say who has to act and stop.
        ctx.desktopTagBlocked = true;
        ctx.log("The tag ruleset rejected " + desktop + ": only a repository admin can create it. " +
          "An admin runs: git push origin " + tags[release] + ":refs/tags/" + desktop +
          " (or npm run release -- resume " + ctx.version + ").");
        return;
      }
      ctx.log("Could not push " + desktop + " (" + firstLine(error) + "); retrying. " +
        "The tag ruleset admits repository admins only; by hand: git push origin " + tags[release] + ":refs/tags/" + desktop);
      return;
    }
    ctx.log("Pushed " + desktop + " at " + tags[release] + "; desktop.yml starts from the tag push.");
  }
  if (action === "push" || action === "done") ctx.desktopTagDone = true;
}

function firstLine(error) {
  return String(error?.message ?? error).split("\n")[0];
}

export function isRuleRejection(error) {
  const text = String(error?.stderr ?? "") + String(error?.message ?? error);
  return /GH013|repository rule violations|creations being restricted/i.test(text);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question + " [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function waitMainMove(ctx, before) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const sha = ctx.run("git", ["ls-remote", "origin", "main"]).split(/\s+/)[0];
    if (sha && sha !== before) return sha;
    await ctx.sleep(5000);
  }
  throw new Error("origin/main did not move within 5 minutes of merging the promotion PR");
}

async function createPromotionPr(ctx) {
  const out = ctx.run("gh", [
    "pr", "create", "--base", "main", "--head", "dev",
    "--title", "release: promote dev to main",
    "--body", "Promotion PR opened by scripts/release.mjs --promote; merging it moves origin/main to dev so release.yml can cut from it.",
  ]);
  const match = /\/pull\/(\d+)/.exec(out);
  if (!match) throw new Error("could not parse PR number from: " + out);
  return Number(match[1]);
}

async function ensurePromoted(ctx) {
  ctx.log(ctx.run("gh", ["auth", "status"]));
  ctx.run("git", ["fetch", "origin", "main", "dev", "--tags"]);
  const ahead = Number(ctx.run("git", ["rev-list", "--count", "origin/main..origin/dev"]));
  if (ahead === 0) return;
  if (!ctx.flags.has("--promote")) {
    ctx.log("origin/dev is " + ahead + " commit(s) ahead of origin/main.");
    ctx.log("Promote first:  npm run release -- " + ctx.bump + " --promote");
    throw new ExitError(2);
  }
  ctx.log("origin/dev is " + ahead + " commit(s) ahead of origin/main; promoting.");
  const before = ctx.run("git", ["ls-remote", "origin", "main"]).split(/\s+/)[0];
  const open = JSON.parse(ctx.run("gh", [
    "pr", "list", "--head", "dev", "--base", "main", "--state", "open", "--json", "number,title",
  ]));
  let number = open[0]?.number;
  if (number) {
    ctx.log("Using open promotion PR #" + number + ".");
  } else {
    number = await createPromotionPr(ctx);
    ctx.log("Opened promotion PR #" + number + ".");
  }
  if (!(await ctx.ask("Merge PR #" + number + " (dev -> main)?"))) throw new ExitError(0);
  ctx.run("gh", ["pr", "merge", String(number), "--merge"]);
  ctx.log("origin/main moved to " + (await waitMainMove(ctx, before)) + ".");
  ctx.run("git", ["fetch", "origin", "main"]);
}

function runListArgs(workflow, extra = []) {
  return ["run", "list", "--workflow", workflow, "--limit", "30",
    "--json", "databaseId,status,conclusion,headBranch,event,displayTitle,url", ...extra];
}

function highWaterMark(ctx) {
  const runs = JSON.parse(ctx.run("gh", runListArgs("release.yml", ["--event", "workflow_dispatch"])));
  return runs.reduce((max, run) => Math.max(max, Number(run.databaseId)), 0);
}

async function findDispatchedRun(ctx, afterId) {
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const runs = JSON.parse(ctx.run("gh", runListArgs("release.yml", ["--event", "workflow_dispatch"])));
    // The oldest dispatch above the mark is ours; a later one belongs to someone else.
    const run = runs
      .filter((candidate) => Number(candidate.databaseId) > afterId)
      .sort((a, b) => Number(a.databaseId) - Number(b.databaseId))[0];
    if (run) return run;
    await ctx.sleep(5000);
  }
  throw new Error("no release.yml workflow_dispatch run appeared above id " + afterId);
}

function reportJob(ctx, seen, job) {
  const prev = seen.get(job.name);
  if (prev === job.status) return;
  seen.set(job.name, job.status);
  const conclusion = job.conclusion ? " (" + job.conclusion + ")" : "";
  ctx.log("  job " + job.name + ": " + (prev ? prev + " -> " : "") + job.status + conclusion);
}

async function approvePending(ctx, approvals, workflow, runId) {
  const pending = JSON.parse(ctx.run("gh", [
    "api", "repos/:owner/:repo/actions/runs/" + runId + "/pending_deployments",
  ]));
  for (const approval of selectPendingApprovals(pending)) {
    const key = runId + ":" + approval.environmentId;
    if (approvals.has(key)) continue;
    approvals.add(key); // print the approve command at most once per deployment
    const args = [
      "api", "-X", "POST", "repos/:owner/:repo/actions/runs/" + runId + "/pending_deployments",
      // -F sends a typed value: the API rejects environment ids sent as strings.
      "-F", "environment_ids[]=" + approval.environmentId,
      "-f", "state=approved",
      "-f", "comment=approved by scripts/release.mjs --approve (" + approval.environmentName + ")",
    ];
    if (ctx.flags.has("--approve")) {
      ctx.run("gh", args);
      ctx.log("Approved " + approval.environmentName + " on " + workflow + " run " + runId + ".");
    } else {
      ctx.log("Pending approval: " + approval.environmentName + " on " + workflow + " run " + runId + ".");
      ctx.log("  gh " + args.map((arg) => (arg.includes(" ") ? '"' + arg + '"' : arg)).join(" "));
    }
  }
}

function ownRuns(ctx, workflow) {
  const runs = JSON.parse(ctx.run("gh", runListArgs(workflow)));
  return runs.filter((run) => isOwnRun(run, { afterId: ctx.afterId, version: ctx.version, workflow }));
}

async function checkApprovals(ctx, approvals) {
  // Dry modes change no remote state, so there are no publish/desktop runs to
  // approve; the release.yml run itself has no protected environment.
  if (dryRunInput(ctx.flags) !== "false") return;
  await approvePending(ctx, approvals, "release.yml", ctx.releaseId);
  for (const workflow of ["publish.yml", "desktop.yml"]) {
    for (const run of ownRuns(ctx, workflow)) await approvePending(ctx, approvals, workflow, run.databaseId);
  }
}

async function watchRun(ctx, release, approvals) {
  const seen = new Map();
  for (;;) {
    const view = JSON.parse(ctx.run("gh", [
      "run", "view", String(release.databaseId), "--json", "status,conclusion,jobs",
    ]));
    for (const job of view.jobs) reportJob(ctx, seen, job);
    await checkApprovals(ctx, approvals);
    ensureDesktopTag(ctx);
    if (view.status === "completed") return view.conclusion;
    await ctx.sleep(20000);
  }
}

// A missing release makes `gh release view` exit non-zero; that only means
// "not public yet", never a failure of the release.
function desktopPublished(ctx) {
  try {
    const view = JSON.parse(ctx.run("gh", ["release", "view", "desktop-v" + ctx.version, "--json", "isDraft"]));
    return view?.isDraft === false;
  } catch {
    return false;
  }
}

// The desktop build outlives release.yml (it starts in the tag job and needs
// desktop-production approval after ~10 minutes of packaging), so keep
// watching it once the release itself has succeeded. A desktop release that is
// already public (a resume, or a build that finished first) ends the watch.
async function watchDesktop(ctx, approvals) {
  const deadline = Date.now() + 90 * 60 * 1000;
  while (Date.now() < deadline) {
    if (desktopPublished(ctx)) {
      ctx.log("Desktop release desktop-v" + ctx.version + " is published.");
      return "success";
    }
    ensureDesktopTag(ctx);
    await checkApprovals(ctx, approvals);
    const [run] = ownRuns(ctx, "desktop.yml");
    if (!run) ctx.log("Waiting for the desktop.yml run on desktop-v" + ctx.version + " (it starts when the tag is pushed).");
    else if (run.status === "completed") {
      ctx.log("Desktop run finished: " + run.conclusion + " " + run.url);
      return run.conclusion;
    }
    await ctx.sleep(30000);
  }
  ctx.log("Stopped watching the desktop run after 90 minutes; check it in Actions.");
  return "timed_out";
}

async function watchDispatched(ctx) {
  const release = await findDispatchedRun(ctx, ctx.afterId);
  ctx.releaseId = release.databaseId;
  ctx.log("Release run: " + release.url);
  const conclusion = await watchRun(ctx, release, new Set());
  ctx.log("Release run finished: " + conclusion);
  return conclusion;
}

async function runResume(ctx) {
  ctx.afterId = highWaterMark(ctx);
  ctx.log("Dispatching release.yml: resume_version=" + ctx.version + " dry_run=false");
  if (!(await ctx.ask("Resume the release of v" + ctx.version + " now?"))) throw new ExitError(0);
  ctx.run("gh", [
    "workflow", "run", "release.yml",
    "-f", "bump=patch", "-f", "dry_run=false", "-f", "resume_version=" + ctx.version,
  ]);
  if ((await watchDispatched(ctx)) !== "success") return 1;
  return (await watchDesktop(ctx, new Set())) === "success" ? 0 : 1;
}

export async function runRelease(argv, deps = {}) {
  const parsed = parseArgs(argv);
  const { flags } = parsed;
  const ctx = {
    bump: parsed.bump,
    flags,
    run: deps.run ?? defaultRun,
    sleep: deps.sleep ?? defaultSleep,
    log: deps.log ?? ((line) => console.log(line)),
    // --yes answers every confirmation, whoever supplied the prompt.
    ask: flags.has("--yes") ? () => Promise.resolve(true) : (deps.ask ?? confirm),
  };
  if (parsed.mode === "resume") {
    ctx.version = parsed.version;
    return runResume(ctx);
  }
  const { bump } = parsed;
  await ensurePromoted(ctx);
  const sha = ctx.run("git", ["rev-parse", "origin/main"]);
  const version = bumpVersion(
    JSON.parse(ctx.run("git", ["show", "origin/main:package.json"])).version,
    bump,
  );
  ctx.afterId = highWaterMark(ctx);
  ctx.version = version;
  const dry = dryRunInput(flags);
  ctx.log("Dispatching release.yml: bump=" + bump + " dry_run=" + dry + " expected_sha=" + sha + " (v" + version + ")");
  if (!(await ctx.ask("Dispatch release now?"))) throw new ExitError(0);
  ctx.run("gh", [
    "workflow", "run", "release.yml",
    "-f", "bump=" + bump, "-f", "dry_run=" + dry, "-f", "expected_sha=" + sha,
  ]);
  const conclusion = await watchDispatched(ctx);
  if (conclusion !== "success") return 1;
  if (dry !== "false") return 0;
  return (await watchDesktop(ctx, new Set())) === "success" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRelease(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof ExitError) process.exit(error.code);
      console.error(error.message || error);
      process.exit(1);
    });
}
