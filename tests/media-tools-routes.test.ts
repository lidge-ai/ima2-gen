// Route contract for the media tool catalog and informational estimates.
// All provider calls are intercepted; HTTP requests stay on loopback.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const configDir = await mkdtemp(join(tmpdir(), "ima2-tools-config-"));
process.env.IMA2_CONFIG_DIR = configDir;

const { config } = await import("../config.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { WORKFLOWS } = await import("../lib/workflows/index.ts");
const { registerMediaRoutes } = await import("../routes/media.ts");
const { registerMediaToolRoutes } = await import("../routes/mediaTools.ts");
const { FAKE_KEY, fakeSpec, fakeTransport, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");

test.after(async () => {
  await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const image = { model: "acme/still-1", task: "text-to-image", count: 1 };
const video = { model: "acme/clip-1", task: "text-to-video" };
const priceSource = { source: "https://example.com/pricing", checkedAt: "2026-11-26" };

async function withApp(
  run: (base: string, calls: { url: string }[]) => Promise<void>,
  options: { keyed?: boolean; mediaFirst?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "ima2-tools-routes-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify(options.keyed === false ? {} : { fakeApiKey: FAKE_KEY }));
  const adapter = makeFakeAdapter({ models: [
    fakeSpec("acme/still-1", { kind: "image", tasks: ["text-to-image"], params: {}, pricing: [
      { unit: "image", usd: 0.01, variant: "1K · low", ...priceSource },
      { unit: "image", usd: 0.2, variant: "1K · high", ...priceSource },
    ] }),
    fakeSpec("acme/clip-1", { pricing: [{ unit: "second", usd: 0.05, ...priceSource }] }),
  ] });
  const registry = new MediaRegistry([adapter]);
  const transport = fakeTransport();
  const deps = { registry, env: {}, fetch: transport.fetch, thumbnails: false };
  const ctx = { rootDir: root, packageVersion: "test", config: { ...config, storage: {
    ...config.storage, configFile, configDir: root, generatedDir: join(root, "generated"),
  }, log: { ...config.log, level: "silent" } } };
  const app = express();
  app.use(express.json());
  if (options.mediaFirst) registerMediaRoutes(app, ctx, deps);
  registerMediaToolRoutes(app, ctx, { deps });
  if (!options.mediaFirst) registerMediaRoutes(app, ctx, deps);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, transport.calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function estimate(base: string, body: object) {
  const response = await fetch(`${base}/api/media/estimate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("tools route publishes version 1 and all 14 descriptors", async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/api/media/tools`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.version, 1);
    assert.equal(body.tools.length, 14);
    assert.deepEqual(body.tools.map((tool: { name: string }) => tool.name), [
      "media_catalog", "media_keys_status", "media_estimate", "media_submit", "media_job_status",
      "media_wait", "media_jobs", "media_cancel", "media_result", "media_history",
      "workflow_list", "workflow_schema", "workflow_estimate", "workflow_run",
    ]);
  });
});

test("workflow schema route resolves a real workflow and returns a structured 404", async () => {
  await withApp(async (base) => {
    const def = WORKFLOWS.find((workflow) => workflow.id === "remix-restyle");
    assert.ok(def);
    const response = await fetch(`${base}/api/workflows/remix-restyle/schema`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, def.id);
    assert.equal(body.label, def.label);
    assert.equal(body.schema.type, "object");
    assert.equal(body.schema.additionalProperties, false);
    assert.deepEqual(Object.keys(body.schema.properties).sort(), def.fields.map((field) => field.name).sort());
    assert.deepEqual((body.schema.required ?? []).slice().sort(), def.fields.filter((field) => field.required).map((field) => field.name).sort());

    const missing = await fetch(`${base}/api/workflows/no-such-workflow/schema`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      ok: false, code: "WORKFLOW_UNKNOWN", error: "Unknown workflow: no-such-workflow",
      status: 404, category: "not-found", retryable: false,
    });
  });
});

test("estimate prices the selected image variant and leaves ambiguous prices unknown", async () => {
  await withApp(async (base, calls) => {
    const selected = await estimate(base, { ...image, priceVariant: "1K · low" });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.model, image.model);
    assert.equal(selected.body.adapter, "fake");
    assert.equal(selected.body.hasKey, true);
    assert.equal(selected.body.unit, "image");
    assert.equal(selected.body.quantity, 1);
    assert.equal(selected.body.usd, 0.01);
    assert.deepEqual(selected.body.prices.map((price: { variant: string }) => price.variant), ["1K · low", "1K · high"]);
    const ambiguous = await estimate(base, image);
    assert.equal(ambiguous.status, 200);
    assert.equal(ambiguous.body.usd, null);
    assert.match(ambiguous.body.note, /several published variants/);
    assert.deepEqual(calls, [], "estimation must not call a provider");
  });
});

test("estimate uses video seconds and reports missing duration", async () => {
  await withApp(async (base) => {
    const known = await estimate(base, { ...video, durationSec: 5 });
    assert.equal(known.status, 200);
    assert.equal(known.body.unit, "second");
    assert.equal(known.body.quantity, 5);
    assert.equal(known.body.usd, 0.25);
    const unknown = await estimate(base, video);
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.quantity, null);
    assert.equal(unknown.body.usd, null);
    assert.match(unknown.body.note, /quantity unknown/);
  });
});

test("estimate works without a key and reports unknown models as not found", async () => {
  await withApp(async (base, calls) => {
    const missingKey = await estimate(base, { ...image, priceVariant: "1K · low" });
    assert.equal(missingKey.status, 200);
    assert.equal(missingKey.body.hasKey, false);
    assert.equal(missingKey.body.usd, 0.01);
    const missingModel = await estimate(base, { ...image, model: "unknown/model" });
    assert.equal(missingModel.status, 404);
    assert.equal(missingModel.body.code, "MEDIA_MODEL_UNKNOWN");
    assert.equal(missingModel.body.category, "not-found");
    assert.deepEqual(calls, []);
  }, { keyed: false });
});

test("estimate routing coexists with media submission and cancellation in either registration order", async () => {
  for (const mediaFirst of [false, true]) {
    await withApp(async (base, calls) => {
      const result = await estimate(base, { ...image, priceVariant: "1K · low" });
      assert.equal(result.status, 200);
      assert.equal(result.body.usd, 0.01);
      assert.equal(result.body.unit, "image");
      assert.equal(result.body.quantity, 1);
      assert.equal(result.body.ok, undefined, "must not reach the cancel handler");
      assert.deepEqual(calls, [], "must not reach the media submit handler");
    }, { mediaFirst });
  }
});
