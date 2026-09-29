import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { registerGenerateRoutes } from "../routes/generate.ts";
import { subscribe, _resetForTest as resetEventBus } from "../lib/eventBus.js";
import { _resetForTests as resetInflight } from "../lib/inflight.js";

const FINAL_B64 = Buffer.from("classic async image").toString("base64");

let originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetEventBus();
  resetInflight();
});

function sseResponse(events: unknown[]): Response {
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

function imageEvents(): unknown[] {
  return [
    {
      type: "response.output_item.done",
      item: { type: "image_generation_call", result: FINAL_B64, revised_prompt: "classic revised" },
    },
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ];
}

async function withGenerateApp(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), "ima2-classic-async-"));
  const generatedDir = join(rootDir, "generated");
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerGenerateRoutes(app, {
    rootDir,
    apiKey: "sk-test",
    config: {
      ...config,
      storage: { ...config.storage, generatedDir },
      log: { ...config.log, level: "silent" },
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
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("/api/generate async mode returns before upstream completion and publishes done", async () => {
  resetEventBus();
  resetInflight();

  let releaseUpstream: (() => void) | null = null;
  const upstreamEntered = new Promise<void>((resolve) => {
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      resolve();
      await new Promise<void>((release) => { releaseUpstream = release; });
      return sseResponse(imageEvents());
    };
  });

  const doneEvent = new Promise<Record<string, unknown>>((resolve) => {
    subscribe((ev) => {
      if (ev.jobId === "classic_async_req" && ev.event === "done") resolve(ev.data);
    });
  });

  await withGenerateApp(async (baseUrl) => {
    const startedAt = Date.now();
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "classic async route",
        provider: "api",
        requestId: "classic_async_req",
        async: true,
      }),
    });
    const accepted = await res.json() as { requestId?: string; async?: boolean };
    assert.equal(res.status, 202);
    assert.equal(accepted.requestId, "classic_async_req");
    assert.equal(accepted.async, true);
    assert.ok(Date.now() - startedAt < 1000, "async POST must not wait for upstream image completion");

    await upstreamEntered;
    releaseUpstream?.();
    const done = await doneEvent;
    assert.equal(done.requestId, "classic_async_req");
    assert.equal(done.provider, "api");
    assert.equal(typeof done.image, "string");
    assert.equal(done.filename && typeof done.filename === "string", true);
  });
});
