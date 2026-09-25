import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const RUNNING_RE = /Image Gen running at (https?:\/\/[^\s]+)/i;
const STOP_GRACE_MS = 5_000;
const HEALTH_TIMEOUT_MS = 1_500;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASH_RESTARTS = 3;

export async function probeHealth(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.ok ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the server to shut itself down via POST /api/admin/stop using the nonce
 * from its advertise file. Needed on Windows, where child.kill() is a hard
 * TerminateProcess and would skip the server's own teardown.
 */
async function requestAdminStop(pid, configDir, log, timeoutMs = 2_500) {
  const file = join(configDir || join(homedir(), ".ima2"), "server.json");
  try {
    const entry = JSON.parse(readFileSync(file, "utf-8"));
    if (entry.pid !== pid) return fail(`advertise pid ${entry.pid} != child pid ${pid}`);
    if (!entry.adminNonce || !entry.url) return fail("advertise file lacks adminNonce/url");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${String(entry.url).replace(/\/$/, "")}/api/admin/stop`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-ima2-admin-nonce": entry.adminNonce, connection: "close" },
    });
    clearTimeout(timer);
    return res.status === 202 || fail(`admin stop returned HTTP ${res.status}`);
  } catch (err) {
    return fail(`${file}: ${err.message}`);
  }

  function fail(reason) {
    log(`[desktop] graceful stop unavailable (${reason}); falling back to signals`);
    return false;
  }
}

function findOnPath(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf-8" });
  if (r.status !== 0) return null;
  const first = String(r.stdout || "").split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim() : null;
}

/**
 * Packaged builds run the server on Electron's bundled Node
 * (ELECTRON_RUN_AS_NODE) so no system Node is required. Dev runs prefer a
 * system `node` so the repo's native modules stay built for the system ABI.
 */
export function resolveNodeCommand({ nodeBinary, isPackaged }) {
  if (nodeBinary) return { bin: nodeBinary, env: {} };
  if (!isPackaged) {
    const systemNode = findOnPath("node");
    if (systemNode) return { bin: systemNode, env: {} };
  }
  return { bin: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export class ServerSupervisor extends EventEmitter {
  constructor({ rootDir, logFile, isPackaged }) {
    super();
    this.rootDir = rootDir;
    this.logFile = logFile;
    this.isPackaged = isPackaged;
    this.child = null;
    this.state = "stopped";
    this.url = null;
    this.external = false;
    this.lastError = null;
    this.crashTimes = [];
    this.stopping = false;
    this.logStream = null;
    this.configDir = "";
  }

  #setState(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit("status", this.snapshot());
  }

  snapshot() {
    return { state: this.state, url: this.url, external: this.external, pid: this.child?.pid ?? null, lastError: this.lastError };
  }

  #log(line) {
    if (!this.logStream) {
      mkdirSync(dirname(this.logFile), { recursive: true });
      this.logStream = createWriteStream(this.logFile, { flags: "a" });
    }
    this.logStream.write(line.endsWith("\n") ? line : `${line}\n`);
    this.emit("log", line);
  }

  async start(settings) {
    if (this.child || this.state === "starting") return;
    this.stopping = false;
    this.lastError = null;
    const base = `http://127.0.0.1:${settings.port}`;
    this.#setState("starting", { url: null, external: false });

    const existing = await probeHealth(base);
    if (existing) {
      this.#log(`[desktop] attaching to existing ima2 server at ${base} (pid ${existing.pid})`);
      this.#setState("running", { url: base, external: true });
      return;
    }
    this.#spawn(settings);
  }

  #buildEnv(settings) {
    const { bin, env: nodeEnv } = resolveNodeCommand({ nodeBinary: settings.nodeBinary, isPackaged: this.isPackaged });
    const env = { ...process.env, ...nodeEnv, IMA2_PORT: String(settings.port), IMA2_DESKTOP: "1" };
    if (settings.devLogging) {
      env.IMA2_DEV = "1";
      env.IMA2_LOG_LEVEL = env.IMA2_LOG_LEVEL || "debug";
    }
    if (settings.configDir) env.IMA2_CONFIG_DIR = settings.configDir;
    this.configDir = settings.configDir || "";
    return { bin, env };
  }

  #spawn(settings) {
    const { bin, env } = this.#buildEnv(settings);
    const serverPath = join(this.rootDir, "server.js");
    this.#log(`[desktop] starting server: ${bin} ${serverPath} (port ${settings.port})`);
    let child;
    try {
      child = spawn(bin, [serverPath], { cwd: this.rootDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      this.lastError = err.message;
      this.#log(`[desktop] spawn failed: ${err.message}`);
      this.#setState("error");
      return;
    }
    this.child = child;
    child.stdout.on("data", (buf) => this.#onOutput(buf));
    child.stderr.on("data", (buf) => this.#onOutput(buf));
    child.on("error", (err) => {
      this.lastError = err.message;
      this.#log(`[desktop] spawn error: ${err.message}`);
      this.child = null;
      this.#setState("error");
    });
    child.on("exit", (code, signal) => this.#onExit(code, signal, settings));
  }

  #onOutput(buf) {
    for (const line of String(buf).split(/\r?\n/)) {
      if (!line) continue;
      this.#log(line);
      const m = line.match(RUNNING_RE);
      if (m && this.state === "starting") this.#setState("running", { url: m[1].replace(/\/$/, "") });
    }
  }

  #onExit(code, signal, settings) {
    this.#log(`[desktop] server exited code=${code} signal=${signal}`);
    this.child = null;
    if (this.stopping) {
      this.#setState("stopped", { url: null });
      return;
    }
    const now = Date.now();
    this.crashTimes = this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS);
    this.crashTimes.push(now);
    if (this.crashTimes.length > MAX_CRASH_RESTARTS) {
      this.lastError = `server crashed ${this.crashTimes.length} times in ${CRASH_WINDOW_MS / 1000}s (code ${code})`;
      this.#setState("error", { url: null });
      return;
    }
    this.#setState("starting", { url: null });
    setTimeout(() => { if (!this.child && !this.stopping) this.#spawn(settings); }, 1_000);
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      this.#setState("stopped", { url: null, external: false });
      return;
    }
    const graceful = await requestAdminStop(child.pid, this.configDir, (line) => this.#log(line));
    await new Promise((resolve) => {
      const force = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* best-effort: child may already have exited */ } }, STOP_GRACE_MS);
      child.once("exit", () => { clearTimeout(force); resolve(); });
      if (child.exitCode !== null) return resolve();
      if (!graceful) { try { child.kill("SIGTERM"); } catch { resolve(); } }
    });
    this.child = null;
    this.#setState("stopped", { url: null, external: false });
  }

  async restart(settings) {
    await this.stop();
    this.crashTimes = [];
    await this.start(settings);
  }

  dispose() {
    this.logStream?.end();
    this.logStream = null;
  }
}
