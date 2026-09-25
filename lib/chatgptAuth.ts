/**
 * ChatGPT (GPT OAuth) credential store owned by ima2.
 *
 * Ported from OpenCodex `src/oauth/chatgpt.ts` (constants, JWT identity helpers) and its
 * store discipline (atomic 0600 writes, 0700 directory). ima2 keeps its own session file so
 * ima2's GPT OAuth client and the Codex CLI never rotate the same refresh token: a shared
 * ~/.codex/auth.json made whichever process refreshed second lose the session
 * (refresh_token_reused), which surfaced as "logged in, but GPT OAuth still says log in".
 *
 * The file keeps the Codex auth.json shape (`tokens.{id_token,access_token,refresh_token,
 * account_id}` + `last_refresh`) because lib/codexBackend/session.ts reads it on every request
 * and writes refreshed tokens back into it.
 *
 * MUST stay a leaf module: only node:fs, node:crypto, node:os, node:path.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CHATGPT_OAUTH_ISSUER = "https://auth.openai.com";
export const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_OAUTH_ISSUER}/oauth/authorize`;
export const CHATGPT_TOKEN_URL = `${CHATGPT_OAUTH_ISSUER}/oauth/token`;
export const CHATGPT_OAUTH_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";

const CHATGPT_AUTH_NAMESPACE = "https://api.openai.com/auth";
const AUTH_FILENAME = "chatgpt-auth.json";

export type ChatgptSessionSource = "ima2" | "codex" | "chatgpt-local" | "xdg-codex";

export interface ChatgptTokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}

/** On-disk shape (Codex auth.json compatible). Unknown keys survive a round-trip. */
export interface ChatgptAuthFile {
  tokens?: ChatgptTokens;
  last_refresh?: string;
  [key: string]: unknown;
}

export interface ChatgptSession {
  source: ChatgptSessionSource;
  path: string;
  accountId?: string;
  email?: string;
  plan?: string;
  /** epoch ms from the access token `exp`; undefined when the token carries no exp. */
  accessExpiresAt?: number;
  refreshable: boolean;
  lastRefresh?: string;
}

export function ima2ConfigDir(): string {
  return process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
}

export function chatgptAuthFilePath(configDir: string = ima2ConfigDir()): string {
  return join(configDir, AUTH_FILENAME);
}

/** Candidate session files in priority order: ima2's own store first, then Codex CLI files. */
export function chatgptSessionCandidates(configDir?: string): Array<{ source: ChatgptSessionSource; path: string }> {
  const home = homedir();
  const codexHome = process.env.CODEX_HOME || join(home, ".codex");
  return [
    { source: "ima2", path: chatgptAuthFilePath(configDir) },
    { source: "codex", path: join(codexHome, "auth.json") },
    { source: "chatgpt-local", path: join(home, ".chatgpt-local", "auth.json") },
    { source: "xdg-codex", path: join(home, ".config", "codex", "auth.json") },
  ];
}

// ---------------------------------------------------------------------------
// JWT identity (display/routing metadata only; signatures are never verified here)
// ---------------------------------------------------------------------------

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function authNamespace(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const ns = payload[CHATGPT_AUTH_NAMESPACE];
  return ns && typeof ns === "object" && !Array.isArray(ns) ? ns as Record<string, unknown> : undefined;
}

/** OpenCodex precedence: top-level claim, namespaced claim, then organizations[0].id. */
export function extractChatgptAccountId(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    const payload = decodeJwtPayload(token);
    if (!payload) continue;
    if (typeof payload.chatgpt_account_id === "string" && payload.chatgpt_account_id) return payload.chatgpt_account_id;
    const ns = authNamespace(payload);
    if (typeof ns?.chatgpt_account_id === "string" && ns.chatgpt_account_id) return ns.chatgpt_account_id;
    const orgs = payload.organizations;
    if (Array.isArray(orgs) && orgs[0] && typeof orgs[0].id === "string") return orgs[0].id as string;
  }
  return undefined;
}

export function extractChatgptEmail(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    const payload = decodeJwtPayload(token);
    if (typeof payload?.email === "string" && payload.email) return payload.email.toLowerCase();
    const profile = payload?.["https://api.openai.com/profile"];
    if (profile && typeof profile === "object" && typeof (profile as Record<string, unknown>).email === "string") {
      return ((profile as Record<string, unknown>).email as string).toLowerCase();
    }
  }
  return undefined;
}

export function extractChatgptPlan(idToken?: string, accessToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    const payload = decodeJwtPayload(token);
    if (!payload) continue;
    if (typeof payload.chatgpt_plan_type === "string" && payload.chatgpt_plan_type) return payload.chatgpt_plan_type;
    const ns = authNamespace(payload);
    if (typeof ns?.chatgpt_plan_type === "string" && ns.chatgpt_plan_type) return ns.chatgpt_plan_type;
  }
  return undefined;
}

export function jwtExpiryMs(token: string | undefined): number | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Never throws: a missing, unreadable, or malformed file is simply "no session". */
export function readChatgptAuthFile(path: string): ChatgptAuthFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as ChatgptAuthFile;
    const tokens = record.tokens;
    if (!tokens || typeof tokens !== "object" || !nonEmpty(tokens.access_token)) return null;
    return record;
  } catch {
    return null;
  }
}

function describeSession(source: ChatgptSessionSource, path: string, file: ChatgptAuthFile): ChatgptSession {
  const tokens = file.tokens ?? {};
  const accountId = nonEmpty(tokens.account_id) ?? extractChatgptAccountId(tokens.id_token, tokens.access_token);
  const email = extractChatgptEmail(tokens.id_token, tokens.access_token);
  const plan = extractChatgptPlan(tokens.id_token, tokens.access_token);
  const accessExpiresAt = jwtExpiryMs(tokens.access_token);
  const lastRefresh = nonEmpty(file.last_refresh);
  return {
    source,
    path,
    refreshable: Boolean(nonEmpty(tokens.refresh_token)),
    ...(accountId ? { accountId } : {}),
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
    ...(accessExpiresAt !== undefined ? { accessExpiresAt } : {}),
    ...(lastRefresh ? { lastRefresh } : {}),
  };
}

/** Path of the first candidate that holds a usable session (what the proxy must be given). */
export function resolveChatgptSessionFile(configDir?: string): { source: ChatgptSessionSource; path: string } | null {
  for (const candidate of chatgptSessionCandidates(configDir)) {
    if (readChatgptAuthFile(candidate.path)) return candidate;
  }
  return null;
}

/** The session the GPT OAuth proxy will use: the first readable candidate file. */
export function resolveChatgptSession(configDir?: string): ChatgptSession | null {
  for (const candidate of chatgptSessionCandidates(configDir)) {
    const file = readChatgptAuthFile(candidate.path);
    if (file) return describeSession(candidate.source, candidate.path, file);
  }
  return null;
}

/** Access token + account id for direct backend calls (quota). Reads the resolved file. */
export function readChatgptAccess(configDir?: string): { accessToken: string; accountId: string; source: ChatgptSessionSource } | null {
  for (const candidate of chatgptSessionCandidates(configDir)) {
    const file = readChatgptAuthFile(candidate.path);
    const accessToken = nonEmpty(file?.tokens?.access_token);
    if (!file || !accessToken) continue;
    const accountId = nonEmpty(file.tokens?.account_id)
      ?? extractChatgptAccountId(file.tokens?.id_token, accessToken)
      ?? "";
    return { accessToken, accountId, source: candidate.source };
  }
  return null;
}

/** Atomic 0600 write (tmp + rename); the directory is forced to 0700. */
function writeAtomic(target: string, data: unknown): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${AUTH_FILENAME}.tmp-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Persist a token endpoint response into ima2's store. Rejects a response that cannot drive
 * the proxy (no access token, no refresh token, or no account identity) instead of writing
 * a file the proxy would later refuse.
 */
export function saveChatgptTokenResponse(payload: Record<string, unknown>, configDir?: string): ChatgptSession {
  const accessToken = nonEmpty(payload.access_token);
  const refreshToken = nonEmpty(payload.refresh_token);
  const idToken = nonEmpty(payload.id_token);
  if (!accessToken) throw new Error("ChatGPT token response did not include an access token");
  if (!refreshToken) throw new Error("ChatGPT token response did not include a refresh token");
  const accountId = extractChatgptAccountId(idToken, accessToken);
  if (!accountId) throw new Error("ChatGPT token response did not identify a ChatGPT account");
  const target = chatgptAuthFilePath(configDir);
  const file: ChatgptAuthFile = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      ...(idToken ? { id_token: idToken } : {}),
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
    },
    last_refresh: new Date().toISOString(),
  };
  writeAtomic(target, file);
  return describeSession("ima2", target, file);
}

export function hasIma2ChatgptSession(configDir?: string): boolean {
  return existsSync(chatgptAuthFilePath(configDir));
}

/** Explicit logout of ima2's own store. Codex CLI files are never touched. */
export function clearChatgptCredentials(configDir?: string): boolean {
  const target = chatgptAuthFilePath(configDir);
  const existed = existsSync(target);
  rmSync(target, { force: true });
  return existed;
}
