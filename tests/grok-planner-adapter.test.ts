import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertOwned, isolateExecution } from "./_executionRouteIsolation.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

const isolation = await isolateExecution();
// These legacy adapter calls resolve the OAuth `grok` credential from ~/.progrok/auth.json.
const grokAuth = seedGrokAuth();
const { imageTransport } = isolation;
const deniedFetch = globalThis.fetch;
after(async () => { try { await isolation.close(); } finally { grokAuth.cleanup(); } });
afterEach(async () => {
  try {
    await imageTransport.deactivate();
    assert.deepEqual(imageTransport.violations, []);
  } finally { globalThis.fetch = deniedFetch; }
});

const {
  buildGrokPlannerPayload,
  buildGrokSearchPayload,
  editViaGrok,
  generateViaGrok,
  parseGrokImagePlan,
} = await import("../lib/grokImageAdapter.js");
const { generateMultimodeViaGrok } = await import("../lib/grokMultimodeAdapter.js");
const { config, DEFAULT_GROK_PLANNER_MODEL } = await import("../config.js");
for (const key of ["configDir", "dbPath", "generatedDir", "trashDir", "generationRequestLogFile"] as const) {
  assertOwned(isolation.rootDir, config.storage[key]);
}

function activateImageTransport() {
  const respond = globalThis.fetch;
  assert.notEqual(respond, isolation.nativeFetch);
  assert.notEqual(respond, deniedFetch);
  imageTransport.activate({
    hosts: { "cdn.x.ai": [{ address: "8.8.8.8", family: 4 }] },
    respond: (call) => {
      assert.equal(call.method, "GET");
      assert.equal(call.body, "");
      // Reuse the legacy CDN branch without inventing a JSON POST body.
      return respond(call.url, { method: "GET", headers: call.headers, signal: call.signal });
    },
  });
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      ...config,
      grokProvider: {
        ...config.grokProvider,
        plannerModel: "grok-4.3",
        plannerTimeoutMs: 10_000,
        generationTimeoutMs: 10_000,
      },
    },
    packageVersion: "test",
    grokAuthHomeDir: grokAuth.homeDir,
    ...overrides,
  } as any;
}

function plannerUserText(payload: ReturnType<typeof buildGrokPlannerPayload>): string {
  const content = payload.messages[1].content;
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("Grok planner adapter", () => {
  it("uses the current planner by default while preserving explicit compatibility overrides", () => {
    const sizeParams = { aspect_ratio: "1:1", resolution: "1k" } as const;
    assert.equal(
      buildGrokPlannerPayload("default", "grok-imagine-image-quality", "1024x1024", sizeParams).model,
      DEFAULT_GROK_PLANNER_MODEL,
    );
    assert.equal(buildGrokSearchPayload("default").model, DEFAULT_GROK_PLANNER_MODEL);
    assert.equal(buildGrokSearchPayload("compat", "grok-4.3").model, "grok-4.3");
  });

  it("builds a forced generate_image tool call payload", () => {
    const payload = buildGrokPlannerPayload(
      "make a poster",
      "grok-imagine-image-quality",
      "2048x1152",
      { aspect_ratio: "16:9", resolution: "2k" },
      "grok-4.3",
      "Search found current stage-lighting references.",
      [
        { b64: Buffer.from("ref-one").toString("base64"), detectedMime: "image/png" },
        { b64: Buffer.from("ref-two").toString("base64"), detectedMime: "image/jpeg" },
      ],
    );
    const userText = plannerUserText(payload);

    assert.equal(payload.model, "grok-4.3");
    assert.equal(payload.parallel_tool_calls, false);
    assert.deepEqual(payload.tool_choice, { type: "function", function: { name: "generate_image" } });
    assert.equal(payload.tools[0].function.name, "generate_image");
    assert.match(String(payload.messages[0].content), /MUST be in English/);
    assert.match(userText, /2048x1152/);
    assert.match(userText, /"aspect_ratio":"16:9"/);
    assert.match(userText, /Search found current/);
    assert.match(userText, /Reference images attached: 2/);
    assert.match(userText, /prompt argument in English only/);
    assert.equal(Array.isArray(payload.messages[1].content), true);
    assert.equal((payload.messages[1].content as any[]).filter((part) => part.type === "image_url").length, 2);
  });

  it("builds a mandatory web_search responses payload", () => {
    const payload = buildGrokSearchPayload("make a current poster", "grok-4.3");

    assert.equal(payload.model, "grok-4.3");
    assert.deepEqual(payload.tools, [{ type: "web_search" }]);
    assert.equal(payload.tool_choice, "required");
    assert.match(payload.input[0].content, /must use web_search/);
  });

  it("parses planner tool arguments", () => {
    const plan = parseGrokImagePlan({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "generate_image",
              arguments: JSON.stringify({ prompt: "cinematic cat", model: "grok-imagine-image" }),
            },
          }],
        },
      }],
    }, "grok-imagine-image-quality");

    assert.deepEqual(plan, { prompt: "cinematic cat", model: "grok-imagine-image-quality", webSearchCalls: 1 });
  });

  for (const webSearchEnabled of [undefined, true, false]) {
  it(`runs legacy generate search=${webSearchEnabled ?? "omitted"}, planner, then images API without unsupported size`, async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief with current references." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned image prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from("jpeg"), { headers: { "Content-Type": "image/jpeg" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-gen.png" }],
        usage: { cost_in_usd_ticks: 400000000 },
      });
    }) as typeof fetch;

    activateImageTransport();
    const result = await generateViaGrok("raw prompt", ctx(), {
      model: "grok-imagine-image-quality",
      size: "2048x1152",
      requestId: "req_test",
      ...(webSearchEnabled === undefined ? {} : { webSearchEnabled }),
    });

    const searchCalls = webSearchEnabled === false ? 0 : 1;
    assert.equal(calls.length, searchCalls + 3);
    // Search, planner and generation all leave for the direct xAI origin.
    assert.equal(calls.slice(0, searchCalls + 2).every((call) => call.url.startsWith("https://api.x.ai/")), true);
    assert.equal(calls.filter((call) => call.url.endsWith("/v1/responses")).length, searchCalls);
    if (searchCalls) {
      assert.equal(calls[0].url.endsWith("/v1/responses"), true);
      assert.equal(calls[0].body.tool_choice, "required");
      assert.match(plannerUserText(calls[1].body), /Visual search brief/);
    }
    assert.equal(calls[searchCalls].url.endsWith("/v1/chat/completions"), true);
    assert.equal(calls[searchCalls].body.model, "grok-4.3");
    assert.equal(calls[searchCalls + 1].url.endsWith("/v1/images/generations"), true);
    assert.equal(calls[searchCalls + 1].body.prompt, "planned image prompt");
    assert.equal(calls[searchCalls + 1].body.aspect_ratio, "16:9");
    assert.equal(calls[searchCalls + 1].body.resolution, "2k");
    assert.equal("size" in calls[searchCalls + 1].body, false);
    assert.equal(result.revisedPrompt, "planned image prompt");
    assert.equal(result.webSearchCalls, searchCalls);
    assert.equal(result.mime, "image/jpeg");
    assert.equal(imageTransport.calls.length, 1);
    assert.equal(imageTransport.resolutions.length, 1);
  });
  }

  it("uses image edits endpoint when classic Grok generation has reference images", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief for reference-based image editing." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned edit prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from("png"), { headers: { "Content-Type": "image/png" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-edit.png" }],
      });
    }) as typeof fetch;

    activateImageTransport();
    const result = await generateViaGrok("raw prompt", ctx(), {
      model: "grok-imagine-image-quality",
      size: "2048x1152",
      requestId: "req_ref",
      references: [
        { b64: Buffer.from("ref-one").toString("base64"), detectedMime: "image/png" },
        { b64: Buffer.from("ref-two").toString("base64"), declaredMime: "image/jpeg" },
      ],
    });

    assert.equal(calls.length, 4);
    assert.equal(calls[2].url.endsWith("/v1/images/edits"), true);
    assert.equal(calls[2].body.prompt, "planned edit prompt");
    assert.equal(Array.isArray(calls[2].body.images), true);
    assert.equal(calls[2].body.images.length, 2);
    assert.match(calls[2].body.images[0].url, /^data:image\/png;base64,/);
    assert.match(calls[2].body.images[1].url, /^data:image\/jpeg;base64,/);
    assert.equal(calls[2].body.aspect_ratio, "16:9");
    assert.equal(calls[2].body.resolution, "2k");
    assert.equal("size" in calls[2].body, false);
    assert.match(plannerUserText(calls[1].body), /Reference images attached: 2/);
    assert.match(plannerUserText(calls[1].body), /prompt argument in English only/);
    assert.equal(calls[1].body.messages[1].content.filter((part: any) => part.type === "image_url").length, 2);
    assert.equal(result.revisedPrompt, "planned edit prompt");
    assert.equal(result.webSearchCalls, 1);
    assert.equal(imageTransport.calls.length, 1);
    assert.equal(imageTransport.resolutions.length, 1);
  });

  for (const webSearchEnabled of [undefined, true, false]) {
  it(`uses legacy multimode search=${webSearchEnabled ?? "omitted"}, multimodal planner, and edits endpoint`, async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Visual search brief for multimode reference editing." }],
          }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned multimode edit prompt", model: "grok-imagine-image-quality" }),
                },
              }],
            },
          }],
        });
      }
      if (String(url).startsWith("https://cdn.x.ai/")) {
        return new Response(Buffer.from("multi-ref"), { headers: { "Content-Type": "image/jpeg" } });
      }
      return Response.json({
        data: [{ url: "https://cdn.x.ai/test-multi.png" }],
      });
    }) as typeof fetch;

    activateImageTransport();
    const result = await generateMultimodeViaGrok("raw sequence prompt", ctx(), {
      model: "grok-imagine-image-quality",
      size: "2048x1152",
      maxImages: 1,
      requestId: "req_multi_ref",
      ...(webSearchEnabled === undefined ? {} : { webSearchEnabled }),
      references: [
        { b64: Buffer.from("ref-one").toString("base64"), detectedMime: "image/png" },
      ],
    });

    const searchCalls = webSearchEnabled === false ? 0 : 1;
    assert.equal(calls.length, searchCalls + 3);
    assert.equal(calls.filter((call) => call.url.endsWith("/v1/responses")).length, searchCalls);
    if (searchCalls) assert.equal(calls[0].url.endsWith("/v1/responses"), true);
    assert.equal(calls[searchCalls].url.endsWith("/v1/chat/completions"), true);
    assert.equal(calls[searchCalls + 1].url.endsWith("/v1/images/edits"), true);
    assert.equal(calls[searchCalls + 1].body.prompt, "planned multimode edit prompt");
    assert.match(calls[searchCalls + 1].body.image.url, /^data:image\/png;base64,/);
    assert.equal(calls[searchCalls + 1].body.aspect_ratio, "16:9");
    assert.equal(calls[searchCalls + 1].body.resolution, "2k");
    assert.match(plannerUserText(calls[searchCalls].body), /Reference images attached: 1/);
    assert.equal(calls[searchCalls].body.messages[1].content.filter((part: any) => part.type === "image_url").length, 1);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].revisedPrompt, "planned multimode edit prompt");
    assert.equal(result.webSearchCalls, searchCalls);
    assert.equal(imageTransport.calls.length, 1);
    assert.equal(imageTransport.resolutions.length, 1);
  });
  }
});

describe("Grok image 2.0 quality and retired ids", () => {
  function stubImages(calls: Array<{ url: string; body: any }>) {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith("https://cdn.x.ai/")) return new Response(Buffer.from("jpeg"), { headers: { "Content-Type": "image/jpeg" } });
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
      return Response.json({ data: [{ url: "https://cdn.x.ai/quality.png" }] });
    }) as typeof fetch;
    activateImageTransport();
  }
  const imageCall = (calls: Array<{ url: string; body: any }>) => calls.find(call => /\/v1\/images\/(generations|edits)$/.test(call.url))!.body;
  for (const [quality, expected] of [[undefined, "low"], ["high", "medium"], ["medium", "medium"], ["auto", "auto"]] as const) {
    it(`migrates a retired id to 2.0 with quality ${expected} for request quality ${quality ?? "(none)"}`, async () => {
      const calls: Array<{ url: string; body: any }> = []; stubImages(calls);
      await generateViaGrok("raw", ctx(), { model: "grok-imagine-image-quality", plannedPrompt: "planned", webSearchEnabled: false, ...(quality ? { quality } : {}) } as any);
      assert.equal(imageCall(calls).model, "grok-imagine-image-2.0");
      assert.equal(imageCall(calls).quality, expected);
    });
  }
  it("migrates grok-imagine-image-pro like the quality slug", async () => {
    const calls: Array<{ url: string; body: any }> = []; stubImages(calls);
    await generateViaGrok("raw", ctx(), { model: "grok-imagine-image-pro", plannedPrompt: "planned", webSearchEnabled: false } as any);
    assert.deepEqual([imageCall(calls).model, imageCall(calls).quality], ["grok-imagine-image-2.0", "low"]);
  });
  it("never sends quality for the base image model", async () => {
    const calls: Array<{ url: string; body: any }> = []; stubImages(calls);
    await generateViaGrok("raw", ctx(), { model: "grok-imagine-image", quality: "medium", plannedPrompt: "planned", webSearchEnabled: false } as any);
    assert.equal(imageCall(calls).model, "grok-imagine-image");
    assert.equal("quality" in imageCall(calls), false);
  });
  for (const [quality, expected] of [[undefined, "auto"], ["low", "low"], ["high", "medium"]] as const) {
    it(`edits on 2.0 send quality ${expected} for request quality ${quality ?? "(none)"}`, async () => {
      const calls: Array<{ url: string; body: any }> = []; stubImages(calls);
      await editViaGrok("edit", "aGVsbG8=", ctx(), { model: "grok-imagine-image-2.0", ...(quality ? { quality } : {}) } as any);
      assert.equal(imageCall(calls).quality, expected);
    });
  }
  it("maps the 1.5k Grok size option", async () => {
    const { mapSizeToGrokImageParams } = await import("../lib/grokSizeMapper.js");
    assert.equal(mapSizeToGrokImageParams("grok:1:1:1.5k").resolution, "1.5k");
  });
});
