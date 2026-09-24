/**
 * Contract tests for lib/chatgptAuth.ts + lib/chatgptLogin.ts (native GPT OAuth login).
 * No network: fetch is injected, HOME/CODEX_HOME/IMA2_CONFIG_DIR point at temp dirs.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chatgptAuthFilePath,
  clearChatgptCredentials,
  extractChatgptAccountId,
  readChatgptAccess,
  resolveChatgptSession,
  saveChatgptTokenResponse,
} from "../lib/chatgptAuth.js";
import { buildChatgptAuthorizeUrl, runChatgptLogin, type ChatgptLoginPrompt } from "../lib/chatgptLogin.js";
import { detectCodexAuth } from "../lib/codexDetect.js";
import { gptAuthStatus, gptSessionState } from "../lib/authStatus.js";

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

const NS = "https://api.openai.com/auth";
const ID_TOKEN = jwt({ email: "User@Example.com", [NS]: { chatgpt_account_id: "acct-123", chatgpt_plan_type: "plus" } });
const ACCESS = (expSec: number) => jwt({ exp: expSec, [NS]: { chatgpt_account_id: "acct-123" } });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let root: string;
const savedEnv: Record<string, string | undefined> = {};

describe("native ChatGPT OAuth store and login", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ima2-chatgpt-auth-"));
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "IMA2_CONFIG_DIR"]) savedEnv[key] = process.env[key];
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.CODEX_HOME = join(root, ".codex");
    process.env.IMA2_CONFIG_DIR = join(root, ".ima2");
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("saves a token response in the Codex auth.json shape with 0600 permissions", () => {
    const session = saveChatgptTokenResponse({ access_token: ACCESS(2_000_000_000), refresh_token: "rt-1", id_token: ID_TOKEN });
    const path = chatgptAuthFilePath();
    const stored = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(stored.tokens.refresh_token, "rt-1");
    assert.equal(stored.tokens.account_id, "acct-123");
    assert.equal(typeof stored.last_refresh, "string");
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(session.source, "ima2");
    assert.equal(session.email, "user@example.com");
    assert.equal(session.plan, "plus");
    assert.equal(session.refreshable, true);
  });

  it("rejects a token response that cannot drive the proxy and writes nothing", () => {
    assert.throws(() => saveChatgptTokenResponse({ access_token: ACCESS(2_000_000_000), id_token: ID_TOKEN }), /refresh token/);
    assert.throws(() => saveChatgptTokenResponse({ access_token: jwt({}), refresh_token: "rt" }), /ChatGPT account/);
    assert.equal(resolveChatgptSession(), null);
  });

  it("prefers ima2's own store over a Codex CLI session, and falls back after logout", () => {
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: ACCESS(2_000_000_000), refresh_token: "codex-rt", account_id: "acct-codex" } }));
    assert.equal(resolveChatgptSession()?.source, "codex");
    assert.equal(detectCodexAuth({ probe: false }).proxyAuthFile, join(root, ".codex", "auth.json"));

    saveChatgptTokenResponse({ access_token: ACCESS(2_000_000_000), refresh_token: "rt-1", id_token: ID_TOKEN });
    const auth = detectCodexAuth();
    assert.equal(auth.proxyAuthFile, chatgptAuthFilePath());
    assert.equal(auth.probe, "skipped", "no Codex CLI spawn when a file session exists");
    assert.equal(readChatgptAccess()?.accountId, "acct-123");

    assert.equal(clearChatgptCredentials(), true);
    assert.equal(resolveChatgptSession()?.source, "codex");
  });

  it("classifies session state like OpenCodex: an expired access token with a refresh token is usable", () => {
    const base = { source: "ima2" as const, path: "x", refreshable: true };
    assert.equal(gptSessionState(null), "none");
    assert.equal(gptSessionState({ ...base, accessExpiresAt: Date.now() + 60_000 }), "ready");
    assert.equal(gptSessionState({ ...base, accessExpiresAt: Date.now() - 60_000 }), "access_expired");
    assert.equal(gptSessionState({ ...base, refreshable: false }), "no_refresh_token");
  });

  it("extracts the account id with the OpenCodex precedence", () => {
    assert.equal(extractChatgptAccountId(jwt({ chatgpt_account_id: "top", [NS]: { chatgpt_account_id: "ns" } })), "top");
    assert.equal(extractChatgptAccountId(undefined, jwt({ organizations: [{ id: "org-1" }] })), "org-1");
    assert.equal(extractChatgptAccountId("not-a-jwt"), undefined);
  });

  it("device flow: polls through 403 pending, exchanges the server verifier, and saves", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    let polls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/deviceauth/usercode")) return json(200, { device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "1" });
      if (url.endsWith("/deviceauth/token")) {
        polls++;
        return polls < 3 ? json(403, {}) : json(200, { authorization_code: "code-1", code_verifier: "server-verifier" });
      }
      if (url.endsWith("/oauth/token")) return json(200, { access_token: ACCESS(2_000_000_000), refresh_token: "rt-dev", id_token: ID_TOKEN });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const prompts: ChatgptLoginPrompt[] = [];
    const session = await runChatgptLogin({ flow: "device", fetchImpl, sleep: async () => {}, onPrompt: (p) => prompts.push(p) });
    assert.equal(prompts[0]?.userCode, "ABCD-1234");
    assert.equal(prompts[0]?.url, "https://auth.openai.com/codex/device");
    assert.equal(polls, 3);
    const exchange = new URLSearchParams(calls.at(-1)!.body);
    assert.equal(exchange.get("code_verifier"), "server-verifier");
    assert.equal(exchange.get("redirect_uri"), "https://auth.openai.com/deviceauth/callback");
    assert.equal(session.source, "ima2");
    assert.equal(JSON.parse(readFileSync(chatgptAuthFilePath(), "utf8")).tokens.refresh_token, "rt-dev");
  });

  it("device flow: a terminal poll error fails without writing a session", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) return json(200, { device_auth_id: "d", user_code: "C" });
      return json(500, { error: "server_error" });
    }) as typeof fetch;
    await assert.rejects(runChatgptLogin({ flow: "device", fetchImpl, sleep: async () => {}, onPrompt: () => {} }), /HTTP 500/);
    assert.equal(resolveChatgptSession(), null);
  });

  it("browser flow: ignores a state mismatch, then accepts the real callback and saves", async () => {
    const port = 21455 + Math.floor(Math.random() * 1000);
    let exchangeBody = "";
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      exchangeBody = String(init?.body ?? "");
      return json(200, { access_token: ACCESS(2_000_000_000), refresh_token: "rt-web", id_token: ID_TOKEN });
    }) as typeof fetch;
    const login = runChatgptLogin({
      flow: "browser",
      fetchImpl,
      callbackPort: port,
      onPrompt: (prompt) => {
        const authorize = new URL(prompt.url);
        const state = authorize.searchParams.get("state")!;
        assert.equal(authorize.searchParams.get("redirect_uri"), "http://localhost:1455/auth/callback");
        assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
        void (async () => {
          const forged = await fetch(`http://127.0.0.1:${port}/auth/callback?code=evil&state=wrong`);
          assert.equal(forged.status, 400);
          // A cross-site navigation without the state must not be able to cancel the login either.
          const forgedError = await fetch(`http://127.0.0.1:${port}/auth/callback?error=access_denied`);
          assert.equal(forgedError.status, 400);
          const ok = await fetch(`http://127.0.0.1:${port}/auth/callback?code=good&state=${encodeURIComponent(state)}`);
          assert.equal(ok.status, 200);
        })();
      },
    });
    const session = await login;
    assert.equal(new URLSearchParams(exchangeBody).get("code"), "good");
    assert.equal(session.refreshable, true);
  });

  it("builds the authorize URL with the Codex simplified-flow parameters", () => {
    const url = new URL(buildChatgptAuthorizeUrl({ state: "s", challenge: "c" }));
    assert.equal(url.origin + url.pathname, "https://auth.openai.com/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
    assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
    assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
  });
  it("the proxy file choice skips a malformed ima2 file, like status and quota do", () => {
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: ACCESS(2_000_000_000), refresh_token: "codex-rt", account_id: "acct-codex" } }));
    mkdirSync(join(root, ".ima2"), { recursive: true });
    writeFileSync(chatgptAuthFilePath(), "{ not json");
    assert.equal(detectCodexAuth({ probe: false }).proxyAuthFile, join(root, ".codex", "auth.json"));
    assert.equal(resolveChatgptSession()?.source, "codex");
  });

  it("a login aborted while its token exchange is in flight writes nothing", async () => {
    const abort = new AbortController();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/deviceauth/usercode")) return json(200, { device_auth_id: "d", user_code: "C" });
      if (url.endsWith("/deviceauth/token")) return json(200, { authorization_code: "c", code_verifier: "v" });
      abort.abort();
      return json(200, { access_token: ACCESS(2_000_000_000), refresh_token: "rt-late", id_token: ID_TOKEN });
    }) as typeof fetch;
    await assert.rejects(runChatgptLogin({ flow: "device", fetchImpl, signal: abort.signal, sleep: async () => {}, onPrompt: () => {} }), /cancelled/);
    assert.equal(resolveChatgptSession(), null);

  it("status verdicts follow OpenCodex health: action on every non-healthy state, masked ids, no tokens", () => {
    assert.deepEqual(
      { health: gptAuthStatus(null).health, action: gptAuthStatus(null).action },
      { health: "not_logged_in", action: "ima2 login" },
    );
    const own = saveChatgptTokenResponse({ access_token: ACCESS(2_000_000_000), refresh_token: "rt-1", id_token: ID_TOKEN });
    const healthy = gptAuthStatus(own);
    assert.equal(healthy.health, "healthy");
    assert.equal(healthy.accountId, "acct-123".slice(0, 2) + "…");
    assert.doesNotMatch(JSON.stringify(healthy), /rt-1|eyJ/);

    const expired = gptAuthStatus({ ...own, accessExpiresAt: Date.now() - 1000 });
    assert.equal(expired.health, "healthy", "an expired access token with a refresh token still works");
    assert.match(expired.note ?? "", /refreshes/);

    const shared = gptAuthStatus({ ...own, source: "codex" });
    assert.equal(shared.health, "warning");
    assert.equal(shared.reason, "shared_with_codex_cli");

    const rejected = gptAuthStatus(own, { proxyStatus: "auth_required" });
    assert.equal(rejected.health, "reauth_required");
    assert.equal(rejected.loggedIn, false);
    assert.equal(rejected.action, "ima2 login");

    assert.equal(gptAuthStatus({ ...own, refreshable: false }).reason, "no_refresh_token");
  });
});
