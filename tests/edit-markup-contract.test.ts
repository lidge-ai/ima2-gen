import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, type RouteHarness } from "./_executionRouteHarness.ts";
import { imagesJson } from "./_oauthNativeFixture.ts";

const BASE = { prompt: "Remove the circled lamp. Do not draw the red circle.", quality: "medium",
  size: "1024x1024", webSearchEnabled: false };

async function png(width: number, height: number, alpha: number): Promise<string> {
  return (await sharp({ create: { width, height, channels: 4, background: { r: 220, g: 20, b: 20, alpha } } })
    .png().toBuffer()).toString("base64");
}

/** A transparent layer with one opaque red stroke: the shape a canvas markup export has. */
async function markupLayer(width: number, height: number): Promise<string> {
  const stroke = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } })
    .png().toBuffer();
  return (await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: stroke, left: 1, top: 1 }]).png().toBuffer()).toString("base64");
}

if (executionTestProcess(import.meta.url)) describe("markup-guided edit contract", { concurrency: false }, () => {
  let harness: RouteHarness;
  let source: string;
  let markup: string;
  before(async () => {
    harness = await openRouteHarness();
    source = await png(8, 8, 1);
    markup = await markupLayer(8, 8);
  });
  after(async () => { await harness?.close(); });

  for (const imageToolModel of ["gpt-image-2.6-flare", "gpt-image-2.5-sunburst"]) {
    it(`${imageToolModel} sends markup to /v1/images/edits with the first image`, async () => {
      await harness.run("edit", { upstream: () => imagesJson(source) }, async (f) => {
        const response = await f.post({ ...BASE, provider: "api", imageToolModel, image: source, markup });
        assert.equal(response.status, 200);
        await f.waitSettled();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0]!.url, "https://api.openai.com/v1/images/edits");
        const body = JSON.parse(f.calls[0]!.body);
        assert.equal(body.model, imageToolModel);
        assert.equal(body.prompt.includes("circled lamp"), true);
        assert.equal(body.images.length, 1);
        assert.equal(body.markup.image_url, `data:image/png;base64,${markup}`);
        assert.equal(body.mask, undefined);
      });
    });
  }

  const rejected: Array<[string, () => Promise<Record<string, unknown>>, string]> = [
    ["markup with mask", async () => ({ provider: "api", imageToolModel: "gpt-image-2.6-flare", markup, mask: markup }), "EDIT_MARKUP_WITH_MASK"],
    ["GPT OAuth lane", async () => ({ provider: "oauth", markup }), "EDIT_MARKUP_UNSUPPORTED"],
    ["API lane without an image model", async () => ({ provider: "api", markup }), "EDIT_MARKUP_UNSUPPORTED"],
    ["a flattened (opaque) layer", async () => ({ provider: "api", imageToolModel: "gpt-image-2.6-flare", markup: await png(8, 8, 1) }), "EDIT_MARKUP_NO_TRANSPARENCY"],
    ["a size mismatch", async () => ({ provider: "api", imageToolModel: "gpt-image-2.6-flare", markup: await markupLayer(16, 8) }), "EDIT_MARKUP_DIMENSION_MISMATCH"],
    ["a JPEG layer", async () => ({ provider: "api", imageToolModel: "gpt-image-2.6-flare",
      markup: (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).jpeg().toBuffer()).toString("base64") }), "INVALID_EDIT_MARKUP_PNG"],
    ["a non-string", async () => ({ provider: "api", imageToolModel: "gpt-image-2.6-flare", markup: 42 }), "INVALID_EDIT_MARKUP"],
  ];
  for (const [label, body, code] of rejected) {
    it(`rejects ${label} before upstream with ${code}`, async () => {
      await harness.run("edit", { upstream: () => { throw new Error("Unexpected upstream"); } }, async (f) => {
        const response = await f.post({ ...BASE, image: source, ...(await body()) });
        assert.equal(response.status, 400);
        const result = await response.json();
        assert.equal(result.code ?? result.error?.code, code);
        await f.waitSettled();
        assert.equal(f.calls.length, 0);
      });
    });
  }
});
