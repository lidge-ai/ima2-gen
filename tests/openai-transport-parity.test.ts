import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import type { ImageExecutionRequest, ExecutionProgress } from "../lib/providers/execution/types.ts";
import type { PostResponsesArgs } from "../lib/responsesTransport.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse, type RouteCase, type RouteHarness, type UpstreamCall } from "./_executionRouteHarness.ts";
import { bounded } from "./_executionTrackedWrites.ts";

const OPTIONS = { model: "gpt-5.4", quality: "high", size: "1536x1024", moderation: "low",
  mode: "direct" as const, reasoningEffort: "high", webSearchEnabled: false };
const imageItem = (result: string, revised_prompt = "transport revised") => ({ type: "image_generation_call", result, revised_prompt });
const final = (b64: string) => ({ type: "response.output_item.done", item: imageItem(b64) });
const done = { type: "response.completed", response: { usage: { total_tokens: 23 } } };
const imageResponse = (b64: string) => responsesSse([final(b64), done]);
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function exactEndpoint(call: UpstreamCall, provider: "api" | "oauth" = "api") {
  assert.equal(call.method, "POST");
  assert.equal(call.url, provider === "api" ? "https://api.openai.com/v1/responses" : "http://oauth-fixture.invalid/v1/responses");
}
function requestFor(surface: "classic" | "node" | "edit" | "multimode", signal: AbortSignal, source: string): ImageExecutionRequest {
  const base = { provider: "api" as const, requestId: undefined, signal, prompt: "captured effective prompt", rawPrompt: "live raw prompt",
    references: [{ b64: source, detectedMime: "image/png", declaredMime: "image/png" }], options: { ...OPTIONS } };
  switch (surface) {
    case "classic": return { ...base, surface, providerUrl: null, background: { background: "auto", outputFormat: "webp" }, backgroundConstraint: undefined, nai: {}, comfy: {} };
    case "node": return { ...base, surface, sourceImage: null, contextMode: "parent-plus-refs", searchMode: "off", partialImages: 0, nai: {} };
    case "edit": return { ...base, surface, sourceImage: source, mask: null };
    case "multimode": return { ...base, surface, providerUrl: null, maxImages: 3, nai: {} };
  }
}
type Direct = RouteCase & { controller: AbortController; release: Array<() => void>; track<T>(work: Promise<T>): Promise<T> };
// All direct work is observed before assertion/wait; timeout retains fixture isolation.
async function direct(harness: RouteHarness, upstream: (call: UpstreamCall) => Response | Promise<Response>, body: (f: Direct) => Promise<void>) {
  await harness.run("classic", { upstream }, async (f) => {
    const controller = new AbortController(), release: Array<() => void> = [], pending: Promise<unknown>[] = [];
    const originalConfig = f.ctx.config;
    const track = <T>(work: Promise<T>) => { pending.push(work); return f.trackWork(work); };
    try { await body({ ...f, controller, release, track }); }
    finally {
      for (const unblock of release) unblock();
      controller.abort(); await bounded(Promise.allSettled(pending));
      f.ctx.config = originalConfig;
    }
  });
}
async function post(f: Direct, options: Partial<PostResponsesArgs> = {}) {
  try {
    const { postResponses } = await import("../lib/responsesTransport.ts");
    return await postResponses({ ctx: f.ctx, provider: "api", scope: "wp04-transport", payload: { model: "fixture-model", stream: true },
      signal: f.controller.signal, ...options });
  } catch (error) { throw error; }
}
async function execute(f: Direct, request: ImageExecutionRequest, progress?: ExecutionProgress) {
  try {
    const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
    return await (await prepareImageExecution(f.ctx, request, progress)).execute();
  } catch (error) { throw error; }
}

export async function runLayeredAbortCase(harness: RouteHarness, layer: string, callerAbort: boolean, source: string) {
  const entered = gate();
  const reasons: unknown[] = [];
  await direct(harness, (call) => {
    exactEndpoint(call); assert.ok(call.signal);
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => { reasons.push(call.signal!.reason); reject(call.signal!.reason); };
      if (call.signal!.aborted) abort(); else call.signal!.addEventListener("abort", abort, { once: true });
      entered.release();
    });
  }, async (f) => {
    f.ctx.config = { ...f.ctx.config, oauth: { ...f.ctx.config.oauth, generationTimeoutMs: callerAbort ? 5000 : 20 } };
    let work: Promise<unknown>;
    if (layer === "transport") work = f.track(post(f));
    else if (layer === "operations") {
      const { generateViaResponses } = await import("../lib/providers/adapters/openaiOperations.ts");
      work = f.track(generateViaResponses("api", "abort operation", "high", "1536x1024", "low", [], null, "direct", f.ctx, { signal: f.controller.signal }));
    } else {
      assert.ok(layer === "classic" || layer === "node" || layer === "edit" || layer === "multimode");
      work = f.track(execute(f, requestFor(layer, f.controller.signal, source)));
    }
    const expectedCode = layer === "classic" ? (callerAbort ? "INVALID_REQUEST" : "UNKNOWN")
      : (callerAbort ? "GENERATION_CANCELED" : "RESPONSES_IMAGE_TIMEOUT");
    const rejected = assert.rejects(work, (error: Error & { code?: string; status?: number; cause?: unknown }) => {
      assert.equal(error.code, expectedCode); assert.equal(error.status, callerAbort ? 499 : 504);
      if (layer === "classic") {
        const cause = error.cause as Error & { code?: string; cause?: unknown };
        assert.equal(cause.code, callerAbort ? "GENERATION_CANCELED" : "RESPONSES_IMAGE_TIMEOUT");
        assert.equal(cause.cause, reasons.at(-1));
      } else assert.equal(error.cause, reasons.at(-1));
      assert.equal((reasons.at(-1) as Error).name, "AbortError");
      return true;
    });
    await bounded(entered.promise);
    if (callerAbort) f.controller.abort();
    await bounded(rejected);
    assert.equal(f.calls.length, layer === "classic" && !callerAbort ? 2 : 1);
  });
}

if (executionTestProcess(import.meta.url)) describe("WP04 real Responses transport and direct execution", { concurrency: false }, () => {
  let harness: RouteHarness;
  let source: string;
  before(async () => {
    harness = await openRouteHarness();
    source = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  for (const provider of ["api", "oauth"] as const) it(`O04-1 transport ${provider} headers and sanitized URL`, async () => {
    await direct(harness, (call) => { exactEndpoint(call, provider); return imageResponse(source); }, async (f) => {
      f.ctx.apiKey = "  fixture-current-key  ";
      f.ctx.oauthUrl = "http://username:password@oauth-fixture.invalid/";
      const result = await f.track(post(f, { provider }));
      assert.equal(result.images[0]!.b64, source); assert.equal(f.calls.length, 1);
      const call = f.calls[0]!;
      assert.equal(call.headers.get("authorization"), provider === "api" ? "Bearer fixture-current-key" : null);
      assert.equal(call.headers.get("content-type"), "application/json"); assert.equal(call.headers.get("accept"), "text/event-stream");
      assert.deepEqual(JSON.parse(call.body), { model: "fixture-model", stream: true });
    });
  });

  for (const key of ["synthetic-secret\nheader", "   "]) it(`O04-7 ${key.trim() ? "malformed" : "missing"} key refuses before network`, async () => {
    await direct(harness, () => { assert.fail("invalid key must never fetch"); }, async (f) => {
      f.ctx.apiKey = key;
      await assert.rejects(f.track(post(f)), (error: Error & { code?: string; status?: number }) => {
        assert.equal(error.status, 401); assert.equal(error.code, key.trim() ? "AUTH_API_KEY_INVALID" : "API_KEY_REQUIRED");
        assert.equal(error.message.includes("synthetic-secret"), false); return true;
      });
      assert.equal(f.calls.length, 0);
    });
  });
  for (const status of [400, 401, 429]) it(`O04-7 HTTP ${status} redaction and paramless wording`, async () => {
    const code = status === 400 ? "invalid_request_error" : status === 401 ? "invalid_api_key" : "rate_limit_exceeded";
    const payload = { error: { code, message: "Bearer synthetic-secret must not leak", type: code } };
    await direct(harness, (call) => { exactEndpoint(call); return Response.json(payload, { status }); }, async (f) => {
      await assert.rejects(f.track(post(f)), (error: Error & Record<string, unknown>) => {
        assert.equal(error.status, status); assert.equal(error.upstreamCode, code); assert.equal(error.upstreamParam, null);
        assert.equal(error.upstreamBodyChars, JSON.stringify(payload).length); assert.equal(error.upstreamMessageRedacted, true);
        // invalid_api_key alone is not classified by the baseline; HTTP 401 supplies this wording.
        assert.equal(error.message, status === 400 ? "OpenAI rejected the image request." : status === 401 ? "OpenAI authentication failed." : "OpenAI rate limited the image request.");
        assert.equal(JSON.stringify(error).includes("synthetic-secret"), false); return true;
      });
      assert.equal(f.calls.length, 1);
    });
  });
  it("O04-7 marked stream error preserves upstream code and event metadata", async () => {
    await direct(harness, (call) => { exactEndpoint(call); return responsesSse([done, { type: "error", error: { code: "rate_limit_exceeded" } }]); }, async (f) => {
      await assert.rejects(f.track(post(f)), (error: Error & Record<string, unknown>) => {
        assert.equal(error.code, "RESPONSES_STREAM_ERROR"); assert.equal(error.status, 502);
        assert.equal(error.upstreamCode, "rate_limit_exceeded"); assert.equal(error.eventCount, 2); assert.equal(error.eventType, "error");
        assert.equal(error.ima2ResponsesError, true); assert.equal(Object.keys(error).includes("ima2ResponsesError"), false); return true;
      });
    });
  });

  for (const layer of ["transport", "operations", "node", "edit", "multimode", "classic"]) for (const abort of [false, true]) {
    it(`O04-8 ${layer} ${abort ? "caller abort" : "internal timer"} keeps layer-specific code/cause/attempts`, async () => {
      await runLayeredAbortCase(harness, layer, abort, source);
    });
  }

  it("O04-1 prepare reads live OAuth readiness at execute and performs zero fetch", async () => {
    await direct(harness, () => { assert.fail("failed readiness cannot fetch"); }, async (f) => {
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      const request = requestFor("node", f.controller.signal, source); request.provider = "oauth";
      const prepared = await f.track(prepareImageExecution(f.ctx, request));
      assert.equal(f.calls.length, 0); f.ctx.oauthReadyState = "failed";
      await assert.rejects(f.track(prepared.execute()), { code: "OAUTH_UNAVAILABLE", status: 503 });
      assert.equal(f.calls.length, 0);
    });
  });
  for (const surface of ["classic", "node", "edit", "multimode"] as const) it(`O04-1 ${surface} capture timing and current API credentials`, async () => {
    await direct(harness, (call) => { exactEndpoint(call); return imageResponse(source); }, async (f) => {
      const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
      const request = requestFor(surface, f.controller.signal, source);
      const prepared = await f.track(prepareImageExecution(f.ctx, request));
      assert.equal(f.calls.length, 0);
      f.ctx.apiKey = "fixture-replaced-at-execute";
      request.prompt = "mutated effective"; request.rawPrompt = "mutated raw";
      request.options.model = "gpt-5.6-luna"; request.options.quality = "medium"; request.references = [];
      await f.track(prepared.execute()); assert.equal(f.calls.length, 1);
      const call = f.calls[0]!, body = JSON.parse(call.body);
      assert.equal(call.headers.get("authorization"), "Bearer fixture-replaced-at-execute");
      assert.equal(body.model, surface === "classic" ? "gpt-5.4" : "gpt-5.6-luna");
      assert.equal(body.tools[0].quality, surface === "classic" ? "high" : "medium");
      const content = body.input[1].content, text = typeof content === "string" ? content : content.at(-1).text;
      assert.ok(text.includes(surface === "classic" ? "captured effective prompt" : surface === "edit" ? "mutated raw" : "mutated effective"));
      if (surface !== "edit") assert.equal(typeof content, "string", "refs read at execute, not prepare");
      if (surface === "classic") assert.deepEqual(body.tools[0], { type: "image_generation", quality: "high", size: "1536x1024", moderation: "low", background: "auto", output_format: "webp" });
    });
  });

  // GPT OAuth no longer runs the Responses image tool, so its empty-stream and prompt-only fallback
  // paths are gone; the plan-retry contract lives in tests/oauth-image-lane-contract.test.ts.

  for (const json of [false, true]) it(`O04-6 ${json ? "JSON retains duplicates without callbacks" : "SSE dedupes and invokes callbacks"}`, async () => {
    await direct(harness, (call) => {
      exactEndpoint(call);
      return json ? Response.json({ output: [imageItem(source, "A"), imageItem(source, "duplicate"), imageItem("B", "B")], usage: { total_tokens: 23 } })
        : responsesSse([{ type: "response.output_item.done", item: imageItem(source, "A") },
          { type: "response.output_item.done", item: imageItem(source, "duplicate") }, { type: "response.output_item.done", item: imageItem("B", "B") }, done]);
    }, async (f) => {
      const callbacks: unknown[] = [];
      const result = await f.track(post(f, { maxImages: 3, onFinalImage: (image, index) => { callbacks.push({ image, index }); } }));
      assert.deepEqual(result.images, json ? [{ b64: source, revisedPrompt: "A" }, { b64: source, revisedPrompt: "duplicate" }, { b64: "B", revisedPrompt: "B" }]
        : [{ b64: source, revisedPrompt: "A" }, { b64: "B", revisedPrompt: "B" }]);
      assert.deepEqual(callbacks, json ? [] : result.images.map((image, index) => ({ image, index })));
      assert.equal(result.eventCount, json ? 3 : 4); assert.equal(result.diagnostics.imageResultCount, 3);
      assert.deepEqual(result.usage, { total_tokens: 23 }); assert.equal(f.calls.length, 1);
    });
  });
  it("O04-6 node partial callback remains independent of partialImages=0 and final callback absent", async () => {
    await direct(harness, (call) => { exactEndpoint(call); return responsesSse([
      { type: "response.image_generation_call.partial_image", partial_image: source, index: 7 }, final(source), done]);
    }, async (f) => {
      const partials: unknown[] = [], finals: unknown[] = [];
      await f.track(execute(f, requestFor("node", f.controller.signal, source), {
        onPartialImage: (partial) => { partials.push(partial); }, onFinalImage: (image) => { finals.push(image); },
      }));
      assert.deepEqual(partials, [{ b64: source, index: 7 }]); assert.deepEqual(finals, []);
      assert.equal(JSON.parse(f.calls[0]!.body).tools[0].partial_images, undefined);
    });
  });
});
