import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { API_REQUEST_POLICY, config } from "../config.js";
import { normalizeBodyRequestId } from "../lib/generationInputValidation.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";
import { assertLanAccessConfiguration, buildApp, isLoopbackHost } from "../server.js";

async function listen(app: ReturnType<typeof buildApp>): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("generation request IDs are normalized and bounded", () => {
  assert.equal(normalizeBodyRequestId("client_ok-1", "fallback"), "client_ok-1");
  assert.match(normalizeBodyRequestId("bad\nrequest", "fallback"), /^req_[0-9a-f-]+$/);
  assert.match(normalizeBodyRequestId("x".repeat(129), "fallback"), /^req_[0-9a-f-]+$/);
});

test("generation pipelines reject oversized prompts and counts with JSON 400", async () => {
  const ctx = createTestRuntimeContext({ config });
  const running = await listen(buildApp(ctx));
  try {
    for (const path of ["/api/generate", "/api/generate/multimode", "/api/node/generate"]) {
      const response = await fetch(`${running.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "x".repeat(32_001), async: false }),
      });
      assert.equal(response.status, 400, path);
      assert.match(response.headers.get("content-type") || "", /application\/json/);
      assert.equal((await response.json()).error.code, "PROMPT_TOO_LONG");
    }

    for (const [path, count] of [["/api/generate", { n: 0 }], ["/api/generate/multimode", { maxImages: 999 }]] as const) {
      const response = await fetch(`${running.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "valid", async: true, ...count }),
      });
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error.code, "INVALID_COUNT");
    }
  } finally {
    await running.close();
  }
});

test("non-loopback API access requires the configured LAN token", async () => {
  const lanConfig = {
    ...config,
    server: { ...config.server, host: "0.0.0.0", lanToken: "test-lan-secret", lanTokenOnLoopback: true },
  };
  const running = await listen(buildApp(createTestRuntimeContext({ config: lanConfig })));
  try {
    const denied = await fetch(`${running.base}/api/health`);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error.code, "LAN_TOKEN_REQUIRED");

    for (const path of ["/API/health", "/Api/health", "/api"]) {
      const alias = await fetch(`${running.base}${path}`);
      assert.equal(alias.status, 401, path);
      assert.equal((await alias.json()).error.code, "LAN_TOKEN_REQUIRED");
    }
    const notApi = await fetch(`${running.base}/apix/health`);
    assert.notEqual(notApi.status, 401);
    const callbackPost = await fetch(`${running.base}/api/mcp/oauth/callback`, { method: "POST" });
    assert.equal(callbackPost.status, 401);
    for (const path of ["/api/mcp/oauth/callback", "/API/MCP/OAUTH/CALLBACK"]) {
      const callbackGet = await fetch(`${running.base}${path}`);
      assert.notEqual(callbackGet.status, 401, path);
      assert.equal(callbackGet.status, 400, "missing OAuth state fails before any exchange");
    }

    const headerAllowed = await fetch(`${running.base}/api/health`, {
      headers: { "x-ima2-token": "test-lan-secret" },
    });
    assert.notEqual(headerAllowed.status, 401);

    const queryAllowed = await fetch(`${running.base}/api/health?token=test-lan-secret`);
    assert.notEqual(queryAllowed.status, 401);

    const staticResponse = await fetch(`${running.base}/`);
    assert.notEqual(staticResponse.status, 401);
  } finally {
    await running.close();
  }
});

test("real app rejects exhausted mutation allowance before JSON parsing", async () => {
  const localConfig = { ...config, server: { ...config.server, host: "127.0.0.1" } };
  const running = await listen(buildApp(createTestRuntimeContext({ config: localConfig })));
  try {
    for (let i = 0; i < API_REQUEST_POLICY.mutations; i++) {
      const response = await fetch(`${running.base}/api/__budget_probe`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      assert.equal(response.status, 404);
      await response.arrayBuffer();
    }
    const denied = await fetch(`${running.base}/api/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{invalid-json",
    });
    assert.equal(denied.status, 429, "parser would return400 if admission ran after it");
    assert.equal((await denied.json()).error.code, "API_RATE_LIMITED");
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    const read = await fetch(`${running.base}/api/health`);
    assert.equal(read.status, 200, "read allowance remains available");
    await read.arrayBuffer();
  } finally { await running.close(); }
});

test("LAN binding is rejected before listen without explicit token opt-in", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.doesNotThrow(() => assertLanAccessConfiguration("127.0.0.1", undefined));
  assert.doesNotThrow(() => assertLanAccessConfiguration("0.0.0.0", "explicit-token"));
  assert.throws(
    () => assertLanAccessConfiguration("0.0.0.0", ""),
    { message: "[server.security] Set a nonempty IMA2_LAN_TOKEN of at most 4096 UTF-8 bytes to enable LAN access." },
  );
});
