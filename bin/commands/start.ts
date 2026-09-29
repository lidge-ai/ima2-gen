import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { config } from "../../config.js";
import { buildServerEnv, probeHealth, resolveRuntime, serverLogFile, spawnDetached } from "../lib/runtime.js";
import { buildStartReport, type StartReport } from "../lib/runtimeReport.js";
import { RuntimeArgError, humanWriter, portFlag, wantsHelp } from "../lib/runtimeArgs.js";
import { inspectManager, serviceOwnership } from "../lib/serviceManager.js";
import { stopRuntime } from "../lib/stopRuntime.js";
import { ensureFreshUiDist } from "../lib/ui-build.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOOT_TIMEOUT_MS = 45_000;

const HELP = `
  Usage: ima2 start [--port <n>] [--dev] [--json]
         ima2 restart [--port <n>] [--dev] [--json]

  start    Runs the server in the background and returns once it answers.
           Already running → says so and exits 0. Logs: 'ima2 logs'.
           The port is pinned: a busy port is an error, never a silent hop.
  restart  Stops a background or terminal server, then starts one in the
           background. A desktop or login-service server is restarted from
           its owner ('ima2 service restart', or the desktop app).

    --port <n>  Port to use (default: IMA2_PORT or config, 3333)
    --dev       Verbose server diagnostics (IMA2_DEV=1)
    --json      Print one ima2-start/1 document on stdout
`;

function probeHost(): string {
  const host = config.server.host;
  return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function readUserConfig(): { provider?: string; apiKey?: string } {
  try {
    return existsSync(config.storage.configFile) ? JSON.parse(readFileSync(config.storage.configFile, "utf-8")) : {};
  } catch {
    return {};
  }
}

function logTail(file: string, lines = 20): string {
  try {
    return readFileSync(file, "utf-8").split(/\r?\n/).slice(-lines - 1).join("\n");
  } catch {
    return "";
  }
}

export async function startRuntime({ port, dev, json = false }: { port: number; dev: boolean; json?: boolean }): Promise<StartReport> {
  const logFile = serverLogFile(config.storage.configDir);
  const resolved = await resolveRuntime({ advertiseFile: config.storage.advertiseFile, port });
  const base = { logFile, port, pid: null, url: null, launcher: null };
  if (resolved.status === "live" && resolved.runtime) {
    const r = resolved.runtime;
    return buildStartReport({ ...base, outcome: "already-running", pid: r.pid, url: r.url, port: r.port, launcher: r.launcher,
      message: `ima2 server already running at ${r.url} (pid ${r.pid}${r.launcher ? `, ${r.launcher}` : ""}).` });
  }
  if (resolved.status === "unknown") {
    return buildStartReport({ ...base, outcome: "refused",
      message: `Not starting: ${resolved.reason ?? "something answers but cannot be identified"}. Free the port or pick another with --port.` });
  }
  const ui = ensureFreshUiDist(ROOT, { toStderr: json });
  if (!ui.ok) return buildStartReport({ ...base, outcome: "failed", message: ui.error ?? "UI build is missing" });
  return launch({ port, dev, logFile });
}

async function launch({ port, dev, logFile }: { port: number; dev: boolean; logFile: string }): Promise<StartReport> {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a");
  writeSync(fd, `\n[ima2 start] ${new Date().toISOString()} port ${port}\n`);
  const bootId = randomUUID();
  const env = buildServerEnv(readUserConfig(), {
    IMA2_LAUNCHER: "background",
    IMA2_STRICT_PORT: "1",
    IMA2_PORT: String(port),
    IMA2_BOOT_ID: bootId,
    ...(dev ? { IMA2_DEV: "1", IMA2_LOG_LEVEL: process.env.IMA2_LOG_LEVEL || "debug" } : {}),
  });
  const child = spawnDetached(process.execPath, [join(ROOT, "server.js")], { cwd: ROOT, env, logFd: fd });
  const ready = await waitForBoot(child, `http://${probeHost()}:${port}`, bootId);
  const common = { logFile, port, pid: child.pid ?? null, launcher: "background" };
  if (ready.ok) {
    return buildStartReport({ ...common, outcome: "started", url: ready.url, message: `ima2 server started in the background at ${ready.url} (pid ${child.pid}).` });
  }
  const tail = logTail(logFile);
  return buildStartReport({ ...common, outcome: "failed", url: null, message: `${ready.reason}. Log: ${logFile}${tail ? `\n${tail}` : ""}` });
}

async function waitForBoot(child: ChildProcess, url: string, bootId: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  let exited: string | undefined;
  child.once("exit", (code, signal) => { exited = signal ? `signal ${signal}` : `code ${code}`; });
  child.once("error", (error) => { exited = error.message; });
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) return { ok: false, reason: `The server exited during startup (${exited})` };
    const probe = await probeHealth(url, fetch, 1500);
    if (probe.kind === "ima2" && probe.health.pid === child.pid && probe.health.bootId === bootId) return { ok: true, url };
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, reason: `The server did not answer within ${BOOT_TIMEOUT_MS / 1000} s (pid ${child.pid} may still be starting)` };
}

/** Stop what runs now (only if the CLI may), then start in the background. */
export async function restartRuntime({ port, dev, json = false }: { port: number; dev: boolean; json?: boolean }): Promise<StartReport> {
  const resolved = await resolveRuntime({ advertiseFile: config.storage.advertiseFile, port });
  const refuse = (message: string) => buildStartReport({ outcome: "refused", logFile: serverLogFile(config.storage.configDir), port, pid: resolved.runtime?.pid ?? null, url: resolved.runtime?.url ?? null, launcher: resolved.runtime?.launcher ?? null, message });
  if (resolved.status === "live" && resolved.runtime) {
    const r = resolved.runtime;
    if (r.launcher === "desktop") return refuse("This server belongs to the ima2 desktop app; restart it from the app (tray → Restart Server).");
    if (serviceOwnership(r, inspectManager()) !== "unmanaged") return refuse("This server belongs to the login service; use 'ima2 service restart'.");
    const stopped = await stopRuntime({ advertiseFile: config.storage.advertiseFile, expectPid: r.pid,
      ...(r.bootId ? { expectBoot: r.bootId } : r.startedAt ? { expectStarted: r.startedAt } : {}) });
    if (!stopped.ok) return refuse(`Could not stop the running server: ${stopped.message}`);
  }
  return startRuntime({ port, dev, json });
}

export async function start(args: string[] = [], mode: "start" | "restart" = "start"): Promise<void> {
  if (wantsHelp(args)) {
    console.log(HELP);
    return;
  }
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
  const dev = args.includes("--dev");
  const report = mode === "restart" ? await restartRuntime({ port, dev, json }) : await startRuntime({ port, dev, json });
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else say(`\n  ${report.message.replace(/\n/g, "\n  ")}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
