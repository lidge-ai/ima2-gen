import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveTarget, type LaneInfo, type ModelCatalog } from "../bin/lib/modelResolver.ts";

const ready = (models: Partial<LaneInfo["models"]> = {}, defaults: LaneInfo["defaults"] = {}): LaneInfo => ({
  status: "ready",
  defaults,
  models: { image: models.image ?? [], video: models.video ?? [] },
});

function makeCatalog(): ModelCatalog {
  return {
    lanes: {
      // Astra sits in BOTH lanes because that is what /api/models really
      // projects: the same supported GPT set appears under oauth and api. The
      // older single-lane entries above are long-standing fixture shorthand.
      oauth: ready({ image: [{ id: "gpt-6-luna" }, { id: "gpt-6.2-astra" }, { id: "shared" }] }, { image: "gpt-6-luna" }),
      api: ready({ image: [{ id: "gpt-6.2-astra" }, { id: "shared" }] }, { image: "shared" }),
      grok: ready({ video: [{ id: "grok-video" }] }, { video: "grok-video" }),
      "grok-api": ready(),
      agy: ready({ image: [{ id: "banana" }] }, { image: "banana" }),
      "gemini-api": ready({ image: [{ id: "gemini-image" }] }, { image: "gemini-image" }),
      atlascloud: ready(
        { image: [{ id: "openai/gpt-image-2/text-to-image" }] },
        { image: "openai/gpt-image-2/text-to-image" },
      ),
      minimax: ready(
        { image: [{ id: "image-01" }] },
        { image: "image-01" },
      ),
      comfy: ready(
        {
          image: [{ id: "sdxl" }],
          video: [{ id: "minimax-h3", executable: false, lockReason: "catalog only" }],
        },
        { image: "sdxl" },
      ),
      runway: ready(
        { image: [{ id: "gen-4" }], video: [{ id: "veo-3.1" }] },
        { image: "gen-4", video: "veo-3.1" },
      ),
      higgsfield: ready({ video: [{ id: "higgs-video" }] }, { video: "higgs-video" }),
    },
  };
}

function expectFailure(result: ReturnType<typeof resolveTarget>, code: string) {
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, code);
  return result.ok ? null : result;
}

describe("shared GPT lane resolution", () => {
  // The CLI alias map in bin/lib/model-aliases.ts is maintained separately from
  // the registry's aliases field, which never reaches the resolver, so this is
  // the only place proving a short alias actually resolves for a user.
  it("canonicalizes the astra alias and resolves the default OpenAI lane", () => {
    assert.deepStrictEqual(resolveTarget("image", { model: "oauth/astra" }, makeCatalog(), {}), {
      ok: true, lane: "oauth", model: "gpt-6.2-astra", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "api/astra" }, makeCatalog(), {}), {
      ok: true, lane: "api", model: "gpt-6.2-astra", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "astra" }, makeCatalog(), {}), {
      ok: true, lane: "oauth", model: "gpt-6.2-astra", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "astra" }, makeCatalog(), { image: "api/shared" }), {
      ok: true, lane: "api", model: "gpt-6.2-astra", transport: "core",
    });
  });

  it("resolves all shared GPT aliases using the default lane and falls back to OAuth", () => {
    const catalog = makeCatalog();
    const ids = ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-sol", "gpt-6.2-astra"];
    catalog.lanes.oauth.models.image = ids.map((id) => ({ id }));
    catalog.lanes.api.models.image = ids.map((id) => ({ id }));
    for (const [alias, model] of [["luna", ids[0]], ["terra", ids[1]], ["sol", ids[2]], ["astra", ids[3]], [ids[0], ids[0]]]) {
      assert.deepStrictEqual(resolveTarget("image", { model: alias }, catalog, { image: "api/gpt-6-luna" }), {
        ok: true, lane: "api", model, transport: "core",
      });
      assert.deepStrictEqual(resolveTarget("image", { model: alias }, catalog, { image: "agy/banana" }), {
        ok: true, lane: "oauth", model, transport: "core",
      });
    }
    catalog.lanes.api.status = "key-missing";
    expectFailure(resolveTarget("image", { model: "sol" }, catalog, { image: "api/gpt-6-luna" }), "LANE_UNAVAILABLE");
  });

  // Saved legacy ids migrate within each OpenAI lane.
  it("maps legacy GPT OAuth ids to their GPT-6 tier on both OpenAI lanes", () => {
    const catalog = makeCatalog();
    catalog.lanes.api = ready({ image: [{ id: "gpt-6-luna" }, { id: "gpt-6.2-astra" }] }, { image: "gpt-6-luna" });
    catalog.lanes.oauth = ready({ image: [{ id: "gpt-6-luna" }, { id: "gpt-6.2-sol" }, { id: "gpt-6.2-astra" }] }, { image: "gpt-6-luna" });
    assert.deepStrictEqual(resolveTarget("image", { model: "oauth/gpt-5.6-luna" }, catalog, {}), {
      ok: true, lane: "oauth", model: "gpt-6-luna", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "oauth/gpt-5.6-sol" }, catalog, {}), {
      ok: true, lane: "oauth", model: "gpt-6.2-sol", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "api/gpt-5.6-luna" }, catalog, {}), {
      ok: true, lane: "api", model: "gpt-6-luna", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", {}, catalog, { image: "oauth/gpt-5.5" }), {
      ok: true, lane: "oauth", model: "gpt-6-luna", transport: "core",
    });
    assert.deepStrictEqual(resolveTarget("image", { model: "gpt-5.6-luna" }, catalog, { image: "api/gpt-6-luna" }), {
      ok: true, lane: "api", model: "gpt-6-luna", transport: "core",
    });
  });

});
