import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { ExecutionImage, ImageExecutionRequest } from "../lib/providers/execution/types.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse } from "./_executionRouteHarness.ts";
import { bounded } from "./_executionTrackedWrites.ts";

function assertCanceledExecution(execution: PromiseSettledResult<unknown> | undefined): void {
  assert.ok(execution && execution.status === "rejected");
  assert.equal(execution.reason.code, "GENERATION_CANCELED");
}

if (executionTestProcess(import.meta.url)) describe("execution multimode routes and native sequence", () => {
  let harness: Awaited<ReturnType<typeof openRouteHarness>>;
  let first: string;
  let second: string;
  before(async () => {
    harness = await openRouteHarness();
    first = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer()).toString("base64");
    second = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc6600" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  function sequenceFrames() {
    return [
      { type: "response.image_generation_call.partial_image", partial_image_b64: first, partial_image_index: 4 },
      { type: "response.output_item.done", item: { type: "image_generation_call", result: first, revised_prompt: "Blue stage A" } },
      { type: "response.output_item.done", item: { type: "image_generation_call", result: first, revised_prompt: "Ignored duplicate A" } },
      { type: "response.output_item.done", item: { type: "image_generation_call", result: second, revised_prompt: "Amber stage B" } },
      { type: "response.output_text.done", text: "Sequence fixture text" },
      { type: "response.completed", response: { usage: { input_tokens: 23, output_tokens: 31, total_tokens: 54 }, tool_usage: { web_search: { num_requests: 3 } } } },
    ];
  }

  for (const asyncMode of [false, true]) it(`API ${asyncMode ? "async" : "legacy SSE"} sequence dedupes A,A,B and persists exactly two outputs`, async () => {
    await harness.run("multimode", {
      context: { apiKey: "sk-fixture-sequence" },
      upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        assert.equal(call.method, "POST");
        assert.equal(call.headers.get("authorization"), "Bearer sk-fixture-sequence");
        return responsesSse(sequenceFrames());
      },
    }, async (fixture) => {
      const response = await fixture.post({
        provider: "api", prompt: "Two colored stages", maxImages: 2, async: asyncMode,
        model: "gpt-6.1-terra", quality: "high", size: "1536x1024", moderation: "low", mode: "direct",
        reasoningEffort: "high", webSearchEnabled: true, references: [`data:image/png;base64,${first}`],
        composerPrompt: "Composer sequence fixture",
      });
      assert.equal(response.status, asyncMode ? 202 : 200);
      let sse = "";
      if (asyncMode) assert.deepEqual(await response.json(), { requestId: fixture.requestId });
      else {
        assert.match(response.headers.get("content-type")!, /text\/event-stream/);
        sse = await response.text();
      }
      const terminal = await fixture.waitTerminal();
      await fixture.waitSettled();
      assert.equal(terminal.event, "done");
      assert.equal(fixture.calls.length, 1);
      const wire = JSON.parse(fixture.calls[0]!.body);
      assert.equal(wire.model, "gpt-6.1-terra");
      assert.deepEqual(wire.reasoning, { effort: "high" });
      assert.equal(wire.tool_choice, "required");
      assert.deepEqual(wire.tools.map((tool: { type: string }) => tool.type), ["web_search", "image_generation"]);
      assert.equal(wire.tools[1].quality, "high");
      assert.equal(wire.tools[1].size, "1536x1024");
      assert.equal(wire.tools[1].moderation, "low");
      assert.deepEqual(wire.input[1].content[0], { type: "input_image", image_url: `data:image/png;base64,${first}` });
      assert.match(wire.input[1].content.at(-1).text, /Two colored stages/);
      const images = fixture.events.filter((event) => event.event === "image");
      assert.equal(images.length, 2);
      assert.deepEqual(images.map((event) => event.data.sequenceIndex), [1, 2]);
      assert.deepEqual(images.map((event) => event.data.image), [`data:image/png;base64,${first}`, `data:image/png;base64,${second}`]);
      const partials = fixture.events.filter((event) => event.event === "partial");
      assert.equal(partials.length, 1);
      assert.deepEqual(partials[0]!.data, {
        image: `data:image/png;base64,${first}`, requestId: fixture.requestId,
        sequenceId: terminal.data.sequenceId, index: 4,
      });
      assert.equal(fixture.events.filter((event) => event.event === "done").length, 1);
      assert.equal(fixture.events.some((event) => event.event === "error"), false);
      for (const [field, expected] of Object.entries({ ok: true, requested: 2, returned: 2, status: "complete", provider: "api", model: "gpt-6.1-terra", quality: "high", size: "1536x1024", moderation: "low", webSearchCalls: 3, webSearchEnabled: true, extraIgnored: 0, promptMode: "direct" })) assert.deepEqual(terminal.data[field], expected, field);
      assert.deepEqual(terminal.data.usage, { input_tokens: 23, output_tokens: 31, total_tokens: 54 });
      assert.deepEqual(terminal.data.images, images.map((event) => event.data));
      const filenames = images.map((event) => String(event.data.filename));
      assert.equal(new Set(filenames).size, 2);
      const files = await readdir(fixture.generatedDir);
      assert.equal(files.filter((name) => name.endsWith(".json")).length, 2);
      for (const [index, filename] of filenames.entries()) {
        const meta = JSON.parse(await readFile(join(fixture.generatedDir, `${filename}.json`), "utf8"));
        for (const [field, expected] of Object.entries({ kind: "multimode-image", generationStrategy: "one-call-text-sequence", provider: "api", model: "gpt-6.1-terra", quality: "high", size: "1536x1024", format: "png", prompt: "Two colored stages", userPrompt: "Two colored stages", composerPrompt: "Composer sequence fixture", promptMode: "direct", refsCount: 1, sequenceIndex: index + 1, stageLabel: index === 0 ? "A" : "B", sequenceTotalRequested: 2, sequenceTotalReturned: index + 1, sequenceStatus: index === 0 ? "partial" : "complete", revisedPrompt: index === 0 ? "Blue stage A" : "Amber stage B", usage: null, webSearchCalls: 0 })) assert.deepEqual(meta[field], expected, field);
        assert.equal(meta.requestId, fixture.requestId);
        assert.equal(meta.sequenceId, terminal.data.sequenceId);
        assert.equal("originalIndexes" in meta, false);
        const savedPixels = await sharp(await readFile(join(fixture.generatedDir, filename))).raw().toBuffer();
        assert.deepEqual([...savedPixels.subarray(0, 3)], index === 0 ? [51, 102, 153] : [204, 102, 0]);
      }
      if (!asyncMode) {
        const wireEvents = sse.split(/\n\n/).filter((block) => block.startsWith("event:")).map((block) => {
          const lines = block.split("\n");
          return { event: lines[0]!.slice(7), data: JSON.parse(lines.find((line) => line.startsWith("data: "))!.slice(6)) };
        });
        assert.deepEqual(wireEvents.filter((event) => ["partial", "image", "done"].includes(event.event)), fixture.events.filter((event) => ["partial", "image", "done"].includes(event.event)).map(({ event, data }) => ({ event, data })));
      }
    });
  });

  it("native Responses sequence awaits original callback objects and retains full diagnostics", async () => {
    await harness.run("multimode", {
      upstream: (call) => {
        assert.equal(call.url, "https://api.openai.com/v1/responses");
        return responsesSse(sequenceFrames());
      },
    }, async (fixture) => {
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let entered!: () => void;
      const callbackEntered = new Promise<void>((resolve) => { entered = resolve; });
      const originals: ExecutionImage[] = [];
      const indexes: number[] = [];
      const partials: unknown[] = [];
      const controller = new AbortController();
      const pending: Promise<unknown>[] = [];
      const request: Extract<ImageExecutionRequest, { surface: "multimode" }> = {
        surface: "multimode", provider: "api", requestId: fixture.requestId,
        signal: controller.signal, prompt: "Native sequence", rawPrompt: "Raw sequence",
        references: [], providerUrl: null, maxImages: 2, nai: {},
        options: { model: "gpt-6.1-terra", quality: "medium", size: "1024x1024", moderation: "low", mode: "direct", reasoningEffort: "high", webSearchEnabled: false },
      };
      try {
        const preparation = fixture.trackWork(prepareImageExecution(fixture.ctx, request, {
          onPartialImage: (partial) => { partials.push(partial); },
          onFinalImage: async (image, index) => {
            originals.push(image); indexes.push(index);
            if (index === 0) { entered(); await held; }
          },
        }));
        pending.push(preparation);
        const prepared = await preparation;
        assert.equal(fixture.calls.length, 0, "preparing a sequence performs no provider work");
        let settled = false;
        const work = fixture.trackWork(prepared.execute().then((result) => { settled = true; return result; }));
        pending.push(work);
        await bounded(callbackEntered);
        assert.equal(settled, false);
        assert.deepEqual(indexes, [0]);
        release();
        const { kind, value } = await work;
        assert.equal(kind, "sequence");
        assert.deepEqual(indexes, [0, 1]);
        assert.deepEqual(partials, [{ b64: first, index: 4 }]);
        assert.equal(value.images[0], originals[0]);
        assert.equal(value.images[1], originals[1]);
        assert.deepEqual(value.images, [{ b64: first, revisedPrompt: "Blue stage A" }, { b64: second, revisedPrompt: "Amber stage B" }]);
        assert.deepEqual(value.usage, { input_tokens: 23, output_tokens: 31, total_tokens: 54 });
        assert.equal(value.webSearchCalls, 3);
        assert.equal(value.text, "Sequence fixture text");
        assert.equal(value.extraIgnored, 0);
        assert.equal(value.eventCount, 6);
        assert.deepEqual(value.eventTypes, { "response.image_generation_call.partial_image": 1, "response.output_item.done": 3, "response.output_text.done": 1, "response.completed": 1 });
        assert.equal(value.diagnostics?.streamStats.sawResponseCompleted, true);
        assert.equal(value.diagnostics?.imageResultCount, 3);
        assert.equal(value.diagnostics?.outputItemSummary.length, 3);
        assert.equal(value.diagnostics?.messageOutputSeen, true);
        assert.equal(value.originalIndexes, undefined);
      } finally {
        release(); controller.abort();
        await bounded(Promise.allSettled(pending));
      }
    });
  });

  it("native Grok callbacks retain provider URL, object identity and awaited completion", async () => {
    const providerUrl = "https://fixture.invalid/sequence-native.png";
    await harness.run("multimode", {
      context: { xaiApiKey: "fixture-xai-sequence" },
      upstream: (call) => {
        if (call.url === providerUrl) return new Response(Buffer.from(first, "base64"), { headers: { "content-type": "image/png" } });
        assert.equal(call.headers.get("authorization"), "Bearer fixture-xai-sequence");
        if (call.url === "https://api.x.ai/v1/responses") return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "Sequence research" }] }] });
        if (call.url === "https://api.x.ai/v1/chat/completions") return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "Native planned stage" }) } }] } }] });
        assert.equal(call.url, "https://api.x.ai/v1/images/generations");
        return Response.json({ data: [{ url: providerUrl }], usage: { cost_in_usd_ticks: 211 } });
      },
    }, async (fixture) => {
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      let original: ExecutionImage | undefined;
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let entered!: () => void;
      const callbackEntered = new Promise<void>((resolve) => { entered = resolve; });
      const controller = new AbortController();
      const pending: Promise<unknown>[] = [];
      try {
        const preparation = fixture.trackWork(prepareImageExecution(fixture.ctx, {
          surface: "multimode", provider: "grok-api", requestId: fixture.requestId,
          signal: controller.signal, prompt: "Grok effective sequence", rawPrompt: "Grok raw sequence",
          references: [], providerUrl: null, maxImages: 1, nai: {},
          options: { model: "grok-imagine-image", quality: "medium", size: "1024x1024", moderation: "low", mode: "direct", reasoningEffort: "none", webSearchEnabled: false },
        }, {
          onFinalImage: async (image, index) => {
            original = image;
            assert.equal(index, 0);
            entered(); await held;
          },
        }));
        pending.push(preparation);
        const prepared = await preparation;
        assert.equal(fixture.calls.length, 0);
        let settled = false;
        const work = fixture.trackWork(prepared.execute().then((result) => { settled = true; return result; }));
        pending.push(work);
        await bounded(callbackEntered);
        assert.equal(settled, false);
        assert.equal(original?.providerUrl, providerUrl);
        release();
        const { value } = await work;
        assert.equal(value.images[0], original);
        assert.deepEqual(value.images[0], { b64: first, mime: "image/png", revisedPrompt: "Native planned stage", providerUrl });
        assert.deepEqual(value.usage, { grok_cost_usd_ticks: 211 });
        assert.equal(value.webSearchCalls, 0, "explicit false suppresses search, not planning");
        assert.equal(value.extraIgnored, 0);
        assert.deepEqual(value.originalIndexes, [0]);
        assert.equal(fixture.calls.length, 3);

        const response = await fixture.post({ provider: "grok-api", prompt: "Grok route sequence", model: "grok-imagine-image", maxImages: 1, async: true });
        assert.equal(response.status, 202);
        const terminal = await fixture.waitTerminal();
        await fixture.waitSettled();
        assert.equal(terminal.event, "done");
        const event = fixture.events.find((entry) => entry.event === "image")!;
        assert.equal(event.data.providerUrl, providerUrl);
        const meta = JSON.parse(await readFile(join(fixture.generatedDir, `${event.data.filename}.json`), "utf8"));
        assert.equal(meta.providerUrl, providerUrl);
        assert.equal(meta.revisedPrompt, "Native planned stage");
        assert.equal(meta.usage, null, "callback sidecars precede native sequence usage assignment");
        assert.deepEqual(terminal.data.usage, { grok_cost_usd_ticks: 211 });
        assert.equal(terminal.data.webSearchCalls, 1, "omitted route option retains search-on default");
        assert.equal((await readdir(fixture.generatedDir)).filter((name) => name.endsWith(".json")).length, 1);
      } finally {
        release(); controller.abort();
        await bounded(Promise.allSettled(pending));
      }
    });
  });

  it("Grok all-failed sequence preserves its representative native error through the seam and route", async () => {
    let imageAttempts = 0;
    await harness.run("multimode", {
      context: { xaiApiKey: "fixture-xai-failure" },
      upstream: (call) => {
        if (call.url === "https://api.x.ai/v1/responses") return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "Failure research" }] }] });
        if (call.url === "https://api.x.ai/v1/chat/completions") return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "Failure stage" }) } }] } }] });
        assert.equal(call.url, "https://api.x.ai/v1/images/generations");
        imageAttempts++;
        return Response.json({ error: imageAttempts % 2 ? "First item refused" : "Last item refused" }, { status: imageAttempts % 2 ? 400 : 403 });
      },
    }, async (fixture) => {
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      const prepared = await prepareImageExecution(fixture.ctx, {
        surface: "multimode", provider: "grok-api", requestId: fixture.requestId,
        signal: new AbortController().signal, prompt: "All failed", rawPrompt: "All failed",
        references: [], providerUrl: null, maxImages: 2, nai: {},
        options: { model: "grok-imagine-image", quality: "medium", size: "1024x1024", moderation: "low", mode: "auto", reasoningEffort: "none", webSearchEnabled: true },
      }, { onFinalImage: () => assert.fail("failed images must not call final callback") });
      const { value } = await prepared.execute();
      assert.deepEqual(value.images, []);
      assert.deepEqual(value.originalIndexes, []);
      assert.equal(value.usage, null);
      assert.equal(value.webSearchCalls, 2);
      assert.ok(value.error instanceof Error);
      assert.equal(value.error.message, "Grok auth failed: Last item refused");
      assert.equal(Reflect.get(value.error, "code"), "GROK_AUTH_FAILED");
      assert.equal(Reflect.get(value.error, "status"), 502);
      assert.equal(imageAttempts, 2);

      const response = await fixture.post({ provider: "grok-api", prompt: "All failed route", model: "grok-imagine-image", maxImages: 2, async: true });
      assert.equal(response.status, 202);
      const terminal = await fixture.waitTerminal();
      await fixture.waitSettled();
      assert.equal(terminal.event, "error");
      assert.equal(terminal.data.code, "GROK_AUTH_FAILED");
      assert.equal(terminal.data.status, 422);
      assert.equal(terminal.data.requested, 2);
      assert.equal(terminal.data.returned, 0);
      assert.equal(imageAttempts, 4);
      assert.deepEqual(await readdir(fixture.generatedDir), []);
      assert.equal(fixture.events.some((entry) => entry.event === "done" || entry.event === "image"), false);
    });
  });

  it("failed assertion releases actual held Grok callback and settles execution before pinned deactivation", async () => {
    const order: string[] = [];
    const providerUrl = "https://fixture.invalid/cleanup.png";
    let generatedDir = "";
    await assert.rejects(harness.run("multimode", {
      context: { xaiApiKey: "fixture-xai-cleanup" }, upstream: (call) => {
        if (call.method === "GET") {
          assert.equal(call.url, providerUrl);
          return new Response(Buffer.from(first, "base64"), { headers: { "content-type": "image/png" } });
        }
        if (call.url.endsWith("/chat/completions")) return Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: {
          name: "generate_image", arguments: JSON.stringify({ prompt: "held callback cleanup" }),
        } }] } }] });
        assert.equal(call.url, "https://api.x.ai/v1/images/generations");
        return Response.json({ data: [{ url: providerUrl }] });
      },
    }, async (fixture) => {
      generatedDir = fixture.generatedDir;
      const controller = new AbortController();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const callbackEntered = new Promise<void>((resolve) => { entered = resolve; });
      const pending: Promise<unknown>[] = [];
      try {
        const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
        const preparation = fixture.trackWork(prepareImageExecution(fixture.ctx, {
          surface: "multimode", provider: "grok-api", requestId: fixture.requestId, signal: controller.signal,
          prompt: "callback cleanup", rawPrompt: "callback cleanup", references: [], providerUrl: null, maxImages: 2, nai: {},
          options: { model: "grok-imagine-image", quality: "medium", size: "1024x1024", moderation: "low", mode: "direct", reasoningEffort: "none", webSearchEnabled: false },
        }, { onFinalImage: async (_image, index) => {
          assert.equal(index, 0); entered(); await gate; order.push("callback-released");
        } }));
        pending.push(preparation);
        const prepared = await preparation;
        const work = fixture.trackWork(prepared.execute().finally(() => { order.push("execution-settled"); }));
        pending.push(work);
        await bounded(callbackEntered);
        assert.deepEqual(order, []);
        assert.fail("intentional held-callback assertion failure");
      } finally {
        release(); controller.abort();
        const settled = await bounded(Promise.allSettled(pending));
        const execution = settled[1];
        assertCanceledExecution(execution);
        // A real public-wrapper GET after execution settlement can succeed only while
        // this case's pinned fixture remains active. No policy/download replacement.
        const { downloadGrokImageUrl } = await import("../lib/grokImageCore.ts");
        const probeController = new AbortController();
        const probe = fixture.trackWork(downloadGrokImageUrl(providerUrl, probeController.signal));
        try { assert.equal((await bounded(probe)).b64, first); }
        finally { probeController.abort(); await bounded(Promise.allSettled([probe])); }
        order.push("pinned-probe-complete");
        assert.equal(fixture.imageTransportCalls.length, 2);
        assert.equal(fixture.calls.filter((call) => call.url.endsWith("/images/generations")).length, 1);
      }
    }), (error) => error instanceof assert.AssertionError && error.message.includes("intentional held-callback assertion failure"));
    order.push("harness-cleaned");
    assert.deepEqual(order, ["callback-released", "execution-settled", "pinned-probe-complete", "harness-cleaned"]);
    await assert.rejects(access(generatedDir), { code: "ENOENT" });
  });
});
