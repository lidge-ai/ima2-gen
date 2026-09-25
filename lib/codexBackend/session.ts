/**
 * ChatGPT session for direct calls to the Codex backend (chatgpt.com/backend-api/codex).
 *
 * The session file is the source of truth: `ima2 gpt login`, the web login, or Codex CLI can
 * rotate or replace it at any time, and ChatGPT refresh tokens rotate on use. So:
 *   - every request re-reads the file;
 *   - a near-expiry token and an upstream 401 share ONE serialized refresh;
 *   - compare-before-write: a login that replaced the file during a refresh wins;
 *   - the write-back is atomic, keeps unknown keys, and stays mode 0600.
 * This is the contract the bundled openai-oauth proxy carried as the ima2 patch.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  CHATGPT_OAUTH_CLIENT_ID,
  CHATGPT_TOKEN_URL,
  chatgptSessionCandidates,
  decodeJwtPayload,
  extractChatgptAccountId,
  jwtExpiryMs,
} from "../chatgptAuth.js";

const EXPIRY_SKEW_MS = 60_000;

export interface CodexSession {
  accessToken: string;
  accountId: string;
  isFedRamp: boolean;
  refreshToken: string | undefined;
  path: string;
}

type SessionFile = { path: string; data: Record<string, unknown> };
type Tokens = Record<string, unknown>;

export class CodexSessionError extends Error {
  code = "OAUTH_SESSION_REQUIRED";
  status = 401;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
const tokensOf = (data: Record<string, unknown> | undefined): Tokens => (isRecord(data?.tokens) ? data.tokens : {});

function isFedRamp(token: string | undefined): boolean {
  const auth = decodeJwtPayload(token)?.["https://api.openai.com/auth"];
  return isRecord(auth) && auth.chatgpt_account_is_fedramp === true;
}

async function readSessionFile(configDir?: string): Promise<SessionFile | null> {
  for (const candidate of chatgptSessionCandidates(configDir)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(candidate.path, "utf8"));
      if (isRecord(parsed) && str(tokensOf(parsed).access_token)) return { path: candidate.path, data: parsed };
    } catch {
      // Missing or unreadable candidates are skipped, as resolveChatgptSessionFile does.
    }
  }
  return null;
}

function toSession(file: SessionFile): CodexSession {
  const tokens = tokensOf(file.data);
  const accessToken = str(tokens.access_token) as string;
  const idToken = str(tokens.id_token);
  const accountId = str(tokens.account_id) ?? extractChatgptAccountId(idToken, accessToken);
  if (!accountId) throw new CodexSessionError("ChatGPT account id not found in the session file. Run `ima2 gpt login`.");
  return {
    accessToken,
    accountId,
    isFedRamp: isFedRamp(idToken) || isFedRamp(accessToken),
    refreshToken: str(tokens.refresh_token),
    path: file.path,
  };
}

async function writeAtomic(target: string, data: unknown): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, target);
  await chmod(target, 0o600).catch(() => undefined);
}

export interface TokenRefreshResult {
  access_token?: unknown;
  id_token?: unknown;
  refresh_token?: unknown;
}

export type TokenRefresher = (refreshToken: string) => Promise<TokenRefreshResult>;

export const refreshChatgptTokens: TokenRefresher = async (refreshToken) => {
  const res = await fetch(CHATGPT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CHATGPT_OAUTH_CLIENT_ID }),
  });
  if (!res.ok) throw new CodexSessionError(`ChatGPT token refresh failed with HTTP ${res.status}. Run \`ima2 gpt login\`.`);
  const body: unknown = await res.json();
  if (!isRecord(body) || !str(body.access_token)) throw new CodexSessionError("ChatGPT token refresh returned no access token.");
  return body;
};

export interface CodexSessionStore {
  get(): Promise<CodexSession>;
  refresh(failedToken: string): Promise<CodexSession>;
}

export function createCodexSessionStore(options: { configDir?: string; refresher?: TokenRefresher } = {}): CodexSessionStore {
  const refresher = options.refresher ?? refreshChatgptTokens;
  let inflight: Promise<CodexSession> | null = null;

  const load = async () => {
    const file = await readSessionFile(options.configDir);
    if (!file) throw new CodexSessionError("No ChatGPT session. Run `ima2 gpt login`.");
    return file;
  };

  const doRefresh = async (failedToken: string): Promise<CodexSession> => {
    const before = await load();
    const current = str(tokensOf(before.data).access_token);
    // Another writer already rotated the token: use theirs instead of spending ours.
    if (current && current !== failedToken) return toSession(before);
    const refreshToken = str(tokensOf(before.data).refresh_token);
    if (!refreshToken) throw new CodexSessionError("The ChatGPT session cannot be refreshed. Run `ima2 gpt login`.");
    const refreshed = await refresher(refreshToken);
    const after = await load();
    // A login replaced the file while we refreshed: it wins, and the stale refresh is dropped.
    if (str(tokensOf(after.data).access_token) !== current) return toSession(after);
    const tokens = tokensOf(after.data);
    const idToken = str(refreshed.id_token) ?? str(tokens.id_token);
    const accessToken = str(refreshed.access_token) as string;
    const next = {
      ...after.data,
      auth_mode: "chatgpt",
      tokens: {
        ...tokens,
        access_token: accessToken,
        ...(idToken ? { id_token: idToken } : {}),
        refresh_token: str(refreshed.refresh_token) ?? refreshToken,
        account_id: str(tokens.account_id) ?? extractChatgptAccountId(idToken, accessToken),
      },
      last_refresh: new Date().toISOString(),
    };
    await writeAtomic(after.path, next);
    return toSession({ path: after.path, data: next });
  };

  const refresh = (failedToken: string) => {
    inflight ??= doRefresh(failedToken).finally(() => { inflight = null; });
    return inflight;
  };

  const get = async () => {
    if (inflight) return inflight;
    const session = toSession(await load());
    const expiresAt = jwtExpiryMs(session.accessToken);
    const expiring = expiresAt !== undefined && expiresAt - Date.now() < EXPIRY_SKEW_MS;
    return session.refreshToken && expiring ? refresh(session.accessToken) : session;
  };

  return { get, refresh };
}

