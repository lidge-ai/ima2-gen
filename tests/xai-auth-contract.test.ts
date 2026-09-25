/**
 * Contract tests for lib/xaiAuth.ts — the 15 rows of
 * devlog/_fin/260909_grok_native_oauth/010_wp2_xai_auth.md "검증 (C 게이트)".
 *
 * Runs with no network: every test installs its own globalThis.fetch stub and an isolated
 * HOME created with mkdtempSync, and injects deps.sleep so backoff never costs wall time.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GrokAuthError,
  XaiTokenRequestError,
  __resetGrokAuthStateForTest,
  clearGrokCredentials,
  discoverXaiOAuthEndpoints,
  getGrokAccessToken,
  grokAuthFilePath,
  loadGrokCredentials,
  postXaiToken,
  saveGrokCredentials,
  type GrokCredentials,
  type XaiTokenRetryDeps,
} from "../lib/xaiAuth.js";

const TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";

let homeDir: string;
let realFetch: typeof globalThis.fetch;
let fetchCalls: string[];
let sleeps: number[];
let deps: XaiTokenRetryDeps;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Installs a fetch stub that records every request URL. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    fetchCalls.push(url);
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

function seedCredentials(overrides: Partial<GrokCredentials> = {}): GrokCredentials {
  const creds: GrokCredentials = {
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 3_600_000,
    tokenEndpoint: TOKEN_ENDPOINT,
    ...overrides,
  };
  saveGrokCredentials(creds, homeDir);
  return creds;
}

function readStored(): GrokCredentials {
  return JSON.parse(readFileSync(grokAuthFilePath(homeDir), "utf8")) as GrokCredentials;
}

async function expectAuthError(promise: Promise<unknown>): Promise<GrokAuthError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GrokAuthError, "expected GrokAuthError, got " + String(error));
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to reject" });
}

describe("lib/xaiAuth contract", () => {
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "ima2-xai-auth-"));
    realFetch = globalThis.fetch;
    fetchCalls = [];
    sleeps = [];
    deps = { sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5 };
    __resetGrokAuthStateForTest();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    __resetGrokAuthStateForTest();
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("throws GROK_AUTH_REQUIRED without touching the network when no credential file exists", async () => {
    stubFetch(async () => jsonResponse(200, {}));
    const error = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(error.code, "GROK_AUTH_REQUIRED");
    assert.equal(error.status, 401);
    assert.equal(fetchCalls.length, 0);
  });

  it("returns the stored token without refreshing while it is still far from expiry", async () => {
    seedCredentials({ expiresAt: Date.now() + 3_600_000 });
    stubFetch(async () => jsonResponse(200, {}));
    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-old");
    assert.equal(fetchCalls.length, 0);
  });

  it("refreshes a token expiring inside the skew window and rewrites the file at 0600", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(200, {
      access_token: "access-new",
      refresh_token: "refresh-new",
      expires_in: 3600,
    }));

    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-new");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0], TOKEN_ENDPOINT);

    const stored = readStored();
    assert.equal(stored.accessToken, "access-new");
    assert.equal(stored.refreshToken, "refresh-new");
    assert.ok(stored.expiresAt !== undefined && stored.expiresAt > Date.now() + 3_000_000);
    // NTFS has no POSIX mode bits (Node reports 0o666 there), so the 0600 contract is a
    // POSIX-only assertion; the atomic tmp+rename write is exercised on every platform.
    if (process.platform !== "win32") assert.equal(statSync(grokAuthFilePath(homeDir)).mode & 0o777, 0o600);
  });

  it("uses a credential with no expiresAt optimistically instead of refreshing", async () => {
    const creds = seedCredentials();
    delete creds.expiresAt;
    saveGrokCredentials(creds, homeDir);
    stubFetch(async () => jsonResponse(200, {}));

    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-old");
    assert.equal(fetchCalls.length, 0);
  });

  it("collapses 12 concurrent expiring calls into exactly one token request", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(200, { access_token: "access-new", expires_in: 3600 }));

    const tokens = await Promise.all(
      Array.from({ length: 12 }, () => getGrokAccessToken({ homeDir, deps })),
    );
    assert.deepEqual(new Set(tokens), new Set(["access-new"]));
    assert.equal(fetchCalls.length, 1);
  });

  it("keeps the existing refresh token when the server does not rotate it", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(200, { access_token: "access-new", expires_in: 3600 }));

    await getGrokAccessToken({ homeDir, deps });
    assert.equal(readStored().refreshToken, "refresh-old");
  });

  it("preserves a progrok-written idToken across a refresh", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000, idToken: "id-token-from-progrok", email: "a@b.com" });
    stubFetch(async () => jsonResponse(200, { access_token: "access-new", expires_in: 3600 }));

    await getGrokAccessToken({ homeDir, deps });
    const stored = readStored();
    assert.equal(stored.idToken, "id-token-from-progrok");
    assert.equal(stored.email, "a@b.com");
  });

  it("treats invalid_grant as terminal, keeps the file, and serves the next 30s from cache", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(400, { error: "invalid_grant", error_description: "expired" }));

    const first = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(first.code, "GROK_AUTH_REQUIRED");
    assert.equal(first.oauthError, "invalid_grant");
    assert.equal(fetchCalls.length, 1);
    assert.equal(loadGrokCredentials(homeDir)?.accessToken, "access-old", "credential file must survive");

    const second = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(second.code, "GROK_AUTH_REQUIRED");
    assert.equal(fetchCalls.length, 1, "negative cache must skip the network");
  });

  it("reports GROK_AUTH_REFRESH_FAILED after three 503 responses", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(503, { error: "server_error" }));

    const error = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(error.code, "GROK_AUTH_REFRESH_FAILED");
    assert.equal(error.status, 502);
    assert.equal(fetchCalls.length, 3);
    assert.equal(sleeps.length, 2);
  });

  it("honors a numeric Retry-After instead of clamping it to the jitter ceiling", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) return jsonResponse(429, { error: "rate_limited" }, { "retry-after": "5" });
      return jsonResponse(200, { access_token: "access-new", expires_in: 3600 });
    });

    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-new");
    assert.deepEqual(sleeps, [5000]);
  });

  it("honors an HTTP-date Retry-After", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    const retryAt = new Date(Date.now() + 30_000).toUTCString();
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) return jsonResponse(429, { error: "rate_limited" }, { "retry-after": retryAt });
      return jsonResponse(200, { access_token: "access-new", expires_in: 3600 });
    });

    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-new");
    assert.equal(sleeps.length, 1);
    const waited = sleeps[0] as number;
    assert.ok(waited > 25_000 && waited <= 31_000, "expected a date-derived wait, got " + String(waited));
  });

  it("rethrows a custom abort reason without retrying", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    stubFetch(async (_url, init) => {
      const signal = init?.signal;
      if (signal?.aborted) throw signal.reason as Error;
      return jsonResponse(200, {});
    });

    await assert.rejects(
      () => postXaiToken(TOKEN_ENDPOINT, { grant_type: "refresh_token" }, controller.signal, deps),
      (error: unknown) => error === reason,
    );
    assert.equal(fetchCalls.length, 1, "an aborted request must not be retried");
    assert.equal(sleeps.length, 0);
  });

  it("returns the stored token when rejectedAccessToken belongs to an older generation", async () => {
    seedCredentials({ accessToken: "access-current", expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(200, { access_token: "should-not-be-fetched" }));

    const token = await getGrokAccessToken({
      homeDir,
      deps,
      forceRefresh: true,
      rejectedAccessToken: "access-stale",
    });
    assert.equal(token, "access-current");
    assert.equal(fetchCalls.length, 0);
  });

  it("rejects a discovery document that points the token endpoint at an untrusted host", async () => {
    stubFetch(async () => jsonResponse(200, {
      authorization_endpoint: "https://auth.x.ai/oauth2/auth",
      token_endpoint: "https://evil.x.ai/token",
    }));

    await assert.rejects(() => discoverXaiOAuthEndpoints(), /not trusted/);

    const creds = seedCredentials({ expiresAt: Date.now() + 60_000 });
    delete creds.tokenEndpoint;
    saveGrokCredentials(creds, homeDir);
    const error = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(error.code, "GROK_AUTH_REFRESH_FAILED");
  });

  it("does not clobber a credential file another writer replaced during the refresh", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => {
      // progrok or a device login rewrote the file while our refresh was in flight.
      saveGrokCredentials({ accessToken: "access-newer", refreshToken: "refresh-newer", expiresAt: Date.now() + 3_600_000 }, homeDir);
      return jsonResponse(200, { access_token: "access-old-lineage", refresh_token: "refresh-old-lineage", expires_in: 3600 });
    });

    assert.equal(await getGrokAccessToken({ homeDir, deps }), "access-newer");
    const stored = readStored();
    assert.equal(stored.accessToken, "access-newer");
    assert.equal(stored.refreshToken, "refresh-newer", "the newer session must survive the racing refresh");
  });

  it("does not resurrect the session when the credential file is deleted mid-refresh", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => {
      clearGrokCredentials(homeDir);
      return jsonResponse(200, { access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 });
    });

    const error = await expectAuthError(getGrokAccessToken({ homeDir, deps }));
    assert.equal(error.code, "GROK_AUTH_REQUIRED");
    assert.equal(loadGrokCredentials(homeDir), null, "a logout mid-refresh must stay a logout");
  });

  it("rejects an aborted caller without failing the other callers on the shared refresh", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    let resolveToken: ((response: Response) => void) | undefined;
    stubFetch(async () => new Promise<Response>((resolve) => { resolveToken = resolve; }));

    const controller = new AbortController();
    const abortReason = new Error("job cancelled");
    const first = getGrokAccessToken({ homeDir, deps, signal: controller.signal }).then(
      (token) => ({ token }),
      (error: unknown) => ({ error }),
    );
    const second = getGrokAccessToken({ homeDir, deps });
    await new Promise((resolve) => setTimeout(resolve, 10));

    controller.abort(abortReason);
    resolveToken!(jsonResponse(200, { access_token: "access-new", expires_in: 3600 }));

    const firstResult = await first;
    assert.ok("error" in firstResult && firstResult.error === abortReason, "the aborted caller gets its own reason");
    assert.equal(await second, "access-new", "the joined caller still gets the refreshed token");
    assert.equal(fetchCalls.length, 1);
    assert.equal(readStored().accessToken, "access-new");
  });

  it("leaves no temp files behind after a refresh", async () => {
    seedCredentials({ expiresAt: Date.now() + 60_000 });
    stubFetch(async () => jsonResponse(200, { access_token: "access-new", expires_in: 3600 }));

    await getGrokAccessToken({ homeDir, deps });
    assert.deepEqual(readdirSync(join(homeDir, ".progrok")), ["auth.json"]);
  });

  it("returns null rather than throwing for a malformed credential file", () => {
    mkdirSync(join(homeDir, ".progrok"), { recursive: true, mode: 0o700 });
    writeFileSync(grokAuthFilePath(homeDir), "{ not json", { mode: 0o600 });
    assert.equal(loadGrokCredentials(homeDir), null);
  });

  it("exposes the oauth error on XaiTokenRequestError for terminal classification", () => {
    const error = new XaiTokenRequestError(400, "refresh_token_reused", "boom");
    assert.equal(error.status, 400);
    assert.equal(error.oauthError, "refresh_token_reused");
  });
});
