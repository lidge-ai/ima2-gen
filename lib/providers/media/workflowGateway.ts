import type { MediaModelSpec } from "./contract.js";
import { MediaKeySnapshot } from "./credentials.js";
import type { MediaCatalogModel } from "./registry.js";
import type { MediaRunnerDeps } from "./runnerTypes.js";
import { WorkflowError } from "../../workflows/errors.js";
import type { ResolvedRoute, WorkflowGateway } from "../../workflows/types.js";
import type { SessionRoute } from "./sessionRoutes.js";

function pick(model: MediaCatalogModel, keys: MediaKeySnapshot, route: string | undefined) {
  if (route) return model.candidates.find((c) => c.adapter.id === route);
  return model.candidates.find((c) => keys.hasKey(c.adapter)) ?? model.candidates[0];
}

/**
 * The L6 workflow engine's view of the media layer: catalog lookups and route/key
 * resolution follow the same rule as POST /api/media (explicit route as-is, else
 * the first keyed route, direct before aggregator; never a keyless route).
 * One key snapshot per request keeps the estimate and the run on the same route.
 */
export interface GatewayExtras extends Pick<WorkflowGateway, "planText"> {
  /** Route ids served by a signed-in session instead of a saved key (xai-oauth, openai-oauth). */
  sessionRoutes?: Readonly<Record<string, SessionRoute>>;
}

async function resolveSession(deps: MediaRunnerDeps, modelId: string, routeId: string, session: SessionRoute, fetchImpl: typeof fetch): Promise<ResolvedRoute> {
  const candidate = deps.registry.getModel(modelId)?.candidates.find((c) => c.adapter.id === session.adapterId);
  if (!candidate) {
    throw new WorkflowError("MEDIA_ROUTE_UNKNOWN", `${modelId} is not available through ${session.label} (no ${session.adapterId} adapter lists it)`, { status: 400 });
  }
  try {
    const opened = await session.open(AbortSignal.timeout(30_000));
    return { adapter: candidate.adapter, ctx: { apiKey: opened.apiKey, fetch: opened.fetch ?? fetchImpl, ...(opened.baseUrl ? { baseUrl: opened.baseUrl } : {}) } };
  } catch {
    throw new WorkflowError("MEDIA_SESSION_MISSING", `Sign in to ${session.label} to use route ${routeId}`, { status: 400, category: "auth" });
  }
}

export async function createWorkflowGateway(deps: MediaRunnerDeps, extras: GatewayExtras = {}): Promise<WorkflowGateway> {
  const keys = await MediaKeySnapshot.load(deps.configFile, deps.env ?? process.env);
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  return {
    catalog(modelId: string): MediaModelSpec | undefined {
      const model = deps.registry.getModel(modelId);
      return model ? pick(model, keys, undefined)?.spec : undefined;
    },
    canRun(modelId: string, route: string | undefined): boolean {
      const session = route ? extras.sessionRoutes?.[route] : undefined;
      const model = deps.registry.getModel(modelId);
      if (!model) return false;
      // A session route is offered when its adapter lists the model; sign-in is checked when the step opens it.
      if (session) return model.candidates.some((c) => c.adapter.id === session.adapterId);
      const chosen = pick(model, keys, route);
      return chosen ? keys.hasKey(chosen.adapter) : false;
    },
    async resolve(modelId: string, route: string | undefined): Promise<ResolvedRoute> {
      const session = route ? extras.sessionRoutes?.[route] : undefined;
      if (session) return resolveSession(deps, modelId, route!, session, fetchImpl);
      const model = deps.registry.getModel(modelId);
      if (!model) throw new WorkflowError("MEDIA_MODEL_UNKNOWN", `No adapter lists ${modelId}`, { status: 404, category: "not-found" });
      const chosen = pick(model, keys, route);
      if (!chosen) throw new WorkflowError("MEDIA_ROUTE_UNKNOWN", `${modelId} is not available through ${route}`, { status: 400 });
      if (!keys.hasKey(chosen.adapter)) {
        throw new WorkflowError("MEDIA_KEY_MISSING", `No key saved for ${chosen.adapter.label} (needed for ${modelId})`, { status: 400, category: "auth" });
      }
      const cred = keys.resolve(chosen.adapter);
      return { adapter: chosen.adapter, ctx: { apiKey: cred.apiKey ?? "", extra: cred.extra, fetch: fetchImpl } };
    },
    fetch: fetchImpl,
    ...(extras.planText ? { planText: extras.planText } : {}),
  };
}
