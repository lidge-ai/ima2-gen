import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AUTOSTART_FLAG } from "./launch-origin.mjs";

/**
 * Electron's login-item API covers macOS and Windows only. Linux desktops follow the XDG
 * autostart spec: a .desktop entry in $XDG_CONFIG_HOME/autostart. AppImage builds must point at
 * the AppImage itself ($APPIMAGE), not the transient mount the process runs from.
 */
export function linuxAutostartFile(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "autostart", "ima2.desktop");
}

const DESKTOP_EXEC_RESERVED = new Set(['"', "\\", "$", String.fromCharCode(96)]);

export function linuxAutostartEntry(execPath) {
  const escaped = Array.from(execPath, (c) => (DESKTOP_EXEC_RESERVED.has(c) ? "\\" + c : c)).join("");
  const needsQuotes = Array.from(execPath).some((c) => c.trim() === "" || c === "'" || DESKTOP_EXEC_RESERVED.has(c));
  const quoted = needsQuotes ? `"${escaped}"` : execPath;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=ima2",
    "Comment=Local-first visual generation studio",
    // The flag tells the app it was started at login (desktop/lib/launch-origin.mjs).
    `Exec=${quoted} ${AUTOSTART_FLAG}`,
    "Icon=ima2",
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function createLoginItem({ app, platform = process.platform, env = process.env, execPath = process.execPath }) {
  if (platform !== "linux") {
    // Windows compares login items by path *and* args, so reads must pass the same args.
    const query = platform === "win32" ? { args: [AUTOSTART_FLAG] } : undefined;
    const read = () => app.getLoginItemSettings(query);
    return {
      supported: true,
      isEnabled: () => read().openAtLogin === true,
      set: (enabled, { hidden = false } = {}) => {
        const current = read();
        const darwin = platform === "darwin";
        if (current.openAtLogin === enabled && (!darwin || current.openAsHidden === hidden)) return;
        app.setLoginItemSettings(darwin ? { openAtLogin: enabled, openAsHidden: hidden } : { openAtLogin: enabled, args: [AUTOSTART_FLAG] });
      },
    };
  }
  const file = linuxAutostartFile(env);
  const target = env.APPIMAGE || execPath;
  return {
    supported: true,
    isEnabled: () => existsSync(file),
    set: (enabled) => {
      if (!enabled) {
        rmSync(file, { force: true });
        return;
      }
      const entry = linuxAutostartEntry(target);
      if (existsSync(file) && readFileSync(file, "utf8") === entry) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, entry, { mode: 0o644 });
    },
  };
}
