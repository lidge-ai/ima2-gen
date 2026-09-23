import test from "node:test";
import assert from "node:assert/strict";
import { parseStream, safeDiagnosticLabel } from "../lib/responsesParse.ts";
import { emptyResponseError } from "../lib/responsesErrors.ts";
import { errorCodeFrom, normalizeGenerationFailure } from "../lib/generationErrors.ts";
import { upstreamErrorFields } from "../lib/routeHelpers.ts";
import { finalErrorUpstreamLabels, nodeErrorDetails } from "../lib/nodeHelpers.ts";
import { configureLogger, logEvent } from "../lib/logger.ts";
import { classifyUpstreamErrorCode } from "../lib/errorClassify.ts";

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

// --- PR 256 WP3: bounded upstream labels, never upstream sentences -------------------

const SECRETS = [
  "sk-proj-abcdef123456", "sk_live_abc123def456", "xai-AbCdEf123456", "xai_AbCdEf1234567890",
  "AIzaSyA1234567890abcdef", "AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln",
  "ghp_abcdefghij1234567890", "hunter2-password-value",
];
const PROMPT = "a portrait of my neighbour Mina at her kitchen table";
const PROSE = "The image could not be generated because the request looked unusual";
const LEGIT = [
  "moderation_blocked", "content_policy_violation", "rate_limit_exceeded", "image_generation_user_error",
  "max_output_tokens", "token_expired", "input_tokens", "tools[0].size", "gpt-image-2", "invalid_api_key",
  "server_error", "insufficient_quota", "invalid_request_error", "response.output_item.done", "RESPONSES_STREAM_ERROR",
];

function assertClean(label: string, serialized: string) {
  for (const needle of [...SECRETS, PROMPT, PROSE, "hunter2", "Bearer"]) {
    assert.ok(!serialized.includes(needle), `${label} leaked ${needle}`);
  }
}

function serializeError(err: Record<string, unknown>) {
  return JSON.stringify({ ...err, message: (err as { message?: string }).message });
}

function failedImageItem(code: string, type: string, param: string) {
  return {
    type: "response.output_item.done",
    item: {
      type: "image_generation_call",
      status: "failed",
      error: { code, type, param, message: `${PROSE}. Prompt: ${PROMPT}. Bearer ${SECRETS[0]} password=hunter2` },
    },
  };
}

test("WP3 label filter keeps provider codes and redacts credential shapes", () => {
  for (const label of LEGIT) assert.equal(safeDiagnosticLabel(label), label, label);
  const shapes = [
    ...SECRETS.slice(0, 8), "Bearer abc", "password:hunter2", "api_key=abc", "secret=x",
    "abcdefghijklmnopqrstuvwxyzabcdefgh", "https://example.test/x", "two words", "x".repeat(121),
  ];
  for (const shape of shapes) assert.equal(safeDiagnosticLabel(shape), "_redacted", shape);
  // A secret straddling the old 120-character cut must not survive as a short prefix.
  assert.equal(safeDiagnosticLabel(`${"a".repeat(100)}_ABCDEF0123456789ABCDEF0123456789ABCD`), "_redacted");
  assert.equal(safeDiagnosticLabel(`${"a".repeat(112)}_AIzaSyA1234567890`), "_redacted");
  // Redaction must not change how legitimate codes classify.
  for (const code of ["invalid_api_key", "moderation_blocked", "rate_limit_exceeded"]) {
    assert.equal(classifyUpstreamErrorCode(safeDiagnosticLabel(code)), classifyUpstreamErrorCode(code), code);
  }
});

test("WP3 a failed image item carries its code and type labels to every envelope, never its sentence", async () => {
  const parsed = await parseStream(sseResponse([
    failedImageItem("moderation_blocked", "image_generation_user_error", "prompt"),
    { type: "response.completed", response: { usage: { total_tokens: 3 } } },
  ]), { scope: "test-wp3", maxImages: 1 });
  const err = emptyResponseError("Responses image tool call failed.", parsed, { provider: "api" });
  assert.equal(err.code, "IMAGE_TOOL_FAILED");
  assert.equal(err.upstreamCode, "moderation_blocked");
  assert.equal(err.upstreamType, "image_generation_user_error");
  // The diagnostic code wins; the label must not reclassify this as a moderation refusal.
  assert.equal(errorCodeFrom(err as never), "IMAGE_TOOL_FAILED");
  const normalized = normalizeGenerationFailure(err as never) as Record<string, unknown>;
  assert.equal(normalized.code, "IMAGE_TOOL_FAILED");
  const fields = upstreamErrorFields(normalized);
  assert.equal(fields.upstreamCode, "moderation_blocked");
  assert.equal(fields.upstreamType, "image_generation_user_error");
  const node = nodeErrorDetails(normalized, err as never);
  assert.equal(node.upstreamCode, "moderation_blocked");
  for (const [label, value] of [
    ["diagnostics", JSON.stringify(parsed.diagnostics)],
    ["emptyResponseError", serializeError(err as never)],
    ["normalized", serializeError(normalized)],
    ["upstreamErrorFields", JSON.stringify(fields)],
    ["nodeErrorDetails", JSON.stringify(node)],
  ] as const) assertClean(label, value);
  assert.equal(err.message, "Responses image tool call failed.");
});

test("WP3 credential-shaped codes are redacted before they reach any consumer", async () => {
  const parsed = await parseStream(sseResponse([
    failedImageItem(SECRETS[2]!, SECRETS[6]!, "password:hunter2"),
    { type: "response.completed", response: {} },
  ]), { scope: "test-wp3", maxImages: 1 });
  const err = emptyResponseError("Responses image tool call failed.", parsed, {});
  assert.equal(err.upstreamCode, "_redacted");
  assert.equal(err.upstreamType, "_redacted");
  const normalized = normalizeGenerationFailure(err as never) as Record<string, unknown>;
  assertClean("diagnostics", JSON.stringify(parsed.diagnostics));
  assertClean("normalized", serializeError(normalized));
  assertClean("upstreamErrorFields", JSON.stringify(upstreamErrorFields(normalized)));
});

test("WP3 the first coded image summary wins when the item is reported twice", async () => {
  const parsed = await parseStream(sseResponse([
    { type: "response.output_item.done", item: { type: "image_generation_call", status: "failed" } },
    { type: "response.completed", response: { output: [{ type: "image_generation_call", status: "failed", error: { code: "server_error", type: "api_error" } }] } },
  ]), { scope: "test-wp3", maxImages: 1 });
  const err = emptyResponseError("Responses image tool call failed.", parsed, {});
  assert.equal(err.upstreamCode, "server_error");
  assert.equal(err.upstreamType, "api_error");
});

test("WP3 a stream error keeps a fixed message and a label code", async () => {
  const res = sseResponse([{ type: "error", error: { code: "rate_limit_exceeded", message: `${PROSE} ${SECRETS[1]}` } }]);
  await assert.rejects(parseStream(res, { scope: "test-wp3", maxImages: 1 }), (error: Record<string, unknown>) => {
    assert.equal(error.upstreamCode, "rate_limit_exceeded");
    assert.equal(error.message, "Responses stream returned an error");
    assertClean("stream error", serializeError(error));
    return true;
  });
});

test("WP3 no-image shapes keep their stable codes without inventing an upstream code", async () => {
  const cases: Array<[string, Response]> = [
    ["EMPTY_RESPONSE", sseResponse([{ type: "response.completed", response: {} }])],
    ["STREAM_PARSE_FAILED", rawSseResponse("data: {not json\n\n")],
    ["WEB_SEARCH_ONLY_RESPONSE", sseResponse([
      { type: "response.output_item.done", item: { type: "web_search_call", status: "completed" } },
      { type: "response.completed", response: {} },
    ])],
  ];
  for (const [expected, res] of cases) {
    const parsed = await parseStream(res, { scope: "test-wp3", maxImages: 1 });
    const err = emptyResponseError("no image", parsed, {});
    assert.equal(err.code, expected);
    assert.equal(err.upstreamCode, undefined, expected);
  }
});

test("WP3 the final_error log filters raw upstream code and type from passthrough errors", () => {
  const lines: string[] = [];
  const capture = (line: string) => { lines.push(line); };
  configureLogger({ level: "info", sink: { info: capture, log: capture } as never });
  try {
    // The OAuth passthrough keeps the provider's raw code and type (lib/oauthProxy/errors.ts).
    const raw = { code: "OAUTH_UPSTREAM_ERROR", upstreamCode: `Bearer ${SECRETS[0]}`, upstreamType: SECRETS[4] };
    logEvent("node", "final_error", { finalCode: "OAUTH_UPSTREAM_ERROR", ...finalErrorUpstreamLabels(raw as never) });
    assert.deepEqual(finalErrorUpstreamLabels(raw as never), { upstreamCode: "_redacted", upstreamType: "_redacted" });
    assert.deepEqual(finalErrorUpstreamLabels({ code: "IMAGE_TOOL_FAILED" } as never), { upstreamCode: "IMAGE_TOOL_FAILED", upstreamType: null });
  } finally {
    configureLogger({});
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /final_error/);
  assertClean("final_error log", lines[0]!);
});
