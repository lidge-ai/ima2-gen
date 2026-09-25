/**
 * /api/auth/switch drives the native ChatGPT login (lib/chatgptLogin.ts) and, once it
 * completes, restarts the GPT OAuth proxy so the new session is used without a server
 * restart. Upstream OAuth endpoints are stubbed; the express app listens on an ephemeral port.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerHealthRoutes } from "../routes/health.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";
import { config } from "../config.js";
import { chatgptAuthFilePath } from "../lib/chatgptAuth.js";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

const ID_TOKEN = jwt({ email: "a@b.c", "https://api.openai.com/auth": { chatgpt_account_id: "acct-9" } });

let root: string;
let server: Server;
let base: string;
let realFetch: typeof fetch;
let restarts: number;
const savedEnv: Record<string, string | undefined> = {};

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
}

describe("/api/auth/switch (codex)", () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "ima2-auth-switch-"));
    for (const key of ["IMA2_CONFIG_DIR", "HOME", "USERPROFILE", "CODEX_HOME"]) savedEnv[key] = process.env[key];
    process.env.IMA2_CONFIG_DIR = root;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.CODEX_HOME = join(root, ".codex");
    restarts = 0;
    realFetch = globalThis.fetch;
    const app = express();
    app.use(express.json());
    const ctx = { restartOAuthProxy: () => { restarts++; return { restarted: true }; } } as RouteRuntimeContext;
    registerAuthRoutes(app, ctx);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Upstream stub: everything that is not this test server is auth.openai.com.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      if (url.endsWith("/deviceauth/usercode")) return Response.json({ device_auth_id: "d", user_code: "WXYZ-12345", interval: 1 });
      if (url.endsWith("/deviceauth/token")) return Response.json({ authorization_code: "c", code_verifier: "v" });
      if (url.endsWith("/oauth/token")) return Response.json({ access_token: jwt({ exp: 2_000_000_000 }), refresh_token: "rt-web", id_token: ID_TOKEN });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await new Promise((r) => server.close(r));
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("device flow: returns the code, saves the ima2 session, and restarts the proxy", async () => {
    const start = await realFetch(`${base}/api/auth/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", flow: "device" }),
    });
    assert.equal(start.status, 200);
    const body = await start.json() as { sessionId: string; userCode: string; flow: string; verificationUrl: string };
    assert.equal(body.flow, "device");
    assert.equal(body.userCode, "WXYZ-12345");
    assert.equal(body.verificationUrl, "https://auth.openai.com/codex/device");

    const done = await waitFor(async () => {
      const poll = await realFetch(`${base}/api/auth/switch/${body.sessionId}`);
      const json = await poll.json() as { status: string; email?: string };
      return json.status === "pending" ? undefined : json;
    });
    assert.equal(done.status, "complete");
    assert.equal(done.email, "a@b.c");
    assert.equal(restarts, 1);
    assert.equal(JSON.parse(readFileSync(chatgptAuthFilePath(root), "utf8")).tokens.refresh_token, "rt-web");
  });

  it("two near-simultaneous codex starts save exactly one session and restart once", async () => {
    let exchanges = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (url.endsWith("/deviceauth/usercode")) {
        await new Promise((r) => setTimeout(r, 30));
        return Response.json({ device_auth_id: "d", user_code: "CODE-1", interval: 1 });
      }
      if (url.endsWith("/deviceauth/token")) return Response.json({ authorization_code: "c", code_verifier: "v" });
      exchanges++;
      return Response.json({ access_token: jwt({ exp: 2_000_000_000 }), refresh_token: `rt-${exchanges}`, id_token: ID_TOKEN });
    }) as typeof fetch;
    const start = () => realFetch(`${base}/api/auth/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", flow: "device" }),
    });
    const [first, second] = await Promise.all([start(), start()]);
    const winner = await second.json() as { sessionId: string };
    assert.equal(second.status, 200);
    await first.text();
    const done = await waitFor(async () => {
      const json = await (await realFetch(`${base}/api/auth/switch/${winner.sessionId}`)).json() as { status: string };
      return json.status === "pending" ? undefined : json;
    });
    assert.equal(done.status, "complete");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(restarts, 1, "the superseded login must not complete or restart the proxy");
    assert.equal(exchanges, 1, "the superseded login must not reach the token exchange");
  });

  it("an upstream failure before a code exists is a 502 with the reason", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const start = await realFetch(`${base}/api/auth/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", flow: "device" }),
    });
    assert.equal(start.status, 502);
    assert.match((await start.json() as { error: string }).error, /device code login may be disabled/i);
    assert.equal(restarts, 0);
  });

  it("two near-simultaneous grok starts let only the newest device login write the session", async () => {
    let tokenPolls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (url.endsWith("/.well-known/openid-configuration")) {
        await new Promise((r) => setTimeout(r, 30));
        return Response.json({
          authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
          token_endpoint: "https://auth.x.ai/oauth2/token",
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        });
      }
      if (url.endsWith("/oauth2/device/code")) {
        return Response.json({ device_code: "d", user_code: "GROK-1", verification_uri: "https://x.ai/device", expires_in: 600, interval: 1 });
      }
      if (url.endsWith("/oauth2/token")) {
        tokenPolls++;
        return Response.json({ access_token: "grok-access", refresh_token: "grok-refresh", expires_in: 3600 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const start = () => realFetch(`${base}/api/auth/switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "grok" }),
    });
    const [first, second] = await Promise.all([start(), start()]);
    // The superseded start is aborted before it can prompt, so its POST fails while
    // the newest one returns a session.
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 502]);
    const loser = first.status === 200 ? second : first;
    const winnerRes = first.status === 200 ? first : second;
    await loser.text();
    const winner = await winnerRes.json() as { sessionId: string };
    const done = await waitFor(async () => {
      const json = await (await realFetch(`${base}/api/auth/switch/${winner.sessionId}`)).json() as { status: string };
      return json.status === "pending" ? undefined : json;
    }, 15_000);
    assert.equal(done.status, "complete");
    assert.equal(tokenPolls, 1, "only the winning flow may reach the token endpoint");
    assert.equal(JSON.parse(readFileSync(join(root, ".progrok", "auth.json"), "utf8")).accessToken, "grok-access");
  });

  it("POST /api/oauth/restart forwards to the runtime hook", async () => {
    const res = await realFetch(`${base}/api/oauth/restart`, { method: "POST" });
    assert.deepEqual(await res.json(), { restarted: true });
    assert.equal(restarts, 1);
  });
  it("GET /api/oauth/status: a failed proxy with no session is a login problem, with an action", async () => {
    const app = express();
    const ctx = createTestRuntimeContext({
      oauthReadyState: "failed",
      grokAuthHomeDir: root,
      config: { ...config, oauth: { ...config.oauth, autoStart: true } },
    });
    registerHealthRoutes(app, ctx);
    const s = await new Promise<Server>((resolve) => { const x = app.listen(0, "127.0.0.1", () => resolve(x)); });
    try {
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/oauth/status`;
      const before = await (await realFetch(url)).json() as { status: string; auth: { health: string; action?: string }; grokAuth: { health: string } };
      assert.equal(before.status, "auth_required");
      assert.equal(before.auth.health, "not_logged_in");
      assert.equal(before.auth.action, "ima2 login");
      assert.equal(before.grokAuth.health, "not_logged_in");

      // With a session on disk, the same dead proxy is an outage, not a missing login.
      const { saveChatgptTokenResponse } = await import("../lib/chatgptAuth.js");
      saveChatgptTokenResponse({ access_token: jwt({ exp: 2_000_000_000 }), refresh_token: "rt", id_token: ID_TOKEN }, root);
      const after = await (await realFetch(url)).json() as { status: string; auth: { health: string; email?: string } };
      assert.equal(after.status, "offline");
      assert.equal(after.auth.health, "healthy");
      assert.equal(after.auth.email, "a@b.c");
    } finally {
      await new Promise((r) => s.close(r));
    }
  });

  it("GET /api/oauth/status: transient /v1/models failures do not ask for re-login, auth refusals do", async () => {
    const { saveChatgptTokenResponse } = await import("../lib/chatgptAuth.js");
    saveChatgptTokenResponse({ access_token: jwt({ exp: 2_000_000_000 }), refresh_token: "rt", id_token: ID_TOKEN }, root);
    let modelsReply = new Response("upstream blew up", { status: 502 });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/models")) return modelsReply.clone();
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const app = express();
    const ctx = createTestRuntimeContext({
      oauthReadyState: "ready",
      grokAuthHomeDir: root,
      config: { ...config, oauth: { ...config.oauth, autoStart: true } },
    });
    registerHealthRoutes(app, ctx);
    const s = await new Promise<Server>((resolve) => { const x = app.listen(0, "127.0.0.1", () => resolve(x)); });
    try {
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/oauth/status`;
      // A live proxy failing upstream with a usable session file is an outage, not a logout.
      const transient = await (await realFetch(url)).json() as { status: string; auth: { health: string } };
      assert.equal(transient.status, "offline");
      assert.equal(transient.auth.health, "healthy");

      // Generic auth-ish wording inside a 5xx must not count as a refused session.
      modelsReply = new Response("upstream authentication service unavailable", { status: 503 });
      const noise = await (await realFetch(url)).json() as { status: string };
      assert.equal(noise.status, "offline");

      // 401 means the session was refused no matter how the body is phrased.
      modelsReply = new Response("invalid_api_key", { status: 401 });
      const unauthed = await (await realFetch(url)).json() as { status: string; auth: { health: string } };
      assert.equal(unauthed.status, "auth_required");
      assert.equal(unauthed.auth.health, "reauth_required");

      modelsReply = new Response("Encountered invalidated oauth token", { status: 502 });
      const refused = await (await realFetch(url)).json() as { status: string; auth: { health: string } };
      assert.equal(refused.status, "auth_required");
      assert.equal(refused.auth.health, "reauth_required");
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});
