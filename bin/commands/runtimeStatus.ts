import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../../config.js";
import { resolveRuntime, serverLogFile } from "../lib/runtime.js";
import { STATUS_EXIT, buildStatusReport, type StatusReport } from "../lib/runtimeReport.js";
import { RuntimeArgError, humanWriter, portFlag } from "../lib/runtimeArgs.js";
import { inspectManager, serviceOwnership, type ManagerState } from "../lib/serviceManager.js";

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function serviceSharesConfig(manager: ManagerState, configDir: string): boolean | null {
  if (manager.state !== "bound" || !manager.configDir) return null;
  return canonical(manager.configDir) === canonical(configDir);
}

export async function collectRuntimeStatus(port: number = config.server.port): Promise<StatusReport> {
  const resolved = await resolveRuntime({ advertiseFile: config.storage.advertiseFile, port });
  const manager = inspectManager();
  const ownership = resolved.runtime
    ? serviceOwnership(resolved.runtime, manager)
    : manager.state === "unknown" ? "unknown" : "unmanaged";
  return buildStatusReport(resolved, manager, ownership, serverLogFile(config.storage.configDir), serviceSharesConfig(manager, config.storage.configDir));
}

const LAUNCHER_LABEL: Record<string, string> = {
  foreground: "a terminal ('ima2 serve')",
  background: "the background CLI ('ima2 start')",
  service: "the login service ('ima2 service')",
  desktop: "the ima2 desktop app",
};

export function describeRuntime(report: StatusReport): string {
  if (report.liveness === "absent-proven") return "not running";
  if (report.liveness === "unknown") return `unknown — ${report.reason ?? "cannot identify what answers"}`;
  const r = report.runtime!;
  const by = report.serviceOwnership === "managed" ? LAUNCHER_LABEL.service : LAUNCHER_LABEL[r.launcher ?? ""] ?? "an older ima2 (launcher not reported)";
  return `running at ${r.url} (pid ${r.pid}), started by ${by}`;
}

function renderHuman(report: StatusReport, say: (line: string) => void): void {
  say("\n  ima2 runtime\n");
  say(`  Server:   ${describeRuntime(report)}`);
  if (report.runtime?.version) say(`  Version:  ${report.runtime.version}`);
  if (report.runtime?.startedAt) say(`  Started:  ${new Date(report.runtime.startedAt).toLocaleString()}`);
  const m = report.manager;
  say(`  Service:  ${m.state === "absent" ? "not installed" : m.state === "unknown" ? `unknown (${m.reason})` : `${m.kind}, ${m.active ? `running pid ${m.pid ?? "?"}` : "stopped"}`}`);
  if (report.advertiseStale) say("  Note:     ~/.ima2/server.json is stale (its pid is gone)");
  say(`  Log:      ${report.logFile}\n`);
}

/** `ima2 status --runtime [--json] [--port n]`. Exit 0 running, 3 not running, 1 unknown. */
export async function runtimeStatus(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const say = humanWriter(json);
  let port: number;
  try {
    port = portFlag(args) ?? config.server.port;
  } catch (error) {
    if (!(error instanceof RuntimeArgError)) throw error;
    say(`  ${error.message}`);
    process.exitCode = 64;
    return;
  }
  const report = await collectRuntimeStatus(port);
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else renderHuman(report, say);
  process.exitCode = STATUS_EXIT[report.liveness];
}
