/**
 * Is the running server owned by the login service (launchd / systemd)?
 *
 * The answer has three values on purpose. "absent" means no service is
 * installed or registered; "bound" carries what the manager reports; and
 * "unknown" means the manager could not be asked. Treating a failed query as
 * "no service" is how a stop ends up killing a process that KeepAlive then
 * restarts, so callers refuse destructive work on "unknown".
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LAUNCHD_LABEL, SYSTEMD_UNIT } from "./serviceTemplates.js";

export type ManagerState =
  | { state: "absent" }
  | { state: "bound"; kind: "launchd" | "systemd"; pid: number | null; active: boolean; configDir: string | null }
  | { state: "unknown"; reason: string };

export type ServiceOwnership = "managed" | "unmanaged" | "unknown";

export interface RunResult { ok: boolean; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[]) => RunResult;

export function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

export function guiDomain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

export const defaultRunner: Runner = (cmd, args) => {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "" };
  }
};

/** `launchctl print gui/<uid>/<label>` output → pid and whether it runs. */
export function parseLaunchctlPrint(text: string): { pid: number | null; active: boolean } | null {
  const state = /^\s*state = (\S+)/m.exec(text)?.[1];
  if (!state) return null;
  const pid = Number(/^\s*pid = (\d+)/m.exec(text)?.[1]);
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, active: state === "running" };
}

/** `systemctl --user show <unit> -p MainPID -p ActiveState` output. */
export function parseSystemctlShow(text: string): { pid: number | null; active: boolean } | null {
  const active = /^ActiveState=(\S*)/m.exec(text)?.[1];
  const pidText = /^MainPID=(\d+)/m.exec(text)?.[1];
  if (active === undefined || pidText === undefined) return null;
  const pid = Number(pidText);
  return { pid: pid > 0 ? pid : null, active: active === "active" };
}

/**
 * Which config dir the installed service serves: the IMA2_CONFIG_DIR baked into
 * the plist or unit, else the default ~/.ima2. The single login service may
 * belong to a different config dir than the desktop or CLI asking about it.
 */
export function parseServiceConfigDir(text: string, home: string = homedir()): string {
  const plist = /<key>IMA2_CONFIG_DIR<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
  if (plist !== undefined) return plist.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const unit = /^Environment=IMA2_CONFIG_DIR=(.*)$/m.exec(text)?.[1];
  return unit !== undefined ? unit.trim() : join(home, ".ima2");
}

export interface InspectOptions {
  platform?: NodeJS.Platform;
  run?: Runner;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

function readConfigDir(path: string, readFile: (p: string) => string): string | null {
  try {
    return parseServiceConfigDir(readFile(path));
  } catch {
    return null;
  }
}

export function inspectManager(opts: InspectOptions = {}): ManagerState {
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? defaultRunner;
  const exists = opts.exists ?? existsSync;
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  if (platform === "darwin") return inspectLaunchd(run, exists, readFile);
  if (platform === "linux") return inspectSystemd(run, exists, readFile);
  return { state: "absent" };
}

function inspectLaunchd(run: Runner, exists: (p: string) => boolean, readFile: (p: string) => string): ManagerState {
  if (!exists(launchdPlistPath())) return { state: "absent" };
  const r = run("/bin/launchctl", ["print", `${guiDomain()}/${LAUNCHD_LABEL}`]);
  if (!r.ok) {
    // An installed plist whose job is not loaded is a dormant registration.
    if (/could not find service|not find/i.test(r.stderr + r.stdout)) return { state: "absent" };
    return { state: "unknown", reason: `launchctl print failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
  }
  const parsed = parseLaunchctlPrint(r.stdout);
  if (!parsed) return { state: "unknown", reason: "launchctl print output had no state line" };
  return { state: "bound", kind: "launchd", ...parsed, configDir: readConfigDir(launchdPlistPath(), readFile) };
}

function inspectSystemd(run: Runner, exists: (p: string) => boolean, readFile: (p: string) => string): ManagerState {
  if (!exists(systemdUnitPath())) return { state: "absent" };
  const r = run("systemctl", ["--user", "show", SYSTEMD_UNIT, "-p", "MainPID", "-p", "ActiveState"]);
  if (!r.ok) return { state: "unknown", reason: `systemctl show failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
  const parsed = parseSystemctlShow(r.stdout);
  if (!parsed) return { state: "unknown", reason: "systemctl show output had no MainPID/ActiveState" };
  return { state: "bound", kind: "systemd", ...parsed, configDir: readConfigDir(systemdUnitPath(), readFile) };
}

/**
 * The service owns a runtime only when the manager is active and reports that
 * runtime's pid. A server that says it came from the service but has no
 * matching manager is ambiguous and stays "unknown".
 */
export function serviceOwnership(
  runtime: { pid: number; launcher?: string | null } | null,
  manager: ManagerState,
): ServiceOwnership {
  if (manager.state === "unknown") return "unknown";
  if (runtime && manager.state === "bound" && manager.active && manager.pid === runtime.pid) return "managed";
  if (runtime?.launcher === "service") return "unknown";
  return "unmanaged";
}
