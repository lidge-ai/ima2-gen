import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse } from "./_executionRouteHarness.ts";
import { imagesJson } from "./_oauthNativeFixture.ts";

type Harness = Awaited<ReturnType<typeof openRouteHarness>>;
type Fixture = Parameters<Parameters<Harness["run"]>[2]>[0];
type Call = Parameters<Parameters<Harness["run"]>[1]["upstream"]>[0];
const BASE = { provider: "api", prompt: "node raw fixture", model: "gpt-5.4",
  reasoningEffort: "high", quality: "high", size: "1536x1024", format: "png",
  moderation: "low", mode: "direct", webSearchEnabled: false, searchMode: "off" };

function frames(final: string, partial?: string) {
  return responsesSse([
    ...(partial ? [{ type: "response.image_generation_call.partial_image", partial_image: partial, index: 7 }] : []),
    { type: "response.output_item.done", item: { type: "image_generation_call", result: final, revised_prompt: "node revised fixture" } },
    { type: "response.completed", response: { usage: { total_tokens: 17 } } },
  ]);
}

function apiCall(call: Call) {
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("authorization"), "Bearer sk-node-fixture");
  return JSON.parse(call.body);
}

async function seedParent(fixture: Fixture, b64: string) {
  const { saveNode } = await import("../lib/nodeStore.ts");
  await saveNode(fixture.ctx.rootDir, { nodeId: "n_fixture_parent", b64,
    meta: { format: "png" }, generatedDir: fixture.generatedDir });
}

async function assertColor(imageUrl: string, channel: 0 | 1 | 2) {
  const b64 = imageUrl.slice(imageUrl.indexOf(",") + 1);
  const { data } = await sharp(Buffer.from(b64, "base64")).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[channel] > 240);
  assert.ok(data[(channel + 1) % 3] < 15);
  assert.ok(data[(channel + 2) % 3] < 15);
}

function grokResponse(call: Call, final: string) {
  if (call.url === "https://api.x.ai/v1/responses") return Response.json({
    output: [{ type: "message", content: [{ type: "output_text", text: "fixture visual facts" }] }],
  });
  if (call.url === "https://api.x.ai/v1/chat/completions") return Response.json({
    choices: [{ message: { tool_calls: [{ type: "function", function: {
      name: "generate_image", arguments: JSON.stringify({ prompt: "planned node fixture", model: "grok-imagine-image-quality" }),
    } }] } }],
  });
  if (call.url === "https://api.x.ai/v1/images/generations" || call.url === "https://api.x.ai/v1/images/edits") {
    return Response.json({ data: [{ url: "https://fixture.invalid/node.png" }] });
  }
  assert.equal(call.url, "https://fixture.invalid/node.png");
  return new Response(Buffer.from(final, "base64"), { headers: { "Content-Type": "image/png" } });
}

if (executionTestProcess(import.meta.url)) describe("node execution: real route contracts", { concurrency: false }, () => {
  let harness: Harness;
  let red: string, green: string, blue: string;
  let agyMock: ReturnType<typeof mock.module>;
  const agyCalls: Array<{ prompt: string; references?: Array<{ b64: string; declaredMime: string | null; detectedMime: string | null }> }> = [];
  before(async () => {
    // Agy is a process transport: intercept that concrete adapter only, before
    // route imports. All other cases execute their real adapters via fetch traps.
    agyMock = mock.module(new URL("../lib/providers/adapters/agyOperations.ts", import.meta.url).href, { namedExports: {
      generateViaAgy: async (prompt: string, options: { references?: typeof agyCalls[number]["references"] }) => {
        agyCalls.push({ prompt, references: options.references });
        return { b64: red, usage: null, webSearchCalls: 0 };
      },
    } });
    harness = await openRouteHarness();
    [red, green, blue] = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map(async (background) =>
      (await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()).toString("base64")));
  });
  after(async () => { try { await harness?.close(); } finally { agyMock?.restore(); } });

  for (const provider of ["api", "oauth"]) it(`H1 ${provider} rejects unsafe formats before provider work`, async () => {
    for (const format of ["/../../h1-victim", "\\..\\..\\h1-victim", "gif", "", null, ["png"], {}]) {
      await harness.run("node", { upstream: () => frames(red) }, async (fixture) => {
        const victim = join(fixture.ctx.rootDir, "h1-victim");
        await writeFile(victim, "owned sentinel");
        await writeFile(victim + ".json", "owned sidecar sentinel");
        const response = await fixture.post({ ...BASE, provider, format });
        const body = await response.json();
        await fixture.waitSettled();
        assert.equal(await readFile(victim, "utf8"), "owned sentinel");
        assert.equal(await readFile(victim + ".json", "utf8"), "owned sidecar sentinel");
        assert.equal(response.status, 400);
        assert.equal(body.error.code, "INVALID_FORMAT");
        assert.equal(fixture.calls.length, 0);
        assert.deepEqual(await readdir(fixture.generatedDir), []);
        assert.deepEqual(fixture.events, []);
      });
    }
  });

  for (const provider of ["api", "oauth"]) it(`H1 ${provider} saves all supported formats including jpg`, async () => {
    for (const format of ["png", "jpeg", "jpg", "webp"]) {
      // GPT OAuth in direct mode renders once through the Images API.
      await harness.run("node", { upstream: () => (provider === "oauth" ? imagesJson(red) : frames(red)) }, async (fixture) => {
        const response = await fixture.post({ ...BASE, provider, format });
        const body = await response.json();
        await fixture.waitSettled();
        assert.equal(response.status, 200);
        assert.ok(body.filename.endsWith(`.${format}`));
        assert.equal(fixture.calls.length, 1);
        assert.equal((await sharp(await readFile(join(fixture.generatedDir, body.filename))).metadata()).format,
          format === "jpg" ? "jpeg" : format);
        const meta = JSON.parse(await readFile(join(fixture.generatedDir, body.filename + ".json"), "utf8"));
        assert.equal(meta.format, format);
        assert.equal(meta.options.format, format);
      });
    }
  });

  it("H1 Grok ignores request format and saves the detected result format", async () => {
    await harness.run("node", { context: { xaiApiKey: "xai-fixture" }, upstream: (call) => grokResponse(call, red) }, async (fixture) => {
      const response = await fixture.post({ ...BASE, provider: "grok-api", model: "grok-imagine-image", format: "/../../h1-victim" });
      const body = await response.json();
      await fixture.waitSettled();
      assert.equal(response.status, 200);
      assert.ok(body.filename.endsWith(".png"));
      assert.equal(body.format, "png");
    });
  });

  it("E03-1 API wire, effective prompt and raw sidecar stay distinct", async () => {
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: (call) => {
      const wire = apiCall(call);
      assert.equal(wire.model, "gpt-5.4");
      assert.deepEqual(wire.reasoning, { effort: "high" });
      assert.equal(wire.stream, true);
      assert.deepEqual(wire.tools, [{ type: "image_generation", quality: "high", size: "1536x1024", moderation: "low" }]);
      assert.deepEqual(wire.tool_choice, { type: "image_generation" });
      assert.deepEqual(wire.input[1].content[0], { type: "input_image", image_url: `data:image/png;base64,${green}` });
      assert.match(wire.input[1].content[1].text, /Generate an image with this exact prompt, no modifications: node raw fixture\n\nElement notes:\nblue rim light/);
      return frames(red);
    } }, async (fixture) => {
      const response = await fixture.post({ ...BASE, references: [green], elementIds: ["e_fixture"],
        elementNotes: ["blue rim light"], elementRevisions: { e_fixture: 4 } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.requestId, fixture.requestId);
      assert.equal(body.image, `data:image/png;base64,${red}`);
      assert.equal(body.revisedPrompt, "node revised fixture");
      assert.deepEqual(body.usage, { total_tokens: 17 });
      assert.equal(body.refsCount, 1);
      assert.equal(body.webSearchCalls, 0);
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 1);
      assert.equal(fixture.events.filter((e) => e.event === "done").length, 1);
      const meta = JSON.parse(await readFile(join(fixture.generatedDir, `${body.filename}.json`), "utf8"));
      assert.equal(meta.prompt, "node raw fixture");
      assert.equal(meta.userPrompt, "node raw fixture");
      assert.equal(meta.model, "gpt-5.4");
      assert.equal(meta.reasoningEffort, "high");
      assert.deepEqual(meta.options, { quality: "high", size: "1536x1024", format: "png", moderation: "low" });
      assert.deepEqual(meta.elementIds, ["e_fixture"]);
      assert.deepEqual(meta.elementRevisions, { e_fixture: 4 });
      assert.equal(meta.kind, "generate");
    });
  });

  for (const asyncMode of [false, true]) it(`E03-6 exact partial payload in ${asyncMode ? "async bus" : "legacy SSE"}`, async () => {
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: (call) => {
      assert.equal(apiCall(call).tools[0].partial_images, 2);
      return frames(red, blue);
    } }, async (fixture) => {
      const response = await fixture.post({ ...BASE, async: asyncMode }, { Accept: "text/event-stream" });
      assert.equal(response.status, asyncMode ? 202 : 200);
      if (asyncMode) assert.deepEqual(await response.json(), { requestId: fixture.requestId });
      else {
        const text = await response.text();
        assert.ok(text.indexOf("event: partial") < text.indexOf("event: done"));
        const partial = text.split("\n\n").find((frame) => frame.startsWith("event: partial"));
        assert.ok(partial);
        assert.deepEqual(JSON.parse(partial.split("data: ")[1]), {
          requestId: fixture.requestId, image: `data:image/png;base64,${blue}`, index: 7,
        });
      }
      assert.equal((await fixture.waitTerminal()).event, "done");
      await fixture.waitSettled();
      assert.deepEqual(fixture.events.filter((e) => e.event === "partial").map((e) => e.data), [{
        requestId: fixture.requestId, image: `data:image/png;base64,${blue}`, index: 7,
      }]);
      assert.equal(fixture.events.filter((e) => e.event === "done").length, 1);
      assert.ok(!fixture.events.some((e) => e.event.includes("search") || e.event.includes("planner")));
      assert.equal((await readdir(fixture.generatedDir)).filter((name) => name.endsWith(".png")).length, 1);
    });
  });

  for (const child of [false, true]) it(`API empty 422 remains non-retryable for ${child ? "child" : "root"}`, async () => {
    let attempts = 0;
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: (call) => {
      apiCall(call);
      return ++attempts === 1 ? responsesSse([{ type: "response.completed", response: {} }]) : frames(red);
    } }, async (fixture) => {
      if (child) await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, ...(child ? { parentNodeId: "n_fixture_parent" } : {}) });
      assert.equal(response.status, 422);
      const body = await response.json();
      assert.equal(body.error.code, "EMPTY_RESPONSE");
      await fixture.waitSettled();
      assert.equal(attempts, 1);
    });
  });

  it("E03-3 hard 400 refusal exits without a second node attempt", async () => {
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: (call) => {
      apiCall(call);
      return Response.json({ error: { message: "invalid size", code: "invalid_request_error" } }, { status: 400 });
    } }, async (fixture) => {
      const response = await fixture.post(BASE);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 1);
    });
  });

  for (const contextMode of ["parent-plus-refs", "parent-only"]) it(`API child ordering and no partials: ${contextMode}`, async () => {
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: async (call) => {
      const wire = apiCall(call);
      const content = wire.input[1].content;
      assert.equal(content.length, contextMode === "parent-only" ? 2 : 3);
      await assertColor(content[0].image_url, 2);
      if (contextMode !== "parent-only") await assertColor(content[1].image_url, 1);
      assert.match(content.at(-1).text, /node raw fixture\n\nElement notes:\nblue rim light/);
      assert.equal(wire.tools[0].partial_images, undefined);
      return frames(red, blue);
    } }, async (fixture) => {
      await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, parentNodeId: "n_fixture_parent", contextMode,
        references: [green], async: true, elementNotes: ["blue rim light"] });
      assert.equal(response.status, 202);
      assert.equal((await fixture.waitTerminal()).event, "done");
      await fixture.waitSettled();
      assert.equal(fixture.events.filter((e) => e.event === "partial").length, 0);
      assert.equal(fixture.calls.length, 1);
    });
  });

  for (const removeKey of [false, true]) it(`Grok initial key capture: ${removeKey ? "removal refuses retry" : "nonblank replacement does not rebind retry"}`, async () => {
    let imageCalls = 0;
    let current: Fixture;
    await harness.run("node", { context: { xaiApiKey: "xai-initial-fixture" }, upstream: (call) => {
      if (call.url.startsWith("https://api.x.ai/")) assert.equal(call.headers.get("authorization"), "Bearer xai-initial-fixture");
      if (call.url.endsWith("/images/generations")) {
        assert.equal(JSON.parse(call.body).model, "grok-imagine-image-2.0");
        if (++imageCalls === 1) {
          current.ctx.xaiApiKey = removeKey ? undefined : "xai-replacement-fixture";
          return Response.json({ data: [] });
        }
      }
      return grokResponse(call, red);
    } }, async (fixture) => {
      current = fixture;
      const response = await fixture.post({ ...BASE, provider: "grok-api", model: "grok-imagine-image", quality: "high" });
      assert.equal(response.status, removeKey ? 401 : 200);
      const body = await response.json();
      if (removeKey) assert.equal(body.error.code, "GROK_API_KEY_MISSING");
      else assert.equal(body.model, "grok-imagine-image-2.0");
      await fixture.waitSettled();
      assert.equal(imageCalls, removeKey ? 1 : 2);
      assert.equal(fixture.calls.filter((call) => call.url.endsWith("/chat/completions")).length, removeKey ? 1 : 2);
      assert.equal(fixture.events.filter((e) => e.event === "done").length, removeKey ? 0 : 1);
    });
  });

  for (const child of [false, true]) it(`E03-3 Grok retryable empty: ${child ? "child one attempt" : "root two attempts"}`, async () => {
    let imageCalls = 0;
    await harness.run("node", { context: { xaiApiKey: "xai-initial-fixture" }, upstream: (call) => {
      if (/\/images\/(generations|edits)$/.test(call.url) && ++imageCalls === 1) return Response.json({ data: [] });
      return grokResponse(call, red);
    } }, async (fixture) => {
      if (child) await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, provider: "grok-api", model: "grok-imagine-image",
        ...(child ? { parentNodeId: "n_fixture_parent" } : {}) });
      assert.equal(response.status, child ? 502 : 200);
      const body = await response.json();
      if (child) {
        // Existing node normalization exposes UNKNOWN but preserves provider identity.
        assert.equal(body.error.code, "UNKNOWN");
        assert.equal(body.error.rawCode, "GROK_EMPTY_RESPONSE");
        assert.equal(body.upstreamCode, "GROK_EMPTY_RESPONSE");
      }
      else assert.equal(body.image, `data:image/png;base64,${red}`);
      await fixture.waitSettled();
      assert.equal(imageCalls, child ? 1 : 2);
    });
  });

  for (const provider of ["gemini-api", "minimax"]) it(`${provider} parent-only preserves its explicit reference policy and prompt lane`, async () => {
    await harness.run("node", { context: { geminiApiKey: "gemini-fixture", minimaxApiKey: "minimax-fixture" }, upstream: (call) => {
      const wire = JSON.parse(call.body);
      if (provider === "gemini-api") {
        assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
        assert.deepEqual(wire.contents[0].parts, [
          { text: "node raw fixture\n\nElement notes:\nblue rim light" },
        ]);
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: red } }] } }] });
      }
      assert.equal(new URL(call.url).pathname, "/v1/image_generation");
      assert.equal(wire.prompt, "node raw fixture");
      assert.deepEqual(wire.subject_reference, [{ type: "character", image_file: `data:image/png;base64,${green}` }]);
      return Response.json({ base_resp: { status_code: 0 }, data: { image_base64: [red] } });
    } }, async (fixture) => {
      const response = await fixture.post({ ...BASE, provider, model: provider === "gemini-api" ? "nano-banana-2" : "image-01",
        references: [green], contextMode: "parent-only", elementNotes: ["blue rim light"] });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).refsCount, 0);
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 1);
    });
  });

  for (const child of [false, true]) for (const contextMode of ["parent-only", "parent-plus-refs"]) it(`Agy ${child ? "child" : "root"} ${contextMode} preserves selected input order`, async () => {
    agyCalls.length = 0;
    await harness.run("node", { upstream: () => { throw new Error("Agy must use only its process adapter fixture"); } }, async (fixture) => {
      if (child) await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, provider: "agy", references: [green], contextMode,
        elementNotes: ["blue rim light"], ...(child ? { parentNodeId: "n_fixture_parent" } : {}) });
      assert.equal(response.status, 200);
      await fixture.waitSettled();
      assert.equal(agyCalls.length, 1);
      assert.equal(agyCalls[0].prompt, `${child ? "Edit this image: " : ""}node raw fixture\n\nElement notes:\nblue rim light`);
      const refs = agyCalls[0].references;
      assert.ok(refs);
      assert.equal(refs.length, Number(child) + Number(contextMode !== "parent-only"));
      if (child) {
        const ref = refs[0];
        assert.equal(ref.declaredMime, null);
        assert.equal(ref.detectedMime, null);
        await assertColor(`data:image/png;base64,${ref.b64}`, 2);
      }
      if (contextMode !== "parent-only") await assertColor(`data:image/png;base64,${refs.at(-1)!.b64}`, 1);
      assert.equal(fixture.calls.length, 0);
    });
  });

  for (const overCap of [false, true]) it(`Agy real node admission ${overCap ? "rejects parent plus three refs before operation" : "sends parent plus two refs without clipping"}`, async () => {
    agyCalls.length = 0;
    await harness.run("node", { upstream: () => { throw new Error("Agy route must not use fetch"); } }, async (fixture) => {
      await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, provider: "agy", parentNodeId: "n_fixture_parent",
        references: overCap ? [green, red, blue] : [green, red], contextMode: "parent-plus-refs" });
      assert.equal(response.status, overCap ? 400 : 200);
      const body = await response.json(); await fixture.waitSettled();
      assert.equal(fixture.calls.length, 0);
      assert.equal(agyCalls.length, overCap ? 0 : 1);
      if (overCap) {
        assert.equal(body.code, "AGY_REF_TOO_MANY");
        assert.equal(body.error.code, "AGY_REF_TOO_MANY");
        assert.equal(fixture.events.length, 0);
      } else {
        assert.equal(body.refsCount, 2);
        const refs = agyCalls[0].references!;
        assert.equal(refs.length, 3);
        for (const [index, channel] of [[0, 2], [1, 1], [2, 0]] as const) await assertColor(`data:image/png;base64,${refs[index].b64}`, channel);
      }
    });
  });

  it("Atlas child parent-only still passes parent plus all refs, using raw prompt", async () => {
    let uploads = 0;
    await harness.run("node", { context: { atlasCloudApiKey: "atlas-fixture" }, upstream: (call) => {
      if (call.url.endsWith("/uploadMedia")) return Response.json({ data: `https://fixture.invalid/ref-${++uploads}.png` });
      if (call.url.endsWith("/generateImage")) {
        const wire = JSON.parse(call.body);
        assert.equal(wire.prompt, "Edit this image: node raw fixture");
        assert.deepEqual(wire.images, ["https://fixture.invalid/ref-1.png", "https://fixture.invalid/ref-2.png"]);
        return Response.json({ data: { id: "atlas-node-fixture" } });
      }
      assert.equal(call.url, "https://api.atlascloud.ai/api/v1/model/result/atlas-node-fixture");
      return Response.json({ data: { status: "completed", outputs: [`data:image/png;base64,${red}`] } });
    } }, async (fixture) => {
      await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, provider: "atlascloud", parentNodeId: "n_fixture_parent",
        contextMode: "parent-only", references: [green], elementNotes: ["blue rim light"] });
      assert.equal(response.status, 200);
      await fixture.waitSettled();
      assert.equal(uploads, 2);
      assert.equal(fixture.calls.length, 4);
    });
  });

  it("NAI uses raw prompt and forwards only selected native options", async () => {
    await harness.run("node", { context: { naiApiKey: "nai-fixture" }, upstream: (call) => {
      assert.equal(new URL(call.url).pathname, "/ai/generate-image");
      const wire = JSON.parse(call.body);
      assert.equal(wire.input, "node raw fixture");
      assert.equal(wire.parameters.negative_prompt, "fixture negative");
      assert.equal(wire.parameters.steps, 12);
      return Response.json({ message: "fixture bad request" }, { status: 400 });
    } }, async (fixture) => {
      const response = await fixture.post({ ...BASE, provider: "nai", model: "nai-diffusion-5-full",
        negativePrompt: "fixture negative", steps: 12, elementNotes: ["must not reach NAI"] });
      assert.equal(response.status, 400);
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 1);
    });
  });

  for (const contextMode of ["parent-plus-refs", "parent-only"]) it(`Grok child preserves planner and reference ordering: ${contextMode}`, async () => {
    await harness.run("node", { context: { xaiApiKey: "xai-initial-fixture" }, upstream: async (call) => {
      if (call.url.endsWith("/chat/completions")) {
        assert.ok(call.body.includes("node raw fixture\\n\\nElement notes:\\nblue rim light"));
      }
      if (call.url.endsWith("/images/edits")) {
        const wire = JSON.parse(call.body);
        const images = wire.images ?? [wire.image];
        assert.equal(images.length, contextMode === "parent-only" ? 1 : 2);
        await assertColor(images[0].url, 2);
        if (contextMode !== "parent-only") assert.equal(images[1].url, `data:image/png;base64,${green}`);
        assert.equal(wire.prompt, "planned node fixture");
      }
      return grokResponse(call, red);
    } }, async (fixture) => {
      await seedParent(fixture, blue);
      const response = await fixture.post({ ...BASE, provider: "grok-api", model: "grok-imagine-image",
        parentNodeId: "n_fixture_parent", references: [green], contextMode, elementNotes: ["blue rim light"] });
      assert.equal(response.status, 200);
      await fixture.waitSettled();
      assert.equal(fixture.calls.filter((call) => call.url.endsWith("/responses")).length, 0);
      assert.equal(fixture.calls.filter((call) => call.url.endsWith("/chat/completions")).length, 1);
      assert.equal(fixture.calls.filter((call) => call.url.endsWith("/images/edits")).length, 1);
    });
  });

  it("E03-5 node cancellation aborts the held provider and saves no final", async () => {
    let entered: () => void;
    const providerStarted = new Promise<void>((resolve) => { entered = resolve; });
    let signal: AbortSignal;
    await harness.run("node", { context: { apiKey: "sk-node-fixture" }, upstream: (call) => {
      apiCall(call);
      signal = call.signal;
      assert.ok(signal);
      entered();
      return new Promise<Response>((resolve) => {
        if (signal.aborted) resolve(frames(red));
        else signal.addEventListener("abort", () => resolve(frames(red)), { once: true });
      });
    } }, async (fixture) => {
      assert.equal((await fixture.post({ ...BASE, async: true })).status, 202);
      await providerStarted;
      fixture.cancel();
      const terminal = await fixture.waitTerminal();
      assert.equal(terminal.event, "error");
      assert.equal(terminal.data.code, "GENERATION_CANCELED");
      await fixture.waitSettled();
      assert.equal(signal.aborted, true);
      assert.equal(fixture.events.filter((e) => e.event === "done").length, 0);
      assert.deepEqual(await readdir(fixture.generatedDir), []);
    });
  });
});
