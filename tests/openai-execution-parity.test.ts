import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { ExecutionImage, ImageExecutionRequest } from "../lib/providers/execution/types.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse, type RouteCase, type RouteHarness, type UpstreamCall } from "./_executionRouteHarness.ts";
import { bounded } from "./_executionTrackedWrites.ts";

const BASE = { prompt: "WP04 raw prompt", quality: "high", size: "1536x1024", moderation: "low",
  mode: "direct" as const, reasoningEffort: "high", webSearchEnabled: false, sizeNudge: false, format: "png" };
const item = (b64: string, revised_prompt = "WP04 revised") => ({ type: "image_generation_call", result: b64, revised_prompt });
const completed = { type: "response.completed", response: { usage: { total_tokens: 19 }, tool_usage: { web_search: { num_requests: 3 } } } };
const finalFrame = (b64: string) => ({ type: "response.output_item.done", item: item(b64) });
const success = (b64: string) => responsesSse([finalFrame(b64), completed]);
const empty = () => responsesSse([{ type: "response.completed", response: {} }]);
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function wire(call: UpstreamCall, provider: "api" | "oauth") {
  assert.equal(call.method, "POST");
  assert.equal(call.url, provider === "api" ? "https://api.openai.com/v1/responses" : "http://oauth-fixture.invalid/v1/responses");
  assert.equal(call.headers.get("authorization"), provider === "api" ? "Bearer sk-execution-fixture" : null);
  return JSON.parse(call.body);
}
function directRequest(surface: "classic" | "node" | "edit" | "multimode", signal: AbortSignal, source: string): ImageExecutionRequest {
  const base = { provider: "api" as const, requestId: undefined, signal, prompt: "effective WP04", rawPrompt: "raw WP04",
    references: [{ b64: source, detectedMime: "image/png", declaredMime: "image/png" }], options: { ...BASE, model: "gpt-5.4" } };
  switch (surface) {
    case "classic": return { ...base, surface, providerUrl: null, background: null, backgroundConstraint: undefined, nai: {}, comfy: {} };
    case "node": return { ...base, surface, sourceImage: null, contextMode: "parent-plus-refs", searchMode: "off", partialImages: 0, nai: {} };
    case "edit": return { ...base, surface, sourceImage: source, mask: null };
    case "multimode": return { ...base, surface, providerUrl: null, maxImages: 2, nai: {} };
  }
}
async function meta(f: RouteCase, filename: unknown) {
  assert.equal(typeof filename, "string");
  try { return JSON.parse(await readFile(join(f.generatedDir, `${filename}.json`), "utf8")); }
  catch (error) { throw error; }
}
async function color(url: string, channel: number) {
  try {
    assert.match(url, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(url.split(",")[1]!, "base64");
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 8); assert.equal(info.height, 8);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(data[i]! - (i === channel ? 255 : 0)) < 5);
  } catch (error) { throw error; }
}

// Stable names and test titles are intentional: main owns the later DUT mutations.
export async function runApiNoFallbackCase(harness: RouteHarness) {
  await harness.run("classic", { upstream: (call) => { wire(call, "api"); return empty(); } }, async (f) => {
    const response = await f.post({ ...BASE, provider: "api", model: "gpt-5.4" });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "EMPTY_RESPONSE");
    await f.waitSettled();
    assert.equal(f.calls.length, 1, "API empty must not enter OAuth fallback or outer retry");
    assert.deepEqual(await readdir(f.generatedDir), []);
  });
}

export async function runHeldSequenceCallbacks(harness: RouteHarness, first: string, second: string) {
  const entered = gate(), held = gate(), controller = new AbortController();
  const originals: ExecutionImage[] = [], indices: number[] = [], partials: unknown[] = [];
  await harness.run("multimode", { upstream: (call) => {
    const body = wire(call, "api");
    assert.equal(body.tool_choice, "required"); assert.equal(body.tools[0].partial_images, undefined);
    return responsesSse([{ type: "response.image_generation_call.partial_image", partial_image_b64: second, partial_image_index: 4 },
      finalFrame(first), finalFrame(first), finalFrame(second), completed]);
  } }, async (f) => {
    const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
    const work = f.trackWork(prepareImageExecution(f.ctx, directRequest("multimode", controller.signal, first), {
      onPartialImage: (partial) => { partials.push(partial); },
      onFinalImage: async (image, index) => {
        try { originals.push(image); indices.push(index); if (index === 0) { entered.release(); await held.promise; } }
        catch (error) { throw error; }
      },
    }).then((prepared) => prepared.execute()));
    try {
      await bounded(entered.promise, 2000);
      assert.deepEqual(indices, [0], "second callback cannot overtake held first callback");
      held.release();
      const result = await bounded(work);
      assert.equal(result.kind, "sequence"); assert.ok(result.kind === "sequence");
      assert.deepEqual(indices, [0, 1]);
      assert.equal(result.value.images[0], originals[0]); assert.equal(result.value.images[1], originals[1]);
      assert.deepEqual(result.value.images, [{ b64: first, revisedPrompt: "WP04 revised" }, { b64: second, revisedPrompt: "WP04 revised" }]);
      assert.deepEqual(partials, [{ b64: second, index: 4 }]);
      assert.equal(result.value.eventCount, 5); assert.equal(result.value.diagnostics?.imageResultCount, 3);
      assert.deepEqual(result.value.usage, { total_tokens: 19 }); assert.equal(result.value.webSearchCalls, 3);
      assert.equal(f.calls.length, 1);
    } finally { held.release(); entered.release(); controller.abort(); await bounded(Promise.allSettled([work])); }
  });
}

if (executionTestProcess(import.meta.url)) describe("WP04 OpenAI real execution parity", { concurrency: false }, () => {
  let harness: RouteHarness;
  let red: string, green: string, blue: string, mask: string;
  before(async () => {
    harness = await openRouteHarness();
    [red, green, blue] = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map(async (background) => {
      try { return (await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()).toString("base64"); }
      catch (error) { throw error; }
    }));
    mask = (await sharp(Buffer.from(green, "base64")).ensureAlpha(0.5).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  // GPT OAuth no longer uses the Responses image tool: it plans with GPT-6 and renders through the
  // Images API, pinned in tests/oauth-image-lane-contract.test.ts. These cases keep the API-key lane.
  for (const provider of ["api"] as const) for (const surface of ["classic", "node", "edit", "multimode"] as const) {
    it(`O04-1/4 real ${provider} ${surface} route wire and persisted metadata`, async () => {
      const model = provider === "api" ? "gpt-5.4" : "gpt-5.6-luna";
      await harness.run(surface, { upstream: (call) => { wire(call, provider); return success(red); } }, async (f) => {
        const response = await f.post({ ...BASE, provider, model, webSearchEnabled: true,
          ...(surface === "edit" ? { image: blue } : { references: [green] }),
          ...(surface === "multimode" ? { async: true, maxImages: 1 } : {}) });
        assert.equal(response.status, surface === "multimode" ? 202 : 200);
        const result = surface === "multimode" ? (await f.waitTerminal()).data : await response.json();
        await f.waitSettled(); assert.equal(f.calls.length, 1);
        const body = wire(f.calls[0]!, provider);
        assert.equal(body.model, model); assert.deepEqual(body.reasoning, { effort: "high" });
        assert.deepEqual(body.tools, [{ type: "web_search" }, { type: "image_generation", quality: "high", size: "1536x1024", moderation: "low" }]);
        assert.deepEqual(body.tool_choice, surface === "multimode" ? "required" : { type: "image_generation" });
        assert.equal(body.stream, true); assert.equal(body.input[0].role, "developer");
        assert.match(body.input[1].content.at(-1).text, /WP04 raw prompt/);
        if (surface === "edit") await color(body.input[1].content[0].image_url, 2);
        else assert.deepEqual(body.input[1].content[0], { type: "input_image", image_url: `data:image/png;base64,${green}` });
        const image = surface === "multimode" ? f.events.find((e) => e.event === "image")!.data : result;
        assert.equal(image.image, `data:image/png;base64,${red}`);
        assert.deepEqual(result.usage, { total_tokens: 19 }); assert.equal(result.webSearchCalls, 3);
        const saved = await meta(f, image.filename);
        for (const [field, expected] of Object.entries({ provider, model, prompt: BASE.prompt, userPrompt: BASE.prompt,
          revisedPrompt: "WP04 revised", requestId: f.requestId })) assert.equal(saved[field], expected, field);
        assert.equal(saved.kind, { classic: "classic", node: "generate", edit: "edit", multimode: "multimode-image" }[surface]);
        assert.deepEqual(saved.usage, surface === "multimode" ? null : { total_tokens: 19 });
        assert.equal((await readdir(f.generatedDir)).filter((file) => file.endsWith(".json")).length, 1);
      });
    });
  }

  it("O04-3 API empty one call forbids fallback", async () => { await runApiNoFallbackCase(harness); });
  for (const status of [503, 400, 403]) it(`O04-3 classic status ${status} retains retry classification`, async () => {
    let attempts = 0;
    await harness.run("classic", { upstream: (call) => {
      wire(call, "api");
      if (++attempts > 1) return success(red);
      return Response.json({ error: { code: status === 403 ? "moderation_blocked" : "invalid_request_error", message: "fixture only" } }, { status });
    } }, async (f) => {
      const response = await f.post({ ...BASE, provider: "api", model: "gpt-5.4" });
      assert.equal(response.status, status === 400 ? 400 : 200);
      assert.equal(f.calls.length, status === 400 ? 1 : 2);
      if (status === 400) assert.equal((await response.json()).code, "INVALID_REQUEST");
    });
  });

  for (const contextMode of ["parent-plus-refs", "parent-only"] as const) it(`O04-5 child compression/order ${contextMode}`, async () => {
    await harness.run("node", { upstream: (call) => { wire(call, "api"); return success(red); } }, async (f) => {
      const { saveNode } = await import("../lib/nodeStore.ts");
      await saveNode(f.ctx.rootDir, { nodeId: "n_wp04_parent", b64: blue, meta: { format: "png" }, generatedDir: f.generatedDir });
      const response = await f.post({ ...BASE, provider: "api", model: "gpt-5.4", parentNodeId: "n_wp04_parent", references: [green], contextMode });
      assert.equal(response.status, 200); await f.waitSettled(); assert.equal(f.calls.length, 1);
      const content = wire(f.calls[0]!, "api").input[1].content;
      assert.equal(content.length, contextMode === "parent-only" ? 2 : 3);
      await color(content[0].image_url, 2);
      if (contextMode === "parent-plus-refs") await color(content[1].image_url, 1);
    });
  });
  it("O04-5 edit mask is PNG guidance and raw prompt, not a native mask parameter", async () => {
    await harness.run("edit", { upstream: (call) => { wire(call, "api"); return success(red); } }, async (f) => {
      const response = await f.post({ ...BASE, provider: "api", model: "gpt-5.4", image: blue, mask });
      assert.equal(response.status, 200); await f.waitSettled();
      const body = wire(f.calls[0]!, "api"), content = body.input[1].content;
      await color(content[0].image_url, 2);
      assert.deepEqual(content[1], { type: "input_image", image_url: `data:image/png;base64,${mask}` });
      assert.equal(content[2].text, "The previous image is an edit mask guide. Use it as prompt guidance for where the edit should apply; it is not a visible final image element.");
      assert.match(content[3].text, /WP04 raw prompt/); assert.equal(content.length, 4);
      assert.equal(body.mask, undefined); assert.equal(body.tools[0].mask, undefined);
    });
  });
  it("O04-6 held sequence final callback is awaited and A,A,B preserves original objects", async () => {
    await runHeldSequenceCallbacks(harness, red, blue);
  });

  for (const provider of ["api"] as const) it(`O04-6 ${provider} node partial wire precedes final persistence`, async () => {
    await harness.run("node", { upstream: (call) => {
      const body = wire(call, provider); assert.equal(body.tools[0].partial_images, 2);
      return responsesSse([{ type: "response.image_generation_call.partial_image", partial_image: blue, index: 7 }, finalFrame(red), completed]);
    } }, async (f) => {
      assert.equal((await f.post({ ...BASE, provider, model: "gpt-5.4", async: true }, { Accept: "text/event-stream" })).status, 202);
      assert.equal((await f.waitTerminal()).event, "done"); await f.waitSettled();
      assert.deepEqual(f.events.filter((e) => e.event === "partial").map((e) => e.data), [{ requestId: f.requestId, image: `data:image/png;base64,${blue}`, index: 7 }]);
      assert.ok(f.events.findIndex((e) => e.event === "partial") < f.events.findIndex((e) => e.event === "done"));
      assert.equal(f.calls.length, 1); assert.equal((await readdir(f.generatedDir)).filter((name) => name.endsWith(".json")).length, 1);
    });
  });
  for (const provider of ["api"] as const) it(`O04-6 ${provider} sequence A,A,B persists each index once`, async () => {
    await harness.run("multimode", { upstream: (call) => {
      wire(call, provider); return responsesSse([finalFrame(red), finalFrame(red), finalFrame(blue), completed]);
    } }, async (f) => {
      assert.equal((await f.post({ ...BASE, provider, model: "gpt-5.4", maxImages: 2, async: true })).status, 202);
      const terminal = await f.waitTerminal(); assert.equal(terminal.event, "done"); await f.waitSettled();
      const images = f.events.filter((e) => e.event === "image");
      assert.deepEqual(images.map((e) => e.data.sequenceIndex), [1, 2]);
      assert.deepEqual(images.map((e) => e.data.image), [`data:image/png;base64,${red}`, `data:image/png;base64,${blue}`]);
      assert.equal(terminal.data.returned, 2); assert.equal(terminal.data.status, "complete");
      for (const [index, image] of images.entries()) {
        const saved = await meta(f, image.data.filename); assert.equal(saved.sequenceIndex, index + 1);
        assert.equal(saved.sequenceStatus, index === 0 ? "partial" : "complete");
      }
      assert.equal(f.events.filter((e) => e.event === "done").length, 1); assert.equal(f.calls.length, 1);
      assert.equal((await readdir(f.generatedDir)).filter((name) => name.endsWith(".json")).length, 2);
    });
  });

  for (const callerCancel of [false, true]) it(`O04-9 persisted partial then ${callerCancel ? "caller abort error" : "internal timeout done"}`, async () => {
    let closeStream = () => {};
    await harness.run("multimode", { upstream: (call) => {
      wire(call, "api"); assert.ok(call.signal);
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        let ended = false;
        closeStream = () => { if (!ended) { ended = true; controller.close(); } };
        call.signal!.addEventListener("abort", () => { if (!ended) { ended = true; controller.error(call.signal!.reason); } }, { once: true });
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalFrame(red))}\n\n`));
      } });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    } }, async (f) => {
      const originalConfig = f.ctx.config;
      f.ctx.config = { ...originalConfig, oauth: { ...originalConfig.oauth, generationTimeoutMs: callerCancel ? 5000 : 1000 } };
      const work = f.trackWork(f.post({ ...BASE, provider: "api", model: "gpt-5.4", maxImages: 2, async: true }));
      try {
        assert.equal((await work).status, 202);
        const image = await f.waitFor((e) => e.event === "image");
        const before = await readFile(join(f.generatedDir, String(image.data.filename)));
        const saved = await meta(f, image.data.filename);
        if (callerCancel) f.cancel();
        const terminal = await f.waitTerminal(); await f.waitSettled();
        assert.equal(terminal.event, callerCancel ? "error" : "done");
        if (callerCancel) { assert.equal(terminal.data.code, "GENERATION_CANCELED"); assert.equal(terminal.data.status, 499); }
        else { assert.equal(terminal.data.partial, true); assert.equal(terminal.data.returned, 1); assert.equal(terminal.data.status, "partial");
          assert.deepEqual(terminal.data.warning, { code: "RESPONSES_IMAGE_TIMEOUT", message: "The provider timed out after returning partial multimode results." }); }
        // WP07 cancellation dominates the route's later catch; retain the prior partial bytes.
        assert.deepEqual(f.events.filter((e) => e.event === "done" || e.event === "error").map((e) => e.event), callerCancel ? ["error"] : ["done"]);
        if (callerCancel) for (const event of f.events.filter((e) => e.event === "error")) {
          assert.equal(event.data.code, "GENERATION_CANCELED"); assert.equal(event.data.status, 499);
        }
        assert.equal(f.events.filter((e) => e.event === "image").length, 1);
        assert.deepEqual(await readFile(join(f.generatedDir, String(image.data.filename))), before);
        assert.deepEqual(await meta(f, image.data.filename), saved); assert.equal(saved.sequenceStatus, "partial");
      } finally {
        closeStream(); f.cancel(); // The real route owns its controller; cancel aborts that controller.
        await bounded(Promise.allSettled([work])); await f.waitSettled(); f.ctx.config = originalConfig;
      }
    });
  });

  it("O04-10 facade functions retain identity and actual family dispatch is one transport call", async () => {
    await harness.run("classic", { upstream: (call) => { wire(call, "api"); return success(red); } }, async (f) => {
      const facade = await import("../lib/responsesImageAdapter.ts");
      const operations = await import("../lib/providers/adapters/openaiOperations.ts");
      for (const name of ["generateViaResponses", "editViaResponses", "generateMultimodeViaResponses"] as const) assert.equal(facade[name], operations[name]);
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      const controller = new AbortController();
      const work = f.trackWork(prepareImageExecution(f.ctx, directRequest("classic", controller.signal, green)).then((p) => p.execute()));
      try {
        const result = await bounded(work); assert.ok(result.kind === "single");
        assert.equal(result.value.b64, red); assert.equal(f.calls.length, 1);
      }
      finally { controller.abort(); await bounded(Promise.allSettled([work])); }
    });
  });
});
