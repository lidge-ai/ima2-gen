import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptFetchAssignmentsForNativeOAuth } from "./_oauthNativeFixture.ts";

// GPT OAuth plans then renders; keep this file's one-call image fixtures (see the helper).
adaptFetchAssignmentsForNativeOAuth();

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-parallel-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerAgentRoutes } = await import("../routes/agent.ts");
const { _resetForTests } = await import("../lib/inflight.ts");
const db = await import("../lib/db.ts");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetForTests();
});

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

async function pngB64() {
  const buffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: "#884466",
    },
  }).png().toBuffer();
  return buffer.toString("base64");
}

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const generatedDir = join(TEST_DIR, `generated-${Date.now()}`);
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerAgentRoutes(app, {
    apiKey: "sk-test",
    config: {
      storage: { generatedDir },
      log: { level: "silent" },
      agentPlanner: { enabled: false },
    },
    packageVersion: "test",
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createSession(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "parallel contract" }),
  });
  assert.equal(res.status, 201);
  return await res.json() as { selectedSessionId: string };
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("Agent Mode parallel generation contract", () => {
  it("runs fanout prompts with bounded per-item parallelism and returns every image handle", async () => {
    const finalImage = await pngB64();
    let active = 0;
    let maxActive = 0;
    let upstreamHits = 0;

    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      JSON.parse(String(init?.body));
      upstreamHits++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--;
      return sseResponse([
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: finalImage, revised_prompt: `parallel ${upstreamHits}` },
        },
        { type: "response.completed", response: { usage: { total_tokens: 2 } } },
      ]);
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const sessionId = created.selectedSessionId;
      const queued = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "make three bounded variants",
          options: {
            provider: "api",
            variants: 3,
            parallelism: 2,
          },
        }),
      });
      const queuedBody = await queued.json() as any;
      assert.equal(queued.status, 202);
      assert.equal(queuedBody.queueItem.plan.mode, "fanout");
      assert.equal(queuedBody.queueItem.plan.prompts.length, 3);
      assert.equal(queuedBody.queueItem.plan.plannedVariants, 3);
      assert.equal(queuedBody.queueItem.plan.plannedParallelism, 2);
      assert.equal(queuedBody.queueItem.plan.source, "auto-request");

      await waitFor(async () => {
        const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`);
        const queue = (await res.json() as any).queue as Array<any>;
        return queue.find((item) => item.id === queuedBody.queueItem.id && item.status === "succeeded");
      }, "parallel queue item to finish");

      const workspace = await fetch(`${baseUrl}/api/agent/sessions?selectedSessionId=${sessionId}`);
      const payload = await workspace.json() as any;
      const assistantTurns = payload.turnsBySession[sessionId].filter((turn: any) => turn.role === "assistant");

      assert.equal(upstreamHits, 3);
      assert.equal(maxActive, 2);
      assert.ok(Object.keys(payload.imagesById).length >= 3);
      assert.ok(assistantTurns.some((turn: any) => turn.imageIds?.length === 3));
    });
  });
});
