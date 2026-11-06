// OpenAI asks API callers to send a stable, privacy-preserving end-user id as
// `safety_identifier` (it replaced the deprecated `user` field). ima2 is a
// single-user local app, so the "user" is this install: a random id stored next
// to config.json, hashed before it leaves the machine.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logEvent } from "./logger.js";

const INSTALL_ID_FILE = "install-id";
const cache = new Map<string, string | null>();

function readOrCreateInstallId(configDir: string): string {
  const file = join(configDir, INSTALL_ID_FILE);
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f-]{16,64}$/i.test(existing)) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  const created = randomUUID();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(file, `${created}\n`, { mode: 0o600 });
  return created;
}

/** 64 hex chars (OpenAI allows up to 128); null when disabled or the id cannot be stored. */
export function apiSafetyIdentifier(config: { storage?: { configDir?: string }; apiProvider?: { safetyIdentifier?: boolean } } | undefined): string | null {
  if (config?.apiProvider?.safetyIdentifier === false) return null;
  const configDir = config?.storage?.configDir;
  if (!configDir) return null;
  const cached = cache.get(configDir);
  if (cached !== undefined) return cached;
  let value: string | null;
  try {
    value = createHash("sha256").update(`ima2-gen:${readOrCreateInstallId(configDir)}`).digest("hex");
  } catch (error) {
    logEvent("api", "safety_identifier_unavailable", { errorCode: (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN" });
    value = null;
  }
  cache.set(configDir, value);
  return value;
}

/** Spread into an OpenAI API request body; empty for OAuth and when disabled. */
export function apiSafetyFields(provider: string | undefined, config: Parameters<typeof apiSafetyIdentifier>[0]) {
  if (provider !== "api") return {};
  const id = apiSafetyIdentifier(config);
  return id ? { safety_identifier: id } : {};
}
