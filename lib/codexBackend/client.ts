/**
 * Transport to chatgpt.com/backend-api/codex: client version, model catalog, auth headers
 * and the one-shot 401 recovery. Everything the bundled openai-oauth proxy used to do for
 * ima2, in process.
 */
import { config } from "../../config.js";
import { createCodexSessionStore, type CodexSession, type CodexSessionStore } from "./session.js";

const CODEX_REGISTRY_URL = "https://registry.npmjs.org/@openai/codex/latest";
/** Lowest Codex client version measured to list the GPT-6 models (2026-09-25). */
export const CODEX_CLIENT_VERSION_FLOOR = "0.157.0";
const VERSION_TTL_MS = 60 * 60 * 1000;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const CATALOG_FAILURE_TTL_MS = 30 * 1000;

export interface CatalogModel {
  slug: string;
  lite: boolean;
}

let versionCache: { value: string; expiresAt: number } | null = null;
let versionInflight: Promise<string> | null = null;
const catalogCache = new Map<string, { expiresAt: number; models: CatalogModel[] }>();
let store: CodexSessionStore | null = null;

export function codexSessionStore(): CodexSessionStore {
  store ??= createCodexSessionStore();
  return store;
}

/** Test seam: swap the session store (e.g. a temp config dir and a fake refresher). */
export function setCodexSessionStoreForTests(next: CodexSessionStore | null): void {
  store = next;
  catalogCache.clear();
  versionCache = null;
}

/** Forget cached catalogs so a new login's account roster is read on the next call. */
export function resetCodexCaches(): void {
  catalogCache.clear();
}

export function codexBaseUrl(): string {
  return config.oauth.codexBaseUrl.replace(/\/+$/, "");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export async function codexClientVersion(): Promise<string> {
  if (config.oauth.codexClientVersion) return config.oauth.codexClientVersion;
  if (versionCache && versionCache.expiresAt > Date.now()) return versionCache.value;
  versionInflight ??= (async () => {
    try {
      const res = await fetch(CODEX_REGISTRY_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      const version = res.ok ? String(((await res.json()) as { version?: unknown }).version ?? "") : "";
      const value = /^\d+\.\d+\.\d+/.test(version) && compareVersions(version, CODEX_CLIENT_VERSION_FLOOR) >= 0
        ? version.match(/^\d+\.\d+\.\d+/)?.[0] ?? CODEX_CLIENT_VERSION_FLOOR
        : CODEX_CLIENT_VERSION_FLOOR;
      versionCache = { value, expiresAt: Date.now() + VERSION_TTL_MS };
      return value;
    } catch {
      return CODEX_CLIENT_VERSION_FLOOR;
    } finally {
      versionInflight = null;
    }
  })();
  return versionInflight;
}

export function authHeaders(session: CodexSession, extra?: RequestInit["headers"]): Headers {
  const headers = new Headers(extra);
  headers.delete("authorization");
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  headers.set("chatgpt-account-id", session.accountId);
  if (session.isFedRamp) headers.set("X-OpenAI-Fedramp", "true");
  return headers;
}

/**
 * Authenticated upstream fetch. An upstream 401 triggers one shared refresh and one retry,
 * as long as the body can be replayed (strings only).
 */
export async function codexUpstream(path: string, init: RequestInit = {}): Promise<Response> {
  const sessions = codexSessionStore();
  const session = await sessions.get();
  const url = `${codexBaseUrl()}${path}`;
  const res = await fetch(url, { ...init, headers: authHeaders(session, init.headers) });
  if (res.status !== 401 || (init.body != null && typeof init.body !== "string")) return res;
  let fresh: CodexSession;
  try {
    fresh = await sessions.refresh(session.accessToken);
  } catch {
    return res;
  }
  if (fresh.accessToken === session.accessToken) return res;
  await res.body?.cancel().catch(() => undefined);
  return fetch(url, { ...init, headers: authHeaders(fresh, init.headers) });
}

/** The account's model roster at the current client version, cached per account. */
export async function codexCatalog(): Promise<CatalogModel[]> {
  const session = await codexSessionStore().get();
  const cached = catalogCache.get(session.accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  try {
    const version = await codexClientVersion();
    const res = await codexUpstream(`/models?client_version=${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const body = (await res.json()) as { models?: Array<{ slug?: unknown; use_responses_lite?: unknown; visibility?: unknown }> };
    const models = (body.models ?? [])
      .filter((row) => typeof row.slug === "string" && row.visibility !== "hide")
      .map((row) => ({ slug: row.slug as string, lite: row.use_responses_lite === true }));
    catalogCache.set(session.accountId, { expiresAt: Date.now() + CATALOG_TTL_MS, models });
    return models;
  } catch {
    catalogCache.set(session.accountId, { expiresAt: Date.now() + CATALOG_FAILURE_TTL_MS, models: cached?.models ?? [] });
    return cached?.models ?? [];
  }
}

/** GPT-6 and GPT-5.6 are lite on the Codex backend; an unknown catalog falls back to the family rule. */
export async function isLiteModel(model: unknown): Promise<boolean> {
  if (typeof model !== "string") return false;
  const entry = (await codexCatalog()).find((row) => row.slug === model);
  return entry ? entry.lite : /^gpt-(6|5\.6)(-|$)/.test(model);
}
