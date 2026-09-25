import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse, type RouteHarness } from "./_executionRouteHarness.ts";
import { imagesJson, plannerSse } from "./_oauthNativeFixture.ts";

const BASE = { prompt: "Image tool selection fixture", model: "gpt-5.4", quality: "high",
  size: "1024x1024", webSearchEnabled: false, sizeNudge: false };
const MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"];
const SURFACES = ["classic", "edit", "node", "multimode"] as const;

if (executionTestProcess(import.meta.url)) describe("API image tool model contract", { concurrency: false }, () => {
  let harness: RouteHarness;
  let source: string;
  before(async () => {
    harness = await openRouteHarness();
    source = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#456789" } })
      .png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });
  const success = () => responsesSse([
    { type: "response.output_item.done", item: { type: "image_generation_call", result: source } },
    { type: "response.completed", response: {} },
  ]);
  // GPT OAuth plans with GPT-6 on /v1/responses and renders with gpt-image-2 on /v1/images/*.
  const oauthSuccess = (call: { url: string }) => (
    call.url.endsWith("/v1/responses") ? plannerSse(["fixture plan"]) : imagesJson(source)
  );
  const renderFields = async (call: { url: string; headers: Headers; body: string }) => {
    if (call.url.endsWith("/v1/images/generations")) return JSON.parse(call.body) as Record<string, unknown>;
    const form = await new Request(call.url, { method: "POST", headers: call.headers, body: call.body }).formData();
    const fields: Record<string, unknown> = {};
    form.forEach((value, key) => { if (key !== "image") fields[key] = value; });
    return fields;
  };

  for (const surface of SURFACES) for (const [index, imageToolModel] of MODELS.entries()) {
    it(`${surface} serializes ${imageToolModel} without replacing the reasoning model`, async () => {
      const quality = index === 0 ? "xhigh" : "max";
      await harness.run(surface, { upstream: success }, async (f) => {
        const response = await f.post({ ...BASE, provider: "api", imageToolModel, quality,
          ...(surface === "edit" ? { image: source } : {}),
          ...(surface === "multimode" ? { async: true, maxImages: 1 } : {}) });
        assert.equal(response.status, surface === "multimode" ? 202 : 200);
        const result = surface === "multimode" ? (await f.waitTerminal()).data : await response.json();
        await f.waitSettled();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0]!.url, "https://api.openai.com/v1/responses");
        const body = JSON.parse(f.calls[0]!.body);
        assert.equal(body.model, "gpt-5.4");
        assert.deepEqual(body.tools, [{ type: "image_generation", model: imageToolModel,
          quality, size: "1024x1024", moderation: "low" }]);
        assert.equal(result.imageToolModel, imageToolModel);
        const image = surface === "multimode" ? f.events.find((event) => event.event === "image")!.data : result;
        const saved = JSON.parse(await readFile(join(f.generatedDir, `${image.filename}.json`), "utf8"));
        assert.equal(saved.imageToolModel, imageToolModel);
        assert.equal(saved.quality, quality);
        assert.equal(saved.model, "gpt-5.4");
        const { readEmbeddedImageMetadataFromFile } = await import("../lib/imageMetadataStore.ts");
        const embedded = await readEmbeddedImageMetadataFromFile(join(f.generatedDir, image.filename));
        // Edit preserves the upstream bytes and records metadata in its sidecar.
        if (surface === "edit") assert.equal(embedded.metadata, null);
        else {
          assert.equal(embedded.metadata!.imageToolModel, imageToolModel);
          assert.equal(embedded.metadata!.quality, quality);
        }
        const { listHistoryRows } = await import("../lib/historyList.ts");
        const history = await listHistoryRows(f.generatedDir);
        assert.equal(history[0]!.imageToolModel, imageToolModel);
      });
    });
  }

  for (const surface of SURFACES) {
    it(`${surface} rejects invalid API image tool models before upstream`, async () => {
      await harness.run(surface, { upstream: () => { throw new Error("Unexpected upstream"); } }, async (f) => {
        for (const imageToolModel of ["gpt-image-2.5", "gpt-5.4", 25, {}]) {
          const response = await f.post({ ...BASE, provider: "api", imageToolModel,
            ...(surface === "multimode" ? { async: true } : {}),
            ...(surface === "edit" ? { image: source } : {}) });
          assert.equal(response.status, 400);
          const result = await response.json();
          assert.equal(result.code ?? result.error?.code, "INVALID_IMAGE_TOOL_MODEL");
        }
        await f.waitSettled();
        assert.equal(f.calls.length, 0);
      });
    });
  }

  for (const provider of ["api", "oauth"] as const) for (const quality of ["low", "medium", "high", "xhigh", "max"]) {
    it(`${provider} default tool preserves legacy quality scope: ${quality}`, async () => {
      await harness.run("classic", { upstream: provider === "oauth" ? oauthSuccess : success }, async (f) => {
        const response = await f.post({ ...BASE, provider, quality,
          ...(provider === "oauth" ? { imageToolModel: MODELS[0] } : {}) });
        assert.equal(response.status, 200);
        const result = await response.json();
        await f.waitSettled();
        const expected = quality === "xhigh" || quality === "max" ? "medium" : quality;
        assert.equal(result.quality, expected);
        assert.equal(result.imageToolModel, undefined);
        if (provider === "oauth") {
          // The stale API tool model never reaches GPT OAuth; the legacy id plans on its GPT-6 tier.
          assert.equal(JSON.parse(f.calls[0]!.body).model, "gpt-6-luna");
          const render = await renderFields(f.calls[1]!);
          assert.equal(render.model, "gpt-image-2");
          assert.equal(render.quality, expected);
          return;
        }
        const body = JSON.parse(f.calls[0]!.body);
        assert.equal(body.model, "gpt-5.4");
        assert.deepEqual(body.tools, [{ type: "image_generation", quality: expected,
          size: "1024x1024", moderation: "low" }]);
      });
    });
  }

  it("direct adapters omit tool model and absent quality on legacy API/OAuth calls", async () => {
    const isApi = (call: { url: string }) => new URL(call.url).host === "api.openai.com";
    await harness.run("classic", { upstream: (call) => (isApi(call) ? success() : oauthSuccess(call)) }, async (f) => {
      const { generateViaResponses, editViaResponses } = await import("../lib/responsesImageAdapter.ts");
      for (const provider of ["api", "oauth"]) {
        const options = { model: "gpt-5.4", webSearchEnabled: false };
        await generateViaResponses(provider, "fixture", undefined, "1024x1024", "low", [], null, "auto", f.ctx, options);
        await editViaResponses(provider, "fixture", source, undefined, "1024x1024", "low", "auto", f.ctx, null, options);
      }
      const api = f.calls.filter(isApi);
      assert.equal(api.length, 2);
      for (const call of api) {
        const body = JSON.parse(call.body);
        assert.equal(body.model, "gpt-5.4");
        assert.deepEqual(body.tools, [{ type: "image_generation", size: "1024x1024", moderation: "low" }]);
      }
      const renders = f.calls.filter((call) => /\/v1\/images\//.test(call.url));
      assert.equal(renders.length, 2);
      for (const call of renders) {
        assert.deepEqual(await renderFields(call), { model: "gpt-image-2", prompt: "fixture plan", size: "1024x1024", moderation: "low",
          ...(call.url.endsWith("/generations") ? { n: 1 } : {}) });
      }
    });
  });

  it("non-API provider options ignore even stale invalid tool selections", async () => {
    const { resolveProviderOptions } = await import("../lib/providerOptions.ts");
    const { normalizeOAuthParams } = await import("../lib/oauthNormalize.ts");
    for (const provider of ["oauth", "grok", "grok-api", "agy", "gemini-api", "minimax", "nai", "atlascloud"]) {
      const options = resolveProviderOptions(null, { provider, rawImageToolModel: "stale-tool-model" });
      assert.equal(options.error, undefined);
      assert.equal(options.imageToolModel, undefined);
      assert.equal(normalizeOAuthParams({ provider, imageToolModel: MODELS[0], quality: "max" }).quality, "medium");
    }
  });

  it("capabilities separate API tool models and scoped quality from legacy quality", async () => {
    const { buildIma2Capabilities } = await import("../lib/capabilities.ts");
    const result = buildIma2Capabilities({ packageVersion: "fixture", source: "local" });
    assert.deepEqual(result.valid.imageToolModels, {
      api: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"],
      qualities: ["low", "medium", "high", "xhigh", "max"],
    });
    assert.deepEqual(result.valid.quality, ["low", "medium", "high"]);
  });
});
