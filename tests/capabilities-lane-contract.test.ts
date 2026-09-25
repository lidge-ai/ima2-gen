import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tsImport } from "tsx/esm/api";

const { buildIma2Capabilities } = await tsImport(
  "../lib/capabilities.ts", import.meta.url,
) as typeof import("../lib/capabilities.ts");

const EXPECTED_SURFACES = {
  nai: {
    generate: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
    edit: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
    multimode: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
    node: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
    video: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
  },
  oauth: {
    generate: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
    edit: { supported: true, references: true, mask: true, streaming: false, catalogAccess: "static" },
    multimode: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
    node: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
    video: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
  },
  comfy: {
    generate: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
    edit: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
    multimode: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "runtime" },
    node: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "runtime" },
    video: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
  },
};

describe("capability lane contract", () => {
  it("omits lanes entirely when no server answered", () => {
    const built = buildIma2Capabilities({ packageVersion: "0.0.0-test", source: "local" });
    // Absence must read as "nobody could know", never as "no lane exists".
    // `source` is the disambiguator, so a guessed status here would be worse
    // than silence.
    assert.equal(built.source, "local");
    assert.equal("lanes" in built, false);
    assert.deepEqual(Object.keys(built.providerSurfaces), [
      "oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy",
    ]);
    for (const [id, expected] of Object.entries(EXPECTED_SURFACES)) {
      assert.deepEqual(built.providerSurfaces[id], expected);
    }
    // The API-key lane streams partial frames through the Responses image tool; GPT OAuth does not.
    assert.deepEqual(built.providerSurfaces.api, {
      ...EXPECTED_SURFACES.oauth,
      multimode: { ...EXPECTED_SURFACES.oauth.multimode, streaming: true },
      node: { ...EXPECTED_SURFACES.oauth.node, streaming: true },
    });
  });

  it("serializes the same capability facts when server lanes are disconnected", () => {
    const lanes = {
      oauth: { status: "disconnected", models: { image: 2, video: 0 } },
      nai: { status: "key-missing", models: { image: 4, video: 0 } },
      comfy: { status: "disconnected", models: { image: 0, video: 0 } },
      runway: { status: "disconnected", models: { image: 0, video: 0 } },
    } as const;
    const built = buildIma2Capabilities({ packageVersion: "0.0.0-test", source: "server", lanes });
    assert.deepEqual(built.lanes, lanes);
    const serialized = JSON.parse(JSON.stringify(built));
    for (const [id, expected] of Object.entries(EXPECTED_SURFACES)) {
      assert.deepEqual(serialized.providerSurfaces[id], expected);
    }
    for (const id of ["auto", "runway", "higgsfield"]) assert.equal(id in serialized.providerSurfaces, false);
  });

  it("carries lane state when a server supplied it", () => {
    const built = buildIma2Capabilities({
      packageVersion: "0.0.0-test",
      source: "server",
      lanes: {
        grok: { status: "ready", models: { image: 3, video: 2 } },
        minimax: { status: "key-missing", reason: "MiniMax API key missing", models: { image: 2, video: 0 } },
      },
    });
    assert.equal(built.source, "server");
    assert.equal("lanes" in built, true);
    const lanes = (built as { lanes: Record<string, { status: string; reason?: string }> }).lanes;
    assert.equal(lanes.grok?.status, "ready");
    // A lane that cannot run must say why; the reason is the load-bearing part.
    assert.equal(lanes.minimax?.reason, "MiniMax API key missing");
  });

  it("keeps the flag vocabulary separate from the runtime lane map", () => {
    const built = buildIma2Capabilities({ packageVersion: "0.0.0-test", source: "local" });
    const providers = built.valid.providers as readonly string[];
    // valid.providers is what the CLI --provider flag accepts, which includes
    // `auto` and omits the MCP lanes. It is not an availability list, and
    // conflating the two is what sent agents at lanes that had no key.
    assert.ok(providers.includes("auto"));
    assert.equal(providers.includes("runway"), false);
  });

  it("publishes the NovelAI display defaults from runtime config", () => {
    const built = buildIma2Capabilities({ packageVersion: "0.0.0-test", source: "local" });
    const nai = (built.defaults as Record<string, Record<string, unknown>>).nai;
    // Display only. The web UI shows these so its panel matches the operator's
    // configuration; it never re-sends an untouched value, which is what keeps
    // IMA2_NAI_DEFAULT_* authoritative at the adapter.
    assert.ok(nai, "defaults.nai must exist");
    assert.deepEqual(Object.keys(nai).sort(), ["autoSmea", "decrisper", "noiseSchedule", "sampler", "scale", "steps"]);
    assert.equal(typeof nai.sampler, "string");
    assert.equal(typeof nai.noiseSchedule, "string");
    assert.equal(typeof nai.steps, "number");
    assert.equal(typeof nai.scale, "number");
    assert.equal(typeof nai.autoSmea, "boolean");
    assert.equal(typeof nai.decrisper, "boolean");
    // No model: NaiOptions has no model member, and publishing a field nothing
    // consumes is the drift this unit exists to remove.
    assert.equal("model" in nai, false);
  });
});
