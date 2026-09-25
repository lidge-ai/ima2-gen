import assert from "node:assert/strict";
import test from "node:test";
import { getProvider, REGISTRY, type CoreProviderId } from "../lib/providers/registry.ts";
import type { CoreProviderManifestBase, ProviderSurface } from "../lib/providers/types.ts";

type Facts = readonly [boolean, boolean, boolean, boolean, "static" | "runtime"];
type MatrixRow = Record<ProviderSurface, Facts>;

const absent: Facts = [false, false, false, false, "static"];
const image: Facts = [true, true, false, false, "static"];
const standard: MatrixRow = {
  generate: image, edit: image, multimode: image, node: image, video: absent,
};
const responses: MatrixRow = {
  generate: image,
  edit: [true, true, true, false, "static"],
  multimode: [true, true, false, true, "static"],
  node: [true, true, false, true, "static"],
  video: absent,
};
// GPT OAuth renders through the Images API: edits and mask guidance, but no partial frames.
const oauthImages: MatrixRow = { ...responses, multimode: [true, true, false, false, "static"], node: [true, true, false, false, "static"] };
const expected: Record<CoreProviderId, MatrixRow> = {
  oauth: oauthImages, api: responses,
  grok: { ...standard, video: image },
  "grok-api": { ...standard, video: image },
  agy: standard, "gemini-api": standard, atlascloud: standard, minimax: standard,
  nai: {
    generate: [true, false, false, false, "static"], edit: absent,
    multimode: [true, false, false, false, "static"],
    node: [true, false, false, false, "static"], video: absent,
  },
  comfy: {
    generate: [true, true, false, false, "runtime"],
    edit: [true, true, false, false, "runtime"],
    multimode: [false, false, false, false, "runtime"],
    node: [false, false, false, false, "runtime"],
    video: [true, true, false, false, "runtime"],
  },
};

test("NAI can generate without claiming edit support", () => {
  for (const model of getProvider("nai").models) {
    assert.equal(model.supports.edit, false, model.id);
    assert.equal(model.supports.generate, true, model.id);
  }
});

test("every core surface matches independent operation facts", async () => {
  const { deriveProviderSurfaceSupportFrom } = await import("../lib/providers/surfaceSupport.ts");
  for (const [id, row] of Object.entries(expected)) {
    for (const [surface, facts] of Object.entries(row)) {
      const [supported, references, mask, streaming, catalogAccess] = facts;
      assert.deepEqual(
        deriveProviderSurfaceSupportFrom(REGISTRY, id, surface as ProviderSurface),
        { supported, references, mask, streaming, catalogAccess }, id + "/" + surface,
      );
    }
  }
  for (const id of ["auto", "runway", "higgsfield", "missing"]) {
    assert.equal(deriveProviderSurfaceSupportFrom(REGISTRY, id, "generate"), null, id);
  }
});

test("generation-only models survive supported-model derivation without edit sentinels", async () => {
  const { deriveSupportedImageModelsFrom, deriveUnsupportedImageModelsFrom } =
    await import("../lib/providers/deriveCore.ts");
  const fixture: CoreProviderManifestBase = {
    id: "text-only", vendor: "openai", credentials: [], surfaces: ["generate"],
    models: [{
      id: "text-model", kind: "image",
      supports: { generate: true, edit: false, mask: false, streaming: false },
    }],
    referenceLimits: {}, elementTaxonomy: null, limits: { timeoutMs: 1 }, errorPrefix: null,
  };
  assert.deepEqual([...deriveSupportedImageModelsFrom([fixture], "text-only")], ["text-model"]);
  assert.deepEqual([...deriveUnsupportedImageModelsFrom(REGISTRY)], []);
  assert.equal(deriveSupportedImageModelsFrom(REGISTRY, "nai").size, 4);
});

test("generated projection and reference limits retain lane boundaries", async () => {
  const { PROVIDER_SURFACE_SUPPORT } = await import("../ui/src/generated/providers.ts");
  const { deriveProviderSurfaceSupportFrom } = await import("../lib/providers/surfaceSupport.ts");
  const { effectiveReferenceLimit } = await import("../ui/src/lib/referenceLimits.ts");
  for (const id of Object.keys(expected) as CoreProviderId[]) {
    for (const surface of Object.keys(expected[id]) as ProviderSurface[]) {
      assert.deepEqual(PROVIDER_SURFACE_SUPPORT[id][surface],
        deriveProviderSurfaceSupportFrom(REGISTRY, id, surface), id + "/" + surface);
    }
  }
  for (const [provider, limit] of [
    ["nai", 0], ["oauth", 12], ["api", 12], ["atlascloud", 10], ["minimax", 1], ["comfy", 4],
  ] as const) {
    assert.equal(effectiveReferenceLimit({
      provider, serverLimit: 12, videoModelSelected: false, mcpProvider: null,
    }), limit, provider);
  }
  assert.equal(effectiveReferenceLimit({
    provider: "nai", serverLimit: 12, videoModelSelected: false, mcpProvider: "runway",
  }), 3, "MCP takes precedence over the inactive core lane");
});
