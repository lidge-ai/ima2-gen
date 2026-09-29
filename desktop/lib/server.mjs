import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { desktopRuntimeEnv } from "./runtime-env.mjs";
import { parseStatus, parseStop, runBundledCli } from "./runtime-cli.mjs";
import { decideStartup, takeoverBlocker } from "./startup-decision.mjs";
import { takeOver } from "./takeover.mjs";

const RUNNING_RE = /Image Gen running at (https?:\/\/[^\s]+)/i;
const STOP_INTENT_PREFIX = "IMA2_STOP_INTENT ";
const STOP_GRACE_MS = 5_000;
const HEALTH_TIMEOUT_MS = 1_500;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASH_RESTARTS = 3;
const SERVICE_WAIT_MS = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function probeHealth(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.ok ? body : null;
  } catch {
    return null;
  }
}

/** "refused" only for a refused connection; a timeout or any answer is not silence. */
export async function probeListener(url, timeoutMs = 3_000) {
  try {
    await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return "answered";
  } catch (error) {
    return (error?.cause?.code ?? error?.code) === "ECONNREFUSED" ? "refused" : "answered";
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
    const res = await fetch(`${String(entry.url).replace(/\/$/, "")}/api/admin/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-ima2-admin-nonce": entry.adminNonce, connection: "close" },
    });
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

/**
 * Owns the desktop's relationship with "the ima2 server": asks the bundled CLI
 * what already runs (devlog/_plan/260929_background_runtime/030), then attaches
 * to it, asks, takes it over, or starts the bundled server — and restarts only
 * a bundled child that crashed, never one that was stopped on request.
 */
export class ServerSupervisor extends EventEmitter {
  constructor({ rootDir, logFile, isPackaged, origin = "user", askTakeover = null, spawnFn = spawn, runCli = null, probe = probeListener }) {
    super();
    Object.assign(this, { rootDir, logFile, isPackaged, origin, spawnFn, probe });
    this.askTakeover = askTakeover ?? (async () => ({ approve: false }));
    this.checkCli = !runCli;
    this.runCli = runCli ?? ((args, settings) => runBundledCli({
      rootDir, args, env: desktopRuntimeEnv(settings), command: resolveNodeCommand({ nodeBinary: settings.nodeBinary, isPackaged }),
    }));
    Object.assign(this, { child: null, state: "stopped", url: null, external: false, lastError: null, crashTimes: [], stopping: false, logStream: null, configDir: "" });
    Object.assign(this, { ownership: null, guest: null, guestStatus: null, note: null, stoppedBy: null, childBootId: null, generation: 0 });
  }

  #setState(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit("status", this.snapshot());
  }

  snapshot() {
    const { state, url, external, lastError, ownership, guest, note, stoppedBy } = this;
    return { state, url, external, pid: this.child?.pid ?? null, lastError, ownership, guest, note, stoppedBy };
  }

  #log(line) {
    if (!this.logStream) {
      mkdirSync(dirname(this.logFile), { recursive: true });
      this.logStream = createWriteStream(this.logFile, { flags: "a" });
    }
    this.logStream.write(line.endsWith("\n") ? line : `${line}\n`);
    this.emit("log", line);
  }

  async #resolve(settings) {
    if (this.checkCli && !existsSync(join(this.rootDir, "bin", "ima2.js"))) {
      return { ok: false, reason: "the bundled CLI (bin/ima2.js) is missing; run npm run build:cli" };
    }
    return parseStatus(await this.runCli(["status", "--runtime", "--json", "--port", String(settings.port)], settings));
  }

  #decide(parsed, settings) {
    return decideStartup({ parsed, bundledRoot: this.rootDir, existingServer: settings.existingServer, origin: this.origin });
  }

  async start(settings) {
    if (this.child || this.state === "starting") return;
    const gen = ++this.generation;
    this.stopping = false;
    this.lastError = null;
    this.#setState("starting", { url: null, external: false, ownership: null, guest: null, note: null, stoppedBy: null });
    let parsed = await this.#resolve(settings);
    if (gen !== this.generation) return;
    let decision = this.#decide(parsed, settings);
    if (decision.action === "wait-service") ({ parsed, decision } = await this.#waitForService(settings, gen));
    if (gen !== this.generation) return;
    this.#log(`[desktop] startup: ${decision.action}${decision.reason ? ` — ${decision.reason}` : ""}`);
    await this.#apply(decision, parsed, settings, gen);
  }

  /** A login service is active but not answering yet: give it time instead of racing it. */
  async #waitForService(settings, gen) {
    const deadline = Date.now() + SERVICE_WAIT_MS;
    while (Date.now() < deadline && gen === this.generation) {
      await sleep(1_000);
      const parsed = await this.#resolve(settings);
      const decision = this.#decide(parsed, settings);
      if (decision.action !== "wait-service") return { parsed, decision };
    }
    return { parsed: null, decision: { action: "blocked", reason: "the login service is running but its server is not answering yet — wait, or stop it with 'ima2 service stop'" } };
  }

  async #apply(decision, parsed, settings, gen) {
    const status = parsed?.status;
    if (decision.action === "start") return this.#spawn(settings, gen);
    if (decision.action === "attach-bundled") return this.#attach(status, "bundled");
    if (decision.action === "attach-guest") return this.#attach(status, "guest", decision.reason ?? null);
    if (decision.action === "takeover") return this.#takeOver(status, settings, gen);
    if (decision.action === "ask") {
      const answer = await this.askTakeover(status);
      if (gen !== this.generation) return;
      return answer?.approve ? this.#takeOver(status, settings, gen) : this.#attach(status, "guest");
    }
    this.lastError = decision.reason ?? "the ima2 runtime could not be resolved";
    this.#setState("error", { url: null });
  }

  #attach(status, ownership, note = null) {
    const r = status.runtime;
    this.guestStatus = ownership === "guest" ? status : null;
    const guest = ownership === "guest"
      ? { pid: r.pid, launcher: r.launcher, version: r.version, url: r.url, serviceManaged: status.serviceOwnership === "managed", takeoverBlocker: takeoverBlocker(status) }
      : null;
    this.#log(`[desktop] attaching (${ownership}) to ima2 at ${r.url} (pid ${r.pid}, launcher ${r.launcher ?? "not reported"})`);
    this.#setState("running", { url: String(r.url).replace(/\/$/, ""), external: ownership === "guest", ownership, guest, note });
  }

  async #takeOver(status, settings, gen) {
    this.#setState("starting", { url: null, external: false, ownership: null, guest: null, note: "Switching to the bundled server…" });
    const result = await takeOver({
      approved: status,
      resolve: () => this.#resolve(settings),
      stop: async (args) => parseStop(await this.runCli(args, settings)),
      probe: (url) => this.probe(url),
      cancelled: () => gen !== this.generation,
    });
    if (gen !== this.generation) return;
    if (result.ok) {
      this.#log("[desktop] takeover: the other server stopped; starting the bundled server");
      return this.#spawn(settings, gen);
    }
    this.#log(`[desktop] takeover failed: ${result.reason}`);
    this.lastError = `Could not switch to the bundled server: ${result.reason}`;
    const after = await this.#resolve(settings);
    if (gen !== this.generation) return;
    if (after.ok && after.status.liveness === "live") return this.#attach(after.status, "guest", this.lastError);
    this.#setState("error", { url: null, note: null });
  }

  /** Tray / settings action: replace the attached native server with the bundled one. */
  async useBundledServer(settings) {
    if (this.ownership !== "guest" || !this.guestStatus || this.state === "starting") return;
    const gen = ++this.generation;
    this.stopping = false;
    await this.#takeOver(this.guestStatus, settings, gen);
  }

  /** Every async path carries the generation it began in; stop() and a newer start() retire it. */
  #spawn(settings, gen) {
    if (gen !== this.generation || this.stopping || this.child) return;
    const { bin, env: nodeEnv } = resolveNodeCommand({ nodeBinary: settings.nodeBinary, isPackaged: this.isPackaged });
    const env = { ...desktopRuntimeEnv(settings, { forServer: true }), ...nodeEnv };
    const serverPath = join(this.rootDir, "server.js");
    this.configDir = settings.configDir || "";
    this.#log(`[desktop] starting server: ${bin} ${serverPath} (port ${settings.port}, boot ${env.IMA2_BOOT_ID})`);
    let child;
    try {
      child = this.spawnFn(bin, [serverPath], { cwd: this.rootDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      this.lastError = err.message;
      this.#log(`[desktop] spawn failed: ${err.message}`);
      this.#setState("error");
      return;
    }
    this.#track(child, { bootId: env.IMA2_BOOT_ID, buf: "", stopIntent: false }, settings, gen);
  }

  #track(child, own, settings, gen) {
    this.child = child;
    this.childBootId = own.bootId;
    child.stdout.on("data", (buf) => this.#onStdout(child, own, buf));
    child.stderr.on("data", (buf) => { for (const line of String(buf).split(/\r?\n/)) this.#onLine(child, own, line, false); });
    child.on("error", (err) => {
      if (this.child !== child) return;
      this.lastError = err.message;
      this.#log(`[desktop] spawn error: ${err.message}`);
      this.child = null;
      this.#setState("error");
    });
    child.once("exit", (code, signal) => this.#afterStdout(child, () => this.#onExit(child, own, code, signal, settings, gen)));
  }

  /** The exit event can beat the last stdout chunk; the stop-intent line may be in it. */
  #afterStdout(child, fn) {
    let done = false;
    const once = () => { if (!done) { done = true; fn(); } };
    if (!child.stdout || child.stdout.readableEnded) return once();
    const timer = setTimeout(once, 500);
    child.stdout.once("end", () => { clearTimeout(timer); once(); });
  }

  #onStdout(child, own, buf) {
    own.buf += String(buf);
    const lines = own.buf.split(/\r?\n/);
    own.buf = lines.pop() ?? "";
    for (const line of lines) this.#onLine(child, own, line, true);
  }

  /** Only a complete stdout line from this child, naming this child's boot, is a stop intent. */
  #onLine(child, own, line, completeStdoutLine) {
    if (!line) return;
    this.#log(line);
    if (completeStdoutLine && line === `${STOP_INTENT_PREFIX}${own.bootId}`) own.stopIntent = true;
    const m = line.match(RUNNING_RE);
    if (m && this.child === child && this.state === "starting") {
      this.#setState("running", { url: m[1].replace(/\/$/, ""), external: false, ownership: "bundled", guest: null, note: null });
      void this.#confirmBoot(own.bootId);
    }
  }

  async #confirmBoot(bootId) {
    const health = await probeHealth(this.url);
    if (health?.bootId && health.bootId !== bootId) {
      this.#log(`[desktop] warning: ${this.url} reports boot ${health.bootId}, expected ${bootId}`);
    }
  }

  #onExit(child, own, code, signal, settings, gen) {
    // An unterminated fragment is logged but never read as a stop intent.
    if (own.buf) this.#onLine(child, own, own.buf, false);
    own.buf = "";
    this.#log(`[desktop] server exited code=${code} signal=${signal}`);
    if (this.child !== child) return;
    this.child = null;
    if (this.stopping || gen !== this.generation) return this.#setState("stopped", { url: null, ownership: null });
    if (own.stopIntent && code === 0 && !signal) {
      this.lastError = null;
      this.#log("[desktop] the server was stopped on request (ima2 stop); not restarting it");
      return this.#setState("stopped", { url: null, ownership: null, stoppedBy: "cli" });
    }
    const now = Date.now();
    this.crashTimes = this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS);
    this.crashTimes.push(now);
    if (this.crashTimes.length > MAX_CRASH_RESTARTS) {
      this.lastError = `server crashed ${this.crashTimes.length} times in ${CRASH_WINDOW_MS / 1000}s (code ${code})`;
      return this.#setState("error", { url: null, ownership: null });
    }
    this.#setState("starting", { url: null });
    setTimeout(() => this.#spawn(settings, gen), 1_000);
  }

  async stop() {
    this.generation++;
    this.stopping = true;
    const child = this.child;
    if (!child) {
      this.#setState("stopped", { url: null, external: false, ownership: null, guest: null });
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
    this.#setState("stopped", { url: null, external: false, ownership: null, guest: null });
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
