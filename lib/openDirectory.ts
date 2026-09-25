import { type SpawnOptions, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { errInfo } from "./errInfo.js";
interface DirectoryOpenerChild {
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  unref?(): void;
}

export interface OpenDirectoryOptions {
  platform?: NodeJS.Platform;
  spawnImpl?(command: string, args: string[], options: SpawnOptions): DirectoryOpenerChild;
  settleMs?: number;
}

export async function openDirectory(dir: string, options: OpenDirectoryOptions = {}) {
  await mkdir(dir, { recursive: true });
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 250;
  const command =
    platform === "darwin" ? "open"
    : platform === "win32" ? "explorer"
    : "xdg-open";

  return new Promise((resolve) => {
    try {
      const isWin = platform === "win32";
      const child = spawnImpl(command, [dir], {
        detached: !isWin,
        stdio: "ignore",
        windowsHide: !isWin,
      });
      let settled = false;
      const done = (result: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.on("error", (err: Error) => {
        done({ ok: false, error: err.message || String(err) });
      });
      child.on("exit", (code: number | null) => {
        if (platform === "win32") {
          done({ ok: true });
          return;
        }
        if (code === 0) done({ ok: true });
        else if (code != null) done({ ok: false, error: `${command} exited with code ${code}` });
      });
      child.unref?.();
      setTimeout(() => done({ ok: true }), settleMs).unref?.();
    } catch (e) {
      const err = errInfo(e);
      resolve({ ok: false, error: err.message || String(err.raw) });
    }
  });
}
