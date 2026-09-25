import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  config,
  DEFAULT_GROK_PLANNER_MODEL,
  GROK_PLANNER_MODELS,
} from "../config.ts";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_OPTIONS, getImageModelOptionsForProvider } from "../ui/src/lib/imageModels.ts";
import { AGENT_LLM_MODEL_OPTIONS, getAgentLlmModelOption } from "../ui/src/lib/agentModelOptions.ts";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("current model defaults: runtime contract", () => {
  it("projects the Grok planner default and Luna through shared configuration", () => {
    // The video planner rewrites the user's prompt, so its default is a quality call
    // rather than a version race: 4.3 reads better here and 4.6 stays selectable.
    assert.equal(DEFAULT_GROK_PLANNER_MODEL, "grok-4.3");
    assert.equal(GROK_PLANNER_MODELS[0], DEFAULT_GROK_PLANNER_MODEL);
    assert.ok(GROK_PLANNER_MODELS.includes("grok-4.5"));
    assert.ok(GROK_PLANNER_MODELS.includes("grok-4.6"));
    assert.equal(config.grokProvider.plannerModel, DEFAULT_GROK_PLANNER_MODEL);
    assert.equal(config.imageModels.default, "gpt-6-luna");
    assert.equal(config.apiProvider.defaultImageModel, "gpt-5.6-luna");
    assert.equal(config.styleSheet.model, "gpt-5.6-luna", "style sheets run on the API-key client");
    assert.equal(config.cardNewsPlanner.model, "gpt-6-luna");
  });

  it("keeps compatibility activation while centralizing Grok fallbacks", () => {
    const agentSource = readSource("lib/agentImageVideoGen.ts");
    assert.match(agentSource, /DEFAULT_GROK_PLANNER_MODEL, "grok-4\.6", "grok-4\.5", "grok-4\.3"/);

    for (const path of [
      "lib/grokImageCore.ts",
      "lib/grokImagePlanner.ts",
      "lib/grokVideoAdapter.ts",
      "routes/videoExtended.ts",
    ]) {
      const source = readSource(path);
      assert.match(source, /DEFAULT_GROK_PLANNER_MODEL/, `${path} must use the shared Grok planner default`);
    }
  });

  it("derives API model projections from runtime configuration", () => {
    assert.match(readSource("routes/models.ts"), /video:\s*ctx\.config\.grokProvider\.defaultVideoModel/);
    assert.match(readSource("routes/capabilities.ts"), /GROK_PLANNER_MODELS/);
  });

  it("orders active UI model pickers from current defaults to compatibility choices", () => {
    assert.equal(DEFAULT_IMAGE_MODEL, "gpt-6-luna");
    assert.deepEqual(
      IMAGE_MODEL_OPTIONS.slice(0, 9).map((option) => option.value),
      ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    );
    // GPT OAuth offers only GPT-6; the API-key picker keeps its own list with its default first.
    assert.deepEqual(
      getImageModelOptionsForProvider("oauth").map((option) => option.value),
      ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"],
    );
    assert.deepEqual(
      getImageModelOptionsForProvider("api").map((option) => option.value),
      ["gpt-5.6-luna", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    );
    // Gemini lanes share model ids; each lane lists only its own rows, so a
    // value-keyed picker never shows the agy label under the API lane.
    for (const lane of ["agy", "gemini-api"] as const) {
      const rows = getImageModelOptionsForProvider(lane);
      assert.ok(rows.length > 0, lane);
      assert.equal(new Set(rows.map((option) => option.value)).size, rows.length, lane);
      assert.ok(rows.every((option) => option.providerHint === lane), lane);
    }
    assert.deepEqual(
      getImageModelOptionsForProvider("gemini-api").map((option) => option.shortLabel),
      ["nb2 api", "nbp api"],
    );
    // The two GPT pickers are maintained by hand in different files, so pin the
    // OAuth order here too: without this they can silently drift apart, which is
    // how a model ends up selectable in one surface and missing from the other.
    assert.deepEqual(
      AGENT_LLM_MODEL_OPTIONS.filter((option) => option.provider === "oauth").map((option) => option.value),
      ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"],
    );
    assert.deepEqual(
      AGENT_LLM_MODEL_OPTIONS.filter((option) => option.provider === "grok").map((option) => option.value),
      ["grok-4.6", "grok-4.5", "grok-4.3"],
    );
    assert.equal(getAgentLlmModelOption({ provider: "grok", model: "unknown" }).value, "grok-4.6");
    assert.equal(getAgentLlmModelOption({ provider: "grok", model: "grok-4.3" }).value, "grok-4.3");
  });

  it("projects current defaults into UI stores and public documentation", () => {
    const promptBuilderConfig = readSource("config.ts");
    const promptBuilderConstants = readSource("lib/promptBuilder/constants.ts");
    const promptBuilderStore = readSource("ui/src/store/promptBuilderStore.ts");
    assert.match(promptBuilderConfig, /selectedPromptBuilderModel/);
    assert.match(promptBuilderConfig, /DEFAULT_PROMPT_BUILDER_MODELS/);
    assert.match(promptBuilderConstants, /gpt-5\.6-luna/);
    assert.match(promptBuilderConstants, /grok-4\.3/);
    assert.match(promptBuilderStore, /getPromptBuilderConfig/);
    assert.match(promptBuilderStore, /modelOptions/);

    for (const path of [
      "README.md",
      "docs/API.md",
      "docs/CLI.md",
      "site/src/pages/docs/reference/config.astro",
      "site/src/pages/ko/docs/reference/config.astro",
      "structure/03-server-api.md",
      "structure/06-infra-operations.md",
    ]) {
      const source = readSource(path);
      assert.match(source, /gpt-5\.6-luna|grok-4\.5|grok-imagine-video-1\.5/, `${path} missing a current model projection`);
    }
  });
});
