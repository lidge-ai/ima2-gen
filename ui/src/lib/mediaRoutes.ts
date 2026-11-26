import type { MediaModel, MediaPrice, MediaRoute } from "./mediaCatalog";
import { routeTasks } from "./mediaTasks";

/** Lowest published price of a route, in the unit this kind of model is normally sold by when one is listed. */
export function lowestPrice(route: Pick<MediaRoute, "pricing">, kind: MediaModel["kind"]): MediaPrice | null {
  const unit = kind === "image" ? "image" : "second";
  const comparable = route.pricing.some((price) => price.unit === unit) ? route.pricing.filter((price) => price.unit === unit) : route.pricing;
  return comparable.reduce<MediaPrice | null>((min, price) => (!min || price.usd < min.usd ? price : min), null);
}

function supports(route: MediaRoute, task?: string): boolean {
  return !task || (routeTasks(route) as string[]).includes(task);
}

/** Direct routes first, then the lowest published price; routes without a published price last. */
function byPreference(kind: MediaModel["kind"]) {
  const usd = (route: MediaRoute) => lowestPrice(route, kind)?.usd ?? Number.POSITIVE_INFINITY;
  return (a: MediaRoute, b: MediaRoute) => Number(b.route === "direct") - Number(a.route === "direct") || usd(a) - usd(b);
}

/** Every route that can do the task, in the order the automatic choice considers them. */
export function candidateRoutes(model: MediaModel, task?: string): MediaRoute[] {
  return model.routes.filter((route) => supports(route, task)).sort(byPreference(model.kind));
}

/** The route "Automatic" runs: a keyed direct route, otherwise the keyed aggregator with the lowest published price. */
export function autoRoute(model: MediaModel, task?: string): MediaRoute | undefined {
  return candidateRoutes(model, task).find((route) => route.hasKey);
}

export interface ResolvedRoute {
  route: MediaRoute;
  /** auto: chosen for the user. pinned: the user fixed it. needs-key: nothing runs until this route gets a key. */
  state: "auto" | "pinned" | "needs-key";
}

/**
 * A pinned route is honored even without a key (the UI then asks for that key) and is never swapped
 * for another one. Automatic never falls to a keyless route silently: with no key anywhere it names
 * the route to add a key for.
 */
export function resolveRoute(model: MediaModel, selection: { adapter?: string; routeMode?: "auto" | "pinned"; task?: string }): ResolvedRoute | undefined {
  if (selection.routeMode !== "auto" && selection.adapter) {
    const pinned = model.routes.find((route) => route.adapter === selection.adapter);
    if (pinned && supports(pinned, selection.task)) return { route: pinned, state: pinned.hasKey ? "pinned" : "needs-key" };
  }
  const keyed = autoRoute(model, selection.task);
  if (keyed) return { route: keyed, state: "auto" };
  const first = candidateRoutes(model, selection.task)[0];
  return first ? { route: first, state: "needs-key" } : undefined;
}

export function modelRunnable(model: MediaModel, task?: string): boolean {
  return autoRoute(model, task) !== undefined;
}
