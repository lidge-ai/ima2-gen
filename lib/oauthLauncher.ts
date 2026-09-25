import { config } from "../config.js";
import { parseLocalhostPortFromUrl, parseOAuthReadyUrl } from "./runtimePorts.js";
import { detectCodexAuth } from "./codexDetect.js";
import { resolvePackageBin } from "./packageCli.js";
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

export function startOAuthProxy(options: any = {}) {
  const oauthPort = options.oauthPort ?? config.oauth.proxyPort;
  const restartDelayMs = options.restartDelayMs ?? config.oauth.restartDelayMs;
  let currentChild: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let hasBeenReady = false;
  let crashTimes: number[] = [];
  let launchedAuthFile: string | null = null;
  const MAX_RESTARTS = 3;
  // Only crashes inside this window count against the budget; a proxy that ran
  // healthy and exits later resets it, so spread-out crashes never give up permanently.
  const CRASH_WINDOW_MS = 60_000;
  const detectAuth = options.detectAuth ?? detectCodexAuth;
  const execPath = options.execPath ?? process.execPath;
  const resolveOAuthBin = options.resolveOAuthBin ?? (() => resolvePackageBin("openai-oauth", "openai-oauth"));
  const spawnImpl = options.spawnImpl ?? spawn;

  const spawnProxy = () => {
    // Guard: don't start if no auth file exists (avoids pointless crash loops
    // and prevents openai-oauth from corrupting state on refresh failure)
    const auth = detectAuth();
    launchedAuthFile = typeof auth.proxyAuthFile === "string" ? auth.proxyAuthFile : null;
    if (!auth.proxyReady || typeof auth.proxyAuthFile !== "string") {
      console.log("[gpt-oauth] No file-backed Codex session found. Run `ima2 login` to enable GPT OAuth.");
      options.onExit?.({ code: 0, reason: "missing-auth-file" });
      return;
    }

    console.log(`Starting GPT OAuth proxy (openai-oauth) on port ${oauthPort}...`);
    const spawnedAt = Date.now();
    let oauthBin: string;
    try {
      oauthBin = resolveOAuthBin();
    } catch (error) {
      console.error(`[gpt-oauth] failed to resolve bundled proxy: ${(error as Error).message}`);
      options.onExit?.({ code: 1 });
      return;
    }
    const child = spawnImpl(execPath, [
      oauthBin,
      "--port",
      String(oauthPort),
      "--oauth-file",
      auth.proxyAuthFile,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        // openai-oauth 2 enforces one instance per user through a runtime.json lock and exits
        // "already running" when it finds one. Give ima2's child its own lock directory per
        // config dir and port so a proxy the user runs separately never blocks ima2's.
        OPENAI_OAUTH_INTERNAL_RUNTIME_DIR: join(config.storage.configDir, "openai-oauth", String(oauthPort)),
      },
    }) as ChildProcess;
    currentChild = child;

    child.on("error", (err) => {
      console.error(`[gpt-oauth] failed to start proxy: ${err.message}`);
      if (currentChild === child) currentChild = null;
    });

    child.stdout?.on("data", (d) => {
      const msg = d.toString().trim();
      if (!msg) return;
      console.log(`[gpt-oauth] ${msg}`);
      for (const line of msg.split(/\r?\n/)) {
        const url = parseOAuthReadyUrl(line);
        if (!url) continue;
        const port = parseLocalhostPortFromUrl(url);
        if (port && port !== oauthPort) {
          console.log(`[gpt-oauth] requested port ${oauthPort}, actual port ${port}`);
        }
        options.onReady?.({ url, port: port || oauthPort, requestedPort: oauthPort });
        hasBeenReady = true;
      }
    });

    child.stderr?.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes("npm warn")) console.error(`[gpt-oauth] ${msg}`);
    });

    child.on("exit", (code) => {
      if (currentChild === child) currentChild = null;
      if (stopping) return;
      const uptime = Date.now() - spawnedAt;
      if (uptime < 5000 && !hasBeenReady) {
        // Crashed immediately without ever becoming ready — likely missing openai-oauth or no token.
        // Don't restart; just mark as failed silently.
        console.log(`[gpt-oauth] proxy exited immediately (code ${code}). Skipping — Grok-only mode is fine.`);
        options.onExit?.({ code });
        return;
      }
      options.onExit?.({ code });
      const exitedAt = Date.now();
      crashTimes = crashTimes.filter((t) => exitedAt - t < CRASH_WINDOW_MS);
      crashTimes.push(exitedAt);
      if (crashTimes.length > MAX_RESTARTS) {
        console.log(`[gpt-oauth] crashed ${crashTimes.length} times within ${CRASH_WINDOW_MS / 1000}s. Giving up — Grok-only mode is fine.`);
        return;
      }
      console.log(`[gpt-oauth] exited with code ${code}, restarting in ${Math.round(restartDelayMs / 1000)}s... (attempt ${crashTimes.length}/${MAX_RESTARTS})`);
      restartTimer = setTimeout(spawnProxy, restartDelayMs);
    });
  };

  spawnProxy();

  return {
    get child() {
      return currentChild;
    },
    kill(signal: NodeJS.Signals = "SIGTERM") {
      this.stop(signal);
    },
    stop(signal: NodeJS.Signals = "SIGTERM") {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      try { currentChild?.kill(signal); } catch {}
    },
    /**
     * Stop and wait until the child has exited so its port is free. SIGTERM first; after
     * timeoutMs, SIGKILL and wait again. Rejects if the child is still alive after both, so a
     * caller never starts a replacement that would fall back to another port.
     */
    stopAndWait(timeoutMs = 3000): Promise<void> {
      const child = currentChild;
      this.stop();
      if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
      const within = (ms: number) => Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), ms); }),
      ]);
      return within(timeoutMs).then(async (done) => {
        if (done) return;
        try { child.kill("SIGKILL"); } catch {}
        if (!(await within(2000))) throw new Error("GPT OAuth proxy did not exit after SIGKILL");
      });
    },
    /** The session file this launcher handed to the proxy (null when it found none). */
    get authFile() {
      return launchedAuthFile;
    },
  };
}
