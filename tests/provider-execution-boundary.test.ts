import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type { CoreProviderId } from "../lib/providers/registry.ts";
import type { ExecutionSurface, ExecutionProgress } from "../lib/providers/execution/types.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openBoundaryProbe, requestFor, assertCall, assertReferenceOrder, type BoundaryProbe } from "./_executionBoundaryProbe.ts";

const lanes: Record<ExecutionSurface, readonly CoreProviderId[]> = {
  classic: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy"],
  node: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai"],
  edit: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "comfy"],
  multimode: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai"],
};
const concrete: Partial<Record<CoreProviderId, string>> = {
  agy: "generateViaAgy", "gemini-api": "generateViaGeminiApi", atlascloud: "generateViaAtlasCloud",
  "88api": "generateViaApi88Image", minimax: "generateViaMinimax", nai: "generateViaNai", comfy: "generateViaComfy",
};
function expectedTransport(surface: ExecutionSurface, provider: CoreProviderId) {
  if (provider === "api" || provider === "oauth") return surface === "classic" ? "generateViaResponses"
    : surface === "multimode" ? "generateMultimodeViaResponses" : "editViaResponses";
  if (provider.startsWith("grok")) return surface === "edit" ? "editViaGrok"
    : surface === "multimode" ? "generateMultimodeViaGrok" : "generateViaGrok";
  return concrete[provider];
}

if (executionTestProcess(import.meta.url)) {
  let probe: BoundaryProbe;
  before(async () => { probe = await openBoundaryProbe(); });
  after(async () => { await probe?.close(); });

  for (const surface of Object.keys(lanes) as ExecutionSurface[]) {
    for (const provider of lanes[surface]) {
      test(`${surface}/${provider}: actual family/legacy dispatch, fields, identity and native result`, async () => {
        probe.reset();
        const request = requestFor(surface, provider, probe.source);
        const result = await (await probe.prepareImageExecution(probe.ctx, request)).execute();
        const names = probe.calls.map((call) => call.name);
        assert.deepEqual(names, surface === "classic" && provider.startsWith("grok")
          ? ["planGrokImage", "generateViaGrok"] : [expectedTransport(surface, provider)]);
        const call = probe.calls.at(-1)!;
        assertCall(call, probe.ctx, request);
        assertReferenceOrder(call, request, probe.source);
        if (surface === "multimode") {
          assert.equal(result.kind, "sequence");
          if (["api", "oauth", "grok", "grok-api"].includes(provider)) assert.equal(result.value, probe.sequence);
          else assert.deepEqual(result.value, {
            images: [{ b64: "native-image", revisedPrompt: "native-revised", ...(provider === "88api" ? { mime: "image/webp" } : {}) }],
            usage: { total_tokens: 17 }, webSearchCalls: 3,
          });
        } else {
          assert.equal(result.kind, "single");
          assert.deepEqual(result.value, {
            b64: "native-image", revisedPrompt: "native-revised", providerUrl: null, mime: "image/webp", usage: { total_tokens: 17 },
            webSearchCalls: 3, text: "native-text", retryKind: "native-retry", initialEventCount: 6,
            initialEventTypes: { "native-event": 6 }, hadReferences: true, referencesDroppedOnRetry: false,
            developerPromptDroppedOnRetry: true, webSearchDroppedOnRetry: false, promptId: "comfy-native-id", origin: "native-origin", effectiveModel: "native-effective-model",
          });
          if (!(surface === "edit" && ["api", "oauth"].includes(provider))) assert.equal(result.value, probe.single);
        }
        if (surface === "classic" && provider.startsWith("grok")) {
          const plan = probe.calls[0];
          assertCall(plan, probe.ctx, request);
          const options = plan.args[2] as Record<string, unknown>;
          assert.equal(options.referenceCount, 3); assert.equal(options.backgroundConstraint, "keep alpha");
          assert.equal(options.webSearchEnabled, false);
          assert.equal((call.args[2] as Record<string, unknown>).plannedPrompt, "planned-effective");
          assert.equal((call.args[2] as Record<string, unknown>).webSearchCalls, 7);
        }
      });
    }
  }

  for (const provider of ["grok", "grok-api"] as const) {
    test(`classic/${provider}: prepared zero search count survives repeated executions`, async () => {
      probe.reset();
      probe.planSearchCalls(0);
      const prepared = await probe.prepareImageExecution(probe.ctx, requestFor("classic", provider, probe.source));
      await prepared.execute(); await prepared.execute();
      assert.deepEqual(probe.calls.map((call) => call.name), ["planGrokImage", "generateViaGrok", "generateViaGrok"]);
      for (const call of probe.calls.slice(1)) {
        const options = call.args.at(-1) as Record<string, unknown>;
        assert.equal(options.plannedPrompt, "planned-effective");
        assert.equal(options.webSearchCalls, 0);
      }
    });
  }

  for (const provider of lanes.node) {
    for (const sourceImage of [true, false]) {
      test(`node/${provider}: parent-only ${sourceImage ? "with parent" : "root"} follows migrated policy or explicit legacy exception`, async () => {
        probe.reset();
        const request = requestFor("node", provider, probe.source);
        assert.equal(request.surface, "node");
        if (request.surface !== "node") throw new Error("fixture discriminant");
        request.contextMode = "parent-only";
        request.sourceImage = sourceImage ? probe.source : null;
        await (await probe.prepareImageExecution(probe.ctx, request)).execute();
        assert.equal(probe.calls.length, 1);
        assertCall(probe.calls[0], probe.ctx, request);
        assertReferenceOrder(probe.calls[0], request, probe.source);
      });
    }
  }

  for (const provider of ["agy", "gemini-api"] as const) for (const surface of ["classic", "node", "edit", "multimode"] as const) {
    test(`Google ${surface}/${provider}: captured classic scalars, live inputs and no synthetic callbacks`, async () => {
      probe.reset();
      const request = requestFor(surface, provider, probe.source);
      const progress = {
        onPartialImage: () => assert.fail("Google must not invent partial callbacks"),
        onFinalImage: () => assert.fail("Google must not invent final callbacks"),
        onQueue: () => assert.fail("Google must not invent queue callbacks"),
      };
      const prepared = await probe.prepareImageExecution(probe.ctx, request, progress);
      assert.equal(probe.calls.length, 0, "prepare cannot execute a native operation");
      request.prompt = "updated effective"; request.rawPrompt = "updated raw";
      request.options.model = "updated-model"; request.options.size = "auto";
      request.requestId = "updated-id";
      request.references = [{ b64: "updated-reference", declaredMime: "image/webp", detectedMime: "image/webp" }];
      request.signal = new AbortController().signal;
      if (request.surface === "node") request.sourceImage = null;
      if (request.surface === "edit") request.sourceImage = "updated-source";
      const result = await prepared.execute();
      assert.equal(probe.calls.length, 1, "each surface executes one native operation");
      const call = probe.calls[0];
      const options = call.args.at(-1) as Record<string, unknown>;
      assert.equal(call.args[0], surface === "classic" ? "effective prompt with context"
        : `${surface === "edit" ? "Edit this image: " : ""}updated effective`);
      assert.equal(options.requestId, surface === "classic" ? "boundary-fixture" : "updated-id");
      assert.equal(options.signal, request.signal);
      const references = options.references as Array<{ b64: string }>;
      assert.deepEqual(references.map(ref => ref.b64), [surface === "edit" ? "updated-source" : "updated-reference"]);
      if (provider === "gemini-api") {
        assert.equal(call.args[1], probe.ctx);
        assert.equal(options.model, surface === "classic" ? "grok-imagine-image-quality" : "updated-model");
        assert.equal(options.size, surface === "classic" ? "1536x1024" : "auto");
      }
      if (surface !== "multimode") assert.equal(result.value, probe.single);
      await prepared.execute();
      assert.equal(probe.calls.length, 2, "multimode maxImages does not introduce native loops");
    });

    test(`Google ${surface}/${provider}: optional requestId own-property contract`, async () => {
      probe.reset();
      const request = requestFor(surface, provider, probe.source);
      request.requestId = undefined;
      await (await probe.prepareImageExecution(probe.ctx, request)).execute();
      const options = probe.calls[0].args.at(-1) as Record<string, unknown>;
      assert.equal(options.requestId, undefined);
      assert.equal(Object.hasOwn(options, "requestId"), provider === "agy");
    });
  }

  for (const provider of ["api", "grok"] as const) {
    test(`multimode/${provider}: original callback/image identity and awaited final callback promise`, async () => {
      probe.reset();
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const called = new Promise<void>((resolve) => { entered = resolve; });
      const progress: ExecutionProgress = { onFinalImage: (image, index) => {
        assert.equal(image, probe.callbackImage); assert.equal(index, 3); entered(); return held;
      } };
      const request = requestFor("multimode", provider, probe.source);
      const work = (await probe.prepareImageExecution(probe.ctx, request, progress)).execute();
      let settled = false;
      void work.then(() => { settled = true; });
      await called;
      assert.equal(settled, false);
      assert.equal((probe.calls[0].args.at(-1) as ExecutionProgress).onFinalImage, progress.onFinalImage);
      assert.equal(probe.callbackPromise(), held);
      release();
      assert.equal((await work).value, probe.sequence);
    });
  }

  test("node partial and Comfy queue callbacks retain object and function identity", async () => {
    for (const surface of ["node", "classic"] as const) {
      probe.reset();
      const request = requestFor(surface, surface === "node" ? "api" : "comfy", probe.source);
      if (request.surface === "node") request.sourceImage = null;
      let observed = 0;
      const progress: ExecutionProgress = {
        onPartialImage: (value) => { assert.equal(value, probe.partial); observed++; },
        onQueue: (value) => { assert.equal(value, probe.queue); observed++; },
      };
      await (await probe.prepareImageExecution(probe.ctx, request, progress)).execute();
      const options = probe.calls[0].args.at(-1) as ExecutionProgress;
      assert.equal(surface === "node" ? options.onPartialImage : options.onQueue, surface === "node" ? progress.onPartialImage : progress.onQueue);
      assert.equal(observed, 1);
    }
  });

  for (const surface of ["classic", "node", "edit", "multimode"] as const) {
    test(`${surface}: direct key presence is checked at prepare and each execute; capture point is unchanged`, async () => {
      probe.reset();
      const request = requestFor(surface, "grok-api", probe.source);
      for (const absent of [undefined, " \n\t"]) {
        probe.ctx.xaiApiKey = absent;
        await assert.rejects(probe.prepareImageExecution(probe.ctx, request), { code: "GROK_API_KEY_MISSING", status: 401 });
        assert.equal(probe.calls.length, 0);
      }
      probe.ctx.xaiApiKey = "initial-invented-key";
      const prepared = await probe.prepareImageExecution(probe.ctx, request);
      probe.ctx.xaiApiKey = "replacement-invented-key";
      await prepared.execute(); await prepared.execute();
      const executions = probe.calls.filter((call) => call.name !== "planGrokImage");
      assert.equal(executions.length, 2);
      for (const call of executions) assert.deepEqual((call.args.at(-1) as Record<string, unknown>).credential,
        { kind: "api-key", key: surface === "classic" || surface === "node" ? "initial-invented-key" : "replacement-invented-key" });
      probe.ctx.xaiApiKey = undefined;
      await assert.rejects(prepared.execute(), { code: "GROK_API_KEY_MISSING", status: 401 });
      assert.equal(probe.calls.filter((call) => call.name !== "planGrokImage").length, 2);
    });
  }

  for (const surface of ["classic", "node", "edit", "multimode"] as const) {
    test(`${surface}: facade never wraps native non-Responses errors`, async () => {
      probe.reset();
      const failure = Object.assign(new Error("literal native failure"), { code: "NATIVE_FIXTURE_ERROR", status: 409 });
      const prepared = await probe.prepareImageExecution(probe.ctx, requestFor(surface, "minimax", probe.source));
      probe.failWith(failure);
      await assert.rejects(prepared.execute(), (error) => error === failure);
      assert.equal(probe.calls.length, 1);
    });
  }

  for (const [surface, provider] of [["node", "comfy"], ["edit", "nai"], ["multimode", "comfy"]] as const) {
    test(`legacy ${surface}/${provider} refuses an unsupported branch rather than falling through OAuth`, async () => {
      probe.reset();
      await assert.rejects((await probe.prepareLegacyImageExecution(probe.ctx, requestFor(surface, provider, probe.source))).execute(), /Unsupported/);
      assert.equal(probe.calls.length, 0);
    });
  }
}
