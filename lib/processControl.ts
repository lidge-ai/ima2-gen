/**
 * Process-control helpers for `ima2 stop` (and service stop paths).
 *
 * Doctrine (adversarial audit 260821c): never kill a pid the advertise file
 * merely CLAIMS — verify identity against the live /api/health response first,
 * because pids get recycled. Graceful (admin API) before signals, SIGTERM
 * before SIGKILL, and a stale advertise file is cleaned, not trusted.
 */

import { execFileSync } from "node:child_process";

export interface AdvertiseEntry {
  pid?: number;
  port?: number;
  url?: string;
  adminNonce?: string;
  startedAt?: number;
  bootId?: string;
  launcher?: string;
  root?: string;
  version?: string;
  [key: string]: unknown;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until the pid exits or the timeout lapses. CLI context: async is fine. */
export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isProcessAlive(pid);
}

export type IdentityVerdict = "match" | "mismatch" | "unreachable";

/**
 * Secondary identity signal for when the HTTP check is unreachable: compare
 * the LIVE process start time against the advertised startedAt. A recycled
 * pid belongs to a process started well after our server did; a hung-but-ours
 * server started (approximately) when the advertise file says. Returns
 * "corroborated" only when the start times agree within tolerance; "recycled"
 * when the live process is provably younger than the advertised boot;
 * "unknown" when ps output cannot be read — callers must REFUSE to kill on
 * "unknown"/"recycled" (audit blocker: never guess).
 */
export function corroborateByStartTime(
  pid: number,
  advertisedStartedAt: number | undefined,
  runPs: (pid: number) => string | null = defaultPs,
): "corroborated" | "recycled" | "unknown" {
  if (!advertisedStartedAt || !Number.isFinite(advertisedStartedAt)) return "unknown";
  if (process.platform === "win32") return "unknown";
  const lstart = runPs(pid);
  if (!lstart) return "unknown";
  const started = Date.parse(lstart);
  if (!Number.isFinite(started)) return "unknown";
  // advertise happens moments after process start; allow generous skew.
  const TOLERANCE_MS = 120_000;
  if (Math.abs(started - advertisedStartedAt) <= TOLERANCE_MS) return "corroborated";
  return started > advertisedStartedAt + TOLERANCE_MS ? "recycled" : "unknown";
}

function defaultPs(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
    const line = out.trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
}

/**
 * Does the server answering on entry.url/port actually carry entry.pid?
 * "mismatch" means someone else answers there (or the pid was recycled):
 * killing entry.pid would hit an innocent process.
 */
export async function verifyServerIdentity(
  entry: AdvertiseEntry,
  fetchFn: typeof fetch = fetch,
): Promise<IdentityVerdict> {
  const base = (entry.url ?? (entry.port ? `http://127.0.0.1:${entry.port}` : null))?.toString().replace(/\/$/, "");
  if (!base || !entry.pid) return "unreachable";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const r = await fetchFn(`${base}/api/health`, {
      signal: controller.signal,
      headers: { connection: "close" },
    });
    clearTimeout(timer);
    if (!r.ok) return "unreachable";
    const health = (await r.json()) as { pid?: number };
    return health.pid === entry.pid ? "match" : "mismatch";
  } catch {
    return "unreachable";
  }
}

/**
 * Ask the server to stop itself via the admin API. Requires the nonce from the
 * advertise file. Note: bin/lib/client.ts carries no LAN token, so on a
 * token-guarded non-loopback bind this degrades (401) to the signal path —
 * that is intended behavior, not an accident.
 */
export async function gracefulStop(
  entry: AdvertiseEntry,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const base = (entry.url ?? (entry.port ? `http://127.0.0.1:${entry.port}` : null))?.toString().replace(/\/$/, "");
  if (!base || !entry.adminNonce) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const r = await fetchFn(`${base}/api/admin/stop`, {
      method: "POST",
      signal: controller.signal,
      headers: { "x-ima2-admin-nonce": entry.adminNonce, connection: "close" },
    });
    clearTimeout(timer);
    return r.status === 202;
  } catch {
    return false;
  }
}

export type KillOutcome = "graceful" | "term" | "kill" | "already-dead" | "failed";

/** SIGTERM → wait → SIGKILL → wait. Only ever called on an identity-verified pid. */
export async function escalateKill(
  pid: number,
  waits: { termMs?: number; killMs?: number } = {},
): Promise<KillOutcome> {
  if (!isProcessAlive(pid)) return "already-dead";
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return isProcessAlive(pid) ? "failed" : "already-dead";
  }
  if (await waitForExit(pid, waits.termMs ?? 5000)) return "term";
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return isProcessAlive(pid) ? "failed" : "term";
  }
  if (await waitForExit(pid, waits.killMs ?? 2000)) return "kill";
  return "failed";
}
