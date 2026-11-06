import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, type RouteHarness } from "./_executionRouteHarness.ts";

const BASE = { prompt: "A blue ball bouncing once, seamless loop", quality: "low", size: "512x512",
  webSearchEnabled: false, provider: "api", imageToolModel: "gpt-image-2.6-flare", format: "gif" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } });

if (executionTestProcess(import.meta.url)) describe("GIF output contract", { concurrency: false }, () => {
  let harness: RouteHarness;
  let gif: string;
  before(async () => {
    harness = await openRouteHarness();
    gif = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2255ff" } }).gif().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  it("requests a GIF from /v1/images/generations and saves the upstream bytes as .gif", async () => {
    await harness.run("classic", { upstream: () => json({ data: [{ b64_json: gif }], output_format: "gif" }) }, async (f) => {
      const response = await f.post({ ...BASE, frameCount: 4, frameDurationMs: 120 });
      assert.equal(response.status, 200);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0]!.url, "https://api.openai.com/v1/images/generations");
      const body = JSON.parse(f.calls[0]!.body);
      assert.equal(body.output_format, "gif");
      assert.equal(body.frame_count, 4);
      assert.equal(body.frame_duration_ms, 120);
      assert.equal(body.model, "gpt-image-2.6-flare");
      assert.equal(result.image.startsWith("data:image/gif;base64,"), true);
      assert.match(result.filename, /\.gif$/);
      const saved = await readFile(join(f.generatedDir, result.filename));
      assert.equal(saved.toString("base64"), gif);
      const sidecar = JSON.parse(await readFile(join(f.generatedDir, `${result.filename}.json`), "utf8"));
      assert.equal(sidecar.format, "gif");
      assert.deepEqual(sidecar.animation, { frameCount: 4, frameDurationMs: 120 });
      const { listHistoryRows } = await import("../lib/historyList.ts");
      const row = (await listHistoryRows(f.generatedDir)).find((entry) => entry.filename === result.filename);
      assert.equal(row?.format, "gif");
      assert.deepEqual(row?.animation, { frameCount: 4, frameDurationMs: 120 });
    });
  });

  it("omits frame fields it was not given and ignores IMA2_API_IMAGE_TRANSPORT=responses", async () => {
    await harness.run("classic", { upstream: () => json({ data: [{ b64_json: gif }] }) }, async (f) => {
      const apiProvider = f.ctx.config.apiProvider as { imageTransport?: string };
      const previous = apiProvider.imageTransport;
      apiProvider.imageTransport = "responses";
      try {
        const response = await f.post(BASE);
        assert.equal(response.status, 200);
        await f.waitSettled();
      } finally {
        apiProvider.imageTransport = previous;
      }
      const body = JSON.parse(f.calls[0]!.body);
      assert.equal(f.calls[0]!.url, "https://api.openai.com/v1/images/generations");
      assert.equal(body.output_format, "gif");
      assert.equal("frame_count" in body, false);
      assert.equal("frame_duration_ms" in body, false);
    });
  });

  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ["GPT OAuth", { provider: "oauth", imageToolModel: undefined }, "GIF_OUTPUT_UNSUPPORTED"],
    ["a 2.5 model", { imageToolModel: "gpt-image-2.5-flare" }, "GIF_OUTPUT_UNSUPPORTED"],
    ["the default API tool model", { imageToolModel: undefined }, "GIF_OUTPUT_UNSUPPORTED"],
    ["1 frame", { frameCount: 1 }, "INVALID_GIF_FRAME_COUNT"],
    ["17 frames", { frameCount: 17 }, "INVALID_GIF_FRAME_COUNT"],
    ["2.5 frames", { frameCount: 2.5 }, "INVALID_GIF_FRAME_COUNT"],
    ["a 10 ms frame", { frameDurationMs: 10 }, "INVALID_GIF_FRAME_DURATION"],
    ["frame options on a PNG", { format: "png", frameCount: 4 }, "GIF_OPTIONS_WITHOUT_GIF"],
  ];
  for (const [label, patch, code] of rejected) {
    it(`rejects ${label} with ${code} before upstream`, async () => {
      await harness.run("classic", { upstream: () => { throw new Error("Unexpected upstream"); } }, async (f) => {
        const response = await f.post({ ...BASE, ...patch });
        assert.equal(response.status, 400);
        const result = await response.json();
        assert.equal(result.code ?? result.error?.code, code);
        await f.waitSettled();
        assert.equal(f.calls.length, 0);
      });
    });
  }

  it("an organization without the GIF preview gets IMAGE_FEATURE_NOT_ENABLED naming GIF output", async () => {
    const gated = () => json({ error: { message: "GIF output is not enabled for this organization.",
      type: "invalid_request_error", param: "output_format", code: null } }, 400);
    await harness.run("classic", { upstream: gated }, async (f) => {
      const response = await f.post(BASE);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(response.status, 400);
      assert.equal(result.code ?? result.error?.code, "IMAGE_FEATURE_NOT_ENABLED");
      assert.match(JSON.stringify(result), /has not enabled GIF output/);
      assert.equal(f.calls.length, 1);
    });
  });
});
