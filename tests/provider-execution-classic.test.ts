import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse } from "./_executionRouteHarness.ts";

type Harness = Awaited<ReturnType<typeof openRouteHarness>>;
const apiBody = {
  provider: "api", prompt: "classic fixture", model: "gpt-6.1-terra", quality: "high",
  size: "1536x1024", moderation: "low", reasoningEffort: "high",
  webSearchEnabled: false, mode: "direct", sizeNudge: false,
};

async function png(alpha = 1): Promise<Buffer> {
  try {
    return await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 33, g: 99, b: 177, alpha } } }).png().toBuffer();
  } catch (error) { throw error; }
}

function imageResponse(bytes: Buffer): Response {
  return responsesSse([
    { type: "response.output_item.done", item: { type: "image_generation_call",
      result: bytes.toString("base64"), revised_prompt: "fixture revised" } },
    { type: "response.completed", response: { usage: { total_tokens: 7 } } },
  ]);
}

function heldResponse() {
  let release!: (response: Response) => void;
  let entered!: () => void;
  const response = new Promise<Response>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  return { response, ready, release, entered };
}

async function sidecar(dir: string, filename: unknown): Promise<Record<string, unknown>> {
  assert.equal(typeof filename, "string");
  try { return JSON.parse(await readFile(join(dir, `${filename}.json`), "utf8")); }
  catch (error) { throw error; }
}

if (executionTestProcess(import.meta.url)) {
  describe("classic real execution boundary", { concurrency: false }, () => {
    let harness: Harness;
    before(async () => { harness = await openRouteHarness(); });
    after(async () => { await harness?.close(); });

    it("E03-1 API acknowledges before final and preserves wire options, refs, sidecar and done", async () => {
      const bytes = await png();
      const ref = `data:image/png;base64,${bytes.toString("base64")}`;
      const held = heldResponse();
      await harness.run("classic", { context: { apiKey: "fixture-api-key" }, upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        assert.equal(call.method, "POST");
        assert.equal(call.headers.get("authorization"), "Bearer fixture-api-key");
        call.signal?.addEventListener("abort", () => held.release(imageResponse(bytes)), { once: true });
        held.entered();
        return held.response;
      } }, async (fixture) => {
        const response = await fixture.post({ ...apiBody, references: [ref], async: true,
          composerPrompt: "composer original", sessionId: "fixture-session", clientNodeId: "fixture-node" });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { requestId: fixture.requestId, async: true });
        await held.ready;
        assert.equal(fixture.events.some((event) => event.event === "done"), false);
        assert.deepEqual(await readdir(fixture.generatedDir), []);
        held.release(imageResponse(bytes));
        const terminal = await fixture.waitTerminal();
        await fixture.waitSettled();
        assert.equal(terminal.event, "done");
        assert.equal(fixture.calls.length, 1);
        const wire = JSON.parse(fixture.calls[0]!.body);
        assert.equal(wire.model, "gpt-6.1-terra");
        assert.deepEqual(wire.reasoning, { effort: "high" });
        assert.deepEqual(wire.tools, [{ type: "image_generation", quality: "high", size: "1536x1024", moderation: "low" }]);
        assert.deepEqual(wire.tool_choice, { type: "image_generation" });
        assert.equal(wire.stream, true);
        assert.deepEqual(wire.input[1].content[0], { type: "input_image", image_url: ref });
        assert.match(wire.input[1].content[1].text, /Generate an image with this exact prompt, no modifications: classic fixture\n/);
        assert.match(wire.input[1].content[1].text, /exactly 1536x1024 resolution/);
        assert.equal(terminal.data.provider, "api");
        assert.equal(terminal.data.providerUrl, null);
        assert.deepEqual(terminal.data.usage, { total_tokens: 7 });
        assert.equal(terminal.data.image, `data:image/png;base64,${bytes.toString("base64")}`);
        const meta = await sidecar(fixture.generatedDir, terminal.data.filename);
        for (const [key, value] of Object.entries({ kind: "classic", prompt: "classic fixture", userPrompt: "classic fixture",
          revisedPrompt: "fixture revised", promptMode: "direct", quality: "high", size: "1536x1024", format: "png",
          moderation: "low", model: "gpt-6.1-terra", reasoningEffort: "high", provider: "api", refsCount: 1,
          webSearchCalls: 0, webSearchEnabled: false, sessionId: "fixture-session", clientNodeId: "fixture-node",
          composerPrompt: "composer original", requestId: fixture.requestId })) assert.equal(meta[key], value, key);
        assert.deepEqual(meta.usage, { total_tokens: 7 });
        assert.equal(typeof meta.elapsed, "number");
        assert.equal(fixture.events.filter((event) => event.event === "done").length, 1);
      });
    });

    it("E03-2 Grok n=3 shares search/planner and uses max search aggregation", async () => {
      const bytes = await png();
      await harness.run("classic", { upstream: (call) => {
        if (call.url.endsWith("/v1/responses")) return Response.json({ output: [{ type: "message",
          content: [{ type: "output_text", text: "fixture visual brief" }] }] });
        if (call.url.endsWith("/v1/chat/completions")) return Response.json({ choices: [{ message: {
          tool_calls: [{ type: "function", function: { name: "generate_image",
            arguments: JSON.stringify({ prompt: "planned classic fixture" }) } }] } }] });
        if (call.url.endsWith("/v1/images/generations")) return Response.json({
          data: [{ url: "https://cdn.x.ai/classic-fixture.png" }], usage: { cost_in_usd_ticks: 11 } });
        assert.equal(call.url, "https://cdn.x.ai/classic-fixture.png");
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png" } });
      } }, async (fixture) => {
        const response = await fixture.post({ prompt: "grok batch", provider: "grok", model: "grok-imagine-image-quality",
          quality: "high", size: "2048x1152", n: 3, webSearchEnabled: true, sizeNudge: false });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.count, 3);
        assert.equal(body.webSearchCalls, 1);
        assert.deepEqual(body.usage, { grok_cost_usd_ticks: 33 });
        assert.equal(fixture.calls.filter((call) => call.url.endsWith("/v1/responses")).length, 1);
        assert.equal(fixture.calls.filter((call) => call.url.endsWith("/v1/chat/completions")).length, 1);
        const images = fixture.calls.filter((call) => call.url.endsWith("/v1/images/generations"));
        assert.equal(images.length, 3);
        for (const call of images) {
          const wire = JSON.parse(call.body);
          assert.equal(wire.prompt, "planned classic fixture");
          assert.equal(wire.model, "grok-imagine-image-2.0");
          assert.equal(wire.aspect_ratio, "16:9");
          assert.equal(wire.resolution, "2k");
          assert.equal("size" in wire, false);
        }
        for (const image of body.images) {
          const meta = await sidecar(fixture.generatedDir, image.filename);
          assert.equal(meta.providerUrl, "https://cdn.x.ai/classic-fixture.png");
          assert.equal(meta.revisedPrompt, "planned classic fixture");
          assert.equal(meta.model, "grok-imagine-image-2.0");
          assert.equal(meta.webSearchCalls, 1);
          assert.equal(meta.format, "png");
        }
      });
    });

    it("E03-3 API retries one transient failure and stops on hard refusal", async () => {
      const bytes = await png();
      let attempts = 0;
      await harness.run("classic", { context: { apiKey: "fixture-api-key" }, upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        return ++attempts === 1 ? Response.json({ error: { message: "fixture unavailable" } }, { status: 500 }) : imageResponse(bytes);
      } }, async (fixture) => {
        assert.equal((await fixture.post(apiBody)).status, 200);
        assert.equal(attempts, 2);
      });
      await harness.run("classic", { context: { apiKey: "fixture-api-key" }, upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        return Response.json({ error: { message: "invalid parameter", code: "invalid_request_error" } }, { status: 400 });
      } }, async (fixture) => {
        const response = await fixture.post(apiBody);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_REQUEST");
        assert.equal(fixture.calls.length, 1);
        assert.deepEqual(await readdir(fixture.generatedDir), []);
      });
    });

    it("E03-3 non-OpenAI transient failure gets no new outer retry", async () => {
      await harness.run("classic", { context: { atlasCloudApiKey: "fixture-atlas-key" }, upstream: (call) => {
        assert.ok(call.url.endsWith("/model/generateImage"));
        return Response.json({ error: "fixture unavailable" }, { status: 502 });
      } }, async (fixture) => {
        const response = await fixture.post({ prompt: "atlas failure", provider: "atlascloud", sizeNudge: false });
        assert.equal(response.status, 502);
        assert.equal((await response.json()).code, "ATLASCLOUD_GENERATE_FAILED");
        assert.equal(fixture.calls.length, 1);
      });
    });

    it("E03-5 cancellation while Responses is held suppresses retry, final save and done", async () => {
      const bytes = await png();
      const held = heldResponse();
      let signal: AbortSignal | undefined;
      await harness.run("classic", { context: { apiKey: "fixture-api-key" }, upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        signal = call.signal;
        call.signal?.addEventListener("abort", () => held.release(imageResponse(bytes)), { once: true });
        held.entered();
        return held.response;
      } }, async (fixture) => {
        assert.equal((await fixture.post({ ...apiBody, async: true })).status, 202);
        await held.ready;
        fixture.cancel();
        assert.equal(signal?.aborted, true);
        held.release(imageResponse(bytes));
        await fixture.waitSettled();
        assert.equal(fixture.calls.length, 1);
        assert.equal(fixture.events.some((event) => event.event === "done"), false);
        const terminal = await fixture.waitTerminal();
        assert.equal(terminal.event, "error");
        assert.equal(terminal.data.code, "GENERATION_CANCELED");
        assert.deepEqual(await readdir(fixture.generatedDir), []);
      });
    });

    for (const asyncMode of [true, false]) it(`E03-7 Comfy queue callback and native metadata, async=${asyncMode}`, async () => {
      const bytes = await png(0.5);
      let queueReads = 0;
      await harness.run("classic", { upstream: (call) => {
        if (call.url.endsWith("/prompt")) return Response.json({ prompt_id: "fixture-comfy-prompt", node_errors: {} });
        if (call.url.endsWith("/history/fixture-comfy-prompt")) return Response.json(queueReads < 2 ? {} : {
          "fixture-comfy-prompt": { status: { completed: true, status_str: "success" },
            outputs: { "9": { images: [{ filename: "fixture.png", type: "output", subfolder: "" }] } } } });
        if (call.url.endsWith("/queue")) return Response.json(++queueReads === 1
          ? { queue_running: [[0, "other"]], queue_pending: [[1, "fixture-comfy-prompt"]] }
          : { queue_running: [[1, "fixture-comfy-prompt"]], queue_pending: [] });
        assert.ok(call.url.startsWith("http://127.0.0.1:8188/view?"));
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg" } });
      } }, async (fixture) => {
        const { putWorkflow } = await import("../lib/comfyWorkflowStore.ts");
        const workflowId = asyncMode ? "classic-async" : "classic-sync";
        await putWorkflow({ id: workflowId, label: "Classic fixture", origin: "http://127.0.0.1:8188",
          graph: { "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
            "7": { class_type: "KSampler", inputs: { seed: 0, steps: 1 } },
            "9": { class_type: "SaveImage", inputs: { filename_prefix: "fixture" } } },
          bind: { prompt: { node: "6", input: "text" }, seed: { node: "7", input: "seed" }, output: { node: "9" } },
          params: [{ name: "steps", node: "7", input: "steps", type: "number" }] });
        fixture.ctx.config.comfy.pollIntervalMs = 1;
        const response = await fixture.post({ prompt: "comfy fixture", provider: "comfy", model: workflowId,
          async: asyncMode, sizeNudge: false, seed: 123, comfyParams: { steps: 17 } });
        assert.equal(response.status, asyncMode ? 202 : 200);
        const body = asyncMode ? (await fixture.waitTerminal()).data : await response.json();
        await fixture.waitSettled();
        const phases = fixture.events.filter((event) => event.event === "phase").map((event) => event.data);
        assert.deepEqual(phases, asyncMode ? [
          { requestId: fixture.requestId, phase: "streaming" },
          { requestId: fixture.requestId, phase: "queued", queuePosition: 1 },
          { requestId: fixture.requestId, phase: "streaming", queuePosition: 0 },
        ] : []);
        const wire = JSON.parse(fixture.calls.find((call) => call.url.endsWith("/prompt"))!.body);
        assert.equal(wire.prompt["6"].inputs.text, "comfy fixture");
        assert.equal(wire.prompt["7"].inputs.seed, 123);
        assert.equal(wire.prompt["7"].inputs.steps, 17);
        assert.match(body.image, /^data:image\/png;base64,/);
        const meta = await sidecar(fixture.generatedDir, body.filename);
        assert.equal(meta.comfyPromptId, "fixture-comfy-prompt");
        assert.equal(meta.comfyOrigin, "http://127.0.0.1:8188");
        assert.equal(meta.comfyWorkflow, workflowId);
        assert.equal(meta.format, "png");
      });
    });

    it("E03-9 mixed alpha/opaque batch refuses before saving even the alpha result", async () => {
      const alpha = await png(0.5);
      const opaque = await png();
      let count = 0;
      await harness.run("classic", { context: { apiKey: "fixture-api-key" }, upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        const wire = JSON.parse(call.body);
        assert.equal(wire.tools[0].background, "auto");
        assert.equal(wire.tools[0].output_format, "png");
        return imageResponse(++count === 1 ? alpha : opaque);
      } }, async (fixture) => {
        const response = await fixture.post({ ...apiBody, n: 2, backgroundPreset: "transparent" });
        assert.equal(response.status, 502);
        assert.equal((await response.json()).code, "TRANSPARENT_RESULT_OPAQUE");
        assert.equal(fixture.calls.length, 2);
        assert.deepEqual(await readdir(fixture.generatedDir), []);
      });
    });

    it("E03-9 Atlas alpha bytes override a false JPEG header and remain alpha on disk", async () => {
      const bytes = await png(0.5);
      await harness.run("classic", { context: { atlasCloudApiKey: "fixture-atlas-key" }, upstream: (call) => {
        if (call.url.endsWith("/model/generateImage")) {
          const wire = JSON.parse(call.body);
          assert.equal(wire.background, "transparent");
          assert.equal(wire.output_format, "png");
          return Response.json({ data: { id: "fixture-prediction" } });
        }
        if (call.url.endsWith("/model/result/fixture-prediction")) return Response.json({ data: {
          status: "completed", outputs: ["https://fixture.invalid/alpha.png"] } });
        assert.equal(call.url, "https://fixture.invalid/alpha.png");
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg" } });
      } }, async (fixture) => {
        const response = await fixture.post({ prompt: "atlas cutout", provider: "atlascloud",
          backgroundPreset: "transparent", format: "png", sizeNudge: false });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.match(body.image, /^data:image\/png;base64,/);
        assert.match(body.filename, /\.png$/);
        assert.equal((await sidecar(fixture.generatedDir, body.filename)).format, "png");
        const persisted = sharp(await readFile(join(fixture.generatedDir, body.filename)));
        assert.equal((await persisted.metadata()).hasAlpha, true);
        assert.ok((await persisted.stats()).channels[3]!.min < 255);
      });
    });
  });
}
