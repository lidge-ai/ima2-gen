#!/usr/bin/env node
/**
 * Waits for the ci.yml run that release.yml dispatched for a release candidate.
 *
 * Correlation (roadmap 030, c4): the run must match BOTH
 *   - id above the pre-dispatch high-water mark (ids increase monotonically), and
 *   - headSha equal to the candidate's FULL 40-char SHA (abbreviated SHAs silently
 *     match nothing — that exact mistake produced "CI never runs on version commits"
 *     during roadmap research).
 * The candidate is dispatched with `--ref release-candidate`, so the run's headSha
 * IS the candidate SHA.
 *
 * Usage:
 *   node scripts/wait-ci-gate.mjs latest-id
 *   node scripts/wait-ci-gate.mjs wait <afterRunId> <candidateSha> [timeoutMinutes]
 *   node scripts/wait-ci-gate.mjs reuse-push <baseSha> [timeoutMinutes]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const POLL_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 3 * 60 * 1000;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertFullSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`ci gate requires the full 40-char SHA, got: ${sha}`);
  }
}

export function pickRun(runs, afterRunId, candidateSha) {
  assertFullSha(candidateSha);
  return runs
    .filter((run) => run.event === "workflow_dispatch")
    .filter((run) => Number(run.databaseId) > Number(afterRunId))
    .filter((run) => run.headSha === candidateSha)
    .sort((a, b) => Number(a.databaseId) - Number(b.databaseId))[0];
}

/**
 * D2 (release pipeline simplify): when the version commit only bumps version
 * files, the parent commit's main push CI already proves the tree, so the cut
 * reuses it instead of dispatching a candidate run. That reuse has to be
 * conservative in both directions: only failure of the parent run is red (the
 * tree it proves is broken), while cancelled/skipped/missing evidence falls
 * back to the candidate CI rather than failing a release that could still
 * prove itself.
 */
export function classifyPushRun(run, jobs) {
  if (!run) {
    return { reusable: false, red: false, reason: "no ci.yml push run on main for the parent SHA" };
  }
  if (run.event !== "push") {
    return { reusable: false, red: false, reason: `ci.yml run ${run.databaseId} is a ${run.event}, not a push` };
  }
  if (run.headBranch !== "main") {
    return { reusable: false, red: false, reason: `ci.yml run ${run.databaseId} is on ${run.headBranch}, not main` };
  }
  if (run.conclusion === "failure") {
    return { reusable: false, red: true, reason: `main CI is red for ${run.headSha}` };
  }
  if (run.conclusion !== "success") {
    return {
      reusable: false,
      red: false,
      reason: `main CI run ${run.databaseId} concluded ${run.conclusion ?? run.status}; falling back to the candidate CI`,
    };
  }
  const list = Array.isArray(jobs) ? jobs : [];
  const families = [
    { label: "ci", matches: (name) => name === "ci" },
    { label: "test", matches: (name) => name.startsWith("test (") },
    { label: "windows", matches: (name) => name.startsWith("windows (") },
    { label: "macOS native installation", matches: (name) => name.startsWith("macOS native installation") },
    { label: "frontend e2e", matches: (name) => name.startsWith("frontend e2e") },
  ];
  for (const family of families) {
    const matched = list.filter((job) => family.matches(job.name ?? ""));
    if (matched.length === 0) {
      return {
        reusable: false,
        red: false,
        reason: `main CI run ${run.databaseId} has no ${family.label} job; falling back to the candidate CI`,
      };
    }
    const bad = matched.find((job) => job.conclusion !== "success");
    if (bad) {
      return {
        reusable: false,
        red: false,
        reason: `main CI job "${bad.name}" concluded ${bad.conclusion ?? "incomplete"}; falling back to the candidate CI`,
      };
    }
  }
  return { reusable: true, red: false, reason: `main CI run ${run.databaseId} succeeded for ${run.headSha}` };
}

function emitReuse(verdict) {
  const body = `reusable=${verdict.reusable}\nreason=${verdict.reason}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
  console.log(body);
}

function listRuns() {
  return JSON.parse(
    gh([
      "run", "list", "--workflow", "ci.yml", "--branch", "release-candidate",
      "--limit", "20", "--json", "databaseId,event,headSha,createdAt,status,conclusion",
    ]),
  );
}

/**
 * A single `gh` call can fail on a transient api.github.com i/o timeout. That
 * once killed a release cut at minute 12 of an otherwise green candidate run:
 * the CI it was watching went on to pass, but the gate had already exited 1.
 *
 * Polling is idempotent, so a failed poll is not evidence about the run — only
 * about the network. Return null and let the caller poll again; the surrounding
 * deadline still bounds the wait, so a genuinely unreachable API times out
 * rather than looping forever.
 */
function listRunsOrNull() {
  try {
    return listRuns();
  } catch (error) {
    console.log(`ci gate: transient list failure, retrying — ${String(error.message || error).split("\n")[0]}`);
    return null;
  }
}

function listPushRuns() {
  return JSON.parse(
    gh([
      "run", "list",
      "--workflow", "ci.yml",
      "--branch", "main",
      "--event", "push",
      "--limit", "20",
      "--json", "databaseId,event,headBranch,headSha,status,conclusion",
    ]),
  );
}

function listPushRunsOrNull() {
  try {
    return listPushRuns();
  } catch (error) {
    console.log(`ci gate: transient push-list failure, retrying — ${String(error.message || error).split("\n")[0]}`);
    return null;
  }
}

function latestId() {
  const runs = JSON.parse(
    gh(["run", "list", "--workflow", "ci.yml", "--limit", "5", "--json", "databaseId"]),
  );
  const newest = runs.map((run) => Number(run.databaseId)).sort((a, b) => b - a)[0];
  console.log(String(newest ?? 0));
}

async function waitFor(afterRunId, candidateSha, timeoutMinutes) {
  assertFullSha(candidateSha);
  if (!afterRunId) throw new Error("usage: wait-ci-gate.mjs wait <afterRunId> <candidateSha> [timeoutMinutes]");
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  const deadline = Date.now() + Number(timeoutMinutes) * 60 * 1000;

  let run = null;
  while (!run) {
    if (Date.now() > discoveryDeadline) {
      throw new Error(`no ci.yml run with headSha ${candidateSha} appeared above run id ${afterRunId}`);
    }
    const runs = listRunsOrNull();
    run = runs ? pickRun(runs, afterRunId, candidateSha) : null;
    if (!run) await sleep(POLL_MS);
  }
  console.log(`ci gate: watching run ${run.databaseId} (headSha ${run.headSha})`);

  while (run.status !== "completed") {
    if (Date.now() > deadline) throw new Error(`ci.yml run ${run.databaseId} did not finish in time`);
    await sleep(POLL_MS);
    const fresh = listRunsOrNull()?.find((candidate) => candidate.databaseId === run.databaseId);
    if (fresh) run = fresh;
  }
  if (run.conclusion !== "success") {
    throw new Error(`ci.yml run ${run.databaseId} concluded ${run.conclusion} for candidate ${candidateSha}`);
  }
  console.log(`ci gate: run ${run.databaseId} succeeded for ${candidateSha}`);
}

function viewJobsOrNull(runId) {
  try {
    return JSON.parse(gh(["run", "view", String(runId), "--json", "jobs"]));
  } catch (error) {
    console.log(`ci gate: transient view failure, retrying — ${String(error.message || error).split("\n")[0]}`);
    return null;
  }
}

function newestPushRun(runs, baseSha) {
  return runs
    .filter((candidate) =>
      candidate.event === "push" && candidate.headBranch === "main" && candidate.headSha === baseSha)
    .sort((a, b) => Number(b.databaseId) - Number(a.databaseId))[0];
}

function fallback(reason) {
  emitReuse({ reusable: false, red: false, reason: reason + "; falling back to the candidate CI" });
}

/**
 * Waits only for a run that exists. A parent commit with no push run at all
 * (for example main still at the previous release commit, which a GITHUB_TOKEN
 * push created without CI) falls back after the discovery window instead of
 * burning the whole wait. The newest matching run wins, so a rerun in progress
 * is waited for rather than an older attempt's conclusion being reused.
 */
async function reusePush(baseSha, timeoutMinutes) {
  assertFullSha(baseSha);
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  const deadline = Date.now() + Number(timeoutMinutes) * 60 * 1000;
  let run = null;
  for (;;) {
    const runs = listPushRunsOrNull();
    const match = runs ? newestPushRun(runs, baseSha) : null;
    if (match?.status === "completed") { run = match; break; }
    if (!match && Date.now() > discoveryDeadline) return fallback("no ci.yml push run on main for " + baseSha);
    if (Date.now() > deadline) return fallback("main CI for " + baseSha + " did not finish within " + timeoutMinutes + "m");
    await sleep(POLL_MS);
  }
  console.log("ci gate: classifying main push run " + run.databaseId + " (headSha " + run.headSha + ")");
  let view = null;
  while (!view && Date.now() <= deadline) {
    view = viewJobsOrNull(run.databaseId);
    if (!view) await sleep(POLL_MS);
  }
  const verdict = classifyPushRun(run, view?.jobs ?? []);
  emitReuse(verdict);
  if (verdict.red) throw new Error(verdict.reason);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "latest-id") return latestId();
  if (command === "wait") return waitFor(rest[0], rest[1], Number(rest[2] ?? 45));
  if (command === "reuse-push") return reusePush(rest[0], Number(rest[1] ?? 45));
  throw new Error("usage: wait-ci-gate.mjs latest-id | wait <afterRunId> <candidateSha> [timeoutMinutes] | reuse-push <baseSha> [timeoutMinutes]");
}

const isMain = process.argv[1] && process.argv[1].endsWith("wait-ci-gate.mjs");
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
