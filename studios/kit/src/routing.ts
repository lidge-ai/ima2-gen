import type { CatalogModel, CatalogRoute } from "./types.ts";

export type RouteChoice =
  | { kind: "chosen"; route: CatalogRoute }
  | { kind: "default"; route: CatalogRoute }
  | { kind: "needs-key"; route: CatalogRoute; candidates: readonly CatalogRoute[] }
  | { kind: "unavailable" };

/**
 * Route selection rule from the plan: an explicit choice wins, even without a
 * key (the UI then asks for that key). Otherwise the first keyed direct route,
 * then the first keyed aggregator. With no key anywhere, nothing runs: the UI
 * must ask for a key instead of silently picking a keyless route.
 */
export function chooseRoute(model: CatalogModel, chosenProviderId?: string): RouteChoice {
  if (chosenProviderId) {
    const route = model.routes.find((r) => r.providerId === chosenProviderId);
    if (route)
      return route.keyConfigured ? { kind: "chosen", route } : { kind: "needs-key", route, candidates: [route] };
  }
  const keyed = model.routes.filter((r) => r.keyConfigured);
  const direct = keyed.find((r) => r.route === "direct");
  const pick = direct ?? keyed[0];
  if (pick) return { kind: "default", route: pick };
  const first = model.routes[0];
  if (!first) return { kind: "unavailable" };
  return { kind: "needs-key", route: first, candidates: model.routes };
}

export function modelHasKey(model: CatalogModel): boolean {
  return model.routes.some((r) => r.keyConfigured);
}
