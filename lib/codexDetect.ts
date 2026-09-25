// Codex CLI / OAuth auth detection across platforms.
// References:
// - OpenAI Codex stores auth under CODEX_HOME (default ~/.codex/auth.json).
// - Legacy chatgpt-local stores auth under ~/.chatgpt-local/auth.json.
// - Auth may live in OS keyring instead of a file (file absence ≠ unauth).
// - ima2's GPT OAuth client (lib/codexBackend) can only consume a file-backed Codex session.
import { existsSync } from "node:fs";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { errInfo } from "./errInfo.js";
import { resolvePackageBin } from "./packageCli.js";
import { chatgptAuthFilePath, resolveChatgptSessionFile } from "./chatgptAuth.js";
const HOME = homedir();

type CodexProbeOptions = {
  platform?: NodeJS.Platform;
  execPath?: string;
  resolveCodexBin?: () => string;
  execFileSyncImpl?: ExecFileSyncLike;
};

type ExecFileSyncLike = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptions,
) => unknown;

export const CODEX_FILE_AUTH_CONFIG = 'cli_auth_credentials_store="file"';

export function codexFileLoginArgs(options: { deviceAuth?: boolean } = {}) {
  return [
    "login",
    ...(options.deviceAuth ? ["--device-auth"] : []),
    "-c",
    CODEX_FILE_AUTH_CONFIG,
  ];
}

export function codexAuthPaths() {
  const codexHome = process.env.CODEX_HOME || join(HOME, ".codex");
  return {
    ima2: chatgptAuthFilePath(),
    codex: join(codexHome, "auth.json"),
    chatgpt: join(HOME, ".chatgpt-local", "auth.json"),
    xdgCodex: join(HOME, ".config", "codex", "auth.json"),
  };
}

export function hasAuthFile() {
  const p = codexAuthPaths();
  return existsSync(p.ima2) || existsSync(p.codex) || existsSync(p.chatgpt) || existsSync(p.xdgCodex);
}

function commandErrorText(error: unknown) {
  if (!error || typeof error !== "object") return String(error || "");
  const value = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  return [value.message, value.stdout, value.stderr]
    .map((part) => Buffer.isBuffer(part) ? part.toString("utf8") : typeof part === "string" ? part : "")
    .filter(Boolean)
    .join("\n");
}

// Non-invasive probe: `codex login status` returns 0 when authed (file OR keyring).
// "error" means the wrapper was found but failed before reporting auth state.
function probeCodex(
  command: string,
  args: string[],
  timeoutMs: number,
  execFileSyncImpl: ExecFileSyncLike,
  shell = false,
) {
  try {
    execFileSyncImpl(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
      shell,
    });
    return "authed" as const;
  } catch (e) {
    const err = errInfo(e);
    if (err.code === "ENOENT") return "missing" as const;
    if (typeof err.status === "number" && /not logged in/i.test(commandErrorText(e))) {
      return "unauthed" as const;
    }
    return "error" as const;
  }
}

export function codexLoginStatus(timeoutMs = 2000, options: CodexProbeOptions = {}) {
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync as ExecFileSyncLike;
  let sawError = false;
  try {
    const codexBin = (options.resolveCodexBin || (() => resolvePackageBin("@openai/codex", "codex")))();
    const bundled = probeCodex(
      execPath,
      [codexBin, "login", "status"],
      timeoutMs,
      execFileSyncImpl,
      false,
    );
    if (bundled === "authed" || bundled === "unauthed") return bundled;
    sawError ||= bundled === "error";
  } catch {
    // Fall through to a user-managed Codex CLI when the package dependency is unavailable.
  }

  const candidates =
    platform === "win32"
      ? ["codex.cmd", "codex.exe", "codex"]
      : ["codex"];
  for (const bin of candidates) {
    const result = probeCodex(
      bin,
      ["login", "status"],
      timeoutMs,
      execFileSyncImpl,
      platform === "win32" && bin.endsWith(".cmd"),
    );
    if (result === "authed" || result === "unauthed") return result;
    sawError ||= result === "error";
  }
  return sawError ? "error" : "missing";
}

/**
 * Which file the GPT OAuth proxy will read. ima2's own store (lib/chatgptAuth.ts, written by
 * `ima2 login`) wins over Codex CLI files so the two never rotate one refresh token.
 * The `codex login status` probe only runs when no file exists (keyring-only detection),
 * because it spawns the Codex CLI synchronously.
 */
export function detectCodexAuth(options: { probe?: boolean } = {}) {
  const files = codexAuthPaths();
  const fileHits = {
    ima2: existsSync(files.ima2),
    codex: existsSync(files.codex),
    chatgpt: existsSync(files.chatgpt),
    xdgCodex: existsSync(files.xdgCodex),
  };
  // Same validated choice as status and quota (lib/chatgptAuth.ts): a malformed or
  // token-less file must not win just because it exists.
  const proxyAuthFile = resolveChatgptSessionFile()?.path ?? null;
  const shouldProbe = options.probe ?? proxyAuthFile === null;
  const probe = shouldProbe ? codexLoginStatus() : "skipped" as const;
  const authed = probe === "authed" || proxyAuthFile !== null;
  return {
    authed,
    proxyReady: proxyAuthFile !== null,
    proxyAuthFile,
    probe,
    files,
    fileHits,
    platform: process.platform,
  };
}
