/**
 * Translates the server's wire shapes (wire.ts) into the UI-facing kit types
 * (types.ts) and back. Pure functions; client.ts does the I/O.
 */
import type { Catalog, CatalogModel, CatalogProvider, Job, KeyStatus, MediaModelSpec, MediaSubmitBody, SubmitInput } from "./types.ts";
import type { WireAdapter, WireCatalog, WireJob, WireModel, WireRoute } from "./wire.ts";

/* ---------- catalog and keys ---------- */

function unionParams(routes: readonly WireRoute[]): MediaModelSpec["params"] {
  const out: Record<string, unknown> = {};
  for (const route of routes) {
    for (const [key, value] of Object.entries(route.params)) {
      const prev = out[key];
      if (Array.isArray(value)) out[key] = [...new Set([...((prev as unknown[]) ?? []), ...value])];
      else if (typeof value === "number") out[key] = Math.max(Number(prev ?? 0), value);
      else if (typeof value === "boolean") out[key] = Boolean(prev) || value;
    }
  }
  return out as MediaModelSpec["params"];
}

function toModel(model: WireModel): CatalogModel {
  const rank = (r: WireRoute) => (r.hasKey ? 0 : 2) + (r.route === "direct" ? 0 : 1);
  const routes = [...model.routes].sort((a, b) => rank(a) - rank(b));
  return {
    id: model.id,
    vendor: model.vendor,
    label: model.label,
    kind: model.kind,
    tasks: model.tasks,
    params: unionParams(routes),
    routes: routes.map((r) => ({
      providerId: r.adapter, route: r.route, label: r.label, upstreamId: r.upstreamId,
      pricing: r.pricing, docsUrl: r.docsUrl, keyConfigured: r.hasKey,
    })),
    routeParams: Object.fromEntries(routes.map((r) => [r.adapter, r.params])),
    defaultRoute: model.defaultRoute,
  };
}

function toProvider(a: WireAdapter): CatalogProvider {
  return {
    id: a.id, label: a.label, route: a.route, keyVocabulary: a.keyVocabulary, consoleUrl: a.consoleUrl,
    ...(a.keyPrefix ? { keyPrefix: a.keyPrefix } : {}),
    keyConfigured: a.hasKey,
    extraFields: a.extraFields.map((f) => ({ name: f.name, secret: f.secret, required: f.required })),
  };
}

export function toCatalog(wire: WireCatalog): Catalog {
  return { models: wire.models.map(toModel), providers: wire.adapters.map(toProvider) };
}

/** One status per key vocabulary, built from the catalog's adapter list (several adapters can share a key). */
export function toKeyStatuses(wire: WireCatalog): KeyStatus[] {
  const byVocab = new Map<string, WireAdapter[]>();
  for (const a of wire.adapters) byVocab.set(a.keyVocabulary, [...(byVocab.get(a.keyVocabulary) ?? []), a]);
  return [...byVocab.entries()].map(([vocab, adapters]) => {
    const first = adapters[0]!;
    const source = first.keySource === "env" ? "env" : first.keySource === "config" ? "config" : null;
    return {
      keyVocabulary: vocab,
      providerIds: adapters.map((a) => a.id),
      configured: adapters.some((a) => a.hasKey),
      source,
      extraFields: first.extraFields.map((f) => ({ name: f.name, secret: f.secret, required: f.required, configured: f.configured })),
    };
  });
}

/* ---------- submit ---------- */

function wireInput(input: SubmitInput): Record<string, string> {
  return "inputId" in input ? { role: input.role, ref: input.inputId } : { role: input.role, url: input.url };
}

export function toWireSubmit(body: MediaSubmitBody, sessionId?: string): Record<string, unknown> {
  const { provider, clientRequestId, inputs, ...rest } = body;
  return {
    ...rest,
    ...(provider ? { adapter: provider } : {}),
    ...(clientRequestId ? { requestId: clientRequestId } : {}),
    ...(sessionId ? { sessionId } : {}),
    inputs: inputs.map(wireInput),
  };
}

/* ---------- jobs ---------- */

const iso = (ms: number | undefined) => new Date(ms ?? Date.now()).toISOString();

function terminalStatus(status: string): Job["status"] {
  if (status === "completed" || status === "succeeded") return "succeeded";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return "failed";
}

/** A job record from GET /api/media/jobs. Outputs arrive only through events and history. */
export function fromWireJob(wire: WireJob): Job {
  const meta = wire.meta ?? {};
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : undefined);
  const status: Job["status"] = wire.status ? terminalStatus(wire.status) : wire.phase === "queued" ? "queued" : "running";
  const job: Job = {
    jobId: wire.requestId,
    kind: wire.kind === "workflow" ? "workflow" : "media",
    target: str("model") ?? str("workflow") ?? "",
    status,
    createdAt: iso(wire.startedAt),
    updatedAt: iso(wire.finishedAt ?? wire.phaseAt ?? wire.startedAt),
    request: { prompt: wire.prompt ?? "" } as MediaSubmitBody,
    outputs: [],
  };
  const provider = str("adapter");
  if (provider) job.provider = provider;
  if (status === "failed" && wire.errorCode) {
    job.error = { code: wire.errorCode, message: wire.errorCode, category: "unknown", retryable: false };
  }
  return job;
}
