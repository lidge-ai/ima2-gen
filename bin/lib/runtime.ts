/**
 * One answer to "is an ima2 server running here, and which one?", shared by
 * `ima2 start`, `ima2 status --runtime`, `ima2 stop` and the desktop shell
 * (which runs the bundled CLI rather than guessing on its own).
 *
 * Liveness has three values. "live" names the server that answered. Only
 * "absent-proven" — every candidate endpoint refused the connection — may
 * lead a caller to start a server. Anything else (a timeout, a non-ima2
 * answer, an advertised pid that is alive but answers as someone else) is
 * "unknown", and callers must not read it as absence.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive, type AdvertiseEntry } from "../../lib/processControl.js";

export type Liveness = "live" | "absent-proven" | "unknown";

export interface RuntimeInfo {
  pid: number;
  url: string;
  port: number | null;
  version: string | null;
  startedAt: number | null;
  bootId: string | null;
  launcher: string | null;
  root: string | null;
}

export interface ResolveResult {
  status: Liveness;
  source: "advertise" | "port" | null;
  runtime: RuntimeInfo | null;
  /** The advertisement vouches for the runtime and carries its admin nonce. */
  stoppable: boolean;
  advertiseStale: boolean;
  entry: AdvertiseEntry | null;
  reason?: string;
}

export interface ResolveOptions {
  advertiseFile: string;
  port: number;
  /** Ports after `port` to scan: a foreground `serve` hops up to 20 on EADDRINUSE. */
  span?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  isAlive?: (pid: number) => boolean;
}

type Probe =
  | { kind: "ima2"; health: Record<string, unknown> }
  | { kind: "refused" }
  | { kind: "other"; reason: string };

export function readAdvertiseFile(file: string): { entry: AdvertiseEntry | null; unreadable: boolean } {
  if (!existsSync(file)) return { entry: null, unreadable: false };
  try {
    return { entry: JSON.parse(readFileSync(file, "utf-8")) as AdvertiseEntry, unreadable: false };
  } catch {
    return { entry: null, unreadable: true };
  }
}

function isRefused(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string; errors?: { code?: string }[] } };
  const codes = [e?.code, e?.cause?.code, ...(e?.cause?.errors ?? []).map((x) => x?.code)];
  return codes.includes("ECONNREFUSED");
}

export async function probeHealth(base: string, fetchFn: typeof fetch, timeoutMs: number): Promise<Probe> {
  try {
    const r = await fetchFn(`${base}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { connection: "close" },
    });
    if (!r.ok) return { kind: "other", reason: `${base} answered HTTP ${r.status}` };
    const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (body && body.ok === true && typeof body.pid === "number") return { kind: "ima2", health: body };
    return { kind: "other", reason: `${base} answered but is not an ima2 server` };
  } catch (error) {
    if (isRefused(error)) return { kind: "refused" };
    return { kind: "other", reason: `${base} did not answer (${(error as Error)?.name ?? "error"})` };
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function runtimeFromHealth(base: string, health: Record<string, unknown>): RuntimeInfo {
  const port = Number(new URL(base).port) || null;
  return {
    pid: Number(health.pid),
    url: base,
    port,
    version: str(health.version),
    startedAt: typeof health.startedAt === "number" ? health.startedAt : null,
    bootId: str(health.bootId),
    launcher: str(health.launcher),
    root: str(health.root),
  };
}

function candidates(entry: AdvertiseEntry | null, port: number, span: number): string[] {
  const list: string[] = [];
  if (entry?.url) list.push(String(entry.url).replace(/\/$/, ""));
  if (entry?.port) list.push(`http://127.0.0.1:${entry.port}`);
  for (let p = port; p <= port + span; p++) list.push(`http://127.0.0.1:${p}`);
  return [...new Set(list)];
}

export async function resolveRuntime(opts: ResolveOptions): Promise<ResolveResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const isAlive = opts.isAlive ?? isProcessAlive;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const { entry, unreadable } = readAdvertiseFile(opts.advertiseFile);
  const entryPid = Number(entry?.pid) || 0;
  const entryAlive = entryPid > 0 && isAlive(entryPid);
  const base = { entry, advertiseStale: unreadable || (entry !== null && !entryAlive) };
  const bases = candidates(entry, opts.port, opts.span ?? 20);
  // Probes run in parallel: on Windows a refused loopback connect can take a second or two.
  const probes = await Promise.all(bases.map((b) => probeHealth(b, fetchFn, timeoutMs)));
  const found = probes.findIndex((p) => p.kind === "ima2");
  if (found >= 0) {
    const health = (probes[found] as { health: Record<string, unknown> }).health;
    const runtime = runtimeFromHealth(bases[found]!, health);
    const vouched = entryAlive && runtime.pid === entryPid && Boolean(entry?.adminNonce);
    if (entryAlive && runtime.pid !== entryPid && bases[found] === bases[0] && entry?.url) {
      return { ...base, status: "unknown", source: null, runtime, stoppable: false,
        reason: `advertised pid ${entryPid} is alive but pid ${runtime.pid} answers at ${bases[found]}` };
    }
    return { ...base, status: "live", source: vouched ? "advertise" : "port", runtime, stoppable: vouched };
  }
  const other = probes.find((p) => p.kind === "other") as { reason: string } | undefined;
  if (other) return { ...base, status: "unknown", source: null, runtime: null, stoppable: false, reason: other.reason };
  return { ...base, status: "absent-proven", source: null, runtime: null, stoppable: false };
}

/** Environment for a server child: the caller's env plus the API key from config. */
export function buildServerEnv(
  config: { provider?: string; apiKey?: string },
  extra: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // A launcher marker inherited from a parent must not mislabel this child.
  for (const key of ["IMA2_DESKTOP", "IMA2_SERVICE", "IMA2_LAUNCHER", "IMA2_BOOT_ID", "IMA2_STRICT_PORT"]) delete env[key];
  if (config.provider === "api" && config.apiKey) env.OPENAI_API_KEY = config.apiKey;
  return { ...env, ...extra };
}

export function serverLogFile(configDir: string): string {
  return join(configDir, "logs", "server.log");
}

/**
 * Start a process that outlives this CLI: its own process group (Unix) or a
 * hidden detached process (Windows), stdout/stderr appended to `logFd`. The
 * parent closes its copy of the fd so nothing keeps the log handle open.
 */
export function spawnDetached(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logFd: number },
): ChildProcess {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", opts.logFd, opts.logFd],
  });
  closeSync(opts.logFd);
  child.unref();
  return child;
}
