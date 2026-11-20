import { readChatgptAccess } from "../chatgptAuth.js";
import { authHeaders, codexSessionStore } from "../codexBackend/client.js";
import type { CodexSession } from "../codexBackend/session.js";
import type { QuotaResult } from "./types.js";
import { projectCodexUsage } from "./codexProjection.js";
import { resetIdentity } from "../reset/identity.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_SESSION_TIMEOUT_MS = 8_000;

type CodexSessionRead = { session: CodexSession } | "none" | "error";

/** A hung token endpoint must not stall the whole quota response. */
export function withSessionTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("codex session read timed out")), CODEX_SESSION_TIMEOUT_MS).unref();
    }),
  ]);
}

/** Same session the GPT OAuth lane uses: the file is re-read and a near-expired token refreshes. */
export async function readCodexSession(): Promise<CodexSessionRead> {
  try {
    return { session: await withSessionTimeout(codexSessionStore().get()) };
  } catch {
    // A session file exists but the store could not serve it (a refresh or read
    // failure): that is a quota error, not a logged-out account.
    return readChatgptAccess() ? "error" : "none";
  }
}

function codexUsageRequest(session: CodexSession): Promise<Response> {
  return fetch(CODEX_USAGE_URL, {
    headers: authHeaders(session),
    signal: AbortSignal.timeout(8000),
  });
}

export async function fetchCodexUsage(session: CodexSession): Promise<QuotaResult> {
  try {
    let resp = await codexUsageRequest(session);
    if (resp.status === 401) {
      // The one-shot recovery codexUpstream uses: an invalidated token refreshes once and retries.
      try {
        const fresh = await withSessionTimeout(codexSessionStore().refresh(session.accessToken));
        if (fresh.accessToken !== session.accessToken) {
          await resp.body?.cancel().catch(() => undefined);
          resp = await codexUsageRequest(fresh);
          session = fresh;
        }
      } catch { /* the first response stands */ }
    }
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return { provider: "codex", authenticated: false, windows: [] };
      return { provider: "codex", error: true, windows: [] };
    }
    if (!session.accountId) return { provider: "codex", error: true, windows: [] };
    return { ...projectCodexUsage(await resp.json(), session.accountId), accountRef: resetIdentity("codex", session.accountId).accountRef };
  } catch {
    return { provider: "codex", error: true, windows: [] };
  }
}
