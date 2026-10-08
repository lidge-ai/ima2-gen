import test from "node:test";
import assert from "node:assert/strict";
import { isolateExecution } from "./_executionRouteIsolation.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("Agent preserves API88_EMPTY_RESULT and sends only one POST for a No image data excerpt", async () => {
  const isolation = await isolateExecution();
  let db: typeof import("../lib/db.ts") | undefined;
  try {
    const { config } = await import("../config.ts");
    const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
    const { generateAgentImageWithRetry } = await import("../lib/agentImageVideoGen.ts");
    db = await import("../lib/db.ts");
    const ctx = createTestRuntimeContext({ rootDir: isolation.rootDir, api88ImageKey: "synthetic-image",
      config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://agent88.example" } } });
    let posts = 0;
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://agent88.example/v1/chat/completions");
      assert.equal(init?.method, "POST"); posts++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
      assert.equal(JSON.parse(String(init?.body)).model, "gemini-3.1-flash-image");
      return Response.json({ choices: [{ message: { content: "No image data" } }] });
    }) as typeof fetch;
    await assert.rejects(() => generateAgentImageWithRetry(ctx, "synthetic-session", "bird", "context", false, {
      provider: "88api", model: "gemini-3.1-flash-image", signal: null, sourceImagePolicy: "none",
    }), (error: unknown) => error instanceof Error && error.message.includes("No image data")
      && (error as { code?: string }).code === "API88_EMPTY_RESULT");
    assert.equal(posts, 1, "the generic Agent text-only retry must never resubmit 88API");
  } finally { db?.closeDb(); await isolation.close(); }
});

test("Agent rejects untrimmed or planner model ids on 88API before any POST", async () => {
  const isolation = await isolateExecution();
  let db: typeof import("../lib/db.ts") | undefined;
  try {
    const { config } = await import("../config.ts");
    const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
    const { generateAgentImageWithRetry } = await import("../lib/agentImageVideoGen.ts");
    const { normalizeAgentGenerationSettings } = await import("../lib/agentSettings.ts");
    db = await import("../lib/db.ts");
    const ctx = createTestRuntimeContext({ rootDir: isolation.rootDir, api88ImageKey: "synthetic-image",
      config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://agent88.example" } } });
    let posts = 0;
    globalThis.fetch = (async () => { posts++; return Response.json({}); }) as typeof fetch;
    assert.equal(normalizeAgentGenerationSettings({ provider: "88api", model: " gpt-image-2 " }).model, " gpt-image-2 ");
    assert.equal(normalizeAgentGenerationSettings({ provider: "88api", model: "SD2.5 720P" }).model, "SD2.5 720P");
    const overlong = "x".repeat(300);
    assert.equal(normalizeAgentGenerationSettings({ provider: "88api", model: overlong }).model, overlong);
    for (const model of [" gpt-image-2 ", "grok-4.6"]) {
      await assert.rejects(() => generateAgentImageWithRetry(ctx, "synthetic-session", "bird", "context", false, {
        provider: "88api", model, signal: null, sourceImagePolicy: "none",
      }), (error: unknown) => typeof (error as { code?: string }).code === "string"
        && (error as { code: string }).code.startsWith("API88_"));
    }
    assert.equal(posts, 0, "an inexact or planner id must not reach 88API");
  } finally { db?.closeDb(); await isolation.close(); }
});
