import assert from "node:assert/strict";
import test from "node:test";
import {
  coreImageRequestModel, filterCoreSelectionMemory, providerForImageModel,
  reconcileCoreSelection, rememberCoreSelection, selectCoreProvider,
} from "../ui/src/lib/coreSelection.ts";
import { CORE_PROVIDER_IDS, IMAGE_MODEL_IDS, PROVIDER_MODELS } from "../ui/src/generated/providers.ts";
import type { ImageModel, Provider } from "../ui/src/types.ts";

test("explicit core lane wins over conflicting persisted model and video", () => {
  assert.deepEqual(reconcileCoreSelection({ provider: "grok-api", imageModel: "grok-imagine-image-quality",
    videoModelSelected: "grok-imagine-video-1.5-preview" }), {
    provider: "grok-api", imageModel: "grok-imagine-image-quality", videoModelSelected: "grok-imagine-video-1.5",
    comfyWorkflow: null, comfyVideoWorkflow: null,
  });
  assert.deepEqual(reconcileCoreSelection({ provider: "oauth", imageModel: "gpt-5.6-sol",
    videoModelSelected: "grok-imagine-video", comfyWorkflow: "wf-a", comfyVideoWorkflow: "wf-v" }), {
    provider: "oauth", imageModel: "gpt-6-sol", videoModelSelected: false,
    comfyWorkflow: null, comfyVideoWorkflow: null,
  });
  assert.equal(reconcileCoreSelection({ provider: "gemini-api", imageModel: "grok-imagine-image" }).imageModel,
    "nano-banana-pro");
});

test("invalid provider inference is membership-based, including prototype keys", () => {
  for (const provider of [undefined, null, "auto", "constructor", "__proto__", "toString", {}, []]) {
    assert.equal(reconcileCoreSelection({ provider, imageModel: "grok-imagine-image-quality" }).provider, "grok");
    assert.equal(reconcileCoreSelection({ provider, imageModel: "not-a-model" }).provider, "oauth");
  }
  for (const [imageModel, provider] of [["nano-banana-pro", "agy"], ["image-01-live", "minimax"],
    ["nai-diffusion-5-curated", "nai"], ["openai/gpt-image-2/edit", "atlascloud"]]) {
    assert.equal(reconcileCoreSelection({ imageModel }).provider, provider);
  }
  assert.equal(reconcileCoreSelection({ imageModel: "nai-diffusion-5-full", videoModelSelected: "grok-imagine-video" }).provider, "grok");
  assert.equal(reconcileCoreSelection({ provider: "api", imageModel: "gpt-5.3-codex-spark" }).imageModel, "gpt-5.6-luna");
});

test("every fallback belongs to its real supported lane, with independent exact defaults", () => {
  const expected = { oauth: "gpt-6-luna", api: "gpt-5.6-luna", grok: "grok-imagine-image-2.0",
    "grok-api": "grok-imagine-image-2.0", agy: "nano-banana-2", "gemini-api": "nano-banana-pro",
    atlascloud: "openai/gpt-image-2/text-to-image", minimax: "image-01", nai: "nai-diffusion-5-full" };
  for (const provider of CORE_PROVIDER_IDS) {
    const selected = reconcileCoreSelection({ provider, imageModel: "gpt-5.3-codex-spark" });
    if (provider === "comfy") continue;
    assert.equal(selected.imageModel, expected[provider]);
    assert.ok((PROVIDER_MODELS[provider].image as readonly string[]).includes(selected.imageModel));
    assert.ok((IMAGE_MODEL_IDS as readonly string[]).includes(selected.imageModel));
  }
});

test("Comfy migrates legacy runtime id without widening static selection or auto-picking", () => {
  const value = reconcileCoreSelection({ provider: "comfy", imageModel: "wf-legacy",
    comfyVideoWorkflow: "wf-missing", videoModelSelected: "grok-imagine-video" });
  assert.deepEqual(value, { provider: "comfy", imageModel: "gpt-6-luna", videoModelSelected: false,
    comfyWorkflow: "wf-legacy", comfyVideoWorkflow: "wf-missing" });
  assert.equal(reconcileCoreSelection({ provider: "comfy", imageModel: "wf-legacy", comfyWorkflow: "wf-explicit" }).comfyWorkflow, "wf-explicit");
  assert.equal(reconcileCoreSelection({ provider: "comfy", imageModel: "gpt-5.6-sol" }).comfyWorkflow, null);
  assert.equal(reconcileCoreSelection({ provider: "comfy", imageModel: "  ", comfyWorkflow: [] }).comfyWorkflow, null);
});

test("reconciliation is idempotent and never mutates inputs", () => {
  for (const provider of [...CORE_PROVIDER_IDS, "constructor"]) {
    const input = Object.freeze({ provider, imageModel: "wf-old", comfyVideoWorkflow: "wf-video" });
    const next = reconcileCoreSelection(input);
    assert.deepEqual(reconcileCoreSelection(next), next);
    assert.equal(input.imageModel, "wf-old");
  }
});

test("model family switches preserve compatible credential lanes", () => {
  for (const [provider, model, expected] of [
    ["grok-api", "grok-imagine-image-quality", "grok-api"], ["grok-api", "gpt-5.6-sol", "oauth"],
    ["api", "gpt-5.6-sol", "api"], ["gemini-api", "nano-banana-2", "gemini-api"],
    ["comfy", "nai-diffusion-5-full", "nai"],
  ] as Array<[Provider, ImageModel, Provider]>) assert.equal(providerForImageModel(provider, model), expected);
});

test("provider switches restore remembered kind without exposing inactive workflow slots", () => {
  const current = reconcileCoreSelection({ provider: "api", imageModel: "gpt-5.6-sol" });
  assert.equal(selectCoreProvider(current, "api", { kind: "image", image: "gpt-5.4" }), current);
  const comfy = selectCoreProvider(current, "comfy", { kind: "image", image: "wf-a", video: "wf-v" });
  assert.equal(comfy.comfyWorkflow, "wf-a");
  assert.equal(comfy.comfyVideoWorkflow, null);
  assert.equal(selectCoreProvider(current, "comfy").comfyWorkflow, null);
  assert.equal(selectCoreProvider(current, "comfy", { kind: "video", image: "wf-a", video: "wf-v" }).comfyVideoWorkflow, "wf-v");
  assert.equal(selectCoreProvider(current, "grok-api", { kind: "video", video: "grok-imagine-video-1.5-preview" }).videoModelSelected, "grok-imagine-video-1.5");
  assert.deepEqual(rememberCoreSelection(comfy), { kind: "image", image: "wf-a" });
});

test("wire projection accepts optional AppState workflow and never supplies a hosted Comfy default", () => {
  for (const input of [
    { provider: "comfy" as const, imageModel: "gpt-5.6-sol" as const },
    { provider: "comfy" as const, imageModel: "gpt-5.6-sol" as const, comfyWorkflow: undefined },
    { provider: "comfy" as const, imageModel: "gpt-5.6-sol" as const, comfyWorkflow: null },
  ]) assert.equal(JSON.stringify({ model: coreImageRequestModel(input) }), "{}");
  assert.equal(JSON.stringify({ model: coreImageRequestModel({ provider: "comfy", imageModel: "gpt-5.6-sol", comfyWorkflow: "wf-selected" }) }), '{"model":"wf-selected"}');
  assert.equal(JSON.stringify({ model: coreImageRequestModel({ provider: "oauth", imageModel: "gpt-5.6-sol", comfyWorkflow: "wf-stray" }) }), '{"model":"gpt-5.6-sol"}');
});

test("memory allowlist rejects unknown keys and unsupported slots without inventing defaults", () => {
  assert.deepEqual(filterCoreSelectionMemory(null), {});
  assert.deepEqual(filterCoreSelectionMemory([]), {});
  assert.deepEqual(filterCoreSelectionMemory(JSON.parse('{"__proto__":{"kind":"image"},"missing":{"kind":"image"},"oauth":[]}')), {});
  assert.deepEqual(filterCoreSelectionMemory({
    oauth: { kind: "image", image: "gpt-5.3-codex-spark", video: "grok-imagine-video", token: "not-saved" },
    "grok-api": { kind: "video", image: "grok-imagine-image-quality", video: "grok-imagine-video-1.5-preview" },
    comfy: { kind: "image", image: "wf-not-in-catalog", video: "  " },
    nai: { kind: "audio", image: "nai-diffusion-5-full" },
  }), { oauth: { kind: "image" }, "grok-api": { kind: "video", image: "grok-imagine-image-quality", video: "grok-imagine-video-1.5" },
    comfy: { kind: "image", image: "wf-not-in-catalog" } });
});
