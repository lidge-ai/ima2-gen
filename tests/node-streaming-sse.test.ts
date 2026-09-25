import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { registerNodeRoutes } from "../routes/nodes.ts";

const FINAL_B64 = Buffer.from("final").toString("base64");

// GPT OAuth plans on /v1/responses (an image_gen function call) and renders on /v1/images/*.
function writePlannerSse(res, prompts: string[]) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  for (const [index, prompt] of prompts.entries()) {
    res.write(
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: { type: "function_call", call_id: `call_${index}`, name: "image_gen", arguments: JSON.stringify({ prompt }) },
      })}\n\n`,
    );
  }
  res.write(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: { usage: { total_tokens: 7 } },
    })}\n\n`,
  );
  res.end();
}

describe("Node route SSE streaming", () => {
  let rootDir;
  let oauthServer;
  let appServer;
  let baseUrl;
  let oauthBodies = [];
  let renderCalls = 0;

  before(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "ima2-node-stream-"));
    await mkdir(join(rootDir, "generated"), { recursive: true });

    const oauthApp = express();
    oauthApp.use(express.json({ limit: "2mb" }));
    oauthApp.post("/v1/responses", (req, res) => {
      oauthBodies.push(req.body);
      const text = JSON.stringify(req.body?.input ?? "");
      writePlannerSse(res, text.includes("empty ref node") ? [] : ["revised"]);
    });
    oauthApp.post(["/v1/images/generations", "/v1/images/edits"], (_req, res) => {
      renderCalls++;
      res.json({ data: [{ b64_json: FINAL_B64 }], usage: { total_tokens: 3 } });
    });
    await new Promise((resolve) => {
      oauthServer = oauthApp.listen(0, "127.0.0.1", resolve);
    });
    const oauthAddress = oauthServer.address();

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerNodeRoutes(app, {
      rootDir,
      oauthUrl: `http://127.0.0.1:${oauthAddress.port}`,
      config: {
        oauth: { validModeration: new Set(["auto", "low"]) },
        storage: { generatedDir: join(rootDir, "generated") },
      },
    });
    await new Promise((resolve) => {
      appServer = app.listen(0, "127.0.0.1", resolve);
    });
    const appAddress = appServer.address();
    baseUrl = `http://127.0.0.1:${appAddress.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      appServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      oauthServer.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(rootDir, { recursive: true, force: true });
  });

  it("streams phase and final node events for root generation, without partial frames", async () => {
    oauthBodies = [];
    renderCalls = 0;
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        parentNodeId: null,
        prompt: "stream a node",
        quality: "medium",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        requestId: "req_stream",
        sessionId: "s_1",
        clientNodeId: "nc_1",
      }),
    });

    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
    assert.match(text, /event: phase/);
    assert.match(text, /event: done/);
    // The Images API has no partial frames, so GPT OAuth streams only real results.
    assert.doesNotMatch(text, /event: partial/);
    assert.equal(oauthBodies.length, 1);
    assert.equal(oauthBodies[0].stream, true);
    assert.equal(renderCalls, 1);
  });

  it("keeps the JSON fallback path final-only", async () => {
    oauthBodies = [];
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: null,
        prompt: "json node",
        quality: "medium",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        requestId: "req_json",
        sessionId: "s_1",
        clientNodeId: "nc_2",
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.requestId, "req_json");
    assert.match(body.image, /^data:image\/png;base64,/);
    assert.equal(body.revisedPrompt, "revised");
    assert.deepEqual(oauthBodies[0].tools.map((tool) => tool.name ?? tool.type), ["web_search", "image_gen"]);
  });

  it("retries an empty plan once and never renders for image-input node requests", async () => {
    oauthBodies = [];
    renderCalls = 0;
    const ref = Buffer.from("ref").toString("base64");
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: null,
        prompt: "empty ref node",
        quality: "medium",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        requestId: "req_ref_empty_once",
        sessionId: "s_1",
        clientNodeId: "nc_ref_once",
        references: [ref],
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 422);
    assert.equal(oauthBodies.length, 2);
    assert.equal(renderCalls, 0);
    assert.equal(body.error.code, "EMPTY_RESPONSE");
  });
});
