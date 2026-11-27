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
    assert.deepEqual(ambiguous.body.quote, { state: "range", min: 0.01, max: 0.2, unit: "image", quantity: 1 });
    // Without a count, one image is priced.
    const { count: _count, ...noCount } = image;
    assert.equal((await estimate(base, { ...noCount, priceVariant: "1K · low" })).body.quantity, 1);
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
    // Without a length, the route's default clip (5 s when it offers it) is priced.
    const defaulted = await estimate(base, video);
    assert.equal(defaulted.status, 200);
    assert.equal(defaulted.body.quantity, 5);
    assert.equal(defaulted.body.usd, 0.25);
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

test("an estimate carries no binary-fraction error and still rounds a real fraction of a hundredth of a cent up", async () => {
  const { estimateMediaJob } = await import("../lib/providers/media/estimate.ts");
  const { MediaKeySnapshot } = await import("../lib/providers/media/credentials.ts");
  const one = (usd: number, unit: "image" | "second") => [{ unit, usd, ...priceSource }];
  const registry = new MediaRegistry([makeFakeAdapter({ models: [
    fakeSpec("acme/still-7", { kind: "image", tasks: ["text-to-image"], params: {}, pricing: one(0.07, "image") }),
    fakeSpec("acme/still-tiny", { kind: "image", tasks: ["text-to-image"], params: {}, pricing: one(0.00011, "image") }),
    fakeSpec("acme/clip-10c", { pricing: one(0.1, "second") }),
    fakeSpec("acme/clip-third", { pricing: one(0.0333, "second") }),
  ] })]);
  const keys = new MediaKeySnapshot({ env: {}, fileConfig: {} });
  const usd = (body: Record<string, unknown>) => estimateMediaJob(registry, keys, body as never).usd;
  assert.equal(usd({ model: "acme/still-7", task: "text-to-image", inputs: [], count: 1 }), 0.07, "0.07 x 1 is 0.07, not 0.0701");
  assert.equal(usd({ model: "acme/clip-10c", task: "text-to-video", inputs: [], durationSec: 3 }), 0.3, "0.1 x 3 is 0.3, not 0.3001");
  assert.equal(usd({ model: "acme/still-7", task: "text-to-image", inputs: [], count: 3 }), 0.21);
  assert.equal(usd({ model: "acme/still-tiny", task: "text-to-image", inputs: [], count: 1 }), 0.0002, "a real 0.00011 still rounds up");
  assert.equal(usd({ model: "acme/clip-third", task: "text-to-video", inputs: [], durationSec: 5 }), 0.1665);
});

test("the estimate picks the price row from the request: quality, resolution, sound and length", async () => {
  const { estimateMediaJob } = await import("../lib/providers/media/estimate.ts");
  const { MediaKeySnapshot } = await import("../lib/providers/media/credentials.ts");
  const row = (unit: "image" | "second" | "megapixel", usd: number, variant?: string) => ({ unit, usd, ...(variant ? { variant } : {}), ...priceSource });
  const registry = new MediaRegistry([makeFakeAdapter({ models: [
    fakeSpec("acme/graded", { kind: "image", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "2K"], qualities: ["low", "medium", "high"] }, pricing: [
      row("image", 0.006, "1K · low"), row("image", 0.0528, "1K · medium"), row("image", 0.2108, "1K · high"),
      row("image", 0.006, "2K · low"), row("image", 0.1, "2K · medium"), row("image", 0.4, "2K · high")] }),
    fakeSpec("acme/sound", { params: { durationsSec: [4, 8], resolutions: ["720p"], nativeAudio: true }, pricing: [row("second", 0.1, "720p without audio"), row("second", 0.15, "720p with audio")] }),
    fakeSpec("acme/no-lengths", { params: {}, pricing: [row("second", 0.1)] }),
    fakeSpec("acme/by-area", { kind: "image", tasks: ["text-to-image"], params: {}, pricing: [row("megapixel", 0.03, "output MP")] }),
  ] })]);
  const keys = new MediaKeySnapshot({ env: {}, fileConfig: {} });
  const estimate = (body: Record<string, unknown>) => estimateMediaJob(registry, keys, { inputs: [], ...body } as never);
  const graded = { model: "acme/graded", task: "text-to-image" };
  // The CLI case: a quality and nothing else. Every "low" row costs the same, so that is the price.
  const low = estimate({ ...graded, quality: "low" });
  assert.deepEqual([low.usd, low.quantity, low.unit, low.note], [0.006, 1, "image", undefined]);
  assert.equal(low.quote.state, "exact");
  assert.equal(estimate({ ...graded, quality: "low", count: 3 }).usd, 0.018);
  assert.equal(estimate({ ...graded, vendorOptions: { quality: "low" } }).usd, 0.006, "the older spelling of the same setting");
  assert.equal(estimate({ ...graded, quality: "high", resolution: "2K" }).usd, 0.4);
  // "high" costs different amounts at 1K and 2K: a range, not a guess.
  const high = estimate({ ...graded, quality: "high" });
  assert.equal(high.usd, null);
  assert.deepEqual(high.quote, { state: "range", min: 0.2108, max: 0.4, unit: "image", quantity: 1 });
  assert.match(high.note ?? "", /several published variants/);
  // A named row still wins, as before.
  assert.equal(estimate({ ...graded, quality: "low", priceVariant: "2K · high" }).usd, 0.4);
  assert.match(estimate({ ...graded, priceVariant: "8K" }).note ?? "", /priceVariant not found/);
  // Sound and the default clip length (the shortest when 5 s is not offered).
  assert.deepEqual([estimate({ model: "acme/sound", task: "text-to-video" }).usd, estimate({ model: "acme/sound", task: "text-to-video" }).quantity], [0.4, 4]);
  assert.equal(estimate({ model: "acme/sound", task: "text-to-video", audio: true, durationSec: 8 }).usd, 1.2);
  const noLength = estimate({ model: "acme/no-lengths", task: "text-to-video" });
  assert.deepEqual([noLength.usd, noLength.quantity], [null, null]);
  assert.match(noLength.note ?? "", /quantity unknown/);
  const area = estimate({ model: "acme/by-area", task: "text-to-image" });
  assert.deepEqual([area.usd, area.quote], [null, { state: "usage", unit: "megapixel" }]);
  assert.match(area.note ?? "", /megapixel/);
});
