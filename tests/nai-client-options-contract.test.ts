import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPILED_FALLBACK,
  NAI_UI_NOISE_SCHEDULES,
  NAI_UI_QUALITY_PRESETS,
  NAI_UI_SAMPLERS,
  NAI_UI_UC_PRESETS,
  coerceNaiOverrides,
  isNaiV5Model,
  resolveNaiOptions,
} from "../ui/src/lib/naiOptions.ts";
import {
  NAI_NOISE_SCHEDULES,
  NAI_QUALITY_PRESET_IDS,
  NAI_SAMPLERS,
  NAI_UC_PRESET_IDS,
} from "../lib/naiImageAdapter.ts";
import { readNaiOptions } from "../lib/naiOptions.ts";
import { NAI_OPTIONS_STORAGE_KEY, PERSISTED_KEYS, PERSISTED_REGISTRY } from "../ui/src/store/persistenceRegistry.ts";
import { effectiveCoreGenerationMode } from "../ui/src/lib/coreGenerationMode.ts";
import { naiPayloadFields } from "../ui/src/lib/naiPayload.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// The defect this file guards: the server accepted NovelAI tuning fields that
// no client ever sent. These cases pin the client half of that contract.

test("UI alphabets match the server, minus the V3-only sampler", () => {
  for (const sampler of NAI_UI_SAMPLERS) {
    assert.ok(NAI_SAMPLERS.includes(sampler), `server must accept ${sampler}`);
  }
  // ddim_v3 exists server-side for completeness but no registered model takes it.
  assert.ok(NAI_SAMPLERS.includes("ddim_v3"));
  assert.equal(NAI_UI_SAMPLERS.includes("ddim_v3" as never), false);

  assert.deepEqual([...NAI_UI_NOISE_SCHEDULES], [...NAI_NOISE_SCHEDULES]);
  assert.deepEqual([...NAI_UI_UC_PRESETS], [...NAI_UC_PRESET_IDS]);
  assert.deepEqual([...NAI_UI_QUALITY_PRESETS], [...NAI_QUALITY_PRESET_IDS]);
});

test("every field the client can emit is a field the server reads", () => {
  // The whole point of the unit, encoded: a key with no server reader is a
  // control that silently does nothing.
  const emitted = Object.keys(COMPILED_FALLBACK).concat("negativePrompt");
  const probe: Record<string, unknown> = {
    sampler: "k_euler",
    noiseSchedule: "native",
    steps: 20,
    scale: 4,
    cfgRescale: 0.3,
    ucPresetId: "none",
    qualityPresetId: "none",
    varietyPlus: true,
    straightAlpha: true,
    autoSmea: true,
    decrisper: true,
    seed: 7,
    negativePrompt: "blurry",
  };
  const accepted = readNaiOptions(probe);
  for (const key of emitted) {
    if (key === "seed") continue; // null is the UI's "unset"; a number round-trips
    assert.ok(key in accepted, `server must read ${key}`);
  }
  assert.equal(accepted.seed, 7);
});

test("compiled fallback matches the server's configured defaults", () => {
  const config = read("config.ts");
  assert.match(config, /defaultSteps[^)]*?23/s);
  assert.match(config, /defaultScale[^)]*?5/s);
  assert.match(config, /defaultSampler[^)]*?"k_euler_ancestral"/s);
  assert.match(config, /defaultNoiseSchedule[^)]*?"karras"/s);
  assert.equal(COMPILED_FALLBACK.steps, 23);
  assert.equal(COMPILED_FALLBACK.scale, 5);
  assert.equal(COMPILED_FALLBACK.sampler, "k_euler_ancestral");
  assert.equal(COMPILED_FALLBACK.noiseSchedule, "karras");
  assert.equal(COMPILED_FALLBACK.autoSmea, false);
  assert.equal(COMPILED_FALLBACK.decrisper, false);
});

test("resolve order is fallback, then server, then the user's override", () => {
  assert.equal(resolveNaiOptions(null, {}).steps, COMPILED_FALLBACK.steps);
  assert.equal(resolveNaiOptions({ steps: 28 }, {}).steps, 28, "operator config wins over compiled");
  assert.equal(resolveNaiOptions({ steps: 28 }, { steps: 40 }).steps, 40, "user wins over operator");
});

test("coerceNaiOverrides drops one bad key without discarding the rest", () => {
  const out = coerceNaiOverrides({ sampler: "nonsense", steps: 30, varietyPlus: true });
  assert.deepEqual(out, { steps: 30, varietyPlus: true });
  // A dropped key degrades toward the operator's configuration, not a constant.
  assert.equal(resolveNaiOptions({ sampler: "k_dpmpp_2m" }, out).sampler, "k_dpmpp_2m");
});

test("coerceNaiOverrides rejects wrong types and out-of-range numbers", () => {
  assert.deepEqual(coerceNaiOverrides({ steps: 999 }), {});
  assert.deepEqual(coerceNaiOverrides({ scale: -1 }), {});
  assert.deepEqual(coerceNaiOverrides({ cfgRescale: 2 }), {});
  assert.deepEqual(coerceNaiOverrides({ straightAlpha: "yes" }), {});
  assert.deepEqual(coerceNaiOverrides({ autoSmea: "yes" }), {});
  assert.deepEqual(coerceNaiOverrides({ decrisper: 1 }), {});
  assert.deepEqual(coerceNaiOverrides({ seed: -1 }), {});
  assert.deepEqual(coerceNaiOverrides(null), {});
  assert.deepEqual(coerceNaiOverrides([1, 2]), {});
});

test("coerceNaiOverrides keeps a null seed and a zero seed apart", () => {
  assert.deepEqual(coerceNaiOverrides({ seed: null }), { seed: null });
  assert.deepEqual(coerceNaiOverrides({ seed: 0 }), { seed: 0 });
});

// A minimal AppState stand-in: naiPayloadFields reads exactly four fields.
function stateOf(over: Record<string, unknown> = {}) {
  return {
    provider: "nai",
    imageModel: "nai-diffusion-5-full",
    naiOptionOverrides: {},
    negativePrompt: "",
    ...over,
  } as never;
}

test("the payload sends overrides, never the resolved options", () => {
  // Untouched fields are absent so the server resolves them from config; a
  // resolved-options payload would re-send defaults the client never authored.
  assert.deepEqual(naiPayloadFields(stateOf()), {});
  assert.deepEqual(
    naiPayloadFields(stateOf({ naiOptionOverrides: { steps: 40 } })),
    { steps: 40 },
  );
  assert.deepEqual(
    naiPayloadFields(stateOf({ negativePrompt: "  blurry  " })),
    { negativePrompt: "blurry" },
  );
  assert.deepEqual(naiPayloadFields(stateOf({ negativePrompt: "   " })), {});
});

test("the payload contributes nothing to a non-nai lane", () => {
  const loaded = { naiOptionOverrides: { steps: 40, straightAlpha: true }, negativePrompt: "blurry" };
  for (const provider of ["oauth", "api", "grok", "gemini-api", "88api", "minimax", "comfy"]) {
    assert.deepEqual(naiPayloadFields(stateOf({ ...loaded, provider })), {}, provider);
  }
});

test("a null seed is omitted rather than sent as a literal zero", () => {
  assert.deepEqual(naiPayloadFields(stateOf({ naiOptionOverrides: { seed: null } })), {});
  // 0 is a real NovelAI seed and must survive.
  assert.deepEqual(naiPayloadFields(stateOf({ naiOptionOverrides: { seed: 0 } })), { seed: 0 });
});

test("node mode gates on the node's own lane, not the global one", () => {
  // Node variants carry a per-node provider/model (higgsfield 120). Gating on
  // global state either starves a NAI node or leaks NAI fields into another
  // lane's request — found by the wp5 adversarial audit.
  const overrides = { steps: 40, straightAlpha: true, autoSmea: true, decrisper: true };

  // Global lane is GPT, the node is NAI: the node's options must still ride.
  assert.deepEqual(
    naiPayloadFields(
      stateOf({ provider: "oauth", imageModel: "gpt-image-1", naiOptionOverrides: overrides, negativePrompt: "blurry" }),
      { provider: "nai", imageModel: "nai-diffusion-5-full" },
    ),
    { steps: 40, straightAlpha: true, autoSmea: true, decrisper: true, negativePrompt: "blurry" },
  );

  // Global lane is NAI, the node is not: nothing may leak into that request.
  assert.deepEqual(
    naiPayloadFields(
      stateOf({ naiOptionOverrides: overrides, negativePrompt: "blurry" }),
      { provider: "oauth", imageModel: "gpt-image-1" },
    ),
    {},
  );

  // Global model is V5, the node is V4.5: the V5-only field is stripped.
  assert.deepEqual(
    naiPayloadFields(
      stateOf({ naiOptionOverrides: overrides }),
      { provider: "nai", imageModel: "nai-diffusion-4-5-full" },
    ),
    { steps: 40, autoSmea: true, decrisper: true },
  );
});

test("all three client payload builders carry the nai fields", () => {
  const gen = read("ui/src/store/storeGenImpl.ts");
  const node = read("ui/src/store/storeNodeGenImpl.ts");
  // classic + multimode live in storeGenImpl; node has its own builder and its
  // own request type, so it is easy to forget.
  assert.equal(gen.split("...naiPayloadFields(s)").length - 1, 2, "classic and multimode");
  // Node passes its effective lane explicitly (see the behavioral case below).
  assert.match(node, /\.\.\.naiPayloadFields\(s, \{ provider: nodeProvider, imageModel: nodeModel \}\)/, "node mode");
});

test("V5-only fields are stripped for a V4.5 model", () => {
  const stale = { straightAlpha: true, qualityPresetId: "light", steps: 30 };
  // Model and options hydrate from independent persisted keys, so V4.5 can
  // arrive alongside a flag the user set on V5.
  assert.deepEqual(
    naiPayloadFields(stateOf({ imageModel: "nai-diffusion-4-5-full", naiOptionOverrides: stale })),
    { steps: 30 },
  );
  assert.deepEqual(
    naiPayloadFields(stateOf({ imageModel: "nai-diffusion-5-full", naiOptionOverrides: stale })),
    stale,
  );
  assert.equal(isNaiV5Model("nai-diffusion-5-curated"), true);
  assert.equal(isNaiV5Model("nai-diffusion-4-5-curated"), false);
});

test("nai forces one image and skips the multimode path", () => {
  // Hiding CountPicker is cosmetic on its own: the server fans n out into n
  // separate upstream calls, and a persisted multimode:true still steers
  // submission. Both must be behavioral.
  assert.match(read("ui/src/store/storeGenImpl.ts"), /s\.provider === "nai" \? 1 : s\.count/);
  assert.equal(effectiveCoreGenerationMode({ provider: "nai", uiMode: "classic", multimode: true }), "image");
});

test("the nai override key retains its appended index and exported constant", () => {
  assert.ok(PERSISTED_KEYS.includes("ima2.naiOptions"));
  assert.equal(
    PERSISTED_KEYS[19],
    "ima2.naiOptions",
    "later keys may append, but the original NAI index must never move",
  );
  assert.equal(NAI_OPTIONS_STORAGE_KEY, "ima2.naiOptions");
  assert.equal(PERSISTED_KEYS[5], "ima2.reasoningEffort");
  assert.equal(PERSISTED_KEYS[7], "ima2.generationDefaults");
  assert.equal(PERSISTED_KEYS[14], "ima2.locale");
  assert.equal(PERSISTED_REGISTRY["ima2.naiOptions"].shape, "json:NaiOptionOverrides");
});

test("the negative prompt persists with the composer draft", () => {
  const settings = read("ui/src/store/storeSettingsImpl.ts");
  // Declaring the field is not enough — without this write nothing ever lands.
  assert.match(settings, /saveGenerationDefaultsPatch\(\{ negativePrompt \}\)/);
  assert.match(read("ui/src/store/storePersistence.ts"), /parsed\.negativePrompt === "string"/);
  assert.match(read("ui/src/store/useAppStore.ts"), /negativePrompt: storedGenerationDefaults\.negativePrompt/);
});

test("a quota failure still updates in-memory overrides", () => {
  const settings = read("ui/src/store/storeSettingsImpl.ts");
  const impl = settings.slice(settings.indexOf("export function setNaiOptionImpl"));
  const save = impl.indexOf("saveNaiOverrides");
  const setState = impl.indexOf("set({ naiOptionOverrides })");
  assert.ok(save >= 0 && setState > save, "persist first, then set unconditionally");
  assert.match(read("ui/src/store/storePersistence.ts"), /saveNaiOverrides[\s\S]{0,220}catch \{\}/);
});

test("capabilities hydrate the server defaults through the same coercion", () => {
  const source = read("ui/src/store/storeCapabilitiesImpl.ts");
  assert.match(source, /naiServerDefaults: coerceNaiOverrides\(capabilities\.defaults\?\.nai/);
});
