import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { generateViaResponses } from "../lib/responsesImageAdapter.ts";

function testContext(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      ...config,
      oauth: {
        ...config.oauth,
        generationTimeoutMs: 100,
        statusTimeoutMs: 100,
      },
      log: { ...config.log, level: "silent" },
    },
    ...overrides,
  };
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function rawSseResponse(body: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function expectNoImageCode(eventsOrBody: unknown[] | string, code: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => typeof eventsOrBody === "string"
    ? rawSseResponse(eventsOrBody)
    : sseResponse(eventsOrBody)) as typeof fetch;
  try {
    await assert.rejects(
      () => generateViaResponses(
        "api",
        "cat",
        "low",
        "1024x1024",
        "low",
        [],
        null,
        "auto",
        testContext({ apiKey: "sk-test" }),
        { webSearchEnabled: false },
      ),
      (err: any) => {
        assert.equal(err.code, code);
        assert.equal(err.status, 422);
        assert.equal(err.diagnosticReason, code.toLowerCase());
        assert.ok(err.responseDiagnostics);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Responses no-image outcomes classify into specific diagnostic codes", async () => {
  await expectNoImageCode("data: {not json}\n\n", "STREAM_PARSE_FAILED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "web_search_call", status: "completed" } },
    { type: "response.completed", response: { output: [] } },
  ], "WEB_SEARCH_ONLY_RESPONSE");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "text only" }] } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_NOT_CALLED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "image_generation_call", status: "failed", error: { code: "tool_failed" } } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_FAILED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "image_generation_call", status: "completed" } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT");
});

// GPT OAuth no longer runs the Responses image tool, so its no-image retry and prompt-only
// fallback paths are gone; tests/oauth-image-lane-contract.test.ts pins the plan-retry contract.
