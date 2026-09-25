import { canonicalizeImageModel } from "./model-aliases.js";
import { deriveProviderIds } from "../../lib/providers/derive.js";
import { migrateOAuthImageModel } from "../../lib/oauthLegacyModels.js";
import { listProviders } from "../../lib/mcp/providerRegistry.js";
import type { CoreProviderId } from "../../lib/providers/registry.js";

export type Lane = CoreProviderId | "runway" | "higgsfield";
export type LaneStatus = "ready" | "locked" | "disconnected" | "key-missing";

export interface ModelEntry {
  id: string;
  label?: string;
  capabilities?: unknown;
  executable?: boolean;
  lockReason?: string;
}

export interface LaneInfo {
  status: LaneStatus;
  reason?: string;
  defaults: { image?: string; video?: string };
  models: { image: ModelEntry[]; video: ModelEntry[] };
}

export type ModelCatalog = { lanes: Record<string, LaneInfo> };
export interface CliDefaults { image?: string; video?: string }
export type ResolveResult =
  | { ok: true; lane: Lane; model: string; transport: "core" | "mcp" }
  | { ok: false; code: string; message: string; extra?: Record<string, unknown> | undefined };

const LANES = [
  ...deriveProviderIds(),
  ...listProviders([]).map((provider) => provider.id as Lane),
] as readonly Lane[];

function failure(code: string, message: string, extra?: Record<string, unknown> | undefined): ResolveResult {
  return { ok: false, code, message, ...(extra ? { extra } : {}) };
}

function knownLane(value: string | undefined, catalog: ModelCatalog): Lane | null {
  if (!value || !LANES.includes(value as Lane) || !catalog.lanes[value]) return null;
  return value as Lane;
}

function canonicalModel(kind: "image" | "video", model: string): string {
  return kind === "image" ? canonicalizeImageModel(model) ?? model : model;
}

/** GPT OAuth keeps only GPT-6; a saved or scripted legacy OAuth id resolves to its GPT-6 tier. */
function laneModel(lane: string, kind: "image" | "video", model: string): string {
  return kind === "image" && lane === "oauth" ? migrateOAuthImageModel(model) : model;
}

function modelExists(info: LaneInfo | undefined, kind: "image" | "video", model: string): boolean {
  return info?.models[kind].some((entry) => entry.id === model) ?? false;
}

function findModel(info: LaneInfo | undefined, kind: "image" | "video", model: string): ModelEntry | undefined {
  return info?.models[kind].find((entry) => entry.id === model);
}

function resolveLaneModel(
  kind: "image" | "video",
  lane: Lane,
  requested: string,
  catalog: ModelCatalog,
): ResolveResult {
  const info = catalog.lanes[lane];
  if (!info) return failure("UNKNOWN_LANE", `Unknown lane: ${lane}`);
  const model = laneModel(lane, kind, requested);
  const entry = findModel(info, kind, model);
  if (!entry) {
    const otherKind = kind === "image" ? "video" : "image";
    if (modelExists(info, otherKind, model)) {
      return failure("KIND_MISMATCH", `${lane}/${model} is a ${otherKind} model, not ${kind}`);
    }
    return failure("MODEL_NOT_FOUND", `${lane}/${model} is not available for ${kind}`);
  }
  if (entry.executable === false) {
    const reason = entry.lockReason ?? "model execution is locked";
    return failure("MODEL_LOCKED", `${lane}/${model} is locked: ${reason}`, {
      lane, model, reason,
    });
  }
  if (info.status !== "ready") {
    const reason = info.reason ? `: ${info.reason}` : "";
    return failure("LANE_UNAVAILABLE", `${lane} is ${info.status}${reason}`, {
      lane, status: info.status, ...(info.reason ? { reason: info.reason } : {}),
    });
  }
  return {
    ok: true,
    lane,
    model,
    transport: lane === "runway" || lane === "higgsfield" ? "mcp" : "core",
  };
}

function groupedModels(catalog: ModelCatalog, kind: "image" | "video"): Record<string, string[]> {
  return Object.fromEntries(LANES.map((lane) => [
    lane,
    (catalog.lanes[lane]?.models[kind] ?? []).map((entry) => entry.id),
  ]));
}

function noDefault(kind: "image" | "video", catalog: ModelCatalog): ResolveResult {
  return failure("NO_DEFAULT_MODEL", `No default ${kind} model is configured`, {
    models: groupedModels(catalog, kind),
    fix: [
      `ima2 defaults set ${kind} <lane>/<model>`,
      `ima2 models --kind ${kind}`,
    ],
  });
}

function parseNamespaced(model: string): { lane: string; model: string } | null {
  const slash = model.indexOf("/");
  if (slash < 0) return null;
  return { lane: model.slice(0, slash), model: model.slice(slash + 1) };
}

function resolveNamespaced(
  kind: "image" | "video",
  rawModel: string,
  provider: string | undefined,
  catalog: ModelCatalog,
): ResolveResult {
  const parsed = parseNamespaced(rawModel);
  if (!parsed) return failure("MODEL_NOT_FOUND", `Model target must use <lane>/<model>: ${rawModel}`);
  const lane = knownLane(parsed.lane, catalog);
  if (!lane) return failure("UNKNOWN_LANE", `Unknown lane: ${parsed.lane}`);
  if (provider && provider !== lane) {
    return failure("LANE_CONFLICT", `--provider ${provider} conflicts with --model ${rawModel}`);
  }
  return resolveLaneModel(kind, lane, canonicalModel(kind, parsed.model), catalog);
}

function resolveBare(
  kind: "image" | "video",
  rawModel: string,
  provider: string | undefined,
  catalog: ModelCatalog,
): ResolveResult {
  const model = canonicalModel(kind, rawModel);
  const existsIn = (lane: Lane) => modelExists(catalog.lanes[lane], kind, laneModel(lane, kind, model));
  const lanes = provider
    ? [provider as Lane]
    : LANES.filter(existsIn);
  const matches = lanes.filter(existsIn);
  if (matches.length > 1) {
    return failure("MODEL_AMBIGUOUS", `${model} exists in multiple lanes; pass --provider <lane>`, {
      candidates: matches.map((lane) => `${lane}/${model}`),
    });
  }
  const only = matches[0];
  if (matches.length === 1 && only) return resolveLaneModel(kind, only, model, catalog);
  if (provider) {
    const info = catalog.lanes[provider];
    const otherKind = kind === "image" ? "video" : "image";
    if (modelExists(info, otherKind, model)) {
      return failure("KIND_MISMATCH", `${provider}/${model} is a ${otherKind} model, not ${kind}`);
    }
  }
  return failure("MODEL_NOT_FOUND", `${model} is not available for ${kind}`);
}

export function resolveTarget(
  kind: "image" | "video",
  flags: { model?: string | undefined; provider?: string | undefined },
  catalog: ModelCatalog,
  defaults: CliDefaults,
): ResolveResult {
  if (flags.provider === "auto") {
    return failure(
      "PROVIDER_AUTO_REMOVED",
      "--provider auto was removed; run `ima2 models` and pass `--provider <lane>`",
    );
  }
  const provider = flags.provider ? knownLane(flags.provider, catalog) : null;
  if (flags.provider && !provider) return failure("UNKNOWN_LANE", `Unknown lane: ${flags.provider}`);
  if (flags.model) {
    return parseNamespaced(flags.model)
      ? resolveNamespaced(kind, flags.model, provider ?? undefined, catalog)
      : resolveBare(kind, flags.model, provider ?? undefined, catalog);
  }
  if (provider) {
    const laneInfo = catalog.lanes[provider];
    if (!laneInfo) return failure("UNKNOWN_LANE", `Unknown lane: ${provider}`);
    const model = laneInfo.defaults[kind];
    if (!model) return failure("NO_DEFAULT_MODEL", `${provider} has no default ${kind} model`);
    return resolveLaneModel(kind, provider, canonicalModel(kind, model), catalog);
  }
  const configured = defaults[kind];
  if (!configured) return noDefault(kind, catalog);
  return resolveNamespaced(kind, configured, undefined, catalog);
}
