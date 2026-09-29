import { spawn } from "node:child_process";
import { join } from "node:path";

export const STATUS_SCHEMA = "ima2-status/1";
export const STOP_SCHEMA = "ima2-stop/1";
const STATUS_EXIT = { live: 0, "absent-proven": 3, unknown: 1 };

/**
 * Run the bundled CLI (bin/ima2.js next to server.js) and collect its output.
 * Resolves; never rejects: a spawn error or timeout is reported in the result.
 */
export function runBundledCli({ rootDir, args, env, command, timeoutMs = 20_000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ stdout, stderr, ...result }); } };
    let child;
    try {
      child = spawnFn(command.bin, [join(rootDir, "bin", "ima2.js"), ...args], { cwd: rootDir, env: { ...env, ...command.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      finish({ code: null, error: error.message });
      return;
    }
    timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish({ code: null, error: `timed out after ${timeoutMs} ms` }); }, timeoutMs);
    child.stdout.on("data", (b) => { stdout += String(b); });
    child.stderr.on("data", (b) => { stderr += String(b); });
    child.on("error", (error) => finish({ code: null, error: error.message }));
    child.on("close", (code) => finish({ code }));
  });
}

function lastJson(stdout) {
  const line = String(stdout).trim().split(/\r?\n/).pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function failure(run, what) {
  const detail = run.error ?? (String(run.stderr).trim().split(/\r?\n/).pop() || `exit ${run.code}`);
  return { ok: false, reason: `${what}: ${detail}` };
}

const MANAGER_STATES = ["absent", "bound", "unknown"];
const OWNERSHIPS = ["managed", "unmanaged", "unknown"];

/** The fields the startup decision reads; a report missing any of them decides nothing. */
function statusProblem(doc) {
  if (!doc.manager || !MANAGER_STATES.includes(doc.manager.state)) return "no manager state";
  if (doc.manager.state === "bound" && typeof doc.manager.active !== "boolean") return "manager without active flag";
  if (!OWNERSHIPS.includes(doc.serviceOwnership)) return "no service ownership";
  if (typeof doc.stoppable !== "boolean") return "no stoppable flag";
  if (doc.liveness !== "live") return null;
  const r = doc.runtime;
  if (!r || !Number.isInteger(r.pid) || r.pid <= 0 || typeof r.url !== "string") return "a live answer without pid and url";
  return null;
}

/** A status answer counts only when it is complete and its exit code agrees with its liveness. */
export function parseStatus(run) {
  const doc = lastJson(run.stdout);
  if (!doc || doc.schema !== STATUS_SCHEMA) return failure(run, "the bundled CLI gave no ima2-status/1 answer");
  if (STATUS_EXIT[doc.liveness] === undefined || STATUS_EXIT[doc.liveness] !== run.code) return failure(run, `the bundled CLI answered ${doc.liveness} with exit ${run.code}`);
  const problem = statusProblem(doc);
  if (problem) return { ok: false, reason: `the bundled CLI's status answer is incomplete (${problem})` };
  return { ok: true, status: doc };
}

export function parseStop(run) {
  const doc = lastJson(run.stdout);
  if (!doc || doc.schema !== STOP_SCHEMA) return failure(run, "the bundled CLI gave no ima2-stop/1 answer");
  if ((run.code === 0) !== (doc.ok === true)) return failure(run, `the stop report and exit ${run.code} disagree`);
  return { ok: true, report: doc };
}
