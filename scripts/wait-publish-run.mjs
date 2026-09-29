#!/usr/bin/env node
/**
 * Waits for the publish.yml run that release.yml just dispatched.
 *
 * `gh workflow run` returns nothing identifying, so the run has to be found afterwards.
 * The obvious correlation key does not exist: the REST run object has no `inputs` field
 * (verified against this repo's API — its keys include head_sha and event, not inputs),
 * so the dispatched values cannot be read back off the run.
 *
 * Instead the caller records the newest publish.yml run id BEFORE dispatching. Run ids
 * increase monotonically, so the first workflow_dispatch run with a larger id is ours.
 * A plain "latest run" or a time window would adopt a concurrent release's run and
 * report its success as this one's.
 *
 * Usage:
 *   node scripts/wait-publish-run.mjs latest-id
 *   PUBLISH_RUN_TITLE="Publish refs/tags/vX.Y.Z" node scripts/wait-publish-run.mjs wait <afterRunId> <label> [timeoutMinutes]
 *
 * PUBLISH_RUN_TITLE (optional) is publish.yml's run-name for the dispatched ref.
 */
import { execFileSync } from "node:child_process";

const POLL_MS = 15_000;
// Dispatch queueing has taken longer than three minutes; ten keeps a slow queue from
// failing a healthy release while still catching a dispatch that never happened.
const DISCOVERY_TIMEOUT_MS = 10 * 60 * 1000;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Our run is the OLDEST workflow_dispatch run newer than the pre-dispatch high-water
 * mark. Taking the oldest matters: if a second release dispatches while we wait, its id
 * is also above the mark, and picking the newest would follow that one instead.
 * With a title (publish.yml's run-name, e.g. "Publish refs/tags/v3.24.1"), a hand
 * dispatch for another ref in the same window is not adopted either.
 */
export function pickRun(runs, afterRunId, title) {
  return runs
    .filter((run) => run.event === "workflow_dispatch")
    .filter((run) => Number(run.databaseId) > Number(afterRunId))
    .filter((run) => !title || run.displayTitle === title)
    .sort((a, b) => Number(a.databaseId) - Number(b.databaseId))[0];
}

function listRuns() {
  return JSON.parse(gh(["run", "list", "--workflow", "publish.yml", "--limit", "20", "--json", "databaseId,event,createdAt,status,conclusion,displayTitle"]));
}

/** Prints the newest publish.yml run id, or 0 when the workflow has never run. */
function latestId() {
  const runs = listRuns();
  const newest = runs.map((run) => Number(run.databaseId)).sort((a, b) => b - a)[0];
  console.log(String(newest ?? 0));
}

async function waitFor(afterRunId, label, timeoutMinutes, title) {
  if (!afterRunId) throw new Error("usage: wait-publish-run.mjs wait <afterRunId> <label> [timeoutMinutes]");
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  const deadline = Date.now() + Number(timeoutMinutes) * 60 * 1000;

  let run = null;
  while (!run) {
    if (Date.now() > discoveryDeadline) {
      throw new Error("publish.yml run never appeared after the dispatch");
    }
    run = pickRun(listRuns(), afterRunId, title);
    if (!run) await sleep(POLL_MS);
  }
  console.log(`[wait-publish] watching run ${run.databaseId} for ${label}`);

  for (;;) {
    const current = JSON.parse(gh(["run", "view", String(run.databaseId), "--json", "status,conclusion"]));
    if (current.status === "completed") {
      if (current.conclusion !== "success") {
        throw new Error(`publish run ${run.databaseId} concluded ${current.conclusion}`);
      }
      console.log(`[wait-publish] run ${run.databaseId} succeeded`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`publish run ${run.databaseId} did not finish within ${timeoutMinutes} minutes`);
    await sleep(POLL_MS);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "latest-id") return latestId();
  if (command === "wait") return waitFor(args[0], args[1] || "the release", args[2] || "60", process.env.PUBLISH_RUN_TITLE || "");
  throw new Error("usage: wait-publish-run.mjs latest-id | wait <afterRunId> <label> [timeoutMinutes]");
}

const isMain = process.argv[1] && process.argv[1].endsWith("wait-publish-run.mjs");
if (isMain) {
  main().catch((error) => {
    console.error(`[wait-publish] ${error.message}`);
    process.exit(1);
  });
}
