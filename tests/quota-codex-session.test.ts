/**
 * /api/quota resolves ChatGPT usage through the same session store the GPT OAuth lane uses
 * (lib/codexBackend/session.ts): a near-expired token refreshes before the wham/usage call and
 * an upstream 401 gets one shared refresh plus one retry, instead of surfacing a refreshable
 * session as "not logged in" while /api/oauth/status shows it healthy.
 *
 * The express app listens on an ephemeral port; wham/usage and the token endpoint are stubbed.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerQuotaRoutes } from "../routes/quota.js";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";
import { chatgptAuthFilePath } from "../lib/chatgptAuth.js";
import { createCodexSessionStore } from "../lib/codexBackend/session.js";
import { setCodexSessionStoreForTests } from "../lib/codexBackend/client.js";

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

const AUTH_CLAIM = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } };
const FEDRAMP_CLAIM = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_account_is_fedramp: true } };
const EXPIRED = jwt({ exp: 1_000_000_000, name: "expired", ...AUTH_CLAIM });
const STALE = jwt({ exp: 2_000_000_000, name: "stale", ...AUTH_CLAIM });
const FRESH = jwt({ exp: 2_000_000_000, name: "fresh", ...AUTH_CLAIM });
const ID_TOKEN = jwt({ email: "a@b.c", ...AUTH_CLAIM });
const ID_TOKEN_FEDRAMP = jwt({ email: "a@b.c", ...FEDRAMP_CLAIM });

const USAGE_BODY = {
  email: "a@b.c",
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: 42, reset_at: 1_800_000_000 },
    secondary_window: { used_percent: 12, reset_at: 1_800_000_000 },
  },
};

let root: string;
let authFile: string;
let server: Server;
let base: string;
let realFetch: typeof fetch;
type SeenCall = { bearer: string; accountId: string | null; fedramp: string | null };
let seenCalls: SeenCall[];
let refreshCalls: number;
let tokenFails: boolean;
let tokenIdToken: string;
const savedEnv: Record<string, string | undefined> = {};

function writeSession(accessToken: string, refreshToken?: string, idToken: string = ID_TOKEN) {
  writeFileSync(authFile, JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      account_id: "acct-1",
      id_token: idToken,
    },
    last_refresh: new Date().toISOString(),
  }));
}

const bearers = () => seenCalls.map((call) => call.bearer);

type QuotaBody = {
  codex: {
    authenticated?: boolean;
    error?: boolean;
    account?: { email: string | null; plan: string | null } | null;
    windows: Array<{ label: string; percent: number }>;
  };
};

async function quota(): Promise<QuotaBody> {
  const res = await realFetch(`${base}/api/quota`);
  assert.equal(res.status, 200);
  return res.json() as Promise<QuotaBody>;
}

describe("/api/quota codex lane follows the session store", () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "ima2-quota-codex-"));
    authFile = chatgptAuthFilePath(root);
    for (const key of ["IMA2_CONFIG_DIR", "HOME", "USERPROFILE", "CODEX_HOME"]) savedEnv[key] = process.env[key];
    process.env.IMA2_CONFIG_DIR = root;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.CODEX_HOME = join(root, ".codex");
    seenCalls = [];
    refreshCalls = 0;
    tokenFails = false;
    tokenIdToken = ID_TOKEN;
    realFetch = globalThis.fetch;
    setCodexSessionStoreForTests(createCodexSessionStore({ configDir: root }));
    const app = express();
    registerQuotaRoutes(app, {} as RouteRuntimeContext);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      if (url.endsWith("/wham/usage")) {
        const headers = init?.headers as Headers | undefined;
        seenCalls.push({
          bearer: String(headers?.get?.("authorization") ?? ""),
          accountId: headers?.get?.("chatgpt-account-id") ?? null,
          fedramp: headers?.get?.("x-openai-fedramp") ?? null,
        });
        return seenCalls.at(-1)!.bearer === `Bearer ${FRESH}`
          ? Response.json(USAGE_BODY)
          : new Response("{}", { status: 401 });
      }
      if (url.endsWith("/oauth/token")) {
        refreshCalls++;
        return tokenFails
          ? new Response("{}", { status: 500 })
          : Response.json({ access_token: FRESH, refresh_token: "rt-new", id_token: tokenIdToken });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    setCodexSessionStoreForTests(null);
    await new Promise((r) => server.close(r));
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("an expired-but-refreshable token refreshes first, reports usage, and persists the rotation", async () => {
    writeSession(EXPIRED, "rt-old");
    const body = await quota();
    assert.equal(body.codex.authenticated, undefined);
    assert.equal(body.codex.windows.length, 2);
    assert.equal(body.codex.account?.email, "a@b.c");
    assert.deepEqual(bearers(), [`Bearer ${FRESH}`], "wham/usage only ever sees the refreshed token");
    assert.deepEqual(seenCalls.map((c) => c.accountId), ["acct-1"]);
    assert.equal(refreshCalls, 1);
    const stored = JSON.parse(readFileSync(authFile, "utf8"));
    assert.equal(stored.tokens.access_token, FRESH);
    assert.equal(stored.tokens.refresh_token, "rt-new", "a rotated refresh token is written back");
  });

  it("a valid-looking token the upstream invalidated refreshes once and retries", async () => {
    writeSession(STALE, "rt-old");
    const body = await quota();
    assert.equal(body.codex.windows.length, 2);
    assert.deepEqual(bearers(), [`Bearer ${STALE}`, `Bearer ${FRESH}`]);
    assert.equal(refreshCalls, 1);
  });

  it("a fedramp session carries the fedramp header on the retried call too", async () => {
    writeSession(STALE, "rt-old", ID_TOKEN_FEDRAMP);
    tokenIdToken = ID_TOKEN_FEDRAMP;
    const body = await quota();
    assert.equal(body.codex.windows.length, 2);
    assert.deepEqual(bearers(), [`Bearer ${STALE}`, `Bearer ${FRESH}`]);
    assert.deepEqual(seenCalls.map((c) => c.fedramp), ["true", "true"]);
    assert.deepEqual(seenCalls.map((c) => c.accountId), ["acct-1", "acct-1"]);
  });

  it("a session the store cannot refresh reports a quota error, not logged-out", async () => {
    writeSession(EXPIRED, "rt-old");
    tokenFails = true;
    const body = await quota();
    assert.equal(body.codex.error, true);
    assert.equal(body.codex.authenticated, undefined);
    assert.deepEqual(bearers(), [], "the usage call is skipped while the refresh is unresolved");
    assert.equal(refreshCalls, 1);
  });

  it("a session without a refresh token still reports not-logged-in after one 401", async () => {
    writeSession(EXPIRED);
    const body = await quota();
    assert.equal(body.codex.authenticated, false);
    assert.deepEqual(bearers(), [`Bearer ${EXPIRED}`]);
    assert.equal(refreshCalls, 0);
  });

  it("no session reports not-logged-in without touching the upstream", async () => {
    const body = await quota();
    assert.equal(body.codex.authenticated, false);
    assert.deepEqual(bearers(), []);
  });
});
