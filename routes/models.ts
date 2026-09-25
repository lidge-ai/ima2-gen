import { spawn } from "node:child_process";
import type { Express, Request, Response } from "express";
import { buildAgyPathEnv, resolveAgyBin } from "../lib/agyCli.js";
import { ATLASCLOUD_TEXT_TO_IMAGE_MODEL } from "../lib/atlasCloudImageAdapter.js";
import { MINIMAX_TEXT_TO_IMAGE_MODEL } from "../lib/minimaxImageAdapter.js";
import { NAI_DEFAULT_IMAGE_MODEL } from "../lib/naiImageAdapter.js";
import { getProviderAdapter } from "../lib/providers/adapters/index.js";
import {
  MAX_VIDEO_DURATION,
  MIN_VIDEO_DURATION,
  VALID_VIDEO_ASPECT_RATIOS,
  VALID_VIDEO_RESOLUTIONS,
} from "../lib/imageModels.js";
import {
  getProviderModels,
  type CatalogToolCaller,
  type McpModelCapabilities,
  type McpModelEntry,
  type McpProviderModels,
} from "../lib/mcp/modelsCatalog.js";
import {
  listProviders,
  type McpProviderDescriptor,
} from "../lib/mcp/providerRegistry.js";
import type { McpConnectionStatus } from "../lib/mcp/types.js";
import { deriveModels, deriveProviderIds, getProviderSurfaceSupport } from "../lib/providers/derive.js";
import { PROVIDER_SURFACES } from "../lib/providers/surfaceSupport.js";
import type { ProviderSurface, ProviderSurfaceSupport } from "../lib/providers/types.js";
import { listWorkflows } from "../lib/comfyWorkflowStore.js";
import { probeComfyOrigins } from "../lib/comfyImageAdapter.js";
import { loadGrokCredentials } from "../lib/xaiAuth.js";
import type { CoreProviderId } from "../lib/providers/registry.js";
import {
  requireRuntimeContext,
  type RouteRuntimeContext,
  type RuntimeContext,
} from "../lib/runtimeContext.js";

export type ModelLaneStatus = "ready" | "locked" | "disconnected" | "key-missing";
export type ModelLaneId = CoreProviderId | "runway" | "higgsfield";

export interface ModelLaneDto {
  status: ModelLaneStatus;
  reason?: string;
  defaults: { image?: string; video?: string };
  models: McpProviderModels;
  surfaces?: Record<ProviderSurface, ProviderSurfaceSupport>;
}

interface ModelsRouteDeps {
  detectAgyInstalled?: () => Promise<boolean>;
  listComfyWorkflows?: typeof listWorkflows;
  probeComfyOrigins?: typeof probeComfyOrigins;
}

type LaneState = { status: ModelLaneStatus; reason?: string | undefined };
type CatalogResult = { models: McpProviderModels; reason?: string | undefined; disconnected?: boolean | undefined };


const MCP_LANES = new Set<ModelLaneId>(["runway", "higgsfield"]);
const MCP_PROVIDER_FALLBACKS = listProviders([])
  .filter((provider) => MCP_LANES.has(provider.id as ModelLaneId));
let agyDetection: Promise<boolean> | null = null;

function emptyModels(): McpProviderModels {
  return { image: [], video: [] };
}

function capabilities(
  inputRoles: string[] = [],
  parameters: McpModelCapabilities["parameters"] = [],
  aspectRatios: string[] = [],
): McpModelCapabilities {
  return { source: "verified-contract", aspectRatios, parameters, inputRoles };
}

function entries(provider: CoreProviderId, ids: Iterable<string>, caps?: McpModelCapabilities): McpModelEntry[] {
  return [...ids].map((id) => ({
    id,
    label: id,
    capabilities: caps
      ? { ...caps, aspectRatios: [...caps.aspectRatios], parameters: [...caps.parameters], inputRoles: [...caps.inputRoles] }
      // CoreProviderId comes from the same registry as the getter: never null.
      : capabilities(getProviderSurfaceSupport(provider, "generate")!.references
        ? ["text", "image_references"] : ["text"]),
  }));
}

function videoCapabilities(): McpModelCapabilities {
  return capabilities(
    ["text", "start_image", "image_references"],
    [
      { name: "duration", type: "number", min: MIN_VIDEO_DURATION, max: MAX_VIDEO_DURATION },
      { name: "resolution", type: "string", options: [...VALID_VIDEO_RESOLUTIONS] },
    ],
    [...VALID_VIDEO_ASPECT_RATIOS],
  );
}

function lane(
  state: LaneState,
  defaults: ModelLaneDto["defaults"],
  models: McpProviderModels,
): ModelLaneDto {
  return {
    status: state.status,
    ...(state.reason ? { reason: state.reason } : {}),
    defaults,
    models,
  };
}

function oauthLane(ctx: RuntimeContext, image: McpModelEntry[]): ModelLaneDto {
  const ready = ctx.oauthReadyState === "ready";
  const reason = ready ? undefined : `GPT OAuth ${ctx.oauthReadyState ?? "not ready"}`;
  return lane(
    { status: ready ? "ready" : "disconnected", ...(reason ? { reason } : {}) },
    { image: ctx.config.imageModels.default },
    { image, video: [] },
  );
}

function apiLane(ctx: RuntimeContext, image: McpModelEntry[]): ModelLaneDto {
  return lane(
    ctx.hasApiKey ? { status: "ready" } : { status: "key-missing", reason: "OpenAI API key missing" },
    { image: ctx.config.apiProvider.defaultImageModel },
    { image, video: [] },
  );
}

/**
 * Lane status follows the stored xAI credential, the same file every Grok
 * request reads, so /api/models and /api/grok/status cannot disagree.
 *
 * An expired access token still counts as ready when a refresh token is on
 * disk: lib/xaiAuth.ts refreshes it on the next request, so reporting the lane
 * disconnected would be a failure the user never sees.
 */
function grokLaneState(ctx: RuntimeContext): LaneState {
  const creds = loadGrokCredentials(ctx.grokAuthHomeDir);
  if (!creds) return { status: "disconnected", reason: "Grok login required" };
  if (creds.expiresAt !== undefined && Date.now() >= creds.expiresAt && !creds.refreshToken) {
    return { status: "disconnected", reason: "Grok session expired" };
  }
  return { status: "ready" };
}

function grokLane(ctx: RuntimeContext, provider: "grok" | "grok-api" = "grok"): ModelLaneDto {
  const state = grokLaneState(ctx);
  return lane(state, {
    image: ctx.config.grokProvider.defaultImageModel,
    video: ctx.config.grokProvider.defaultVideoModel,
  }, {
    image: entries(provider, deriveModels(provider, "image")),
    video: entries(
      provider,
      [...deriveModels("grok", "video")].filter((model) => model !== "grok-imagine-video-1.5-preview"),
      videoCapabilities(),
    ),
  });
}

function grokApiLane(ctx: RuntimeContext): ModelLaneDto {
  const state: LaneState = ctx.xaiApiKey
    ? { status: "ready" }
    : { status: "key-missing", reason: "xAI API key missing" };
  const grok = grokLane(ctx, "grok-api");
  return lane(state, { ...grok.defaults }, grok.models);
}

function agyLane(installed: boolean): ModelLaneDto {
  const state: LaneState = installed
    ? { status: "ready", reason: "binary installed; login cannot be probed" }
    : { status: "disconnected", reason: "binary not installed" };
  return lane(state, { image: "nano-banana-2" }, {
    image: entries("agy", deriveModels("agy", "image")), video: [],
  });
}

function geminiLane(ctx: RuntimeContext): ModelLaneDto {
  const configured = Boolean(ctx.geminiApiKey || ctx.vertexServiceAccountJson);
  const state: LaneState = configured
    ? { status: "ready" }
    : { status: "key-missing", reason: "Gemini API or Vertex credentials missing" };
  return lane(state, { image: "nano-banana-2" }, {
    image: entries("gemini-api", deriveModels("gemini-api", "image")), video: [],
  });
}

function atlasCloudLane(ctx: RuntimeContext): ModelLaneDto {
  // #150 phase 2: Atlas Cloud is the second lane behind ProviderAdapterV1.
  // The adapter owns auth state and the model list; the DTO projection stays
  // here, so /api/models keeps its exact shape.
  const adapter = getProviderAdapter(ctx, "atlascloud");
  if (!adapter) {
    const fallback: LaneState = ctx.atlasCloudApiKey
      ? { status: "ready" }
      : { status: "key-missing", reason: "Atlas Cloud API key missing" };
    return lane(fallback, { image: ATLASCLOUD_TEXT_TO_IMAGE_MODEL }, {
      image: entries("atlascloud", deriveModels("atlascloud", "image")), video: [],
    });
  }
  const auth = adapter.validateAuth();
  const state: LaneState = auth.ok
    ? { status: "ready" }
    : { status: "key-missing", reason: auth.reason ?? "Atlas Cloud API key missing" };
  return lane(state, { image: ATLASCLOUD_TEXT_TO_IMAGE_MODEL }, {
    image: entries("atlascloud", adapter.listModels().map((model) => model.id)), video: [],
  });
}

function minimaxLane(ctx: RuntimeContext): ModelLaneDto {
  // #150 phase 1: MiniMax is the reference lane behind ProviderAdapterV1. The
  // adapter owns auth state and the model list; the DTO projection stays here,
  // so /api/models keeps its exact shape.
  const adapter = getProviderAdapter(ctx, "minimax");
  if (!adapter) {
    const fallback: LaneState = ctx.minimaxApiKey
      ? { status: "ready" }
      : { status: "key-missing", reason: "MiniMax API key missing" };
    return lane(fallback, { image: MINIMAX_TEXT_TO_IMAGE_MODEL }, {
      image: entries("minimax", deriveModels("minimax", "image")), video: [],
    });
  }
  const auth = adapter.validateAuth();
  const state: LaneState = auth.ok
    ? { status: "ready" }
    : { status: "key-missing", reason: auth.reason ?? "MiniMax API key missing" };
  return lane(state, { image: MINIMAX_TEXT_TO_IMAGE_MODEL }, {
    image: entries("minimax", adapter.listModels().map((model) => model.id)), video: [],
  });
}

function naiLane(ctx: RuntimeContext): ModelLaneDto {
  const adapter = getProviderAdapter(ctx, "nai");
  if (!adapter) {
    const fallback: LaneState = ctx.naiApiKey
      ? { status: "ready" }
      : { status: "key-missing", reason: "NovelAI API token missing" };
    return lane(fallback, { image: NAI_DEFAULT_IMAGE_MODEL }, {
      image: entries("nai", deriveModels("nai", "image")), video: [],
    });
  }
  const auth = adapter.validateAuth();
  const state: LaneState = auth.ok
    ? { status: "ready" }
    : { status: "key-missing", reason: auth.reason ?? "NovelAI API token missing" };
  return lane(state, { image: NAI_DEFAULT_IMAGE_MODEL }, {
    image: entries("nai", adapter.listModels().map((model) => model.id)), video: [],
  });
}

/**
 * The comfy lane, whose catalog and liveness both come from runtime state.
 *
 * The lane status folds the way grokLaneState does, but partial availability is
 * normal here in a way it is not for a hosted provider: 8188 can be up while
 * 8189 is down, and marking the whole lane disconnected would hide four usable
 * workflows because of one dead box. So the lane stays ready while each
 * workflow carries its own liveness in its description.
 */
async function comfyLane(ctx: RuntimeContext, deps: ModelsRouteDeps = {}): Promise<ModelLaneDto> {
  const workflows = await (deps.listComfyWorkflows ?? listWorkflows)();
  if (workflows.length === 0) {
    return lane(
      { status: "disconnected", reason: "No ComfyUI workflow registered" },
      {},
      { image: [], video: [] },
    );
  }
  const health = await (deps.probeComfyOrigins ?? probeComfyOrigins)(
    workflows.map((workflow) => workflow.origin),
    ctx.config.comfy.healthTimeoutMs,
  );
  const liveness = [...health.values()];
  const anyLive = liveness.some((entry) => entry.ok);
  const allLive = liveness.every((entry) => entry.ok);
  const state: LaneState = anyLive
    ? { status: "ready", ...(allLive ? {} : { reason: "Some ComfyUI instances are offline" }) }
    : { status: "disconnected", reason: "No ComfyUI instance responded" };
  const imageWorkflows = workflows.filter((workflow) => workflow.mediaKind === "image");
  const videoWorkflows = workflows.filter((workflow) => workflow.mediaKind === "video");
  const firstImage = imageWorkflows[0];
  const projectWorkflow = (workflow: (typeof workflows)[number]): McpModelEntry => ({
      id: workflow.id,
      label: workflow.label,
      description: health.get(workflow.origin)?.ok
        ? workflow.origin
        : `${workflow.origin} (offline)`,
      capabilities: {
        source: "verified-contract" as const,
        aspectRatios: [],
        parameters: [],
        inputRoles: workflow.bind.refImage ? ["text", "image_references"] : ["text"],
      },
    });
  return lane(state, firstImage ? { image: firstImage.id } : {}, {
    image: imageWorkflows.map(projectWorkflow),
    // Video workflows run for real now, so they carry no blanket lock. A dead
    // origin still shows through the "(offline)" description that
    // projectWorkflow attaches, which the selector reads to disable the row —
    // that is an availability fact, not a capability lock.
    video: videoWorkflows.map(projectWorkflow),
  });
}

async function buildCoreLanes(ctx: RuntimeContext, agyInstalled: boolean, deps: ModelsRouteDeps = {}) {
  const gptModels = entries("oauth", ctx.config.imageModels.valid);
  const lanes: Record<CoreProviderId, ModelLaneDto> = {
    oauth: oauthLane(ctx, gptModels),
    api: apiLane(ctx, entries("api", ctx.config.apiProvider.validImageModels)),
    grok: grokLane(ctx),
    "grok-api": grokApiLane(ctx),
    agy: agyLane(agyInstalled),
    "gemini-api": geminiLane(ctx),
    atlascloud: atlasCloudLane(ctx),
    minimax: minimaxLane(ctx),
    nai: naiLane(ctx),
    comfy: await comfyLane(ctx, deps),
  };
  for (const id of deriveProviderIds()) {
    // Both ids and surfaces exhaust the canonical registry; MCP is never decorated.
    lanes[id].surfaces = Object.fromEntries(PROVIDER_SURFACES.map((surface) => [
      surface, getProviderSurfaceSupport(id, surface)!,
    ])) as Record<ProviderSurface, ProviderSurfaceSupport>;
  }
  return lanes;
}

function detectAgyInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    try {
      const child = spawn(resolveAgyBin(), ["--version"], {
        stdio: "ignore",
        env: { ...process.env, PATH: buildAgyPathEnv() },
      });
      child.on("error", () => done(false));
      child.on("exit", (code) => done(code === 0));
      timer = setTimeout(() => {
        try { if (!child.killed) child.kill(); } catch { /* best-effort timeout cleanup */ }
        done(false);
      }, 3000);
      timer.unref?.();
    } catch {
      done(false);
    }
  });
}

async function resolveAgyStatus(detector: () => Promise<boolean>): Promise<boolean> {
  try {
    return await detector();
  } catch {
    return false;
  }
}

function cachedAgyDetection(): Promise<boolean> {
  agyDetection ??= resolveAgyStatus(detectAgyInstalled);
  return agyDetection;
}

function mcpState(meta: McpProviderDescriptor, status: McpConnectionStatus): LaneState {
  if (!meta.executable) return { status: "locked", reason: meta.lockReason };
  if (!meta.enabled) return { status: "disconnected", reason: "provider disabled" };
  if (status.state === "connected") return { status: "ready" };
  return {
    status: "disconnected",
    reason: status.detail ?? `MCP connection ${status.state}`,
  };
}

function catalogCaller(ctx: RuntimeContext): CatalogToolCaller {
  const manager = ctx.mcpConnectionManager;
  if (!manager) {
    return () => Promise.reject(new Error("MCP_NOT_CONNECTED"));
  }
  return (provider, name, args, options) => manager.callTool(provider, name, args, options);
}

async function loadCatalog(
  meta: McpProviderDescriptor,
  ctx: RuntimeContext,
  connected: boolean,
): Promise<CatalogResult> {
  if (meta.catalogAccess === "connected" && (!meta.enabled || !connected)) {
    return { models: emptyModels() };
  }
  try {
    const models = await getProviderModels(meta.id, catalogCaller(ctx));
    return { models };
  } catch (error) {
    const code = String((error as Error)?.message ?? error).split(":")[0];
    return {
      models: emptyModels(),
      reason: code === "MCP_NOT_CONNECTED" ? "provider disconnected during catalog browse" : "model catalog unavailable",
      ...(code === "MCP_NOT_CONNECTED" ? { disconnected: true } : {}),
    };
  }
}

async function buildMcpLane(meta: McpProviderDescriptor, ctx: RuntimeContext): Promise<ModelLaneDto> {
  try {
    const connection = ctx.mcpConnectionManager?.status(meta.id)
      ?? { provider: meta.id, state: "disconnected" as const };
    const connected = connection.state === "connected";
    const catalog = await loadCatalog(meta, ctx, connected);
    const base = mcpState(meta, connection);
    const status = catalog.disconnected && base.status !== "locked" ? "disconnected" : base.status;
    const reason = meta.lockReason ?? catalog.reason ?? base.reason;
    return lane({ status, ...(reason ? { reason } : {}) }, { ...meta.defaults }, catalog.models);
  } catch {
    const state = meta.executable
      ? { status: "disconnected" as const, reason: "lane status unavailable" }
      : { status: "locked" as const, reason: meta.lockReason };
    return lane(state, { ...meta.defaults }, emptyModels());
  }
}

function fallbackMcpLanes(): Record<"runway" | "higgsfield", ModelLaneDto> {
  const entries = MCP_PROVIDER_FALLBACKS.map((meta) => {
    const state: LaneState = meta.executable
      ? { status: "disconnected", reason: "lane status unavailable" }
      : { status: "locked", reason: meta.lockReason };
    return [meta.id, lane(state, { ...meta.defaults }, emptyModels())] as const;
  });
  return Object.fromEntries(entries) as Record<"runway" | "higgsfield", ModelLaneDto>;
}

async function buildMcpLanes(ctx: RuntimeContext): Promise<Record<"runway" | "higgsfield", ModelLaneDto>> {
  try {
    const providers = listProviders(ctx.config.mcp.enabledProviders)
      .filter((provider) => MCP_LANES.has(provider.id as ModelLaneId));
    const built = await Promise.all(providers.map(async (provider) => {
      try {
        return [provider.id, await buildMcpLane(provider, ctx)] as const;
      } catch {
        const state: LaneState = provider.executable
          ? { status: "disconnected", reason: "lane status unavailable" }
          : { status: "locked", reason: provider.lockReason };
        return [provider.id, lane(state, { ...provider.defaults }, emptyModels())] as const;
      }
    }));
    return Object.fromEntries(built) as Record<"runway" | "higgsfield", ModelLaneDto>;
  } catch {
    return fallbackMcpLanes();
  }
}

export function registerModelsRoutes(
  app: Express,
  ctxRaw: RouteRuntimeContext,
  deps: ModelsRouteDeps = {},
) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.get("/api/models", async (_req: Request, res: Response) => {
    try {
      const [agyInstalled, mcp] = await Promise.all([
        resolveAgyStatus(deps.detectAgyInstalled ?? cachedAgyDetection),
        buildMcpLanes(ctx),
      ]);
      res.json({ ok: true, lanes: { ...(await buildCoreLanes(ctx, agyInstalled, deps)), ...mcp } });
    } catch {
      const mcp = await buildMcpLanes(ctx);
      res.json({ ok: true, lanes: { ...(await buildCoreLanes(ctx, false, deps)), ...mcp } });
    }
  });
}

/**
 * Builds the whole lane map: the single source of lane truth.
 *
 * /api/models and /api/capabilities both call THIS, rather than each deriving
 * lane state its own way. Two implementations of "is this lane usable" would be
 * the exact drift the capability surface exists to remove.
 */
export async function buildLaneMap(
  ctx: RuntimeContext,
  deps: ModelsRouteDeps = {},
): Promise<Record<string, ModelLaneDto>> {
  try {
    const [agyInstalled, mcp] = await Promise.all([
      resolveAgyStatus(deps.detectAgyInstalled ?? cachedAgyDetection),
      buildMcpLanes(ctx),
    ]);
    return { ...(await buildCoreLanes(ctx, agyInstalled, deps)), ...mcp };
  } catch {
    const mcp = await buildMcpLanes(ctx);
    return { ...(await buildCoreLanes(ctx, false, deps)), ...mcp };
  }
}

/**
 * Lane summary for the capability surface, behind a short TTL.
 *
 * The UI polls /api/capabilities, and a lane map costs a ComfyUI origin probe
 * plus an agy binary spawn — fine once, wasteful per request. A few seconds of
 * staleness is invisible next to how fast a credential or a GPU box changes.
 *
 * Counts, not model ids: choosing a lane is the decision at this layer, and
 * `ima2 models` already answers which models it holds. Repeating that list here
 * would just be a second copy to drift.
 */
const LANE_SUMMARY_TTL_MS = 5_000;
let laneSummaryCache: { at: number; value: Record<string, LaneSummary> } | null = null;

export interface LaneSummary {
  status: ModelLaneStatus;
  reason?: string;
  models: { image: number; video: number };
}

export async function buildLaneSummary(
  ctx: RuntimeContext,
  deps: ModelsRouteDeps = {},
): Promise<Record<string, LaneSummary>> {
  const now = Date.now();
  if (laneSummaryCache && now - laneSummaryCache.at < LANE_SUMMARY_TTL_MS) {
    return laneSummaryCache.value;
  }
  const lanes = await buildLaneMap(ctx, deps);
  const summary: Record<string, LaneSummary> = {};
  for (const [id, dto] of Object.entries(lanes)) {
    summary[id] = {
      status: dto.status,
      ...(dto.reason ? { reason: dto.reason } : {}),
      models: { image: dto.models.image.length, video: dto.models.video.length },
    };
  }
  laneSummaryCache = { at: now, value: summary };
  return summary;
}

/** Test seam: the TTL would otherwise leak state between cases. */
export function _resetLaneSummaryCache(): void {
  laneSummaryCache = null;
}
