import test from "node:test";
import assert from "node:assert/strict";
import { parseStream } from "../lib/responsesParse.ts";

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

test("Responses stream parser records sanitized no-image diagnostics", async () => {
  const res = sseResponse([
    { type: "response.output_item.done", item: { type: "web_search_call", status: "completed" } },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        status: "completed",
        content: [{ type: "output_text", text: "No image was produced." }],
      },
    },
    { type: "response.completed", response: { usage: { total_tokens: 12 } } },
  ]);

  const parsed = await parseStream(res, { scope: "test-responses-parse", maxImages: 1 });

  assert.equal(parsed.images.length, 0);
  assert.equal(parsed.webSearchCalls, 1);
  assert.equal(parsed.text, "No image was produced.");
  assert.equal(parsed.diagnostics.imageCallSeen, false);
  assert.equal(parsed.diagnostics.messageOutputSeen, true);
  assert.equal(parsed.diagnostics.webSearchCallSeen, true);
  assert.equal(parsed.diagnostics.outputItemSummary.length, 2);
  assert.equal(parsed.diagnostics.outputItemSummary[0].itemType, "web_search_call");
  assert.equal(parsed.diagnostics.outputItemSummary[0].resultChars, 0);
  assert.ok(parsed.diagnostics.streamStats.bytesRead > 0);
  assert.equal(parsed.diagnostics.streamStats.sawResponseCompleted, true);
  assert.equal(parsed.eventTypes["response.output_item.done"], 2);
});

test("Responses stream parser accepts CRLF and data lines without a space", async () => {
  const body = [
    'data:{"type":"response.image_generation_call.partial_image","partial_image_b64":"abc","partial_image_index":2}',
    "",
    'data:{"type":"response.completed","response":{"output":[{"type":"image_generation_call","status":"completed","result":"final-b64"}]}}',
    "",
    "data:[DONE]",
    "",
    "",
  ].join("\r\n");
  const partials: Array<{ b64: string; index: number | null | undefined }> = [];

  const parsed = await parseStream(rawSseResponse(body), {
    scope: "test-responses-parse-crlf",
    maxImages: 1,
    onPartialImage: (partial) => partials.push(partial),
  });

  assert.deepEqual(partials, [{ b64: "abc", index: 2 }]);
  assert.equal(parsed.images[0]?.b64, "final-b64");
  assert.equal(parsed.diagnostics.streamStats.crlfBoundaryCount, 3);
  assert.equal(parsed.diagnostics.streamStats.sawDoneSentinel, true);
  assert.equal(parsed.diagnostics.streamStats.sawResponseCompleted, true);
});

test("Responses diagnostics redact untrusted provider labels", async () => {
  const res = sseResponse([
    {
      type: "response.output_item.done sk-SECRET http://user:pass@example.test 고양이",
      item: { type: "message" },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "message sk-SECRET",
        status: "completed http://user:pass@example.test",
        result: "not-output-to-diagnostics",
        revised_prompt: "do not expose",
        error: {
          code: "sk-SECRET",
          type: "bearer TOKEN",
          param: "data:image/png;base64,abc",
        },
      },
    },
  ]);

  const parsed = await parseStream(res, { scope: "test-responses-parse-redaction", maxImages: 1 });
  const diagnosticsJson = JSON.stringify(parsed.diagnostics);
  const eventTypesJson = JSON.stringify(parsed.eventTypes);

  assert.doesNotMatch(diagnosticsJson, /SECRET|user:pass|data:image|고양이|bearer TOKEN/i);
  assert.doesNotMatch(eventTypesJson, /SECRET|user:pass|고양이/);
  assert.match(diagnosticsJson, /_redacted/);
  assert.match(eventTypesJson, /_redacted/);
});

test("the upstream sentence survives to the diagnostics and to the thrown error", async () => {
  // "Responses image tool call failed." la ten MINH dat cho tinh huong. Doc mot
  // minh no thi khong sua duoc gi - phai giu duoc cau upstream that su noi.
  const { emptyResponseError } = await import("../lib/responsesErrors.ts");
  const res = sseResponse([
    {
      type: "response.output_item.done",
      item: {
        type: "image_generation_call",
        status: "failed",
        error: { code: "image_generation_user_error", message: "The image could not be generated: unsupported aspect ratio." },
      },
    },
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ]);

  const parsed = await parseStream(res, { scope: "test-upstream-message", maxImages: 1 });
  assert.equal(
    parsed.diagnostics.upstreamErrorMessage,
    "The image could not be generated: unsupported aspect ratio.",
  );
  assert.equal(
    parsed.diagnostics.outputItemSummary[0]?.errorMessage,
    "The image could not be generated: unsupported aspect ratio.",
  );

  const err = emptyResponseError("no image", parsed, {});
  assert.equal(err.code, "IMAGE_TOOL_FAILED");
  // Nhan cua minh VA cau cua upstream, ca hai.
  assert.match(err.message, /Responses image tool call failed\./);
  assert.match(err.message, /unsupported aspect ratio/);
  assert.equal(err.upstreamMessage, "The image could not be generated: unsupported aspect ratio.");
});

test("an upstream sentence carrying a secret or a URL is dropped, not logged", async () => {
  // Cau nay di thang vao log va len giao dien, nen no khong duoc mang theo khoa,
  // dia chi tai anh hay dia chi thu.
  for (const doc of [
    "call failed for key sk-abcd1234efgh",
    "download failed from https://cdn.example/x.png",
    "contact someone@example.com for help",
  ]) {
    const res = sseResponse([
      {
        type: "response.output_item.done",
        item: { type: "image_generation_call", status: "failed", error: { message: doc } },
      },
      { type: "response.completed", response: {} },
    ]);
    const parsed = await parseStream(res, { scope: "test-upstream-redact", maxImages: 1 });
    assert.equal(parsed.diagnostics.upstreamErrorMessage, "_redacted", doc);
  }
});
