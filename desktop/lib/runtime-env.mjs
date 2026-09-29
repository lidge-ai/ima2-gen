import { randomUUID } from "node:crypto";

/**
 * The environment the desktop shares with everything it runs: the server child
 * and the bundled CLI it asks about the runtime. Both must see the same port and
 * config directory, or the CLI inspects a different server than the one the
 * desktop manages.
 */
export function desktopRuntimeEnv(settings, { forServer = false, base = process.env } = {}) {
  const env = { ...base, IMA2_PORT: String(settings.port) };
  for (const key of ["IMA2_DESKTOP", "IMA2_SERVICE", "IMA2_LAUNCHER", "IMA2_BOOT_ID", "IMA2_STRICT_PORT"]) delete env[key];
  if (settings.configDir) env.IMA2_CONFIG_DIR = settings.configDir;
  if (settings.devLogging) {
    env.IMA2_DEV = "1";
    env.IMA2_LOG_LEVEL = env.IMA2_LOG_LEVEL || "debug";
  }
  if (forServer) {
    env.IMA2_DESKTOP = "1";
    env.IMA2_BOOT_ID = randomUUID();
    // The port was just proven free; a server that races in must not push ours to another port.
    env.IMA2_STRICT_PORT = "1";
  }
  return env;
}
