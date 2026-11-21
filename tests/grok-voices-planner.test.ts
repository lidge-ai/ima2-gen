import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";

// Live GET /v1/tts/voices and /v1/language-models, 2026-11-21 (.codexclaw/evidence/grok-live-readonly-261121.md).
const LIVE_VOICES = ["altair", "ara", "atlas", "aurora", "carina", "castor", "celeste", "cosmo", "eve", "helios", "helix", "iris", "kepler", "leo",
  "liora", "lumen", "luna", "lux", "naksh", "orion", "perseus", "rex", "rigel", "sal", "sirius", "ursa", "zagan", "zenith"];

it("lists the 28 live xAI preset voices", () => {
  const source = readFileSync("lib/capabilities.ts", "utf8");
  const block = source.slice(source.indexOf("knownPresets: ["), source.indexOf("],", source.indexOf("knownPresets: [")));
  const ids = [...block.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids, LIVE_VOICES);
});

it("offers grok-4.7 as a planner everywhere while the default stays grok-4.3", async () => {
  const config = await import("../config.ts");
  const { PROMPT_BUILDER_MODELS } = await import("../lib/promptBuilder/constants.ts");
  const { AGENT_LLM_MODEL_OPTIONS } = await import("../ui/src/lib/agentModelOptions.ts");
  const agentSource = readFileSync("lib/agentImageVideoGen.ts", "utf8");
  assert.equal(config.DEFAULT_GROK_PLANNER_MODEL, "grok-4.3");
  assert.ok(config.GROK_PLANNER_MODELS.includes("grok-4.7"));
  assert.ok(PROMPT_BUILDER_MODELS.grok.includes("grok-4.7"));
  assert.ok(AGENT_LLM_MODEL_OPTIONS.some((option) => option.value === "grok-4.7" && option.provider === "grok"));
  assert.match(agentSource, /AGENT_GROK_PLANNER_MODELS = new Set\(\[[^\]]*"grok-4\.7"/);
});
