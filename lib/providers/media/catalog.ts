import type { MediaKind, MediaPrice, MediaProviderAdapter } from "./contract.js";
import type { MediaKeySnapshot } from "./credentials.js";
import type { MediaCatalogModel, MediaRegistry } from "./registry.js";
import { VendorLogos } from "./vendorAssets.js";

function maskKey(key: string): string {
  return key.length <= 10 ? "***" : `${key.slice(0, 4)}..${key.slice(-2)}`;
}

function adapterEntry(adapter: MediaProviderAdapter, keys: MediaKeySnapshot, logos: VendorLogos) {
  const resolved = keys.resolve(adapter);
  const cred = adapter.credential;
  return {
    id: adapter.id,
    label: adapter.label,
    route: adapter.route,
    logo: logos.forAdapter(adapter),
    keyVocabulary: cred.keyVocabulary,
    consoleUrl: cred.consoleUrl,
    keyPrefix: cred.keyPrefix ?? null,
    hasKey: keys.hasKey(adapter),
    keySource: resolved.source,
    maskedKey: resolved.apiKey ? maskKey(resolved.apiKey) : null,
    extraFields: (cred.extraFields ?? []).map((f) => ({
      name: f.name,
      secret: f.secret,
      required: f.required,
      configured: Boolean(resolved.extra[f.name]),
      source: resolved.extraSources[f.name] ?? "none",
      ...(f.secret ? {} : { value: resolved.extra[f.name] ?? null }),
    })),
    modelCount: adapter.listModels().length,
  };
}

/** Lowest published price of a route, in the unit this kind of model is normally sold by when one is listed. */
function lowestPrice(pricing: readonly MediaPrice[], kind: MediaKind): number {
  const unit = kind === "image" ? "image" : "second";
  const comparable = pricing.some((price) => price.unit === unit) ? pricing.filter((price) => price.unit === unit) : pricing;
  return comparable.reduce((min, price) => Math.min(min, price.usd), Number.POSITIVE_INFINITY);
}

/**
 * The route a client should preselect: a keyed direct route, otherwise the keyed aggregator with the
 * lowest published price (unpublished prices last, registry order on ties). Null when no route has a key.
 */
function defaultRouteOf(routes: readonly { adapter: string; route: "direct" | "aggregator"; hasKey: boolean; pricing: readonly MediaPrice[] }[], kind: MediaKind): string | null {
  const keyed = routes.filter((route) => route.hasKey);
  const direct = keyed.find((route) => route.route === "direct");
  if (direct) return direct.adapter;
  let best: { adapter: string; usd: number } | null = null;
  for (const route of keyed) {
    const usd = lowestPrice(route.pricing, kind);
    if (!best || usd < best.usd) best = { adapter: route.adapter, usd };
  }
  return best?.adapter ?? null;
}

function modelEntry(model: MediaCatalogModel, keys: MediaKeySnapshot, logos: VendorLogos) {
  const routes = model.candidates.map(({ adapter, spec }) => ({
    adapter: adapter.id,
    route: adapter.route,
    label: adapter.label,
    logo: logos.forAdapter(adapter),
    upstreamId: spec.upstreamId,
    tasks: spec.tasks,
    params: spec.params,
    pricing: spec.pricing,
    docsUrl: spec.docsUrl,
    hasKey: keys.hasKey(adapter),
  }));
  return {
    id: model.id,
    label: model.label,
    vendor: model.vendor,
    logo: logos.find(model.vendor),
    kind: model.kind,
    tasks: model.tasks,
    routes,
    defaultRoute: defaultRouteOf(routes, model.kind),
  };
}

export type MediaCatalogResponse = ReturnType<typeof buildMediaCatalog>;

/** GET /api/media/catalog body. Never contains key values, only masked forms. */
export function buildMediaCatalog(registry: MediaRegistry, keys: MediaKeySnapshot, kind?: MediaKind, logos: VendorLogos = new VendorLogos([])) {
  return {
    models: registry.listModels(kind).map((m) => modelEntry(m, keys, logos)),
    adapters: registry.listAdapters().map((a) => adapterEntry(a, keys, logos)),
  };
}
