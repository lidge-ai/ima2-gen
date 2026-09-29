import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import express from "express";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHealthRoutes } from "../routes/health.ts";
import {
  fetchGrokBilling,
  inspectGrokWeeklyEligibility,
  parseGrokCreditsResponse,
} from "../routes/quota.ts";
import type { RouteRuntimeContext } from "../lib/runtimeContext.ts";

const originalFetch = globalThis.fetch;

function makeCtx(overrides: Partial<RouteRuntimeContext> = {}): RouteRuntimeContext {
  return {
    hasApiKey: false,
    apiKey: null,
    apiKeySource: "none",
    oauthPort: 10531,
    oauthUrl: "http://127.0.0.1:10531",
    packageVersion: "0.0.0-test",
    startedAt: 1,
    config: {
      oauth: { statusTimeoutMs: 50 },
    },
    ...overrides,
  };
}

type GetJsonResult = { status: number | undefined; body: Record<string, unknown> };

async function getJson(app, path): Promise<GetJsonResult> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    return await new Promise<GetJsonResult>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path, method: "GET" },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode, body: JSON.parse(body) as Record<string, unknown> });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("/api/billing apiKeySource", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports none when no API key is configured", async () => {
    const app = express();
    registerHealthRoutes(app, makeCtx());

    const res = await getJson(app, "/api/billing");

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      oauth: true,
      apiKeyValid: false,
      apiKeySource: "none",
    });
  });

  it("reports env when the key came from OPENAI_API_KEY", async () => {
    globalThis.fetch = (async (url) => ({
      ok: String(url).includes("/v1/models"),
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const app = express();
    registerHealthRoutes(app, makeCtx({
      hasApiKey: true,
      apiKey: "test",
      apiKeySource: "env",
    }));

    const res = await getJson(app, "/api/billing");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.apiKeySource, "env");
    assert.strictEqual(res.body.apiKeyValid, true);
  });

  it("reports config when the key came from config.json", async () => {
    globalThis.fetch = (async (url) => ({
      ok: String(url).includes("/v1/models"),
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const app = express();
    registerHealthRoutes(app, makeCtx({
      hasApiKey: true,
      apiKey: "test",
      apiKeySource: "config",
    }));

    const res = await getJson(app, "/api/billing");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.apiKeySource, "config");
    assert.strictEqual(res.body.apiKeyValid, true);
  });
});

function writeGrokFixture(homeDir: string, entries: Record<string, unknown>, version: string | null = "0.2.101") {
  const grokDir = join(homeDir, ".grok");
  mkdirSync(grokDir, { recursive: true });
  writeFileSync(join(grokDir, "auth.json"), JSON.stringify(entries));
  if (version) writeFileSync(join(grokDir, "version.json"), JSON.stringify({ version }));
}

describe("Grok weekly credits quota", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses the real nested weekly envelope and proto3 omitted zero", () => {
    const end = "2026-07-19T13:05:52.277209+00:00";
    assert.deepStrictEqual(parseGrokCreditsResponse({
      config: {
        creditUsagePercent: 57,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end },
      },
    }), { percent: 57, periodEnd: end });
    assert.deepStrictEqual(parseGrokCreditsResponse({
      config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end } },
    }), { percent: 0, periodEnd: end });
    assert.strictEqual(parseGrokCreditsResponse({
      config: { creditUsagePercent: 57, currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", end } },
    }), null);
  });

  it("uses only eligible xAI auth and sends source-parity weekly headers", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "ima2-grok-weekly-"));
    try {
      writeGrokFixture(homeDir, {
        "https://example.test::other": {
          key: "not-xai-token",
          auth_mode: "external",
          oidc_issuer: "https://example.test",
          user_id: "other-user",
        },
        "https://auth.x.ai::client": {
          key: "xai-token",
          auth_mode: "external",
          oidc_issuer: "https://auth.x.ai",
          user_id: "xai-user",
          email: "person@example.test",
        },
      });
      const seen: Array<{ url: string; headers: Headers }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers) });
        return Response.json({
          config: {
            creditUsagePercent: 57,
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              end: "2026-07-19T13:05:52.277209+00:00",
            },
          },
        });
      }) as typeof fetch;

      assert.deepStrictEqual(inspectGrokWeeklyEligibility(homeDir), {
        eligible: true,
        reason: "ok",
        candidateCount: 1,
        clientVersion: "0.2.101",
      });
      const result = await fetchGrokBilling(homeDir);
      assert.deepStrictEqual(result.windows, [{
        label: "weekly",
        percent: 57,
        resetsAt: "2026-07-19T13:05:52.277209+00:00",
      }]);
      assert.strictEqual(result.billing, undefined);
      assert.strictEqual(seen.length, 1);
      assert.match(seen[0]!.url, /\/v1\/billing\?format=credits$/);
      assert.strictEqual(seen[0]!.headers.get("authorization"), "Bearer xai-token");
      assert.strictEqual(seen[0]!.headers.get("x-xai-token-auth"), "xai-grok-cli");
      assert.strictEqual(seen[0]!.headers.get("x-authenticateresponse"), "authenticate-response");
      assert.strictEqual(seen[0]!.headers.get("x-userid"), "xai-user");
      assert.strictEqual(seen[0]!.headers.get("x-grok-client-version"), "0.2.101");
      assert.strictEqual(seen[0]!.headers.get("x-grok-client-mode"), "headless");
    } finally {
      rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("reaches legacy monthly billing after every weekly failure class", async () => {
    for (const mode of ["rejection", "malformed", "non-2xx"] as const) {
      const homeDir = mkdtempSync(join(tmpdir(), `ima2-grok-${mode}-`));
      try {
        writeGrokFixture(homeDir, {
          "https://auth.x.ai::client": {
            key: "xai-token",
            auth_mode: "oidc",
            oidc_issuer: "https://auth.x.ai",
            user_id: "xai-user",
          },
        });
        globalThis.fetch = (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith("/billing?format=credits")) {
            if (mode === "rejection") throw new DOMException("timeout", "TimeoutError");
            if (mode === "malformed") return new Response("{", { status: 200 });
            return Response.json({ error: "unavailable" }, { status: 503 });
          }
          if (url.endsWith("/billing")) {
            return Response.json({
              config: {
                monthlyLimit: { val: 10_000 },
                used: { val: 2_500 },
                billingPeriodEnd: "2026-08-01T00:00:00Z",
              },
            });
          }
          if (url.endsWith("/user")) return Response.json({ email: "legacy@example.test" });
          return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const result = await fetchGrokBilling(homeDir);
        assert.deepStrictEqual(result.windows, [{
          label: "monthly",
          percent: 25,
          resetsAt: "2026-08-01T00:00:00Z",
        }], mode);
        assert.deepStrictEqual(result.billing, { usedUsd: 25, limitUsd: 100 }, mode);
      } finally {
        rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it("skips weekly and uses legacy billing when user ID or client version is missing", async () => {
    for (const mode of ["missing-user-id", "missing-version"] as const) {
      const homeDir = mkdtempSync(join(tmpdir(), `ima2-grok-${mode}-`));
      try {
        writeGrokFixture(homeDir, {
          "https://auth.x.ai::client": {
            key: "xai-token",
            auth_mode: "oidc",
            oidc_issuer: "https://auth.x.ai",
            ...(mode === "missing-user-id" ? {} : { user_id: "xai-user" }),
          },
        }, mode === "missing-version" ? null : "0.2.101");
        const seen: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
          const url = String(input);
          seen.push(url);
          if (url.endsWith("/billing")) {
            return Response.json({
              config: {
                monthlyLimit: { val: 10_000 },
                used: { val: 2_500 },
                billingPeriodEnd: "2026-08-01T00:00:00Z",
              },
            });
          }
          if (url.endsWith("/user")) return Response.json({});
          return new Response("not found", { status: 404 });
        }) as typeof fetch;

        const binary = mode === "missing-version" ? "definitely-missing-grok-test-binary" : "grok";
        const preflight = inspectGrokWeeklyEligibility(homeDir, binary);
        assert.strictEqual(preflight.eligible, false, mode);
        assert.strictEqual(preflight.reason, mode === "missing-version" ? "no-version" : "missing-user-id", mode);
        const result = await fetchGrokBilling(homeDir, binary);
        assert.strictEqual(result.windows[0]?.label, "monthly", mode);
        assert.ok(!seen.some((url) => url.includes("format=credits")), mode);
      } finally {
        rmSync(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });
});
