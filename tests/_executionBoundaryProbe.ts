import assert from "node:assert/strict";
import { mock } from "node:test";
import sharp from "sharp";
import type { RuntimeContext } from "../lib/runtimeContext.ts";
import type { CoreProviderId } from "../lib/providers/registry.ts";
import type { ExecutionProgress, ExecutionSurface, ImageExecutionRequest, SingleImageExecutionResult, SequenceImageExecutionResult } from "../lib/providers/execution/types.ts";
import { isolateExecution } from "./_executionRouteIsolation.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

interface Call { name: string; args: unknown[] }
const transports = {
  "providers/adapters/openaiOperations": ["generateViaResponses", "editViaResponses", "generateMultimodeViaResponses"],
  grokImagePlanner: ["planGrokImage"],
  "providers/adapters/grokOperations": ["generateViaGrok", "editViaGrok"],
  "providers/adapters/grokMultimodeOperations": ["generateMultimodeViaGrok"],
  "providers/adapters/agyOperations": ["generateViaAgy"],
  "providers/adapters/geminiOperations": ["generateViaGeminiApi"],
  atlasCloudImageAdapter: ["generateViaAtlasCloud"], minimaxImageAdapter: ["generateViaMinimax"],
  "api88/imageTransport": ["generateViaApi88Image"],
  naiImageAdapter: ["generateViaNai"], comfyImageAdapter: ["generateViaComfy"],
};

export async function openBoundaryProbe() {
  const isolation = await isolateExecution();
  // The OAuth `grok` lane resolves a real bearer during prepare; keep it off the real HOME.
  const grokAuth = seedGrokAuth();
  const calls: Call[] = [];
  const mocks: Array<{ restore(): void }> = [];
  let failure: unknown;
  let plannedSearchCalls = 7;
  let callbackWork: Promise<void> | undefined;
  const single: SingleImageExecutionResult = {
    b64: "native-image", revisedPrompt: "native-revised", providerUrl: null, mime: "image/webp",
    usage: { total_tokens: 17 }, webSearchCalls: 3, text: "native-text", retryKind: "native-retry",
    initialEventCount: 6, initialEventTypes: { "native-event": 6 }, hadReferences: true,
    referencesDroppedOnRetry: false, developerPromptDroppedOnRetry: true, webSearchDroppedOnRetry: false,
    promptId: "comfy-native-id", origin: "native-origin", effectiveModel: "native-effective-model",
  };
  const callbackImage = { b64: "callback-image", revisedPrompt: "callback-revised", mime: "image/png", providerUrl: "https://fixture.invalid/original" };
  const partial = { b64: "partial-native", index: 2 };
  const queue = { running: false, position: 4 };
  const sequence: SequenceImageExecutionResult = {
    images: [callbackImage], usage: { total_tokens: 29 }, webSearchCalls: 5, extraIgnored: 2,
    text: "sequence-text", eventCount: 9, eventTypes: { "sequence-event": 9 },
    error: new Error("representative native error"),
    diagnostics: {
      eventTypes: { "diagnostic-event": 2 },
      streamStats: { chunkCount: 3, bytesRead: 401, maxChunkBytes: 210, lfBoundaryCount: 2, crlfBoundaryCount: 1,
        parseSkipCount: 0, finalBufferChars: 0, sawDoneSentinel: true, sawResponseCompleted: true },
      outputItemSummary: [], imageCallSeen: true, imageCallCompleted: true, imageCallFailed: false,
      imageResultCount: 1, webSearchCallSeen: true, messageOutputSeen: false, outputTextChars: 13,
    },
  };
  const dispatch = async (name: string, args: unknown[]) => {
    calls.push({ name, args });
    if (failure) throw failure;
    if (name === "planGrokImage") return { prompt: "planned-effective", model: "grok-imagine-image-quality", webSearchCalls: plannedSearchCalls };
    const options = args.at(-1) as ExecutionProgress;
    options.onPartialImage?.(partial);
    options.onQueue?.(queue);
    if (name.startsWith("generateMultimode")) {
      callbackWork = Promise.resolve(options.onFinalImage?.(callbackImage, 3));
      await callbackWork;
      return sequence;
    }
    return single;
  };
  try {
    for (const [module, names] of Object.entries(transports)) {
      mocks.push(mock.module(new URL(`../lib/${module}.ts`, import.meta.url).href, {
        namedExports: Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => dispatch(name, args)])),
      }));
    }
    const { config } = await import("../config.ts");
    const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
    const { prepareImageExecution } = await import("../lib/providers/execution/index.ts");
    const { prepareLegacyImageExecution } = await import("../lib/providers/execution/legacy.ts");
    const ctx = createTestRuntimeContext({ rootDir: isolation.rootDir, config, xaiApiKey: "initial-invented-key",
      api88ImageKey: "synthetic-image-key", api88VideoKey: "synthetic-video-key", grokAuthHomeDir: grokAuth.homeDir });
    const source = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#654321" } }).png().toBuffer()).toString("base64");
    return { calls, single, sequence, callbackImage, partial, queue, ctx, source, grokBearer: grokAuth.bearer,
      prepareImageExecution, prepareLegacyImageExecution,
      failWith(error?: unknown) { failure = error; },
      planSearchCalls(value: number) { plannedSearchCalls = value; },
      callbackPromise() { return callbackWork; },
      reset() { calls.length = 0; failure = undefined; callbackWork = undefined; plannedSearchCalls = 7; ctx.xaiApiKey = "initial-invented-key"; },
      async close() {
        (await import("../lib/db.ts")).closeDb();
        for (const entry of mocks.reverse()) entry.restore();
        try { await isolation.close(); } finally { grokAuth.cleanup(); }
      },
    };
  } catch (error) {
    for (const entry of mocks.reverse()) entry.restore();
    try { await isolation.close(); } finally { grokAuth.cleanup(); }
    throw error;
  }
}

export type BoundaryProbe = Awaited<ReturnType<typeof openBoundaryProbe>>;

export function requestFor<P extends CoreProviderId>(surface: ExecutionSurface, provider: P, source: string): ImageExecutionRequest & { provider: P };
export function requestFor(surface: ExecutionSurface, provider: CoreProviderId, source: string): ImageExecutionRequest {
  const base = {
    provider, requestId: "boundary-fixture", signal: new AbortController().signal,
    prompt: "effective prompt with context", rawPrompt: "raw user prompt",
    references: [{ b64: "first-reference", declaredMime: "image/png", detectedMime: "image/png" },
      { b64: "second-reference", declaredMime: "image/webp", detectedMime: "image/webp" }],
    options: { model: provider === "88api" ? "gpt-image-2" : "grok-imagine-image-quality", quality: "high", size: "1536x1024", moderation: "low",
      mode: "direct" as const, reasoningEffort: "high", webSearchEnabled: false },
  };
  switch (surface) {
    case "classic": return { ...base, surface, providerUrl: "https://fixture.invalid/source", background: { background: "transparent", outputFormat: "png" }, backgroundConstraint: "keep alpha", nai: { seed: 117 }, comfy: { seed: 118, params: { steps: 13 } } };
    case "node": return { ...base, surface, sourceImage: source, contextMode: "parent-plus-refs", searchMode: "off", partialImages: 2, nai: { seed: 117 } };
    case "edit": return { ...base, surface, sourceImage: source, references: [], mask: "literal-mask" };
    case "multimode": return { ...base, surface, providerUrl: "https://fixture.invalid/source", maxImages: 3, nai: { seed: 117 } };
  }
}

export function assertCall(call: Call, ctx: RuntimeContext, request: ImageExecutionRequest): void {
  const { surface, provider } = request;
  const options = call.args.at(-1) as Record<string, unknown>;
  const responses = provider === "api" || provider === "oauth";
  if (provider === "88api") {
    assert.equal(call.args[0], request.prompt); assert.equal(call.args[1], ctx);
    assert.equal(options.model, "gpt-image-2"); assert.equal(options.size, request.options.size);
    assert.equal(options.signal, request.signal); assert.equal(options.requestId, request.requestId);
    assert.equal(options.sourceImage, surface === "node" || surface === "edit" ? request.sourceImage : undefined);
    assert.equal(options.providerUrl, surface === "classic" || surface === "multimode" ? request.providerUrl : undefined);
    assert.equal(options.mask, surface === "edit" ? request.mask : undefined);
    assert.equal("background" in options, false); assert.equal("quality" in options, false);
    return;
  }
  const rawLane = (surface === "node" || surface === "multimode") && ["atlascloud", "minimax", "nai"].includes(provider);
  const prompt = surface === "edit" && (responses || provider.startsWith("grok")) || rawLane ? "raw user prompt" : "effective prompt with context";
  const prefix = (surface === "edit" && !responses && !provider.startsWith("grok"))
    || (surface === "node" && request.sourceImage && ["agy", "gemini-api", "atlascloud", "minimax"].includes(provider));
  assert.equal(call.args[responses ? 1 : 0], `${prefix ? "Edit this image: " : ""}${prompt}`);
  if (provider === "oauth") {
    assert.ok(options.signal instanceof AbortSignal);
    assert.notEqual(options.signal, request.signal, "OAuth uses an invocation-local deadline signal");
    assert.equal(options.signal.aborted, request.signal.aborted);
  } else assert.equal(options.signal, request.signal);
  if (provider !== "agy") assert.equal(options.model, provider.startsWith("grok") && surface !== "node" ? "grok-imagine-image-2.0" : "grok-imagine-image-quality");
  if (provider !== "agy" && !responses) assert.equal(options.size, "1536x1024");
  if (responses) {
    assert.equal(call.args[0], provider);
    assert.equal(call.args[8], surface === "edit" || call.name === "editViaResponses" ? "boundary-fixture" : ctx);
    assert.equal(call.args[call.name === "editViaResponses" ? 7 : 8], ctx);
    const edit = call.name === "editViaResponses";
    assert.equal(call.args[edit ? 3 : 2], "high");
    assert.equal(call.args[edit ? 4 : 3], "1536x1024");
    assert.equal(call.args[edit ? 5 : 4], "low");
    assert.equal(call.args[edit ? 6 : 7], "direct");
    assert.equal(options.reasoningEffort, "high"); assert.equal(options.webSearchEnabled, false);
    if (surface === "edit") assert.equal(options.mask, "literal-mask");
    if (surface === "classic") {
      assert.equal(options.allowPromptOnlyOAuthFallback, provider !== "api");
      assert.equal(options.background, "transparent"); assert.equal(options.outputFormat, "png");
    }
    if (surface === "node") {
      if (request.sourceImage) assert.equal(options.searchMode, "off");
      else assert.equal(options.partialImages, 2);
    }
  } else {
    if (provider !== "agy") assert.equal(call.args[call.name === "editViaGrok" ? 2 : 1], ctx);
    assert.equal(options.requestId, "boundary-fixture");
  }
  if (provider === "nai") { assert.equal(options.seed, 117); assert.equal("references" in options, false); }
  if (provider === "comfy" && surface === "classic") {
    assert.equal(options.seed, 118); assert.deepEqual(options.params, { steps: 13 });
  }
  if (provider === "atlascloud" && surface === "classic") {
    assert.equal(options.background, "transparent"); assert.equal(options.outputFormat, "png");
  }
  if (surface === "multimode" && (responses || provider.startsWith("grok"))) assert.equal(options.maxImages, 3);
  if (provider.startsWith("grok") && (surface === "node" || surface === "multimode")) {
    assert.equal(options.webSearchEnabled, request.options.webSearchEnabled);
  }
}

export function assertReferenceOrder(call: Call, request: ImageExecutionRequest, source: string): void {
  const { surface, provider } = request;
  if (provider === "nai" || surface === "edit") return;
  const options = call.args.at(-1) as Record<string, unknown>;
  if (provider === "88api") {
    const references = options.references as Array<{ b64: string }>;
    assert.deepEqual(references.map((ref) => ref.b64), surface === "node" && request.contextMode === "parent-only"
      ? [] : ["first-reference", "second-reference"]);
    if (surface === "node") assert.equal(options.sourceImage, request.sourceImage);
    return;
  }
  const responses = provider === "api" || provider === "oauth";
  const refs = (responses && call.name !== "editViaResponses" ? call.args[5] : options.references) as Array<{ b64: string; url?: string }> | undefined;
  if (surface === "node") {
    const parent = request.sourceImage ? [source] : [];
    const effectiveRefs = request.contextMode === "parent-only" ? [] : ["first-reference", "second-reference"];
    if (provider === "agy" || provider === "gemini-api") assert.deepEqual(refs?.map((ref) => ref.b64), [...parent, ...effectiveRefs]);
    else if (["atlascloud", "minimax"].includes(provider)) assert.deepEqual(refs?.map((ref) => ref.b64), [...parent, "first-reference", "second-reference"]);
    else assert.deepEqual(refs?.map((ref) => ref.b64), [...(responses ? [] : parent), ...effectiveRefs]);
    if (responses && request.sourceImage) assert.equal(call.args[2], source);
  } else if (provider.startsWith("grok")) {
    assert.deepEqual(refs?.map((ref) => ref.url || ref.b64), ["https://fixture.invalid/source", "first-reference", "second-reference"]);
  } else assert.deepEqual(refs?.map((ref) => ref.b64), ["first-reference", "second-reference"]);
}
