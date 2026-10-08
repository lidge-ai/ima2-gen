import type { RuntimeContext } from "../lib/runtimeContext.js";
import { getProvider } from "../lib/providers/registry.js";
import { api88Key, getApi88Catalog } from "../lib/api88/catalog.js";
import { api88VideoModelsForContext } from "../lib/api88/videoCatalogProjection.js";
import type { ProviderModelKind } from "../lib/providers/types.js";
import type { McpModelEntry } from "../lib/mcp/modelCapabilities.js";
import type { ModelLaneDto } from "./models.js";

async function api88Models(ctx: RuntimeContext, kind: ProviderModelKind): Promise<McpModelEntry[]> {
  const live = await getApi88Catalog(ctx, kind);
  if (kind === "video") return api88VideoModelsForContext(ctx, live).map((row): McpModelEntry => ({
    ...row, capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
      inputRoles: ["text", "image_references"] },
  }));
  const key = api88Key(ctx, kind);
  const rows = getProvider("88api").models.filter((model) => model.kind === kind
    && !("status" in model && model.status === "unverified") && model.supports.generate
    && (live === null || live.has(model.id)));
  return rows.map((model): McpModelEntry => {
    const lockReason = !key ? "API88_IMAGE_KEY_MISSING" : undefined;
    return {
      id: model.id, label: model.id,
      capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
        inputRoles: ["text", "image_references"] },
      executable: lockReason === undefined,
      ...(lockReason ? { lockReason } : {}),
    };
  });
}

export async function api88Lane(ctx: RuntimeContext): Promise<ModelLaneDto> {
  const [image, video] = await Promise.all([api88Models(ctx, "image"), api88Models(ctx, "video")]);
  const configured = Boolean(api88Key(ctx, "image") || api88Key(ctx, "video"));
  return {
    status: configured ? "ready" : "key-missing",
    ...(!configured ? { reason: "88API image or video key missing" } : {}),
    defaults: { image: ctx.config.api88Provider.defaultImageModel, video: ctx.config.api88Provider.defaultVideoModel },
    models: { image, video },
  };
}
