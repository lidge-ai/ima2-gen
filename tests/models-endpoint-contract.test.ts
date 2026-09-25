import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tsImport } from "tsx/esm/api";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

const { clearModelsCatalogCache } = await tsImport(
  "../lib/mcp/modelsCatalog.js",
  import.meta.url,
) as typeof import("../lib/mcp/modelsCatalog.ts");
const { registerMcpConnectionRoutes } = await tsImport(
  "../routes/mcpConnections.ts",
  import.meta.url,
) as typeof import("../routes/mcpConnections.ts");
const { registerModelsRoutes } = await tsImport(
  "../routes/models.ts",
  import.meta.url,
) as typeof import("../routes/models.ts");

type ProviderState = "connected" | "disconnected";
type ModelLaneId = import("../routes/models.ts").ModelLaneId;
type ModelLaneDto = import("../routes/models.ts").ModelLaneDto;
type ModelsBody = { ok: true; lanes: Record<ModelLaneId, ModelLaneDto> };
// Literal contract oracles: do not derive expected responses from the registry.
const STATIC_IMAGE_SURFACES = {
  generate: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  edit: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  multimode: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  node: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  video: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
};
const OAUTH_SURFACES = {
  generate: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  edit: { supported: true, references: true, mask: true, streaming: false, catalogAccess: "static" },
  multimode: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  node: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
  video: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
};
const NAI_SURFACES = {
  generate: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
  edit: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
  multimode: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
  node: { supported: true, references: false, mask: false, streaming: false, catalogAccess: "static" },
  video: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "static" },
};
const COMFY_SURFACES = {
  generate: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
  edit: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
  multimode: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "runtime" },
  node: { supported: false, references: false, mask: false, streaming: false, catalogAccess: "runtime" },
  video: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "runtime" },
};
type ProviderBody = {
  providers: Array<{
    id: string;
    executable: boolean;
    lockReason?: string;
  }>;
};

class FakeMcpManager {
  readonly calls: Array<{ provider: string; name: string; args: Record<string, unknown> }> = [];
  readonly states = new Map<string, ProviderState>();
  failCatalog = false;

  status(provider: string) {
    return { provider, state: this.states.get(provider) ?? "disconnected" };
  }

  async callTool(provider: string, name: string, args: Record<string, unknown>) {
    this.calls.push({ provider, name, args });
    if (this.failCatalog) throw new Error("MCP_NOT_CONNECTED");
    return {
      structuredContent: {
        items: args.type === "video"
          ? [{ id: "kling_3", name: "Kling 3", duration_range: { min: 3, max: 10 } }]
          : [{ id: "soul_2", name: "Soul 2", medias: [{ roles: ["image"] }] }],
        has_more: false,
      },
    };
  }
}

const servers = new Set<Server>();
/** Every case gets its own HOME so no lane assertion depends on whether the
 *  developer running the suite happens to be logged into Grok. */
const grokHomes = new Set<string>();

function grokHomeFor(auth: GrokAuthFixture): string {
  const homeDir = mkdtempSync(join(tmpdir(), "ima2-models-grok-home-"));
  grokHomes.add(homeDir);
  if (auth === "session") seedGrokAuth({ homeDir });
  if (auth === "expired-no-refresh") {
    seedGrokAuth({ homeDir, refreshToken: "", expiresAt: Date.now() - 60_000 });
  }
  return homeDir;
}

type GrokAuthFixture = "none" | "session" | "expired-no-refresh";

afterEach(async () => {
  clearModelsCatalogCache();
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
  for (const homeDir of grokHomes) rmSync(homeDir, { recursive: true, force: true });
  grokHomes.clear();
});

async function withApp(
  options: {
    manager?: FakeMcpManager;
    agyInstalled?: boolean;
    minimaxApiKey?: string;
    atlasCloudApiKey?: string;
    naiApiKey?: string;
    oauthReadyState?: "ready" | "pending";
    hasApiKey?: boolean;
    comfyOnline?: boolean;
    grokAuth?: GrokAuthFixture;
    comfyWorkflows?: Array<import("../lib/comfyWorkflowStore.ts").ComfyWorkflowRecord>;
  } = {},
  run: (base: string, manager: FakeMcpManager) => Promise<void>,
) {
  const app = express();
  const manager = options.manager ?? new FakeMcpManager();
  const ctx = {
    oauthReadyState: options.oauthReadyState ?? "ready",
    hasApiKey: options.hasApiKey ?? false,
    xaiApiKey: undefined,
    geminiApiKey: "gemini-test-key",
    minimaxApiKey: options.minimaxApiKey,
    atlasCloudApiKey: options.atlasCloudApiKey,
    naiApiKey: options.naiApiKey,
    mcpConnectionManager: manager,
    grokAuthHomeDir: grokHomeFor(options.grokAuth ?? "none"),
    config: {
      imageModels: {
        default: "gpt-6-luna",
        valid: new Set(["gpt-6-luna", "gpt-6-sol"]),
      },
      // The API-key lane keeps its own list, disjoint from GPT OAuth's GPT-6 ids.
      apiProvider: { defaultImageModel: "gpt-5.6-sol", validImageModels: new Set(["gpt-5.6-luna", "gpt-5.6-sol"]) },
      grokProvider: {
        defaultImageModel: "grok-imagine-image-quality",
        defaultVideoModel: "grok-imagine-video-1.5",
      },
      mcp: { enabledProviders: ["runway", "higgsfield"] },
      comfy: { healthTimeoutMs: 10 },
    },
  };
  registerModelsRoutes(app, ctx as never, {
    detectAgyInstalled: async () => options.agyInstalled ?? false,
    listComfyWorkflows: async () => options.comfyWorkflows ?? [],
    probeComfyOrigins: async (origins) => new Map(origins.map((origin) => [origin,
      options.comfyOnline ? { ok: true } : { ok: false, reason: "fixture offline" },
    ])),
  });
  registerMcpConnectionRoutes(app, ctx as never);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.add(server);
  const address = server.address() as AddressInfo;
  await run(`http://127.0.0.1:${address.port}`, manager);
}

test("GET /api/models returns every canonical lane with deterministic statuses and static catalogs", async () => {
  await withApp({ agyInstalled: true }, async (base, manager) => {
    const response = await fetch(`${base}/api/models`);
    assert.equal(response.status, 200);
    const body = await response.json() as ModelsBody;
    assert.equal(body.ok, true);
    assert.deepEqual(Object.keys(body.lanes), [
      "oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy", "runway", "higgsfield",
    ]);

    assert.equal(body.lanes.oauth.status, "ready");
    assert.equal(body.lanes.api.status, "key-missing");
    assert.equal(body.lanes.grok.status, "disconnected");
    assert.match(body.lanes.grok.reason ?? "", /login required/i);
    assert.equal(body.lanes["grok-api"].status, "key-missing");
    assert.equal(body.lanes.agy.status, "ready");
    assert.equal(body.lanes.agy.reason, "binary installed; login cannot be probed");
    assert.equal(body.lanes["gemini-api"].status, "ready");
    assert.equal(body.lanes.atlascloud.status, "key-missing");
    assert.deepEqual(body.lanes.atlascloud.models.image.map((model) => model.id), [
      "openai/gpt-image-2/text-to-image", "openai/gpt-image-2/edit",
    ]);
    assert.equal(body.lanes.minimax.status, "key-missing");
    assert.deepEqual(body.lanes.minimax.models.image.map((model) => model.id), [
      "image-01", "image-01-live",
    ]);
    assert.equal(body.lanes.runway.status, "disconnected");
    assert.equal(body.lanes.higgsfield.status, "disconnected");
    assert.match(body.lanes.higgsfield.reason ?? "", /MCP connection disconnected/);

    assert.equal(body.lanes.oauth.defaults.image, "gpt-6-luna");
    assert.equal(body.lanes.api.defaults.image, "gpt-5.6-sol");
    assert.deepEqual(body.lanes.grok.defaults, {
      image: "grok-imagine-image-quality",
      video: "grok-imagine-video-1.5",
    });
    assert.equal(body.lanes.runway.defaults.image, "nano-banana-pro");
    assert.equal(body.lanes.runway.defaults.video, "seedance-2");

    assert.deepEqual(body.lanes.oauth.models.image.map((model) => model.id), ["gpt-6-luna", "gpt-6-sol"]);
    // The API lane must list its own models (its default included), never the OAuth-only GPT-6 ids.
    assert.deepEqual(body.lanes.api.models.image.map((model) => model.id), ["gpt-5.6-luna", "gpt-5.6-sol"]);
    assert.deepEqual(body.lanes.grok.models.video.map((model) => model.id), [
      "grok-imagine-video", "grok-imagine-video-1.5",
    ]);
    const grokVideo = body.lanes.grok.models.video[0];
    assert.deepEqual(
      grokVideo.capabilities.parameters.find((parameter) => parameter.name === "resolution")?.options,
      ["480p", "720p", "1080p"],
    );
    assert.ok(body.lanes.runway.models.video.some((model) => model.id === "veo-3.1"));
    assert.deepEqual(body.lanes.higgsfield.models, { image: [], video: [] });
    assert.deepEqual(body.lanes.comfy.surfaces, COMFY_SURFACES);
    assert.deepEqual(body.lanes.comfy.models, { image: [], video: [] });
    for (const id of ["runway", "higgsfield"] as const) assert.equal("surfaces" in body.lanes[id], false);
    assert.equal(manager.calls.length, 0, "disconnected lanes must not browse a dynamic catalog");
  });
});

test("the Comfy lane lists runtime video workflows without inventing an image default", async () => {
  const bind = { prompt: { node: "1", input: "text" }, output: { node: "2" } };
  const workflow = {
      id: "h3", label: "MiniMax H3 FL2VA pruned NVFP4", mediaKind: "video",
      origin: "http://127.0.0.1:9", graph: {
        "1": { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "x" } },
        "2": { class_type: "SaveVideo", inputs: {} },
      }, bind, params: [], createdAt: 1, updatedAt: 1,
    } as import("../lib/comfyWorkflowStore.ts").ComfyWorkflowRecord;
    await withApp({ comfyWorkflows: [workflow] }, async (base) => {
      const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
      assert.deepEqual(body.lanes.comfy.defaults, {});
      assert.deepEqual(body.lanes.comfy.models.image, []);
      const h3 = body.lanes.comfy.models.video[0];
      assert.equal(h3?.id, "h3");
      assert.equal(h3?.label, "MiniMax H3 FL2VA pruned NVFP4");
      // Video workflows are executable now. A dead origin still reads through
      // the description, which is availability rather than a capability lock.
      assert.notEqual(h3?.executable, false);
      assert.equal(h3?.lockReason, undefined);
      assert.deepEqual(body.lanes.comfy.surfaces, COMFY_SURFACES);
    });
});

test("catalog failures degrade per lane and provider listings expose registry state", async () => {
  const manager = new FakeMcpManager();
  manager.states.set("higgsfield", "connected");
  manager.failCatalog = true;
  await withApp({ manager }, async (base) => {
    const modelsResponse = await fetch(`${base}/api/models`);
    assert.equal(modelsResponse.status, 200);
    const models = await modelsResponse.json() as ModelsBody;
    assert.equal(models.ok, true);
    // higgsfield is now executable: catalog failure (MCP_NOT_CONNECTED) degrades to disconnected
    assert.equal(models.lanes.higgsfield.status, "disconnected");
    assert.deepEqual(models.lanes.higgsfield.models, { image: [], video: [] });

    const providers = await (await fetch(`${base}/api/mcp/providers`)).json() as ProviderBody;
    const runway = providers.providers.find((provider) => provider.id === "runway");
    const higgsfield = providers.providers.find((provider) => provider.id === "higgsfield");
    assert.equal(runway?.executable, true);
    assert.equal(runway?.lockReason, undefined);
    assert.equal(higgsfield?.executable, true);
    assert.equal(higgsfield?.lockReason, undefined);
  });
});

test("connected MCP lanes add only read-only dynamic models", async () => {
  const manager = new FakeMcpManager();
  manager.states.set("runway", "connected");
  manager.states.set("higgsfield", "connected");
  await withApp({ manager }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    assert.equal(body.lanes.runway.status, "ready");
    assert.equal(body.lanes.higgsfield.status, "ready");
    for (const id of ["runway", "higgsfield"] as const) assert.equal("surfaces" in body.lanes[id], false);
    assert.deepEqual(body.lanes.higgsfield.models.image.map((model) => model.id), ["soul_2"]);
    assert.deepEqual(body.lanes.higgsfield.models.video.map((model) => model.id), ["kling_3"]);
    assert.deepEqual(body.lanes.higgsfield.models.image[0].capabilities.inputRoles, ["text", "image_references"]);
    assert.ok(manager.calls.length >= 2);
    for (const call of manager.calls) assert.equal(call.name, "models_explore");
  });
});

test("routes/index.ts registers the canonical models endpoint", () => {
  const source = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ registerModelsRoutes \} from "\.\/models\.js";/);
  assert.match(source, /registerModelsRoutes\(app, ctx\);/);
});

/**
 * #150 phase 1 routes the MiniMax lane through ProviderAdapterV1. The adapter
 * contract suite proves the adapter is correct; these two prove the DTO the
 * route builds from it did not drift, in both credential states.
 */
test("the MiniMax lane keeps its exact DTO when no key is configured", async () => {
  await withApp({}, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    const minimax = body.lanes.minimax;
    assert.deepEqual(minimax.surfaces, STATIC_IMAGE_SURFACES);
    assert.equal(minimax.status, "key-missing");
    assert.equal(minimax.reason, "MiniMax API key missing");
    assert.equal(minimax.defaults.image, "image-01");
    assert.deepEqual(minimax.models.image.map((model) => model.id), ["image-01", "image-01-live"]);
    assert.deepEqual(minimax.models.video, []);
    for (const model of minimax.models.image) {
      assert.equal(model.label, model.id);
      assert.ok(Array.isArray(model.capabilities.inputRoles));
    }
  });
});

test("the MiniMax lane reports ready once the runtime context holds a key", async () => {
  await withApp({ minimaxApiKey: "mm-test-key" }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    const minimax = body.lanes.minimax;
    assert.deepEqual(minimax.surfaces, STATIC_IMAGE_SURFACES);
    assert.equal(minimax.status, "ready");
    assert.equal(minimax.reason, undefined, "a ready lane carries no reason");
    assert.equal(minimax.defaults.image, "image-01");
    assert.deepEqual(minimax.models.image.map((model) => model.id), ["image-01", "image-01-live"]);
    assert.deepEqual(minimax.models.video, []);
  });
});

/**
 * #150 phase 2 routes the Atlas Cloud lane through ProviderAdapterV1. Same
 * proof shape as MiniMax above: the adapter contract suite proves the adapter,
 * these two prove the DTO the route builds from it did not drift, in both
 * credential states.
 */
test("the Atlas Cloud lane keeps its exact DTO when no key is configured", async () => {
  await withApp({}, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    const atlascloud = body.lanes.atlascloud;
    assert.deepEqual(atlascloud.surfaces, STATIC_IMAGE_SURFACES);
    assert.equal(atlascloud.status, "key-missing");
    assert.equal(atlascloud.reason, "Atlas Cloud API key missing");
    assert.equal(atlascloud.defaults.image, "openai/gpt-image-2/text-to-image");
    assert.deepEqual(
      atlascloud.models.image.map((model) => model.id),
      ["openai/gpt-image-2/text-to-image", "openai/gpt-image-2/edit"],
    );
    assert.deepEqual(atlascloud.models.video, []);
    for (const model of atlascloud.models.image) {
      assert.equal(model.label, model.id);
      assert.ok(Array.isArray(model.capabilities.inputRoles));
    }
  });
});

test("the Atlas Cloud lane reports ready once the runtime context holds a key", async () => {
  await withApp({ atlasCloudApiKey: "apikey-test" }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    const atlascloud = body.lanes.atlascloud;
    assert.deepEqual(atlascloud.surfaces, STATIC_IMAGE_SURFACES);
    assert.equal(atlascloud.status, "ready");
    assert.equal(atlascloud.reason, undefined, "a ready lane carries no reason");
    assert.equal(atlascloud.defaults.image, "openai/gpt-image-2/text-to-image");
    assert.deepEqual(
      atlascloud.models.image.map((model) => model.id),
      ["openai/gpt-image-2/text-to-image", "openai/gpt-image-2/edit"],
    );
    assert.deepEqual(atlascloud.models.video, []);
  });
});

test("the grok lane follows the stored xAI session, not a configured endpoint", async () => {
  // Requests go straight to api.x.ai now, so the credential file is the only
  // thing that decides whether the lane can serve a generation.
  await withApp({ grokAuth: "session" }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    assert.equal(body.lanes.grok.status, "ready");
    assert.equal(body.lanes.grok.reason, undefined, "a ready lane carries no reason");
  });
  await withApp({ grokAuth: "none" }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    assert.equal(body.lanes.grok.status, "disconnected");
    assert.match(String(body.lanes.grok.reason), /login required/i);
  });
});

test("an expired grok session with no refresh token is disconnected", async () => {
  // With a refresh token the next request silently renews, so only the
  // unrecoverable case is worth showing the user.
  await withApp({ grokAuth: "expired-no-refresh" }, async (base) => {
    const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
    assert.equal(body.lanes.grok.status, "disconnected");
    assert.match(String(body.lanes.grok.reason), /session expired/i);
  });
});

test("OAuth/API and all NovelAI rows expose fixed surface facts regardless of credentials", async () => {
  for (const ready of [false, true]) {
    await withApp({ oauthReadyState: ready ? "ready" : "pending", hasApiKey: ready,
      ...(ready ? { naiApiKey: "nai-fixture-token" } : {}),
    }, async (base) => {
      const body = await (await fetch(`${base}/api/models`)).json() as ModelsBody;
      assert.equal(body.lanes.oauth.status, ready ? "ready" : "disconnected");
      assert.equal(body.lanes.api.status, ready ? "ready" : "key-missing");
      assert.equal(body.lanes.nai.status, ready ? "ready" : "key-missing");
      for (const id of ["oauth", "api"] as const) {
        // The API-key lane streams partial frames through the Responses image tool; GPT OAuth
        // renders through the Images API, which has none.
        assert.deepEqual(body.lanes[id].surfaces, id === "api" ? {
          ...OAUTH_SURFACES,
          multimode: { ...OAUTH_SURFACES.multimode, streaming: true },
          node: { ...OAUTH_SURFACES.node, streaming: true },
        } : OAUTH_SURFACES);
        assert.deepEqual(body.lanes[id].models.image.map((model) => model.capabilities.inputRoles), [
          ["text", "image_references"], ["text", "image_references"],
        ]);
      }
      assert.deepEqual(body.lanes.nai.surfaces, NAI_SURFACES);
      assert.deepEqual(body.lanes.nai.models.image.map((model) => ({
        id: model.id, inputRoles: model.capabilities.inputRoles,
      })), [
        { id: "nai-diffusion-5-full", inputRoles: ["text"] },
        { id: "nai-diffusion-5-curated", inputRoles: ["text"] },
        { id: "nai-diffusion-4-5-full", inputRoles: ["text"] },
        { id: "nai-diffusion-4-5-curated", inputRoles: ["text"] },
      ]);
      assert.deepEqual(body.lanes.nai.models.video, []);
      for (const id of ["agy", "gemini-api", "atlascloud", "minimax"] as const) {
        assert.deepEqual(body.lanes[id].surfaces, STATIC_IMAGE_SURFACES);
        for (const model of body.lanes[id].models.image) {
          assert.deepEqual(model.capabilities.inputRoles, ["text", "image_references"]);
        }
      }
      for (const id of ["grok", "grok-api"] as const) {
        assert.deepEqual(body.lanes[id].surfaces, { ...STATIC_IMAGE_SURFACES,
          video: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
        });
      }
    });
  }
});

test("Comfy keeps per-workflow reference roles and runtime video while liveness changes", async () => {
  const base = {
    origin: "http://127.0.0.1:9", params: [], createdAt: 1, updatedAt: 1,
    graph: { "1": { class_type: "TextEncode", inputs: { text: "fixture" } },
      "2": { class_type: "SaveImage", inputs: {} }, "3": { class_type: "LoadImage", inputs: {} } },
    bind: { prompt: { node: "1", input: "text" }, output: { node: "2" } },
  };
  const workflows: Array<import("../lib/comfyWorkflowStore.ts").ComfyWorkflowRecord> = [
    { ...base, id: "text-image", label: "Text image", mediaKind: "image" },
    { ...base, id: "ref-image", label: "Reference image", mediaKind: "image",
      bind: { ...base.bind, refImage: { node: "3", input: "image" } } },
    { ...base, id: "runtime-video", label: "Runtime video", mediaKind: "video" },
  ];
  for (const comfyOnline of [false, true]) {
    await withApp({ comfyWorkflows: workflows, comfyOnline }, async (url) => {
      const body = await (await fetch(`${url}/api/models`)).json() as ModelsBody;
      const comfy = body.lanes.comfy;
      assert.equal(comfy.status, comfyOnline ? "ready" : "disconnected");
      assert.deepEqual(comfy.surfaces, COMFY_SURFACES);
      assert.deepEqual(comfy.defaults, { image: "text-image" });
      assert.deepEqual(comfy.models.image.map((model) => [model.id, model.capabilities.inputRoles]), [
        ["text-image", ["text"]], ["ref-image", ["text", "image_references"]],
      ]);
      assert.deepEqual(comfy.models.video.map((model) => [model.id, model.capabilities.inputRoles]), [
        ["runtime-video", ["text"]],
      ]);
      assert.equal(comfy.models.video[0].executable, undefined);
      assert.equal(comfy.models.video[0].lockReason, undefined);
    });
  }
});
