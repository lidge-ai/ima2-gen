/**
 * `ima2 stop` as a function that returns one report instead of printing.
 *
 * Doctrine (adversarial audit 260821c, kept): never signal a pid the advertise
 * file merely claims — the live /api/health must carry it; graceful admin stop
 * before signals; a stale advertise file is cleaned, not trusted. Added here:
 * an identity guard for callers that approved a specific process
 * (--expect-pid with --expect-boot or --expect-started), service ownership
 * decided from the live manager instead of a state file, and a Windows path.
 */
import { execFileSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import {
  corroborateByStartTime,
  escalateKill,
  gracefulStop,
  isProcessAlive,
  waitForExit,
  type AdvertiseEntry,
} from "../../lib/processControl.js";
import { probeHealth, readAdvertiseFile } from "./runtime.js";
import { inspectManager, serviceOwnership, type ManagerState } from "./serviceManager.js";
import { buildStopReport, type StopMethod, type StopOutcome, type StopReport } from "./runtimeReport.js";

export interface StopOptions {
  advertiseFile: string;
  force?: boolean;
  service?: boolean;
  expectPid?: number;
  expectBoot?: string;
  expectStarted?: number;
  fetchFn?: typeof fetch;
  inspect?: () => ManagerState;
  stopManager?: () => Promise<{ ok: boolean; message: string }>;
  platform?: NodeJS.Platform;
  gracefulWaitMs?: number;
  stayDownMs?: number;
}

interface Target { opts: StopOptions; entry: AdvertiseEntry; pid: number; launcher: string | null; health: Record<string, unknown> | null }

function cleanup(file: string, pid: number | undefined): void {
  try {
    const { entry } = readAdvertiseFile(file);
    if (pid === undefined || !entry || entry.pid === pid) unlinkSync(file);
  } catch { /* best effort: the file may already be gone */ }
}

function report(outcome: StopOutcome, t: Partial<Target>, message: string, extra: { code?: string; method?: StopMethod } = {}): StopReport {
  const pid = t.pid ?? null;
  const runtimeDown = outcome === "stopped" || outcome === "not-running" || (outcome === "failed" && pid !== null && !isProcessAlive(pid));
  return buildStopReport({ outcome, method: extra.method ?? null, pid, launcher: t.launcher ?? null, runtimeDown, message, ...(extra.code ? { code: extra.code } : {}) });
}

function baseUrl(entry: AdvertiseEntry): string | null {
  const raw = entry.url ?? (entry.port ? `http://127.0.0.1:${entry.port}` : null);
  return raw ? String(raw).replace(/\/$/, "") : null;
}

/** The caller approved one process; anything else answering is a refusal, not a target. */
function identityChanged(opts: StopOptions, health: Record<string, unknown> | null): string | null {
  if (opts.expectPid === undefined) return null;
  if (!health) return "the approved server did not answer its health check";
  if (health.pid !== opts.expectPid) return `pid ${String(health.pid)} answers where pid ${opts.expectPid} was approved`;
  if (opts.expectBoot !== undefined && health.bootId !== opts.expectBoot) return "the server restarted since it was approved (boot id changed)";
  if (opts.expectStarted !== undefined && health.startedAt !== opts.expectStarted) return "the server restarted since it was approved (start time changed)";
  return null;
}

export async function stopRuntime(opts: StopOptions): Promise<StopReport> {
  const { entry, unreadable } = readAdvertiseFile(opts.advertiseFile);
  if (!entry || !entry.pid) {
    if (unreadable) cleanup(opts.advertiseFile, undefined);
    return report("not-running", {}, unreadable ? "Removed unreadable advertise file. No server to stop." : "ima2 server is not running.");
  }
  const pid = Number(entry.pid);
  const t: Target = { opts, entry, pid, launcher: typeof entry.launcher === "string" ? entry.launcher : null, health: null };
  if (!isProcessAlive(pid)) {
    cleanup(opts.advertiseFile, pid);
    return report("not-running", t, `ima2 server (pid ${pid}) is not running. Cleaned stale advertise file.`);
  }
  const base = baseUrl(entry);
  const probe = base ? await probeHealth(base, opts.fetchFn ?? fetch, 1500) : null;
  t.health = probe?.kind === "ima2" ? probe.health : null;
  if (typeof t.health?.launcher === "string") t.launcher = t.health.launcher;
  const changed = identityChanged(opts, t.health);
  if (changed) return report("refused", t, `Refusing to stop: ${changed}.`, { code: "identity-changed" });
  if (t.health && t.health.pid !== pid) {
    cleanup(opts.advertiseFile, pid);
    // Something still answers at the advertised address, so this is not a stop.
    return report("refused", t, `A different server (pid ${String(t.health.pid)}) answers where pid ${pid} was advertised. Refusing to signal a process the advertise file cannot vouch for; cleaned the stale file. Stop that server from its own CLI.`, { code: "advertise-stale" });
  }
  return stopVerified(t);
}

async function stopVerified(t: Target): Promise<StopReport> {
  const { opts } = t;
  const ownership = serviceOwnership({ pid: t.pid, launcher: t.launcher }, (opts.inspect ?? inspectManager)());
  // --force skips the graceful stop and the managed-service refusal, never this one:
  // an unanswerable manager may restart whatever gets killed.
  if (ownership === "unknown") {
    return report("refused", t, "Cannot tell whether the login service manages this server (the service manager could not be asked, or it runs a different pid). Check 'ima2 service status'.", { code: "ownership-unknown" });
  }
  if (opts.service && ownership !== "managed") {
    return report("refused", t, `--service was given, but the login service does not run pid ${t.pid}. Use plain 'ima2 stop'.`, { code: "not-service-managed" });
  }
  if (ownership === "managed") {
    if (opts.service) return stopViaManager(t);
    if (!opts.force) {
      return report("refused", t, "ima2 runs as a background service: KeepAlive would restart it right after a plain stop. Use 'ima2 stop --service' (or 'ima2 service stop'), or 'ima2 stop --force' to kill it anyway.", { code: "service-managed" });
    }
  }
  if (!t.health) {
    const refusal = unreachableRefusal(t);
    if (refusal) return refusal;
  }
  return stopProcess(t);
}

/** HTTP says nothing: only a corroborated start time allows a signal. */
function unreachableRefusal(t: Target): StopReport | null {
  const corroboration = corroborateByStartTime(t.pid, Number(t.entry.startedAt) || undefined);
  if (corroboration === "corroborated") return null;
  if (corroboration === "recycled") {
    cleanup(t.opts.advertiseFile, t.pid);
    return report("not-running", t, `pid ${t.pid} is alive but is NOT the advertised server (the pid was recycled). Cleaned the stale advertise file.`, { code: "pid-recycled" });
  }
  return report("refused", t, `pid ${t.pid} is alive but the server is unreachable and its start time could not be corroborated. Refusing to signal it; if you are sure, stop it manually.`, { code: "identity-unverified" });
}

async function stopViaManager(t: Target): Promise<StopReport> {
  const again = (t.opts.inspect ?? inspectManager)();
  if (!(again.state === "bound" && again.active && again.pid === t.pid)) {
    return report("refused", t, `The service no longer runs pid ${t.pid}; not stopping it.`, { code: "identity-changed" });
  }
  const stopManager = t.opts.stopManager ?? (async () => (await import("../commands/service.js")).stopServiceManager());
  const result = await stopManager();
  if (!result.ok) return report("failed", t, result.message, { code: "manager-stop-failed" });
  await waitForExit(t.pid, 10_000);
  if (await answersAgain(t)) return report("failed", t, "The service manager was stopped but an ima2 server answers again.", { code: "respawned" });
  cleanup(t.opts.advertiseFile, t.pid);
  return report("stopped", t, `${result.message} Server pid ${t.pid} is down.`, { method: "service" });
}

async function answersAgain(t: Target): Promise<boolean> {
  const base = baseUrl(t.entry);
  if (!base) return false;
  await new Promise((r) => setTimeout(r, t.opts.stayDownMs ?? 2000));
  return (await probeHealth(base, t.opts.fetchFn ?? fetch, 1500)).kind === "ima2";
}

async function stopProcess(t: Target): Promise<StopReport> {
  const { opts, pid } = t;
  if (!opts.force && t.health && (await gracefulStop(t.entry, opts.fetchFn ?? fetch)) && (await waitForExit(pid, opts.gracefulWaitMs ?? 8000))) {
    cleanup(opts.advertiseFile, pid);
    return report("stopped", t, `Stopped ima2 server (pid ${pid}) gracefully.`, { method: "graceful" });
  }
  if ((opts.platform ?? process.platform) === "win32") return taskkill(t);
  const outcome = await escalateKill(pid);
  if (outcome === "failed") return report("failed", t, `Could not stop pid ${pid}. Try: kill -9 ${pid}`, { code: "signal-failed" });
  cleanup(opts.advertiseFile, pid);
  if (outcome === "already-dead") return report("stopped", t, `ima2 server (pid ${pid}) had already exited.`);
  if (outcome === "kill") return report("stopped", t, `Force-killed ima2 server (pid ${pid}) with SIGKILL. Helper proxies may have been left behind; they exit on their own.`, { method: "kill" });
  return report("stopped", t, `Stopped ima2 server (pid ${pid}) with SIGTERM.`, { method: "term" });
}

/** Windows has no SIGTERM for another process; only an identity-verified pid reaches this. */
async function taskkill(t: Target): Promise<StopReport> {
  try {
    execFileSync("taskkill", ["/PID", String(t.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch { /* the wait below decides */ }
  if (!(await waitForExit(t.pid, 5000))) return report("failed", t, `Could not stop pid ${t.pid}. Try: taskkill /PID ${t.pid} /T /F`, { code: "taskkill-failed" });
  cleanup(t.opts.advertiseFile, t.pid);
  return report("stopped", t, `Stopped ima2 server (pid ${t.pid}) with taskkill.`, { method: "taskkill" });
}
