import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { normalizeImageModel } from "../lib/imageModels.ts";
import { registerNodeRoutes } from "../routes/nodes.ts";

describe("image model normalization", () => {
  it("defaults to gpt-6-luna without route config", () => {
    assert.deepEqual(normalizeImageModel({}, undefined), { model: "gpt-6-luna" });
  });

  it("accepts the GPT-6 trio on GPT OAuth", () => {
    for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]) {
      assert.deepEqual(normalizeImageModel({}, model), { model });
    }
  });

  it("maps legacy GPT OAuth ids to their GPT-6 tier and leaves the API-key lane alone", () => {
    const legacy = {
      "gpt-5.6-sol": "gpt-6-sol",
      "gpt-5.6-luna": "gpt-6-luna",
      "gpt-5.6-terra": "gpt-6-luna",
      "gpt-5.5": "gpt-6-luna",
      "gpt-5.4": "gpt-6-luna",
      "gpt-5.4-mini": "gpt-6-luna",
    };
    for (const [from, to] of Object.entries(legacy)) {
      assert.deepEqual(normalizeImageModel({}, from), { model: to }, `oauth ${from}`);
      assert.deepEqual(normalizeImageModel({}, from, "api"), { model: from }, `api ${from}`);
    }
  });

  it("accepts gpt-6-astra without moving the default off gpt-6-luna", () => {
    assert.deepEqual(normalizeImageModel({}, "gpt-6-astra"), { model: "gpt-6-astra" });
    assert.deepEqual(normalizeImageModel({}, undefined), { model: "gpt-6-luna" });
    assert.deepEqual(normalizeImageModel({}, undefined, "api"), { model: "gpt-5.6-luna" });
  });

  // Short aliases are a CLI concern: bin/lib/model-aliases.ts resolves them
  // before the request is sent. The server takes canonical ids only, and astra
  // is rejected here exactly like luna, sol and terra are.
  it("rejects short aliases on the server, astra included", () => {
    for (const alias of ["astra", "luna", "sol", "terra"]) {
      assert.equal(normalizeImageModel({}, alias).code, "INVALID_IMAGE_MODEL", `alias ${alias} must not resolve server-side`);
    }
  });

  it("rejects the retired Spark model as an unknown id", () => {
    const result = normalizeImageModel({}, "gpt-5.3-codex-spark");
    assert.equal(result.code, "INVALID_IMAGE_MODEL");
    assert.equal(result.status, 400);
  });

  it("rejects unknown models", () => {
    const result = normalizeImageModel({}, "bad-model");
    assert.equal(result.code, "INVALID_IMAGE_MODEL");
    assert.equal(result.status, 400);
  });
});

describe("node route image model validation", () => {
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
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("rejects Spark before OAuth", async () => {
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "small blue glass fish",
        moderation: "low",
        model: "gpt-5.3-codex-spark",
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "INVALID_IMAGE_MODEL");
  });

  it("rejects unknown models before OAuth", async () => {
    const res = await fetch(`${baseUrl}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "small blue glass fish",
        moderation: "low",
        model: "bad-model",
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "INVALID_IMAGE_MODEL");
  });
});
