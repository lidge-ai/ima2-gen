// Cross-platform helpers (Windows / macOS / Linux / WSL).
// Keep this file tiny & dependency-free. Node 18+ only.

import { spawn, execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { errInfo } from "../../lib/errInfo.js";
import { logWarn } from "../../lib/logger.js";
export const isWin = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = !isWin && !isMac;

let _wslCached: boolean | null = null;
export function isWsl() {
  if (_wslCached !== null) return _wslCached;
  if (!isLinux) return (_wslCached = false);
  try {
    _wslCached = readFileSync("/proc/version", "utf-8").toLowerCase().includes("microsoft");
  } catch {
    _wslCached = false;
  }
  return _wslCached;
}

export function hasDesktopSession() {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Resolve an executable name that differs between Windows and Unix.
 * On Windows, npm global shims are .cmd files; spawn() without shell:true
 * cannot resolve them and fails with ENOENT.
 */
export function resolveBin(name: string) {
  return isWin ? `${name}.cmd` : name;
}

/**
 * spawn() wrapper that works for npm/npx/any PATH-resolved exe on Windows.
 */
export function spawnBin(name: string, args: string[], opts: Parameters<typeof spawn>[2] = {}) {
  if (isWin) {
    // Node 24 on Windows can throw EINVAL when spawning PATH-resolved .cmd
    // shims directly with piped stdio. Routing through cmd.exe avoids that.
    return spawn("cmd.exe", ["/d", "/s", "/c", `${name} ${args.join(" ")}`], {
      windowsHide: true,
      ...opts,
    });
  }
  return spawn(resolveBin(name), args, { windowsHide: true, ...opts });
}

/**
 * Open a URL in the user's default browser.
 * Returns { ok: boolean, error?: string }.
 * Handles WSL (via powershell.exe) and refuses on headless Linux without DISPLAY.
 */
export function openUrl(url: string): { ok: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "only http(s) URLs can be opened" };
    }
    if (isMac) {
      execFileSync("open", [url], { stdio: "ignore" });
    } else if (isWin || isWsl()) {
      // Only base64 data varies; URL punctuation never enters PowerShell syntax.
      const encoded = Buffer.from(url, "utf8").toString("base64");
      const command = `$u=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Start-Process -FilePath $u -ErrorAction Stop`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { stdio: "ignore", windowsHide: true });
    } else {
      if (!hasDesktopSession()) {
        return { ok: false, error: "no desktop session (DISPLAY/WAYLAND_DISPLAY unset)" };
      }
      execFileSync("xdg-open", [url], { stdio: "ignore" });
    }
    return { ok: true };
  } catch (e) {
    const err = errInfo(e);
    return { ok: false, error: err.message || String(e) };
  }
}

/**
 * Register graceful shutdown handlers.
 * Windows does NOT raise SIGTERM from the OS — SIGINT (Ctrl+C) and SIGBREAK
 * (Ctrl+Break) are the observable signals. We still register SIGTERM so that
 * Node-internal `child.kill("SIGTERM")` calls work in tests.
 *
 * Handlers may return a Promise — they run with a grace period (default 3s)
 * before forceful exit, giving file handles and sockets time to close cleanly.
 */
const SHUTDOWN_GRACE_MS = 3_000;
let shutdownStarted = false;

export function onShutdown(handler: (signal: NodeJS.Signals) => void | Promise<void>) {
  const signals: NodeJS.Signals[] = isWin
    ? ["SIGINT", "SIGTERM", "SIGBREAK"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const sig of signals) {
    try {
      process.on(sig, async () => {
        if (shutdownStarted) return;
        shutdownStarted = true;
        const forceExit = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
        forceExit.unref?.();
        try { await handler(sig); } catch (err) { logWarn("shutdown", "handler_failed", { signal: sig, error: err }); }
        process.exit(0);
      });
    } catch {
      // Some signals aren't installable on certain platforms; ignore.
    }
  }
}

/**
 * Kill an entire process tree. On Windows, child.kill() only kills the
 * immediate process, leaving grandchildren alive and holding file locks.
 * taskkill /T /F kills the whole tree.
 */
export function killProcessTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process already exited
  }
}
