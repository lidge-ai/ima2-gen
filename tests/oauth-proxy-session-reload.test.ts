/**
 * The bundled openai-oauth proxy (vendor/openai-oauth-1.0.2-ima2.2.tgz) must follow the
 * session file instead of the first token it read. Before the ima2.2 patch it cached that
 * token forever, so after the Codex CLI rotated it (or the user logged in again) every
 * request failed with "Encountered invalidated oauth token" until the server restarted.
 *
 * Runs the real proxy binary against a local fake upstream and a fake token endpoint.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageBin } from "../lib/packageCli.js";

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

const EXP = 2_000_000_000;
const token = (name: string) => jwt({ exp: EXP, name, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } });
const TOKEN_A = token("a");
const TOKEN_B = token("b");
const TOKEN_C = token("c");
const TOKEN_D = token("d");
const TOKEN_E = token("e");

let root: string;
let authFile: string;
let upstream: Server;
let proxy: ChildProcess;
let proxyUrl: string;
const seen: string[] = [];
let refreshCalls = 0;
/** Runs inside the fake token endpoint before it answers (simulates work during a refresh). */
let onRefresh: (() => Promise<void>) | null = null;
let refreshResult = () => ({ access_token: TOKEN_C, refresh_token: "rt-c", id_token: token("id2") });

function writeSession(accessToken: string, refreshToken: string) {
  writeFileSync(authFile, JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: { access_token: accessToken, refresh_token: refreshToken, account_id: "acct-1", id_token: token("id") },
    last_refresh: new Date().toISOString(),
  }));
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  return port;
}

/** One /v1/responses call through the proxy; the fake upstream records every bearer token. */
async function responsesCall(): Promise<string[]> {
  const before = seen.length;
  await fetch(`${proxyUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-test", input: "hi", stream: false }),
  }).then((r) => r.text());
  return seen.slice(before);
}

describe("bundled OAuth proxy follows the session file", () => {
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "ima2-proxy-reload-"));
    authFile = join(root, "auth.json");
    writeSession(TOKEN_A, "rt-a");
    upstream = createServer((req, res) => {
      if (req.url?.startsWith("/oauth/token")) {
        refreshCalls++;
        void (async () => {
          await onRefresh?.();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(refreshResult()));
        })();
        return;
      }
      const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      seen.push(bearer);
      // TOKEN_B plays the token another client already rotated away.
      res.writeHead(bearer === TOKEN_B ? 401 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: bearer === TOKEN_B ? "Encountered invalidated oauth token" : "nope" } }));
    });
    const upstreamPort = await listen(upstream);
    const port = await freePort();
    proxyUrl = `http://127.0.0.1:${port}`;
    proxy = spawn(process.execPath, [
      resolvePackageBin("openai-oauth", "openai-oauth"),
      "--port", String(port),
      "--oauth-file", authFile,
      // A fixed model list keeps startup off the network; only /v1/responses reaches upstream.
      "--models", "gpt-test",
      "--base-url", `http://127.0.0.1:${upstreamPort}/backend-api/codex`,
      "--oauth-token-url", `http://127.0.0.1:${upstreamPort}/oauth/token`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("proxy did not start")), 15_000);
      proxy.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("http://")) { clearTimeout(timer); resolve(); }
      });
      proxy.once("exit", (code) => { clearTimeout(timer); reject(new Error(`proxy exited ${code}`)); });
    });
  });

  after(async () => {
    proxy?.kill();
    await new Promise((r) => upstream.close(r));
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the token that is in the file now, not the first one it read", async () => {
    assert.deepEqual(await responsesCall(), [TOKEN_A]);
    writeSession(TOKEN_C, "rt-c0");
    assert.deepEqual(await responsesCall(), [TOKEN_C], "a replaced session file must take effect without a restart");
  });

  it("on an upstream 401 it refreshes once, retries with the new token, and writes the file back intact", async () => {
    writeSession(TOKEN_B, "rt-b");
    assert.deepEqual(await responsesCall(), [TOKEN_B, TOKEN_C], "401 → refresh → retry with the refreshed token");
    assert.equal(refreshCalls, 1);
    const stored = JSON.parse(readFileSync(authFile, "utf8"));
    assert.equal(stored.tokens.access_token, TOKEN_C);
    assert.equal(stored.tokens.refresh_token, "rt-c");
    assert.equal(stored.auth_mode, "chatgpt", "unknown Codex keys survive the write-back");
    assert.ok("OPENAI_API_KEY" in stored);
    if (process.platform !== "win32") assert.equal(statSync(authFile).mode & 0o777, 0o600);
  });
  it("concurrent 401s share one refresh: the rotating refresh token is spent once", async () => {
    writeSession(TOKEN_B, "rt-b2");
    refreshCalls = 0;
    refreshResult = () => ({ access_token: TOKEN_E, refresh_token: "rt-e", id_token: token("id3") });
    onRefresh = () => new Promise((r) => setTimeout(r, 80));
    try {
      const results = await Promise.all([responsesCall(), responsesCall(), responsesCall()]);
      assert.equal(refreshCalls, 1, "one refresh for the whole burst");
      for (const attempts of results) assert.equal(attempts.at(-1), TOKEN_E);
    } finally {
      onRefresh = null;
    }
  });

  it("a login that replaces the file during a refresh wins; the stale refresh is not written", async () => {
    writeSession(TOKEN_B, "rt-b3");
    refreshCalls = 0;
    refreshResult = () => ({ access_token: TOKEN_C, refresh_token: "rt-stale", id_token: token("id4") });
    onRefresh = async () => { writeSession(TOKEN_D, "rt-new-login"); };
    try {
      const attempts = await responsesCall();
      assert.equal(attempts.at(-1), TOKEN_D, "the retry uses the new login");
      const stored = JSON.parse(readFileSync(authFile, "utf8"));
      assert.equal(stored.tokens.access_token, TOKEN_D);
      assert.equal(stored.tokens.refresh_token, "rt-new-login");
    } finally {
      onRefresh = null;
    }
  });
});
