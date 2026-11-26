import type { MediaKind, MediaModelSpec, MediaProviderAdapter, MediaTask } from "./contract.js";
import { BUILTIN_MEDIA_ADAPTERS } from "./adapters.js";

export interface MediaRouteCandidate {
  adapter: MediaProviderAdapter;
  spec: MediaModelSpec;
}

export interface MediaCatalogModel {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  /** Union of the tasks every route supports. */
  tasks: readonly MediaTask[];
  /** Direct routes first, then aggregators; registration order within each. */
  candidates: readonly MediaRouteCandidate[];
}

export type MediaRouteErrorCode =
  | "MEDIA_MODEL_UNKNOWN"
  | "MEDIA_ROUTE_UNKNOWN"
  | "MEDIA_TASK_UNSUPPORTED"
  | "MEDIA_KEY_MISSING";

export type MediaRouteSelection =
  | { ok: true; adapter: MediaProviderAdapter; spec: MediaModelSpec }
  | { ok: false; code: MediaRouteErrorCode; status: number; message: string; candidates: readonly string[] };

const ADAPTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function groupModels(adapters: readonly MediaProviderAdapter[]): Map<string, MediaRouteCandidate[]> {
  const byId = new Map<string, MediaRouteCandidate[]>();
  for (const adapter of adapters) {
    for (const spec of adapter.listModels()) {
      const list = byId.get(spec.id) ?? [];
      if (list.some((c) => c.adapter.id === adapter.id)) {
        throw new Error(`media adapter ${adapter.id} lists model ${spec.id} twice`);
      }
      list.push({ adapter, spec });
      byId.set(spec.id, list);
    }
  }
  return byId;
}

function toCatalogModel(id: string, candidates: MediaRouteCandidate[]): MediaCatalogModel {
  const ordered = [
    ...candidates.filter((c) => c.adapter.route === "direct"),
    ...candidates.filter((c) => c.adapter.route !== "direct"),
  ];
  const first = ordered[0]!.spec;
  const tasks = [...new Set(ordered.flatMap((c) => c.spec.tasks))];
  return { id, label: first.label, vendor: first.vendor, kind: first.kind, tasks, candidates: ordered };
}

/** Model id → route candidates, built once from a fixed adapter list. */
export class MediaRegistry {
  private readonly adapters = new Map<string, MediaProviderAdapter>();
  private readonly models = new Map<string, MediaCatalogModel>();

  constructor(adapters: readonly MediaProviderAdapter[]) {
    for (const adapter of adapters) {
      if (!ADAPTER_ID.test(adapter.id)) throw new Error(`invalid media adapter id: ${adapter.id}`);
      if (this.adapters.has(adapter.id)) throw new Error(`duplicate media adapter id: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
    for (const [id, candidates] of groupModels(adapters)) {
      this.models.set(id, toCatalogModel(id, candidates));
    }
  }

  listAdapters(): readonly MediaProviderAdapter[] {
    return [...this.adapters.values()];
  }

  getAdapter(id: string): MediaProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  listModels(kind?: MediaKind): readonly MediaCatalogModel[] {
    const all = [...this.models.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }

  getModel(id: string): MediaCatalogModel | undefined {
    return this.models.get(id);
  }
}

function routeError(code: MediaRouteErrorCode, status: number, message: string, candidates: readonly string[] = []): MediaRouteSelection {
  return { ok: false, code, status, message, candidates };
}

/** Lowest published price of a route, in the unit this kind of model is normally sold by when one is listed. */
function lowestPrice(spec: MediaModelSpec): number {
  const unit = spec.kind === "image" ? "image" : "second";
  const comparable = spec.pricing.some((price) => price.unit === unit) ? spec.pricing.filter((price) => price.unit === unit) : spec.pricing;
  return comparable.reduce((min, price) => Math.min(min, price.usd), Number.POSITIVE_INFINITY);
}

/**
 * The one answer to "which route runs when none is named": a keyed direct route, otherwise the keyed
 * aggregator with the lowest published price (unpublished prices last, registry order on ties).
 * The catalog's defaultRoute and a request without an adapter both come from here.
 */
export function preferredCandidate(candidates: readonly MediaRouteCandidate[], hasKey: (adapter: MediaProviderAdapter) => boolean): MediaRouteCandidate | undefined {
  const keyed = candidates.filter((c) => hasKey(c.adapter));
  const direct = keyed.find((c) => c.adapter.route === "direct");
  if (direct) return direct;
  let best: { candidate: MediaRouteCandidate; usd: number } | undefined;
  for (const candidate of keyed) {
    const usd = lowestPrice(candidate.spec);
    if (!best || usd < best.usd) best = { candidate, usd };
  }
  return best?.candidate;
}

/**
 * Route rule (plan 261126): an explicit adapter is used as-is; otherwise preferredCandidate picks
 * among the routes that can do the task. A route without a key is never chosen silently, and
 * nothing here falls back after a failure.
 */
export function selectMediaRoute(
  model: MediaCatalogModel | undefined,
  options: { modelId: string; adapterId?: string | undefined; task: MediaTask; hasKey: (adapter: MediaProviderAdapter) => boolean },
): MediaRouteSelection {
  if (!model) return routeError("MEDIA_MODEL_UNKNOWN", 404, `Unknown media model: ${options.modelId}`);
  const ids = model.candidates.map((c) => c.adapter.id);
  if (options.adapterId) {
    const chosen = model.candidates.find((c) => c.adapter.id === options.adapterId);
    if (!chosen) return routeError("MEDIA_ROUTE_UNKNOWN", 400, `${model.id} is not available through ${options.adapterId}`, ids);
    if (!chosen.spec.tasks.includes(options.task)) {
      return routeError("MEDIA_TASK_UNSUPPORTED", 400, `${model.id} via ${chosen.adapter.id} does not support ${options.task}`, ids);
    }
    if (!options.hasKey(chosen.adapter)) {
      return routeError("MEDIA_KEY_MISSING", 400, `No key saved for ${chosen.adapter.label}`, [chosen.adapter.id]);
    }
    return { ok: true, adapter: chosen.adapter, spec: chosen.spec };
  }
  const capable = model.candidates.filter((c) => c.spec.tasks.includes(options.task));
  if (capable.length === 0) return routeError("MEDIA_TASK_UNSUPPORTED", 400, `${model.id} does not support ${options.task}`, ids);
  const keyed = preferredCandidate(capable, options.hasKey);
  if (!keyed) {
    const names = capable.map((c) => c.adapter.id);
    return routeError("MEDIA_KEY_MISSING", 400, `No key saved for any route to ${model.id} (${names.join(", ")})`, names);
  }
  return { ok: true, adapter: keyed.adapter, spec: keyed.spec };
}

let activeRegistry: MediaRegistry | null = null;

export function getMediaRegistry(): MediaRegistry {
  activeRegistry ??= new MediaRegistry(BUILTIN_MEDIA_ADAPTERS);
  return activeRegistry;
}
