// GPT-5.6 rollout contract (devlog/_plan/260707_gpt56-oidc-devlog-hardening).
// Activation evidence for the widened validators: the previously-rejecting
// branches must now accept gpt-5.6-* and "max", while unknown values still
// hit the reject branch (proving the guard is alive, not removed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coerceReasoningEffortForModel, normalizeImageModel, normalizeReasoningEffort } from "../lib/imageModels.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";
import { config } from "../config.ts";

const GPT56_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("gpt-5.6 rollout: validators", () => {
  // GPT OAuth keeps only GPT-6 now; the API-key lane still serves every 5.6 slug.
  it("accepts every GPT-5.6 slug on the API-key lane and migrates it on GPT OAuth", () => {
    for (const model of GPT56_MODELS) {
      assert.deepEqual(normalizeImageModel({}, model, "api"), { model });
      assert.match(normalizeImageModel({}, model).model ?? "", /^gpt-6-(sol|luna)$/);
    }
  });

  it("still rejects unknown gpt-family slugs (reject branch alive)", () => {
    const result = normalizeImageModel({}, "gpt-5.6-nova");
    assert.equal(result.code, "INVALID_IMAGE_MODEL");
    assert.equal(result.status, 400);
    assert.match(result.error ?? "", /gpt-6-luna, gpt-6-sol, gpt-6-astra/);
    const api = normalizeImageModel({}, "gpt-5.6-nova", "api");
    assert.equal(api.code, "INVALID_IMAGE_MODEL");
    assert.match(api.error ?? "", /gpt-5\.6-sol, gpt-5\.6-terra, gpt-5\.6-luna/);
  });

  it("accepts max reasoning effort (previously rejected)", () => {
    assert.deepEqual(normalizeReasoningEffort({}, "max"), { effort: "max" });
  });

  it("still rejects non-ladder reasoning efforts", () => {
    const result = normalizeReasoningEffort({}, "ultra");
    assert.equal(result.code, "INVALID_REASONING_EFFORT");
    assert.equal(result.status, 400);
    assert.match(result.error ?? "", /max/);
  });

  it("uses luna as the product default on both GPT lanes", () => {
    assert.deepEqual(normalizeImageModel({}, undefined), { model: "gpt-6-luna" });
    assert.equal(config.imageModels.default, "gpt-6-luna");
    assert.deepEqual(normalizeImageModel({}, undefined, "api"), { model: "gpt-5.6-luna" });
  });
});

describe("gpt-5.6 rollout: runtime config", () => {
  it("config advertises the GPT-6 trio on OAuth and max effort", () => {
    assert.deepEqual([...config.imageModels.valid], ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]);
    assert.ok(config.imageModels.validReasoningEfforts.has("max"));
  });
});

// GPT-6 Astra was registered additively: selectable everywhere the 5.6 slugs
// are, with every default left alone. PR #229 originally paired the same
// registration with a repo-wide reasoning-effort change to "max"; that half was
// deliberately not taken, so these assertions pin both halves - Astra present,
// defaults unmoved - to stop either drifting back in unnoticed.
describe("gpt-6 astra: additive registration", () => {
  const ASTRA = "gpt-6-astra";

  it("is selectable through validation, config and the generated UI catalog", () => {
    assert.deepEqual(normalizeImageModel({}, ASTRA), { model: ASTRA });
    assert.ok(config.imageModels.valid.has(ASTRA), "config valid set missing gpt-6-astra");
    const rejection = normalizeImageModel({}, "gpt-6-nova");
    assert.match(rejection.error ?? "", /gpt-6-astra/);
    assert.ok(readSource("ui/src/generated/providers.ts").includes(`"${ASTRA}"`));
  });

  it("reaches the hand-maintained rosters the registry does not generate", () => {
    assert.ok(readSource("bin/lib/model-aliases.ts").includes(`astra: "${ASTRA}"`));
    assert.ok(readSource("bin/lib/error-hints.ts").includes(ASTRA));
    assert.ok(readSource("ui/src/lib/imageModels.ts").includes(ASTRA));
    assert.ok(readSource("ui/src/lib/agentModelOptions.ts").includes(ASTRA));
    assert.ok(readSource("lib/promptBuilder/constants.ts").includes(ASTRA));
    // The ComfyUI bridge is Python and derives from nothing; it is the surface
    // the original attempt missed.
    assert.ok(readSource("integrations/comfyui/ima2_gen_bridge/nodes.py").includes(ASTRA));
    for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"]) {
      assert.ok(readSource(`ui/src/i18n/${locale}.json`).includes("gpt6Astra"), `${locale} missing gpt6Astra`);
    }
  });

  it("leaves every default exactly where it was", () => {
    assert.equal(config.imageModels.default, "gpt-6-luna");
    assert.equal(config.apiProvider.defaultImageModel, "gpt-5.6-luna");
    assert.equal(config.imageModels.reasoningEffort, "medium");
    assert.equal(config.apiProvider.defaultReasoningEffort, "low");
    assert.deepEqual(normalizeImageModel({}, undefined), { model: "gpt-6-luna" });
    assert.equal(readSource("ui/src/lib/reasoning.ts").match(/DEFAULT_REASONING_EFFORT: ReasoningEffort = "(\w+)"/)?.[1], "none");
  });

  // Astra accepts low/medium/high/xhigh/max but not "none", and "none" is this
  // app's own UI default. Selecting Astra therefore has to coerce rather than
  // forward, or the request fails upstream before any image exists.
  it("coerces only the effort Astra cannot accept, and only for Astra", () => {
    assert.equal(coerceReasoningEffortForModel(ASTRA, "none"), "low");
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      assert.equal(coerceReasoningEffortForModel(ASTRA, effort), effort, `${effort} must pass through untouched`);
    }
    for (const model of [...GPT56_MODELS, "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]) {
      assert.equal(coerceReasoningEffortForModel(model, "none"), "none", `${model} must keep none`);
    }
    assert.equal(coerceReasoningEffortForModel(undefined, "none"), "none");
  });

  it("does not let the app's default effort reach Astra unchanged", () => {
    const uiDefault = readSource("ui/src/lib/reasoning.ts").match(/DEFAULT_REASONING_EFFORT: ReasoningEffort = "(\w+)"/)?.[1];
    const resolved = resolveProviderOptions(null, { provider: "oauth", rawModel: ASTRA, rawReasoningEffort: uiDefault });
    assert.equal(resolved.error, undefined);
    assert.equal(resolved.model, ASTRA);
    assert.notEqual(resolved.reasoningEffort, "none");
    assert.equal(resolved.reasoningEffort, "low");
  });
});

describe("gpt-5.6 rollout: surface contracts", () => {
  it("CLI validators know the 5.6 slugs and max", () => {
    // gen.ts moved to catalog-driven validation (010 CLI strict routing):
    // the resolver validates models against GET /api/models, so gen.ts no
    // longer embeds a KNOWN_IMAGE_MODELS literal. Assert the resolver wiring
    // plus the still-local reasoning ladder instead.
    const genSrc = readSource("bin/commands/gen.ts");
    assert.match(genSrc, /resolveTarget\(\s*"image"/);
    assert.match(genSrc, /\/api\/models/);
    assert.match(genSrc, /none, low, medium, high, xhigh, max/);
    const editSrc = readSource("bin/commands/edit.ts");
    const generatedProviders = readSource("ui/src/generated/providers.ts");
    for (const model of GPT56_MODELS) {
      assert.ok(generatedProviders.includes(`"${model}"`), `generated provider models missing ${model}`);
    }
    assert.match(editSrc, /none, low, medium, high, xhigh, max/);
    for (const path of ["bin/commands/multimode.ts", "bin/commands/node.ts"]) {
      assert.match(readSource(path), /none, low, medium, high, xhigh, max/);
    }
  });

  it("prompt builder accepts the 5.6 slugs", () => {
    const src = readSource("lib/promptBuilder/constants.ts");
    for (const model of GPT56_MODELS) {
      assert.ok(src.includes(`"${model}"`), `prompt builder constants missing ${model}`);
    }
    const menu = readSource("ui/src/components/prompt-builder/PromptBuilderModelMenu.tsx");
    assert.match(menu, /modelOptions/);
    assert.doesNotMatch(menu, /const MODELS|const MODEL_ITEMS/);
  });

  it("UI unions and pickers carry the 5.6 slugs and max", () => {
    const types = readSource("ui/src/types.ts");
    const generatedProviders = readSource("ui/src/generated/providers.ts");
    for (const model of GPT56_MODELS) {
      assert.ok(generatedProviders.includes(`"${model}"`), `generated ui types missing ${model}`);
    }
    assert.match(types, /"xhigh" \| "max"/);
    const imageModels = readSource("ui/src/lib/imageModels.ts");
    for (const model of GPT56_MODELS) {
      assert.ok(imageModels.includes(`"${model}"`), `IMAGE_MODEL_OPTIONS missing ${model}`);
    }
    const reasoning = readSource("ui/src/lib/reasoning.ts");
    assert.match(reasoning, /value: "max"/);
    assert.match(reasoning, /max: "M"/);
  });

  it("i18n carries labels for the new options in both locales", () => {
    for (const path of ["ui/src/i18n/en.json", "ui/src/i18n/ko.json"]) {
      const src = readSource(path);
      for (const key of ["gpt56Sol", "gpt56Terra", "gpt56Luna", "\"max\":"]) {
        assert.ok(src.includes(key), `${path} missing ${key}`);
      }
    }
  });
});
