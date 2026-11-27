import "./helpers/isolatedConfig.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import sharp from "sharp";
import { editViaOAuth, generateViaOAuth, parseOpenAIErrorBody } from "../lib/oauthProxy.ts";

test("OAuth non-ok responses do not expose raw upstream body in logs or errors", async () => {
  const privateText = "private prompt text from upstream body";
  const server = createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: privateText } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));

  try {
    await assert.rejects(
      generateViaOAuth("safe test", "medium", "1024x1024", "low", [], "req_safe", "auto", {
        oauthUrl: `http://127.0.0.1:${port}`,
      }),
      (err) => {
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).message, "OAuth proxy returned 500");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).status, 500);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).code, "OAUTH_UPSTREAM_ERROR");
        assert.ok(!(err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).message.includes(privateText));
        return true;
      },
    );
    assert.ok(!logs.join("\n").includes(privateText));
  } finally {
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("OAuth 400 validation JSON preserves actionable metadata", async () => {
  const upstream = {
    error: {
      message: "Invalid size '512x512'. Requested resolution is below the current minimum pixel budget.",
      type: "invalid_request_error",
      param: "tools[0].size",
      code: "invalid_value",
    },
  };
  const server = createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(upstream));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;

  try {
    await assert.rejects(
      generateViaOAuth("safe test", "medium", "512x512", "low", [], "req_invalid", "auto", {
        oauthUrl: `http://127.0.0.1:${port}`,
      }),
      (err) => {
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).message, upstream.error.message);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).status, 400);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).code, "INVALID_REQUEST");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).upstreamCode, "invalid_value");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).upstreamType, "invalid_request_error");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).upstreamParam, "tools[0].size");
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("generateViaOAuth labels reference inputs with detected MIME", async () => {
  let requestBody = "";
  const server = createServer((req, res) => {
    req.on("data", (chunk) => {
      requestBody += chunk;
    });
    req.on("end", () => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stop", type: "invalid_request_error", code: "invalid_value" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

  try {
    await assert.rejects(
      generateViaOAuth("safe test", "medium", "1024x1024", "low", [jpegB64], "req_mime", "auto", {
        oauthUrl: `http://127.0.0.1:${port}`,
      }),
      /stop/,
    );
    const body = JSON.parse(requestBody);
    assert.equal(body.tool_choice, "required");
    assert.match(requestBody, /data:image\/jpeg;base64/);
    assert.doesNotMatch(requestBody, /data:image\/png;base64/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("generateViaOAuth no-image stream retry keeps reference images", async () => {
  const bodies: string[] = [];
  const imageB64 = Buffer.from("retry image").toString("base64");
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      bodies.push(raw);
      if (bodies.length === 1) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end("data: {\"type\":\"response.completed\"}\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        output: [{ type: "image_generation_call", result: imageB64 }],
        usage: { total_tokens: 3 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

  try {
    const result = await generateViaOAuth("safe test", "medium", "1024x1024", "low", [jpegB64], "req_retry_refs", "auto", {
      oauthUrl: `http://127.0.0.1:${port}`,
    }) as {
      b64: string;
      retryKind?: string;
      hadReferences?: boolean;
      referencesDroppedOnRetry?: boolean;
      developerPromptDroppedOnRetry?: boolean;
    };
    assert.equal(result.b64, imageB64);
    assert.equal(result.retryKind, "references_json_image_tool");
    assert.equal(result.hadReferences, true);
    assert.equal(result.referencesDroppedOnRetry, false);
    assert.equal(result.developerPromptDroppedOnRetry, true);
    assert.equal(bodies.length, 2);
    const retryBody = JSON.parse(bodies[1]);
    assert.equal(retryBody.stream, false);
    assert.equal(retryBody.input.length, 1);
    assert.equal(retryBody.input[0].role, "user");
    const retryContent = retryBody.input[0].content;
    assert.ok(Array.isArray(retryContent), "retry user content keeps reference parts");
    assert.equal(retryContent[0].type, "input_image");
    assert.match(retryContent[0].image_url, /^data:image\/jpeg;base64,/);
    assert.equal(retryContent[retryContent.length - 1].type, "input_text");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("editViaOAuth no-image stream preserves empty response metadata", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("data: {\"type\":\"response.completed\"}\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: "#334455",
    },
  }).png().toBuffer();

  try {
    await assert.rejects(
      editViaOAuth("safe edit", png.toString("base64"), "medium", "3840x2160", "low", "auto", {
        oauthUrl: `http://127.0.0.1:${port}`,
      }, "req_edit_empty"),
      (err) => {
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).eventCount, 1);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).size, "3840x2160");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).quality, "medium");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).refsCount, 0);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).inputImageCount, 1);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).parentImagePresent, true);
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("generateViaOAuth times out a stalled image stream", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: {\"type\":\"response.created\"}\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;

  try {
    await assert.rejects(
      generateViaOAuth("safe test", "medium", "1024x1024", "low", [], "req_timeout", "auto", {
        oauthUrl: `http://127.0.0.1:${port}`,
        config: { oauth: { generationTimeoutMs: 25 } },
      }),
      (err) => {
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).message, "OAuth image generation timed out");
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).status, 504);
        assert.equal((err as { message?: string; status?: number; code?: string; upstreamCode?: string; upstreamType?: string; upstreamParam?: string; eventCount?: number; size?: string; quality?: string; refsCount?: number; inputImageCount?: number; parentImagePresent?: boolean }).code, "OAUTH_IMAGE_TIMEOUT");
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("OpenAI error body parser ignores malformed and preserves fields", () => {
  assert.equal(parseOpenAIErrorBody("not json"), null);
  assert.deepEqual(
    parseOpenAIErrorBody(JSON.stringify({
      error: {
        message: "Invalid request",
        type: "invalid_request_error",
        param: "size",
        code: "invalid_value",
      },
    })),
    {
      message: "Invalid request",
      type: "invalid_request_error",
      param: "size",
      code: "invalid_value",
    },
  );
});
