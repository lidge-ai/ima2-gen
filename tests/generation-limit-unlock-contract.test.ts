import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

const openaiOwners = [
  "lib/providers/adapters/openaiExecution.ts",
  "lib/providers/adapters/openaiOperations.ts",
  "lib/responsesTransport.ts",
];

function assertNoEightCap(source, owner) {
  assert.doesNotMatch(source, /Math\.min\(8/, owner);
  assert.doesNotMatch(source, /<1-8>/, owner);
}

test("generation image-count limit is configured once and exposed to clients", () => {
  const config = readSource("config.ts");
  const capabilities = readSource("lib/capabilities.ts");
  const configKeys = readSource("lib/configKeys.ts");

  assert.match(config, /maxGeneratedImages: pickInt\(env\.IMA2_MAX_GENERATED_IMAGES, fileCfg\.limits\?\.maxGeneratedImages, 24\)/);
  assert.match(config, /maxParallel: pickInt\(env\.IMA2_MAX_PARALLEL, fileCfg\.limits\?\.maxParallel, 24\)/);
  assert.match(config, /export const MAX_GENERATED_IMAGES = config\.limits\.maxGeneratedImages/);
  assert.match(capabilities, /maxGeneratedImages: appConfig\.limits\.maxGeneratedImages/);
  assert.match(capabilities, /enforced: true/);
  assert.match(configKeys, /"limits\.maxGeneratedImages"/);
  assert.match(configKeys, /IMA2_MAX_GENERATED_IMAGES/);
});

test("server generation paths no longer keep hard-coded 8 image-count caps", () => {
  for (const relPath of [
    "lib/generatePipeline.ts",
    "lib/multimodePipeline.ts",
    "lib/providers/execution/index.ts",
    "lib/providers/execution/admission.ts",
    "lib/providers/execution/legacy.ts",
    "lib/providers/execution/legacyClassic.ts",
    "lib/providers/execution/legacyNode.ts",
    "lib/providers/execution/legacyEdit.ts",
    "lib/providers/execution/legacyMultimode.ts",
    ...openaiOwners,
    "lib/multimodeHelpers.ts",
    "lib/oauthProxy/prompts.ts",
    "lib/oauthProxy/generators.ts",
  "lib/oauthProxy/multimodeGenerators.ts",
    "lib/oauthProxy/streams.ts",
    "lib/responsesImageAdapter.ts",
    "lib/grokMultimodeAdapter.ts",
    "lib/providers/adapters/grokMultimodeOperations.ts",
    "lib/agentCommandParser.ts",
    "lib/agentRuntime.ts",
    "lib/agentGenerationPlanner.ts",
    "lib/agentSettings.ts",
    "bin/commands/gen.ts",
    "bin/commands/multimode.ts",
    "bin/commands/node.ts",
  ]) {
    const src = readSource(relPath);
    assertNoEightCap(src, relPath);
  }
});

test("each migrated owner rejects an in-memory eight-cap mutation", () => {
  for (const owner of [...openaiOwners, "lib/providers/adapters/grokMultimodeOperations.ts"]) {
    const source = readSource(owner);
    assertNoEightCap(source, owner);
    for (const mutation of ['const capped = Math.min(8, requested);', 'const help = "<1-8>";']) {
      assert.throws(() => assertNoEightCap(`${source}\n${mutation}`, owner),
        { name: "AssertionError" }, `${owner}: cap mutation must fail the source oracle`);
    }
  }
});

test("Agent natural-language fanout parser is not limited to eight variants", () => {
  const planner = readSource("lib/agentGenerationPlanner.ts");

  assert.match(planner, /NUMERIC_COUNT_PATTERN/);
  assert.match(planner, /twenty\[-\\s\]\?four/);
  assert.match(planner, /스물네/);
  assert.doesNotMatch(planner, /\(\?:eight\|8\)/);
  assert.doesNotMatch(planner, /\(\?:여덟\|8\)/);
});

test("frontend count persistence uses the shared 24 image limit", () => {
  const limits = readSource("ui/src/lib/generationLimits.ts");
  const picker = readSource("ui/src/components/CountPicker.tsx");
  const persistence = readSource("ui/src/store/storePersistence.ts");
  const agentPanel = readSource("ui/src/components/agent/AgentQualityPanel.tsx");
  const agentSettings = readSource("ui/src/lib/agentGenerationSettings.ts");

  assert.match(limits, /MAX_GENERATION_COUNT = 24/);
  assert.match(picker, /normalizeGenerationCount/);
  assert.match(persistence, /normalizeGenerationCount/);
  assert.match(agentPanel, /MAX_AGENT_VARIANTS/);
  assert.match(agentPanel, /MAX_AGENT_PARALLELISM/);
  assert.match(agentSettings, /MAX_AGENT_VARIANTS = MAX_GENERATION_COUNT/);
  assert.doesNotMatch(picker, /Math\.min\(8/);
  assert.doesNotMatch(persistence, /Math\.min\(8/);
  assert.doesNotMatch(agentPanel, /max=\{8\}/);
  assert.doesNotMatch(agentSettings, /maxAutoVariants: 8/);
});

test("frontend reference limit syncs from server capabilities", () => {
  const app = readSource("ui/src/App.tsx");
  const api = readSource("ui/src/lib/api-capabilities.ts");
  const store = readSource("ui/src/store/useAppStore.ts");
  const types = readSource("ui/src/store/storeTypes.ts");
  const capabilitiesStore = readSource("ui/src/store/storeCapabilitiesImpl.ts");
  const helpers = readSource("ui/src/store/storeHelpers.ts");
  const refs = readSource("ui/src/store/storeReferenceImpl.ts");
  const nodeRefs = readSource("ui/src/store/storeNodeRefImpl.ts");
  const ui = readSource("ui/src/store/storeUIImpl.ts");
  const composer = readSource("ui/src/components/PromptComposer.tsx");

  assert.match(api, /\/api\/capabilities/);
  assert.match(capabilitiesStore, /getCapabilities/);
  assert.match(capabilitiesStore, /capabilities\.limits\?\.maxRefCount/);
  assert.match(app, /syncCapabilities/);
  assert.match(types, /referenceLimit: number/);
  assert.match(store, /referenceLimit: DEFAULT_REFERENCE_IMAGE_LIMIT/);
  assert.match(helpers, /DEFAULT_REFERENCE_IMAGE_LIMIT = 5/);
  // Composer surfaces now consume the provider-aware wrapper, which derives
  // from the server-synced referenceLimit (ui/src/lib/referenceLimits.ts).
  assert.match(refs, /get\(\)\.activeReferenceLimit\(\)/);
  assert.match(nodeRefs, /get\(\)\.referenceLimit/);
  assert.match(ui, /get\(\)\.activeReferenceLimit\(\)/);
  assert.match(composer, /const maxRefs = useAppStore\(\(s\) => s\.activeReferenceLimit\(\)\)/);
  assert.match(store, /serverLimit: get\(\)\.referenceLimit/);
  assert.doesNotMatch(refs, /MAX_REFERENCE_IMAGES/);
  assert.doesNotMatch(nodeRefs, /MAX_REFERENCE_IMAGES/);
  assert.doesNotMatch(composer, /MAX_REFS|MAX_REFERENCE_IMAGES/);
});
