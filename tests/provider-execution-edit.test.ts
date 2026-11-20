import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse } from "./_executionRouteHarness.ts";

if (executionTestProcess(import.meta.url)) describe("execution edit real routes", () => {
  let harness: Awaited<ReturnType<typeof openRouteHarness>>;
  let source: string;
  let mask: string;
  let output: string;
  before(async () => {
    harness = await openRouteHarness();
    source = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer()).toString("base64");
    mask = (await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer()).toString("base64");
    output = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc6600" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  it("API masked edit forwards real source/mask and selected wire options, then writes its paired sidecar", async () => {
    await harness.run("edit", {
      context: { apiKey: "sk-fixture-edit-only" },
      upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        assert.equal(call.method, "POST");
        assert.equal(call.headers.get("authorization"), "Bearer sk-fixture-edit-only");
        return responsesSse([
          { type: "response.output_item.done", item: { type: "image_generation_call", result: output, revised_prompt: "Amber edit fixture" } },
          { type: "response.completed", response: { usage: { input_tokens: 11, output_tokens: 19, total_tokens: 30 }, tool_usage: { web_search: { num_requests: 2 } } } },
        ]);
      },
    }, async (fixture) => {
      const response = await fixture.post({
        provider: "api", prompt: "Change blue to amber", image: source, mask: `data:image/png;base64,${mask}`,
        model: "gpt-6.1-terra", quality: "high", size: "1536x1024", moderation: "low",
        mode: "direct", reasoningEffort: "high", webSearchEnabled: true,
      });
      const result = await response.json();
      await fixture.waitSettled();
      assert.equal(response.status, 200);
      assert.equal(fixture.calls.length, 1);
      const wire = JSON.parse(fixture.calls[0]!.body);
      assert.equal(wire.model, "gpt-6.1-terra");
      assert.deepEqual(wire.reasoning, { effort: "high" });
      assert.deepEqual(wire.tools.map((tool: { type: string }) => tool.type), ["web_search", "image_generation"]);
      assert.equal(wire.tools[1].quality, "high");
      assert.equal(wire.tools[1].size, "1536x1024");
      assert.equal(wire.tools[1].moderation, "low");
      assert.deepEqual(wire.tool_choice, { type: "image_generation" });
      const content = wire.input[1].content;
      const inputs = content.filter((item: { type: string }) => item.type === "input_image");
      assert.equal(inputs.length, 2);
      assert.match(inputs[0].image_url, /^data:image\/jpeg;base64,/);
      const pixels = await sharp(Buffer.from(inputs[0].image_url.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
      assert.equal(pixels.info.width, 8);
      assert.equal(pixels.info.height, 8);
      for (const [index, expected] of [51, 102, 153].entries()) assert.ok(Math.abs(pixels.data[index]! - expected) <= 4);
      assert.equal(inputs[1].image_url, `data:image/png;base64,${mask}`);
      assert.ok(content.some((item: { type: string; text?: string }) => item.type === "input_text" && item.text?.includes("mask guide")));
      assert.match(content.at(-1).text, /Change blue to amber/);
      // The mask is 50% alpha everywhere, so the saved image blends source (#336699) and result (#cc6600).
      const saved = await readFile(join(fixture.generatedDir, result.filename));
      assert.equal(result.image, `data:image/png;base64,${saved.toString("base64")}`);
      const blended = await sharp(saved).raw().toBuffer({ resolveWithObject: true });
      assert.equal(blended.info.channels, 3);
      for (const [index, expected] of [127, 102, 77].entries()) assert.ok(Math.abs(blended.data[index]! - expected) <= 2, `channel ${index}`);
      assert.equal(result.provider, "api");
      assert.equal(result.model, "gpt-6.1-terra");
      assert.equal(result.revisedPrompt, "Amber edit fixture");
      assert.deepEqual(result.usage, { input_tokens: 11, output_tokens: 19, total_tokens: 30 });
      assert.equal(result.webSearchCalls, 2);
      assert.equal(result.providerUrl, null);
      assert.equal(result.promptMode, "direct");
      const sidecar = JSON.parse(await readFile(join(fixture.generatedDir, `${result.filename}.json`), "utf8"));
      for (const [field, expected] of Object.entries({ kind: "edit", provider: "api", model: "gpt-6.1-terra", quality: "high", size: "1536x1024", prompt: "Change blue to amber", userPrompt: "Change blue to amber", revisedPrompt: "Amber edit fixture", promptMode: "direct", reasoningEffort: "high", moderation: "low", webSearchCalls: 2, webSearchEnabled: true, format: "png", alphaVerified: false, alphaReason: "no-alpha-channel" })) {
        assert.deepEqual(sidecar[field], expected, field);
      }
      assert.equal(sidecar.requestId, fixture.requestId);
      assert.deepEqual(sidecar.usage, { input_tokens: 11, output_tokens: 19, total_tokens: 30 });
      assert.equal("providerUrl" in sidecar, false);
      assert.equal(sidecar.maskOutsidePreserved, true);
      assert.equal((await readdir(fixture.generatedDir)).filter((name) => name.endsWith(".json")).length, 1);
      assert.equal(fixture.events.some((event) => event.event === "partial" || event.event === "done"), false);
    });
  });

  it("direct Grok edit makes no planner/search call and preserves native URL, usage and revision", async () => {
    const providerUrl = "https://fixture.invalid/edit-result.png";
    await harness.run("edit", {
      context: { xaiApiKey: "fixture-xai-edit" },
      upstream: (call) => {
        if (call.url === providerUrl) return new Response(Buffer.from(output, "base64"), { headers: { "content-type": "image/png" } });
        assert.equal(call.url, "https://api.x.ai/v1/images/edits");
        assert.equal(call.headers.get("authorization"), "Bearer fixture-xai-edit");
        const wire = JSON.parse(call.body);
        assert.equal(wire.prompt, "Grok edit raw prompt");
        assert.equal(wire.image.url, `data:image/png;base64,${source}`);
        assert.equal(wire.n, 1);
        return Response.json({ data: [{ url: providerUrl, revised_prompt: "Native Grok revision" }], usage: { cost_in_usd_ticks: 137 } });
      },
    }, async (fixture) => {
      const response = await fixture.post({ provider: "grok-api", model: "grok-imagine-image", prompt: "Grok edit raw prompt", image: source, quality: "medium", size: "1024x1024" });
      const result = await response.json();
      await fixture.waitSettled();
      assert.equal(response.status, 200);
      assert.equal(fixture.calls.length, 2);
      assert.equal(result.providerUrl, providerUrl);
      assert.equal(result.revisedPrompt, "Native Grok revision");
      assert.deepEqual(result.usage, { grok_cost_usd_ticks: 137 });
      assert.equal(result.webSearchCalls, 0);
      const sidecar = JSON.parse(await readFile(join(fixture.generatedDir, `${result.filename}.json`), "utf8"));
      assert.equal(sidecar.providerUrl, providerUrl);
      assert.equal(sidecar.revisedPrompt, "Native Grok revision");
      assert.deepEqual(sidecar.usage, { grok_cost_usd_ticks: 137 });
    });
  });

  it("API empty edit retains error diagnostics and does not gain a retry", async () => {
    await harness.run("edit", {
      context: { apiKey: "sk-fixture-empty-edit" },
      upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        return responsesSse([
          { type: "response.output_text.done", text: "No image fixture" },
          { type: "response.completed", response: { usage: { total_tokens: 7 } } },
        ]);
      },
    }, async (fixture) => {
      const response = await fixture.post({ provider: "api", prompt: "Empty edit", image: source, model: "gpt-6.1-terra", webSearchEnabled: false });
      const result = await response.json();
      await fixture.waitSettled();
      assert.equal(response.status, 422);
      assert.equal(result.code, "IMAGE_TOOL_NOT_CALLED");
      assert.equal(result.errorEventCount, 2);
      assert.deepEqual(result.eventTypes, { "response.output_text.done": 1, "response.completed": 1 });
      assert.equal(result.responseDiagnostics.messageOutputSeen, true);
      assert.equal(result.responseDiagnostics.imageResultCount, 0);
      assert.equal(fixture.calls.length, 1);
      assert.deepEqual(await readdir(fixture.generatedDir), []);
    });
  });
});
