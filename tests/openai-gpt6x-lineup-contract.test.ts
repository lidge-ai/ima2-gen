import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { deriveSupportedImageModels } from "../lib/providers/derive.ts";
import { canonicalizeImageModel } from "../bin/lib/model-aliases.ts";
import { normalizeImageModel, coerceReasoningEffortForModel } from "../lib/imageModels.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";
import { resolveTarget, type ModelCatalog } from "../bin/lib/modelResolver.ts";
import { PROMPT_BUILDER_MODELS } from "../lib/promptBuilder/constants.ts";
import { normalizePromptBuilderModel } from "../lib/promptBuilder/requestSchema.ts";
import { reconcileCoreSelection, selectCoreProvider } from "../ui/src/lib/coreSelection.ts";
import type * as Persistence from "../ui/src/store/coreSelectionPersistence.ts";

const lineup = ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-sol", "gpt-6.2-astra"];
const savedContext = { config: { apiProvider: { defaultImageModel: "gpt-5.6-luna" } } } as Parameters<typeof resolveProviderOptions>[0];
class MemoryStorage {
  rows = new Map<string, string>();
  getItem(key: string) { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string) { this.rows.set(key, value); }
  removeItem(key: string) { this.rows.delete(key); }
}
let persistence: typeof Persistence | undefined;
async function withStorage(run: (api: typeof Persistence, storage: MemoryStorage) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = async () => { throw Error("unexpected fetch"); };
  try {
    if (!persistence) {
      const result = await build({ stdin: { contents: 'import "./ui/src/store/useAppStore.ts"; export * from "./ui/src/store/coreSelectionPersistence.ts";', resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", globalName: "selectionMemory", platform: "browser", define: { "import.meta.env": "{}" } });
      persistence = new Function(result.outputFiles[0]!.text + "\nreturn selectionMemory;\n//# sourceURL=lineup-memory-bundle.js")();
    }
    run(persistence!, storage);
  } finally {
    globalThis.fetch = oldFetch;
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
for (const lane of ["oauth", "api"] as const) {
  test(`1 ${lane} lineup`, () => assert.deepEqual([...deriveSupportedImageModels(lane)], lineup));
}
for (const [alias, expected] of [["terra", "gpt-6.1-terra"], ["sol", "gpt-6.2-sol"], ["astra", "gpt-6.2-astra"]]) {
  test(`2 alias ${alias}`, () => assert.equal(canonicalizeImageModel(alias), expected));
}
for (const [lane, entries] of Object.entries({ oauth: [["gpt-6-sol", "gpt-6.2-sol"], ["gpt-6-astra", "gpt-6.2-astra"], ["gpt-5.6-terra", "gpt-6.1-terra"], ["gpt-6.1-sol", "gpt-6.2-sol"]], api: [["gpt-5.6-luna", "gpt-6-luna"], ["gpt-5.6-terra", "gpt-6.1-terra"], ["gpt-5.6-sol", "gpt-6.2-sol"], ["gpt-6-astra", "gpt-6.2-astra"], ["gpt-5.4-mini", "gpt-6-luna"]] })) {
  for (const [old, expected] of entries) test(`${lane === "oauth" ? 3 : 4} ${lane} migration ${old}`, () => assert.equal(normalizeImageModel(null, old, lane as "oauth" | "api").model, expected));
}
test("4 saved API default migrates", () => assert.equal(normalizeImageModel(savedContext, undefined, "api").model, "gpt-6-luna"));
test("5 API options migrate before effort coercion", () => {
  const result = resolveProviderOptions(null, { provider: "api", rawModel: "gpt-6-sol", rawReasoningEffort: "none" });
  assert.deepEqual({ model: result.model, reasoningEffort: result.reasoningEffort }, { model: "gpt-6.2-sol", reasoningEffort: "low" });
});
test("5 API options migrate saved default", () => assert.equal(resolveProviderOptions(savedContext, { provider: "api" }).model, "gpt-6-luna"));
test("5 GPT-6.2 Sol effort floor", () => assert.equal(coerceReasoningEffortForModel("gpt-6.2-sol", "none"), "low"));
const info = { status: "ready" as const, defaults: {}, models: { image: lineup.map((id) => ({ id })), video: [] } };
const catalog: ModelCatalog = { lanes: { api: info, oauth: info } };
for (const [input, lane, model] of [["api/gpt-5.6-luna", "api", "gpt-6-luna"], ["oauth/sol", "oauth", "gpt-6.2-sol"]]) {
  test(`7 CLI ${input}`, () => assert.deepEqual(resolveTarget("image", { model: input }, catalog, {}), { ok: true, lane, model, transport: "core" }));
}
for (const [provider, imageModel, expected] of [["api", "gpt-5.6-terra", "gpt-6.1-terra"], ["oauth", "gpt-6-astra", "gpt-6.2-astra"]]) {
  test(`8 selection ${provider}`, () => assert.equal(reconcileCoreSelection({ provider, imageModel }).imageModel, expected));
}
test("8 persisted selection", async () => withStorage((api, storage) => {
  storage.setItem("ima2.generationDefaults", JSON.stringify({ provider: "api" }));
  storage.setItem("ima2.imageModel", "gpt-5.6-luna");
  const selection = api.loadCoreSelectionSnapshot();
  assert.deepEqual({ provider: selection.provider, imageModel: selection.imageModel }, { provider: "api", imageModel: "gpt-6-luna" });
}));
test("8 persisted provider memory and switching", async () => withStorage((api, storage) => {
  storage.setItem("ima2.coreSelectionMemory.v1", JSON.stringify({ version: 1, lanes: { oauth: { kind: "image", image: "gpt-6-sol" }, api: { kind: "image", image: "gpt-5.6-sol" } } }));
  const memory = api.loadCoreSelectionMemory();
  assert.deepEqual(memory, { oauth: { kind: "image", image: "gpt-6.2-sol" }, api: { kind: "image", image: "gpt-6.2-sol" } });
  assert.equal(selectCoreProvider(reconcileCoreSelection({ provider: "grok" }), "api", memory.api).imageModel, "gpt-6.2-sol");
}));
test("9 prompt builder API lineup", () => assert.deepEqual(PROMPT_BUILDER_MODELS.api, lineup));
test("9 prompt builder API legacy", () => assert.equal(normalizePromptBuilderModel("api", "gpt-5.5"), "gpt-6-luna"));
describe("controls", () => {
  for (const [provider, model, effort, expected] of [["api", "gpt-6-astra", "none", "low"], ["oauth", "gpt-6-luna", "none", "none"], ["api", "gpt-6-astra", "high", "high"]]) {
    test(`${provider} ${model} ${effort}`, () => assert.equal(resolveProviderOptions(null, { provider, rawModel: model, rawReasoningEffort: effort }).reasoningEffort, expected));
  }
  test("unknown model is rejected", () => assert.equal(normalizeImageModel(null, "unknown-model", "api").code, "INVALID_IMAGE_MODEL"));
  test("other provider memory survives", async () => withStorage((api, storage) => {
    const lanes = { grok: { kind: "image", image: "grok-imagine-image-2.0" }, minimax: { kind: "image", image: "image-01" } };
    storage.setItem("ima2.coreSelectionMemory.v1", JSON.stringify({ version: 1, lanes }));
    assert.deepEqual(api.loadCoreSelectionMemory(), lanes);
  }));
});

test("startup migrates saved and environment Prompt Builder models only for OpenAI lanes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-prompt-config-"));
  try {
    for (const [backend, viaEnv, expected] of [["api", false, "gpt-6.2-sol"], ["oauth", false, "gpt-6.2-sol"], ["api", true, "gpt-6.2-sol"], ["oauth", true, "gpt-6.2-sol"], ["grok", false, "grok-4.3"]] as const) {
      writeFileSync(join(dir, "config.json"), JSON.stringify({ promptBuilder: { backend, model: "gpt-5.6-sol" } }));
      const env = { ...process.env, IMA2_CONFIG_DIR: dir, IMA2_PROMPT_BUILDER_BACKEND: backend };
      delete env.IMA2_PROMPT_BUILDER_MODEL;
      if (viaEnv) env.IMA2_PROMPT_BUILDER_MODEL = "gpt-5.6-sol";
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import {config} from './config.ts'; console.log(config.promptBuilder.model)"], { env, encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), expected, `${backend} env=${viaEnv}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("agent model selection preserves a compatible OpenAI provider", async () => {
  const bundle = await build({ entryPoints: ["ui/src/components/agent/AgentModelSelector.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], plugins: [{ name: "i18n-fixture", setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/i18n$/ }, () => ({ path: "i18n", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useI18n=()=>({t:(key)=>key})", loader: "js" }));
  } }] });
  const requireUi = createRequire(new URL("../ui/package.json", import.meta.url));
  const actualJsx = requireUi("react/jsx-runtime");
  const react = { useEffect() {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] };
  const module = { exports: {} as { AgentModelSelector: (props: unknown) => unknown } };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id: string) => id === "react" ? react : actualJsx });
  for (const [provider, chosen, expected] of [["api", "6.2s", "api"], ["grok", "6l", "oauth"]]) {
    let patch: unknown;
    const tree = module.exports.AgentModelSelector({ settings: { provider, model: provider === "api" ? "gpt-6-luna" : "grok-4.3", reasoningEffort: "high" }, onChange: (value: unknown) => { patch = value; } });
    const find = (node: any): any => {
      if (!node || typeof node !== "object") return undefined;
      if (node.type === "button" && node.props.role === "menuitemradio" && node.props.children?.[0]?.props?.children === chosen) return node;
      for (const child of [node.props?.children].flat(Infinity)) { const match = find(child); if (match) return match; }
    };
    const button = find(tree); assert.ok(button, chosen); button.props.onClick();
    assert.equal((patch as { provider: string }).provider, expected);
    assert.equal((patch as { model: string }).model, chosen === "6.2s" ? "gpt-6.2-sol" : "gpt-6-luna");
  }
});
