import { existsSync } from "node:fs";
import { listProviders } from "../../lib/providers/registry.js";
import type { CoreProviderManifest, ProviderCredential } from "../../lib/providers/types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectCodexAuth } from "../../lib/codexDetect.js";
import { gptAuthStatus } from "../../lib/authStatus.js";
import { config as runtimeConfig } from "../../config.js";
import { normalizeComfyOrigin } from "../../lib/comfyBridge.js";
import type { DoctorCheckLine } from "./doctor-checks.js";

export type ProviderDoctorLine = DoctorCheckLine & { lane: string };

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function configString(fileConfig: Record<string, unknown>, key?: string): string | undefined {
  if (!key) return undefined;
  const value = fileConfig[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inspectApiKey(lane: string, credential: Extract<ProviderCredential, { kind: "api-key" }>, fileConfig: Record<string, unknown>): ProviderDoctorLine {
  const value = firstEnv(credential.envVars) || configString(fileConfig, credential.configKey);
  if (!value) {
    return { code: "CREDENTIAL_MISSING", lane, kind: "warn", text: `${lane}: api-key unset` };
  }
  if (credential.keyPrefix && !value.startsWith(credential.keyPrefix)) {
    return { code: "CREDENTIAL_SHAPE_INVALID", lane, kind: "fail", text: `${lane}: api-key prefix mismatch (expected ${credential.keyPrefix})` };
  }
  if (!credential.keyPrefix) {
    // Several lanes (minimax region-specific, nai persistent tokens) have no
    // stable prefix, so the message must stay vocabulary-neutral.
    return { code: "CREDENTIAL_PRESENT", lane, kind: "pass", text: `${lane}: api-key present (no prefix check; this lane has no fixed key prefix)` };
  }
  return { code: "CREDENTIAL_PRESENT", lane, kind: "pass", text: `${lane}: api-key present` };
}

function inspectOauth(lane: string): ProviderDoctorLine {
  if (lane === "oauth") {
    const status = gptAuthStatus();
    if (status.health === "healthy") {
      return { code: "OAUTH_FILE_READY", lane, kind: "pass", text: `${lane}: ChatGPT session ready (${status.source})` };
    }
    if (status.health === "warning") {
      return { code: "OAUTH_FILE_READY", lane, kind: "warn", text: `${lane}: ChatGPT session shared with the Codex CLI; run ima2 login for an ima2-owned session` };
    }
    const keyringOnly = !status.loggedIn && status.reason === "no_session" && detectCodexAuth().probe === "authed";
    return {
      code: "OAUTH_FILE_REQUIRED",
      lane,
      kind: "fail",
      text: keyringOnly
        ? `${lane}: Codex is keyring-only; run ima2 login`
        : status.reason === "no_refresh_token"
          ? `${lane}: ChatGPT session has no refresh token; run ima2 login`
          : `${lane}: no ChatGPT session; run ima2 login`,
    };
  }
  if (lane === "grok") {
    const home = homedir();
    // First path is the ima2 session (lib/xaiAuth.ts grokAuthFilePath; spelled out here so
    // the doctor bundle stays free of node:crypto). ~/.grok/auth.json is the xAI CLI file
    // that routes/quota.ts still reads; different schema, never a lib/xaiAuth.ts source.
    const files = [join(home, ".progrok", "auth.json"), join(home, ".grok", "auth.json")];
    if (files.some((path) => existsSync(path))) {
      return { code: "CREDENTIAL_PRESENT", lane, kind: "pass", text: `${lane}: local Grok auth file present` };
    }
    return { code: "CREDENTIAL_MISSING", lane, kind: "warn", text: `${lane}: no ~/.progrok or ~/.grok auth file` };
  }
  return { code: "DIAGNOSTIC_UNKNOWN", lane, kind: "warn", text: `${lane}: oauth-proxy has no lane-specific checker` };
}

function inspectServiceAccount(lane: string, credential: Extract<ProviderCredential, { kind: "service-account" }>, fileConfig: Record<string, unknown>): ProviderDoctorLine {
  const raw = firstEnv(credential.envVars) || configString(fileConfig, credential.configKey);
  if (!raw) return { code: "CREDENTIAL_MISSING", lane, kind: "warn", text: `${lane}: service-account unset` };
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; project_id?: unknown };
    if (parsed.type !== "service_account" || typeof parsed.project_id !== "string" || !parsed.project_id) {
      return { code: "CREDENTIAL_SHAPE_INVALID", lane, kind: "fail", text: `${lane}: service-account JSON missing type/project_id` };
    }
    return { code: "CREDENTIAL_PRESENT", lane, kind: "pass", text: `${lane}: service-account JSON present` };
  } catch {
    return { code: "CREDENTIAL_SHAPE_INVALID", lane, kind: "fail", text: `${lane}: service-account is not JSON` };
  }
}

function inspectLocalCli(lane: string, credential: Extract<ProviderCredential, { kind: "local-cli" }>): ProviderDoctorLine {
  const override = firstEnv(credential.envVars);
  if (override) {
    return existsSync(override)
      ? { code: "LOCAL_CLI_FOUND", lane, kind: "pass", text: `${lane}: local CLI override found` }
      : { code: "LOCAL_CLI_MISSING", lane, kind: "fail", text: `${lane}: local CLI override missing` };
  }
  return { code: "LOCAL_CLI_MISSING", lane, kind: "warn", text: `${lane}: local CLI env unset` };
}

/**
 * A local-http lane has no binary and no key: its env var holds a URL, so the
 * local-cli fallthrough would existsSync() an origin and report a missing file
 * for a perfectly good address.
 *
 * Synchronous like its siblings — doctor lines are built in one pass — so this
 * reports CONFIGURATION, never liveness. It opens no socket; reachability
 * belongs to the settings surface, which probes /system_stats.
 */
function inspectLocalHttp(lane: string, credential: Extract<ProviderCredential, { kind: "local-http" }>): ProviderDoctorLine {
  const raw = firstEnv(credential.envVars) ?? runtimeConfig.comfy.defaultUrl;
  try {
    const origin = normalizeComfyOrigin(raw);
    return { code: "LOCAL_ORIGIN_VALID", lane, kind: "pass", text: `${lane}: origin ${origin}` };
  } catch {
    return { code: "LOCAL_ORIGIN_INVALID", lane, kind: "fail", text: `${lane}: invalid configured origin` };
  }
}

export function inspectProviderLane(provider: CoreProviderManifest, fileConfig: Record<string, unknown>): ProviderDoctorLine[] {
  return provider.credentials.map((credential) => {
    if (credential.kind === "api-key") return inspectApiKey(provider.id, credential, fileConfig);
    // "oauth" (grok, first-party session) and "oauth-proxy" (a separate local
    // process holds the session) both land on the same per-lane file checks.
    if (credential.kind === "oauth-proxy" || credential.kind === "oauth") return inspectOauth(provider.id);
    if (credential.kind === "service-account") return inspectServiceAccount(provider.id, credential, fileConfig);
    if (credential.kind === "local-http") return inspectLocalHttp(provider.id, credential);
    return inspectLocalCli(provider.id, credential);
  });
}

export function buildProviderDoctorLines(fileConfig: Record<string, unknown>): ProviderDoctorLine[] {
  return listProviders().flatMap((provider) => inspectProviderLane(provider, fileConfig));
}

export function resolveValidateUrl(credential: Extract<ProviderCredential, { kind: "api-key" }>): string | undefined {
  if (credential.keyVocabulary === "minimax") {
    const cfg = runtimeConfig.minimaxProvider;
    const base = cfg.region === "cn_zh" ? cfg.cnBaseUrl : cfg.globalBaseUrl;
    return `${String(base).replace(/\/$/, "")}/models`;
  }
  return credential.validateUrl;
}

export function listedValidateUrls(): string[] {
  return listProviders().flatMap((provider) => provider.credentials.flatMap((credential) => {
    if (credential.kind !== "api-key") return [];
    const url = resolveValidateUrl(credential);
    return url ? [url] : [];
  }));
}

export async function verifyConfiguredKeys(
  fileConfig: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number } = {},
): Promise<ProviderDoctorLine[]> {
  const lines: ProviderDoctorLine[] = [];
  for (const provider of listProviders()) {
    for (const credential of provider.credentials) {
      if (credential.kind !== "api-key") continue;
      const url = resolveValidateUrl(credential);
      if (!url) continue;
      const value = firstEnv(credential.envVars) || configString(fileConfig, credential.configKey);
      if (!value) continue;
      const headers: Record<string, string> = credential.keyVocabulary === "gemini"
        ? { "x-goog-api-key": value } : { Authorization: `Bearer ${value}` };
      const code = await verifyKey(url, headers, fetchImpl, options.timeoutMs ?? runtimeConfig.diagnostics.keyTimeoutMs);
      lines.push({ lane: provider.id, code, kind: code === "AUTH_VERIFIED" ? "pass" : "fail", evidence: "remote-auth", text: `${provider.id}: ${code}` });
    }
  }
  return lines;
}

async function verifyKey(url: string, headers: Record<string, string>, fetchImpl: typeof fetch, requestedTimeout: number): Promise<string> {
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 30000) : 5000;
  const controller = new AbortController(); let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error("AUTH_TIMEOUT")); }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: "error" });
      const code = response.ok ? "AUTH_VERIFIED" : response.status === 401 || response.status === 403 ? "AUTH_INVALID"
        : response.status === 429 ? "AUTH_RATE_LIMITED" : "AUTH_UPSTREAM_FAILED";
      await response.body?.cancel();
      return code;
    })();
    return await Promise.race([request, deadline]);
  } catch { return controller.signal.aborted ? "AUTH_TIMEOUT" : "AUTH_NETWORK_FAILED"; }
  finally { clearTimeout(timer); controller.abort(); }
}
