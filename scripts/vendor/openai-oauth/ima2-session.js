// ima2 patch (2.0.0-ima2.1): the session file is the source of truth.
//
// Codex CLI or a new `ima2 login` can rotate or replace auth.json at any time, and ChatGPT
// refresh tokens rotate on use. Upstream 2.0.0 reads the file per request but never retries
// an upstream 401, refreshes on a timer from every concurrent request, and writes the file
// in place. This module keeps the 1.0.2-ima2.2 contract on top of 2.0.0:
//   - every request re-reads the session file;
//   - a near-expiry token and an upstream 401 share ONE serialized refresh;
//   - compare-before-write: a login that replaced the file during a refresh wins;
//   - atomic write-back that keeps unknown keys and mode 0600.
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  deriveAccountId,
  deriveChatGptAccountIsFedRamp,
  parseJwtClaims,
  refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
import { resolveAuthFileCandidates, resolveCodexAuthFilePath } from "@openai-oauth/local/auth-file";

const EXPIRY_SKEW_MS = 60_000;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const readSessionFile = async (candidates) => {
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, "utf-8"));
      if (!isRecord(parsed)) throw new Error(`Auth file at ${candidate} must contain a JSON object.`);
      return { path: candidate, data: parsed };
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") continue;
      if (error instanceof SyntaxError) throw new Error(`Auth file at ${candidate} is not valid JSON.`, { cause: error });
      throw error;
    }
  }
  return { path: undefined, data: {} };
};

const tokensOf = (data) => (isRecord(data?.tokens) ? data.tokens : {});

const toSession = (data, sourcePath) => {
  const tokens = tokensOf(data);
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : undefined;
  const idToken = typeof tokens.id_token === "string" ? tokens.id_token : undefined;
  if (!accessToken) throw new Error("ChatGPT access token not found. Run `npx openai-oauth login` to sign in.");
  const accountId = (typeof tokens.account_id === "string" && tokens.account_id)
    || deriveAccountId(idToken)
    || deriveAccountId(accessToken);
  if (!accountId) throw new Error("ChatGPT account id not found in auth.json. Run `npx openai-oauth login` to sign in again.");
  return {
    accessToken,
    accountId,
    isFedRamp: deriveChatGptAccountIsFedRamp(idToken) || deriveChatGptAccountIsFedRamp(accessToken),
    idToken,
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined,
    lastRefresh: typeof data.last_refresh === "string" ? data.last_refresh : undefined,
    sourcePath,
  };
};

const expiresSoon = (accessToken) => {
  try {
    const exp = parseJwtClaims(accessToken)?.exp;
    return typeof exp === "number" && exp * 1000 - Date.now() < EXPIRY_SKEW_MS;
  } catch {
    return false;
  }
};

const writeAtomic = async (filePath, data) => {
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(temporary, filePath);
  try { await fs.chmod(filePath, 0o600); } catch { /* filesystems without POSIX modes */ }
};

export const createIma2Session = (settings = {}) => {
  const candidates = resolveAuthFileCandidates(settings.authFilePath);
  const writePath = resolveCodexAuthFilePath(settings.authFilePath);
  const rawFetch = typeof settings.fetch === "function" ? settings.fetch : globalThis.fetch.bind(globalThis);
  let inflight = null;

  const refresh = (failedToken) => {
    if (inflight) return inflight;
    inflight = (async () => {
      const before = await readSessionFile(candidates);
      const current = tokensOf(before.data).access_token;
      // Another writer already rotated the token: use theirs instead of spending ours.
      if (current && current !== failedToken) return toSession(before.data, before.path);
      const refreshToken = tokensOf(before.data).refresh_token;
      if (typeof refreshToken !== "string" || !refreshToken) {
        throw new Error("ChatGPT refresh token not found. Run `npx openai-oauth login` to sign in again.");
      }
      const refreshed = await refreshOpenAIOAuthTokens({
        refreshToken,
        clientId: settings.clientId,
        issuer: settings.issuer,
        tokenUrl: settings.tokenUrl,
        fetch: rawFetch,
      });
      const after = await readSessionFile(candidates);
      // A login replaced the file while we were refreshing: it wins, the stale refresh is dropped.
      if (tokensOf(after.data).access_token !== current) return toSession(after.data, after.path);
      const next = {
        ...after.data,
        auth_mode: "chatgpt",
        tokens: {
          ...tokensOf(after.data),
          access_token: refreshed.accessToken,
          id_token: refreshed.idToken ?? tokensOf(after.data).id_token,
          refresh_token: refreshed.refreshToken ?? refreshToken,
          account_id: refreshed.accountId ?? tokensOf(after.data).account_id,
        },
        last_refresh: new Date().toISOString(),
      };
      const target = after.path ?? writePath;
      await writeAtomic(target, next);
      return toSession(next, target);
    })().finally(() => { inflight = null; });
    return inflight;
  };

  const getSession = async () => {
    if (inflight) return inflight;
    const { data, path } = await readSessionFile(candidates);
    const session = toSession(data, path);
    return session.refreshToken && expiresSoon(session.accessToken) ? refresh(session.accessToken) : session;
  };

  // Retry an upstream 401 once with the refreshed token when the body can be replayed.
  const wrapFetch = (base) => async (input, init = {}) => {
    const response = await base(input, init);
    if (response.status !== 401) return response;
    const body = init.body;
    if (body != null && typeof body !== "string") return response;
    const headers = new Headers(init.headers);
    const failed = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    let fresh;
    try {
      fresh = await refresh(failed);
    } catch {
      return response;
    }
    if (!fresh?.accessToken || fresh.accessToken === failed) return response;
    headers.set("Authorization", `Bearer ${fresh.accessToken}`);
    headers.set("chatgpt-account-id", fresh.accountId);
    return base(input, { ...init, headers });
  };

  return { getSession, fetch: wrapFetch(rawFetch) };
};
