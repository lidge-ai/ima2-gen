import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptFetchAssignmentsForNativeOAuth } from "./_oauthNativeFixture.ts";

// GPT OAuth plans then renders; keep this file's one-call image fixtures (see the helper).
adaptFetchAssignmentsForNativeOAuth();

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-ref-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerAgentRoutes } = await import("../routes/agent.ts");
const db = await import("../lib/db.ts");
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });
after(() => { db.closeDb(); rmSync(TEST_DIR, { recursive: true, force: true }); });

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

async function pngB64() {
  return (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#334455" } }).png().toBuffer()).toString("base64");
}

async function withApp(fn: (baseUrl: string, generatedDir: string) => Promise<void>) {
  const generatedDir = join(TEST_DIR, `generated-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerAgentRoutes(app, {
    apiKey: "sk-test",
    config: { storage: { generatedDir }, log: { level: "silent" } },
    packageVersion: "test",
  } as never);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as import("node:net").AddressInfo).port;
  try { await fn(`http://127.0.0.1:${port}`, generatedDir); }
  finally { await new Promise<void>((r) => server.close(() => r())); }
}

async function createSession(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  return await res.json() as { selectedSessionId: string };
}

/** The composer uses the QUEUE, not /turns: only the queue plans a sourceImagePolicy. */
async function enqueue(baseUrl: string, sessionId: string, prompt: string) {
  await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, provider: "api" }),
  });
  await new Promise((r) => setTimeout(r, 1500));
}

async function queueFor(baseUrl: string, sessionId: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`);
  return (await res.json() as { queue: Array<Record<string, unknown>> }).queue;
}

describe("Agent image reference forwarding (issue #192)", () => {
  it("forwards the session image to the Responses branch when the user asks for an edit", async () => {
    // The regression: atlascloud/minimax/grok forwarded the session image but the
    // Responses branch passed []. On the default OAuth/API path the model was asked
    // to edit an image it could not see, answered in prose, and that message-only
    // stream classified as a retryable no-image result - surfacing as the generic
    // "did not include an image artifact" error.
    const finalImage = await pngB64();
    const bodies: string[] = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return (originalFetch as never as (a: unknown, b: unknown) => Promise<Response>)(url, init);
      }
      bodies.push(String((init as { body?: unknown } | undefined)?.body ?? ""));
      return sseResponse([
        { type: "response.output_item.done", item: { type: "image_generation_call", result: finalImage } },
        { type: "response.completed", response: { usage: { total_tokens: 1 } } },
      ]);
    }) as never;

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      await enqueue(baseUrl, created.selectedSessionId, "a red apple");
      bodies.length = 0;
      await enqueue(baseUrl, created.selectedSessionId, "이 이미지를 패션 화보 스타일로 수정해줘");
      assert.ok(bodies.length > 0, "the edit turn must reach the provider");
      assert.match(bodies.join("\n"), /input_image/, "the session image must be attached as an input_image part");
    });
  });

  it("does not attach the previous image to an unrelated fresh generation", async () => {
    // The inverse defect, and the reason the video path has its own contract test:
    // welding the previous image onto every prompt is worse than dropping it.
    const finalImage = await pngB64();
    const bodies: string[] = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return (originalFetch as never as (a: unknown, b: unknown) => Promise<Response>)(url, init);
      }
      bodies.push(String((init as { body?: unknown } | undefined)?.body ?? ""));
      return sseResponse([
        { type: "response.output_item.done", item: { type: "image_generation_call", result: finalImage } },
        { type: "response.completed", response: { usage: { total_tokens: 1 } } },
      ]);
    }) as never;

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      await enqueue(baseUrl, created.selectedSessionId, "a red apple");
      bodies.length = 0;
      await enqueue(baseUrl, created.selectedSessionId, "a completely different mountain landscape");
      assert.ok(bodies.length > 0, "the second turn must reach the provider");
      assert.equal(/input_image/.test(bodies.join("\n")), false, "a fresh generation must not inherit the previous image");
    });
  });

  it("guards an empty provider payload before it becomes a zero-byte artifact", async () => {
    // agy (:373-393) and atlascloud (:181-183) can RESOLVE with an empty b64 on a
    // 0-byte artifact or 0-byte HTTP 200 body; persistAgentImage would then write a
    // 0-byte file and register it as a real image. The Responses branch cannot
    // exercise this - it self-guards at responsesImageAdapter.ts:344 - so the guard
    // is asserted at the choke point that actually owns it.
    const source = readFileSync("lib/agentImageVideoGen.ts", "utf8");
    const guard = source.slice(source.indexOf("if (!response.b64)"));
    assert.ok(source.includes("if (!response.b64)"), "the empty-payload guard must exist");
    assert.match(guard.slice(0, 700), /PROVIDER_EMPTY_IMAGE/);
    assert.ok(
      source.indexOf("if (!response.b64)") < source.indexOf("const image = await persistAgentImage("),
      "the guard must run BEFORE persistAgentImage, or the 0-byte file is already written",
    );

    // And the code must be retryable + renderable, not a dead end.
    const runtime = readFileSync("lib/agentRuntime.ts", "utf8");
    assert.match(runtime, /"PROVIDER_EMPTY_IMAGE",/, "an empty payload is transient; it must be retried once");
    const uiCodes = readFileSync("ui/src/lib/errorCodes.ts", "utf8");
    assert.match(uiCodes, /PROVIDER_EMPTY_IMAGE: \{ surface: "card"/, "an unregistered code degrades to the generic UNKNOWN card");
  });

  it("preserves the underlying cause on the queue path the composer reads", async () => {
    // The direct /turns route already returned rawCode, but the composer reads the
    // QUEUE, and failAgentQueueItem had no column for it - so the user only ever saw
    // the generic wrapper code.
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return (originalFetch as never as (a: unknown, b: unknown) => Promise<Response>)(url, init);
      }
      return sseResponse([
        { type: "response.output_item.done", item: { type: "image_generation_call", status: "failed" } },
        { type: "response.completed", response: { usage: { total_tokens: 1 } } },
      ]);
    }) as never;

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      await enqueue(baseUrl, created.selectedSessionId, "draw something");
      const failed = (await queueFor(baseUrl, created.selectedSessionId)).find((item) => item.status === "failed");
      assert.ok(failed, "the turn must fail");
      assert.equal(failed.errorCode, "AGENT_TEXT_ONLY_RESULT");
      assert.equal(failed.errorRawCode, "IMAGE_TOOL_FAILED", "the queue row must keep the real cause");
    });
  });
});
