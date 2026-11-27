import { resolutionOptions } from "./resolutionLabel.js";
import type { MediaKind, MediaProviderAdapter } from "./contract.js";
import type { MediaKeySnapshot } from "./credentials.js";
import { preferredCandidate, type MediaCatalogModel, type MediaRegistry } from "./registry.js";
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
    // A keyless lane has no entry on a key screen; clients list keys only for the others.
    keyless: cred.keyless === true,
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

function modelEntry(model: MediaCatalogModel, keys: MediaKeySnapshot, logos: VendorLogos) {
  const routes = model.candidates.map(({ adapter, spec }) => ({
    adapter: adapter.id,
    route: adapter.route,
    label: adapter.label,
    logo: logos.forAdapter(adapter),
    upstreamId: spec.upstreamId,
    tasks: spec.tasks,
    params: spec.params,
    // One readable label per listed size; value is the provider's own spelling and is what a request sends.
    resolutionOptions: resolutionOptions(spec.params.resolutions ?? []),
    pricing: spec.pricing,
    docsUrl: spec.docsUrl,
    hasKey: keys.hasKey(adapter),
    keyless: adapter.credential.keyless === true,
  }));
  return {
    id: model.id,
    label: model.label,
    vendor: model.vendor,
    logo: logos.find(model.vendor),
    kind: model.kind,
    tasks: model.tasks,
    routes,
    // The same rule a request without an adapter runs by (registry.preferredCandidate).
    defaultRoute: preferredCandidate(model.candidates, (adapter) => keys.hasKey(adapter))?.adapter.id ?? null,
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
