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

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-queue-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerAgentRoutes } = await import("../routes/agent.ts");
const { listJobs, listTerminalJobs, _resetForTests } = await import("../lib/inflight.ts");
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
      background: "#446688",
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
    body: JSON.stringify({ title: "queue contract" }),
  });
  assert.equal(res.status, 201);
  return await res.json() as { selectedSessionId: string };
}

async function enqueue(baseUrl: string, sessionId: string, prompt: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, options: { provider: "api" } }),
  });
  assert.equal(res.status, 202);
  return await res.json() as any;
}

async function queueFor(baseUrl: string, sessionId: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`);
  assert.equal(res.status, 200);
  return (await res.json() as any).queue as Array<any>;
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

describe("Agent Mode queue contract", () => {
  it("keeps queue state durable, session-scoped, cancelable, retryable, and mirrored to inflight", async () => {
    const finalImage = await pngB64();
    let upstreamHits = 0;
    let releaseFirst: () => void = () => {};
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(sseResponse([
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: finalImage, revised_prompt: "queued first" },
        },
        { type: "response.completed", response: { usage: { total_tokens: 3 } } },
      ]));
    });

    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      upstreamHits++;
      if (upstreamHits === 1) {
        return await Promise.race([
          firstResponse,
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }),
        ]);
      }
      return sseResponse([
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: finalImage, revised_prompt: "queued retry" },
        },
        { type: "response.completed", response: { usage: { total_tokens: 4 } } },
      ]);
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const sessionId = created.selectedSessionId;
      const first = await enqueue(baseUrl, sessionId, "hold first queue item");

      const running = await waitFor(async () => {
        const queue = await queueFor(baseUrl, sessionId);
        return queue.find((item) => item.id === first.queueItem.id && item.status === "running");
      }, "first queue item to run");
      assert.equal(typeof running.startedAt, "number");
      assert.equal(running.progressStage, "requesting");

      assert.ok(listJobs({ kind: "agent_queue", sessionId }).some((job) => (
        job.requestId === first.queueItem.requestId
      )));

      const canceledRunning = await fetch(`${baseUrl}/api/agent/queue/${first.queueItem.id}/cancel`, { method: "POST" });
      const canceledRunningBody = await canceledRunning.json() as any;
      assert.equal(canceledRunning.status, 200);
      assert.equal(
        canceledRunningBody.queueBySession[sessionId].find((item: any) => item.id === first.queueItem.id).status,
        "canceled",
      );
      assert.equal(
        canceledRunningBody.queueBySession[sessionId].find((item: any) => item.id === first.queueItem.id).errorMessage,
        "Canceled by user",
      );

      const second = await enqueue(baseUrl, sessionId, "complete second queue item");
      assert.equal(second.workspace.selectedSessionId, sessionId);
      assert.ok(second.workspace.queueBySession[sessionId].some((item: any) => item.id === second.queueItem.id));

      releaseFirst();
      await waitFor(async () => {
        const queue = await queueFor(baseUrl, sessionId);
        return queue.find((item) => item.id === second.queueItem.id && item.status === "succeeded");
      }, "second queue item to finish");

      assert.equal(listJobs({ kind: "agent_queue", sessionId }).length, 0);
      assert.ok(listTerminalJobs({ kind: "agent_queue", sessionId }).some((job) => (
        job.requestId === second.queueItem.requestId && job.status === "completed"
      )));

      const retried = await fetch(`${baseUrl}/api/agent/queue/${first.queueItem.id}/retry`, { method: "POST" });
      const retriedBody = await retried.json() as any;
      assert.equal(retried.status, 200);
      assert.equal(retriedBody.selectedSessionId, sessionId);

      await waitFor(async () => {
        const queue = await queueFor(baseUrl, sessionId);
        return queue.find((item) => item.id === first.queueItem.id && item.status === "succeeded");
      }, "retried queue item to finish");
    });
  });
});
