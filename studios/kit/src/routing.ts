import type { CatalogModel, CatalogRoute, MediaTask } from "./types.ts";

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
 *
 * With a task, only routes that serve it are considered: a route may serve fewer tasks than its model
 * lists, and a choice made for another task is dropped rather than sent somewhere that refuses it.
 */
export function chooseRoute(model: CatalogModel, chosenProviderId?: string, task?: MediaTask): RouteChoice {
  const routes = task ? model.routes.filter((r) => !r.tasks || r.tasks.includes(task)) : model.routes;
  if (chosenProviderId) {
    const route = routes.find((r) => r.providerId === chosenProviderId);
    if (route)
      return route.keyConfigured ? { kind: "chosen", route } : { kind: "needs-key", route, candidates: [route] };
  }
  const keyed = routes.filter((r) => r.keyConfigured);
  const direct = keyed.find((r) => r.route === "direct");
  const pick = direct ?? keyed[0];
  if (pick) return { kind: "default", route: pick };
  const first = routes[0];
  if (!first) return { kind: "unavailable" };
  return { kind: "needs-key", route: first, candidates: routes };
}

export function modelHasKey(model: CatalogModel): boolean {
  return model.routes.some((r) => r.keyConfigured);
}
