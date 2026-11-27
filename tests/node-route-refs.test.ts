import "./helpers/isolatedConfig.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { registerNodeRoutes } from "../routes/nodes.ts";

const VALID_B64 = "aGVsbG8=";

describe("Node route reference handling", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerNodeRoutes(app, {
      rootDir: process.cwd(),
      config: {
        oauth: { validModeration: new Set(["auto", "low"]) },
        storage: { generatedDir: process.cwd() },
      },
    });
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("allows child node requests to pass reference validation before parent loading", async () => {
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: "parent_1",
        prompt: "try this as an edit",
        references: [VALID_B64],
        moderation: "low",
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 404);
    assert.notStrictEqual(body.error.code, "NODE_REFS_UNSUPPORTED_FOR_EDIT");
    assert.strictEqual(body.error.code, "NODE_NOT_FOUND");
    assert.strictEqual(body.parentNodeId, "parent_1");
  });

  it("keeps malformed reference validation ahead of parent loading", async () => {
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: "parent_1",
        prompt: "try this as an edit",
        references: "not-an-array",
        moderation: "low",
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error.code, "REF_NOT_ARRAY");
    assert.strictEqual(body.code, "REF_NOT_ARRAY");
  });
});
