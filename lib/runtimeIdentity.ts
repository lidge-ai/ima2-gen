/**
 * Who launched this server and which boot it is.
 *
 * The launcher is derived from the environment each spawner already sets:
 * the desktop shell sets IMA2_DESKTOP=1, the launchd/systemd templates set
 * IMA2_SERVICE=1 and `ima2 start` sets IMA2_LAUNCHER=background. Anything else
 * is a foreground `ima2 serve` (or a bare `node server.js`).
 *
 * The boot id names one process lifetime. Spawners may choose it up front
 * (IMA2_BOOT_ID) so they can recognise their own child without trusting
 * anything the child prints; otherwise the server generates one.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LAUNCHERS = ["foreground", "background", "service", "desktop"] as const;
export type Launcher = (typeof LAUNCHERS)[number];

type Env = Record<string, string | undefined>;

export function resolveLauncher(env: Env = process.env): Launcher {
  if (env.IMA2_DESKTOP === "1") return "desktop";
  if (env.IMA2_SERVICE === "1") return "service";
  if (env.IMA2_LAUNCHER === "background") return "background";
  return "foreground";
}

export function isLauncher(value: unknown): value is Launcher {
  return typeof value === "string" && (LAUNCHERS as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBootId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function resolveBootId(env: Env = process.env): string {
  const chosen = env.IMA2_BOOT_ID;
  return isBootId(chosen) ? chosen : randomUUID();
}

/**
 * Printed on the server's own stdout when POST /api/admin/stop accepts a
 * request. A supervisor that owns the pipe learns that the exit that follows
 * was asked for, and by whom it cannot be forged: only a caller holding the
 * admin nonce reaches this line.
 */
export const STOP_INTENT_PREFIX = "IMA2_STOP_INTENT ";

export function stopIntentLine(bootId: string): string {
  return `${STOP_INTENT_PREFIX}${bootId}\n`;
}

/**
 * Write the advertise file atomically: readers never see half a document, and
 * the file is owner-only because it carries the admin nonce.
 */
export function writeAdvertiseAtomic(file: string, payload: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
