/**
 * Contract tests for lib/xaiDeviceLogin.ts (030 wp4).
 *
 * No network and no wall time: every test installs its own fetch stub, writes into an
 * isolated HOME, and injects a sleep that only records the requested delay.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokAuthFilePath, type GrokCredentials } from "../lib/xaiAuth.js";
import { runXaiDeviceLogin, type XaiDeviceCodeInfo } from "../lib/xaiDeviceLogin.js";

const DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
const DEVICE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";

let homeDir: string;
let realFetch: typeof globalThis.fetch;
let sleeps: number[];
let calls: string[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: "user-1", email }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

function discoveryBody(withDevice = true): Record<string, string> {
  return {
    authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
    token_endpoint: TOKEN_URL,
    ...(withDevice ? { device_authorization_endpoint: DEVICE_URL } : {}),
  };
}

/** Installs the stub on globalThis (discovery uses it) and returns it for `fetchImpl`. */
function stubFetch(handler: (url: string) => Promise<Response>): typeof fetch {
  const stub = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  globalThis.fetch = stub;
  return stub;
}

/** Serves discovery + device code, then the given token responses in order. */
function stubDeviceFlow(tokenResponses: Response[], deviceOverrides: Record<string, unknown> = {}): typeof fetch {
  let tokenIndex = 0;
  return stubFetch(async (url) => {
    if (url === DISCOVERY_URL) return jsonResponse(200, discoveryBody());
    if (url === DEVICE_URL) {
      return jsonResponse(200, {
        device_code: "device-123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://x.ai/device",
        expires_in: 600,
        interval: 1,
        ...deviceOverrides,
      });
    }
    if (url === TOKEN_URL) {
      const response = tokenResponses[tokenIndex];
      tokenIndex += 1;
      if (!response) throw new Error("unexpected extra token poll");
      return response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("lib/xaiDeviceLogin runXaiDeviceLogin", () => {
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "ima2-xai-device-"));
    realFetch = globalThis.fetch;
    sleeps = [];
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("polls through authorization_pending and slow_down, then saves the session", async () => {
    const codes: XaiDeviceCodeInfo[] = [];
    const fetchImpl = stubDeviceFlow([
      jsonResponse(400, { error: "authorization_pending" }),
      jsonResponse(400, { error: "slow_down" }),
      jsonResponse(200, {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        id_token: idToken("Person@Example.COM"),
      }),
    ]);

    const before = Date.now();
    const creds = await runXaiDeviceLogin({
      onUserCode: (info) => codes.push(info),
      homeDir,
      fetchImpl,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    assert.deepEqual(codes, [{ userCode: "ABCD-EFGH", verificationUrl: "https://x.ai/device", expiresIn: 600 }]);
    // interval 1 is clamped to the RFC 8628 floor of 5s; slow_down adds 5s to the next wait.
    assert.deepEqual(sleeps, [5000, 5000, 10000]);
    assert.equal(calls.filter((url) => url === TOKEN_URL).length, 3);

    const saved = JSON.parse(readFileSync(grokAuthFilePath(homeDir), "utf8")) as GrokCredentials;
    assert.equal(saved.accessToken, "access-new");
    assert.equal(saved.refreshToken, "refresh-new");
    assert.equal(saved.tokenEndpoint, TOKEN_URL);
    assert.equal(saved.email, "person@example.com");
    assert.ok(saved.expiresAt !== undefined && saved.expiresAt >= before + 3_600_000);
    assert.deepEqual(creds, saved);
  });

  it("omits expiresAt when the token response has no numeric expires_in", async () => {
    const fetchImpl = stubDeviceFlow([jsonResponse(200, { access_token: "access-only" })]);
    const creds = await runXaiDeviceLogin({
      onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); },
    });
    assert.equal(creds.expiresAt, undefined);
    assert.equal(creds.refreshToken, undefined);
    assert.equal(JSON.parse(readFileSync(grokAuthFilePath(homeDir), "utf8")).accessToken, "access-only");
  });

  it("stops at expires_in and rejects without writing a session", async () => {
    const fetchImpl = stubDeviceFlow(
      [jsonResponse(400, { error: "authorization_pending" }), jsonResponse(400, { error: "authorization_pending" })],
      { expires_in: 8 },
    );
    await assert.rejects(
      runXaiDeviceLogin({ onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }),
      /expired before it was approved/,
    );
    assert.deepEqual(sleeps, [5000, 5000]);
    assert.throws(() => readFileSync(grokAuthFilePath(homeDir), "utf8"));
  });

  it("keeps polling through transient transport and 5xx failures", async () => {
    const codes: XaiDeviceCodeInfo[] = [];
    let polls = 0;
    const fetchImpl = stubFetch(async (url) => {
      if (url === DISCOVERY_URL) return jsonResponse(200, discoveryBody());
      if (url === DEVICE_URL) {
        return jsonResponse(200, {
          device_code: "device-123", user_code: "ABCD-EFGH",
          verification_uri: "https://x.ai/device", expires_in: 600, interval: 1,
        });
      }
      if (url === TOKEN_URL) {
        polls += 1;
        if (polls === 1) throw new Error("socket hang up");
        if (polls === 2) return jsonResponse(503, {});
        return jsonResponse(200, { access_token: "access-new", refresh_token: "r", expires_in: 3600 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const creds = await runXaiDeviceLogin({
      onUserCode: (info) => codes.push(info),
      homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); },
    });
    assert.equal(creds.accessToken, "access-new");
    assert.equal(polls, 3);
    assert.equal(sleeps.length, 3, "each retryable poll is followed by a normal interval wait");
  });

  it("gives up after three consecutive transient poll failures", async () => {
    const fetchImpl = stubDeviceFlow([jsonResponse(503, {}), jsonResponse(503, {}), jsonResponse(503, {})]);
    await assert.rejects(
      runXaiDeviceLogin({ onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }),
      /token endpoint kept failing.*503/,
    );
    assert.throws(() => readFileSync(grokAuthFilePath(homeDir), "utf8"));
  });

  it("still fails fast on a terminal OAuth error between transient ones", async () => {
    const fetchImpl = stubDeviceFlow([jsonResponse(503, {}), jsonResponse(400, { error: "access_denied" })]);
    await assert.rejects(
      runXaiDeviceLogin({ onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }),
      /access_denied/,
    );
    assert.equal(calls.filter((url) => url === TOKEN_URL).length, 2, "a denial is not retried");
  });

  it("rejects a terminal OAuth error without writing a session", async () => {
    const fetchImpl = stubDeviceFlow([jsonResponse(400, { error: "access_denied" })]);
    await assert.rejects(
      runXaiDeviceLogin({ onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }),
      /access_denied/,
    );
    assert.throws(() => readFileSync(grokAuthFilePath(homeDir), "utf8"));
  });

  it("rejects when discovery does not advertise a device authorization endpoint", async () => {
    const fetchImpl = stubFetch(async (url) => {
      if (url === DISCOVERY_URL) return jsonResponse(200, discoveryBody(false));
      throw new Error(`unexpected fetch: ${url}`);
    });
    await assert.rejects(
      runXaiDeviceLogin({ onUserCode: () => {}, homeDir, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }),
      /device_authorization_endpoint/,
    );
    assert.deepEqual(sleeps, []);
  });
});
