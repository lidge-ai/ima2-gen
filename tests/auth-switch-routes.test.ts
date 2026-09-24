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
    savedEnv.IMA2_CONFIG_DIR = process.env.IMA2_CONFIG_DIR;
    process.env.IMA2_CONFIG_DIR = root;
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
    if (savedEnv.IMA2_CONFIG_DIR === undefined) delete process.env.IMA2_CONFIG_DIR;
    else process.env.IMA2_CONFIG_DIR = savedEnv.IMA2_CONFIG_DIR;
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

  it("POST /api/oauth/restart forwards to the runtime hook", async () => {
    const res = await realFetch(`${base}/api/oauth/restart`, { method: "POST" });
    assert.deepEqual(await res.json(), { restarted: true });
    assert.equal(restarts, 1);
  });
});
