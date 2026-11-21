import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, type UpstreamCall } from "./_executionRouteHarness.ts";

// A retired Grok image id (-quality, -pro) is xAI's 2.0 at low quality. A caller that names
// the retired id without a quality must still reach 2.0 + low through every image route,
// not the routes' generic "medium" default (PR #434 final review #4, plan R1-F1/R2-F2).
const KEY = "xai-retired-quality";
const ARTIFACT = "https://fixture.invalid/retired.png";
const RETIRED = "grok-imagine-image-quality";

if (executionTestProcess(import.meta.url)) describe("retired Grok image ids keep their low default on every route", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof openRouteHarness>>;
  let png: string;
  before(async () => {
    harness = await openRouteHarness();
    png = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2367ab" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  function upstream(call: UpstreamCall): Response {
    if (call.method === "GET") return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    if (call.url.endsWith("/chat/completions")) {
      return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "planned" }) } }] } }] });
    }
    return Response.json({ data: [{ url: ARTIFACT }] });
  }

  async function imagePayloads(surface: "classic" | "node" | "multimode" | "edit", body: Record<string, unknown>, grokDefault?: string) {
    let payloads: Record<string, unknown>[] = [];
    await harness.run(surface, { context: { xaiApiKey: KEY }, upstream }, async (fixture) => {
      if (grokDefault) fixture.ctx.config = { ...fixture.ctx.config, grokProvider: { ...fixture.ctx.config.grokProvider, defaultImageModel: grokDefault } };
      const response = await fixture.post({ provider: "grok-api", prompt: "retired fixture", image: png, n: 1, maxImages: 1,
        webSearchEnabled: false, searchMode: "off", async: surface === "classic" || surface === "multimode", ...body });
      assert.equal(response.status, surface === "edit" || surface === "node" ? 200 : 202, await response.clone().text());
      if (surface === "classic" || surface === "multimode") assert.equal((await fixture.waitTerminal()).event, "done");
      await fixture.waitSettled();
      payloads = fixture.calls.filter((call) => /\/images\//.test(call.url)).map((call) => JSON.parse(call.body));
    });
    assert.ok(payloads.length > 0, "an image request reached xAI");
    return payloads;
  }

  for (const surface of ["classic", "node", "multimode", "edit"] as const) {
    it(`${surface}: a retired id without quality sends 2.0 + low`, async () => {
      for (const payload of await imagePayloads(surface, { model: RETIRED })) {
        assert.equal(payload.model, "grok-imagine-image-2.0");
        assert.equal(payload.quality, "low");
      }
    });
    it(`${surface}: an explicit quality still wins for a retired id`, async () => {
      for (const payload of await imagePayloads(surface, { model: RETIRED, quality: "medium" })) {
        assert.equal(payload.model, "grok-imagine-image-2.0");
        assert.equal(payload.quality, "medium");
      }
    });
  }

  it("classic: a retired saved config default without quality sends 2.0 + low", async () => {
    for (const payload of await imagePayloads("classic", {}, RETIRED)) {
      assert.equal(payload.model, "grok-imagine-image-2.0");
      assert.equal(payload.quality, "low");
    }
  });

  for (const surface of ["classic", "edit"] as const) {
    it(`${surface}: native 2.0 without quality sends auto; the base model sends no quality`, async () => {
      for (const payload of await imagePayloads(surface, { model: "grok-imagine-image-2.0" })) assert.equal(payload.quality, "auto");
      for (const payload of await imagePayloads(surface, { model: "grok-imagine-image" })) assert.equal("quality" in payload, false);
    });
  }
});
