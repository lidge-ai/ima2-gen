import type { MediaModel } from "./mediaCatalog";
import { formProblem } from "./mediaForm";
import { resolveRoute } from "./mediaRoutes";
import { reconcileSelection, type Adjustment, type MediaSelection } from "./mediaSelection";
import { inferTask, isClassicTask } from "./mediaTasks";

/** What a media result row carries about how it was made (GET /api/history, from the sidecar). */
export interface MediaResultSettings {
  task?: string | null;
  durationSec?: number | null;
  resolution?: string | null;
  quality?: string | null;
  aspectRatio?: string | null;
  seed?: number | null;
  audio?: boolean | null;
  inputRoles?: readonly string[] | null;
}
export interface MediaResultFacts {
  provider?: string | null;
  model?: string | null;
  adapter?: string | null;
  route?: "direct" | "aggregator" | string | null;
  mediaType?: string | null;
  media?: MediaResultSettings | null;
  billed?: { usd?: number; units?: number; unit?: string } | null;
  estimate?: { usd: number | null; basis: string } | null;
}

/** Made through a media route: the server records these as provider "media:<adapter>". */
export function isMediaResult(item: MediaResultFacts): boolean {
  return typeof item.provider === "string" && item.provider.startsWith("media:") && typeof item.model === "string" && item.model !== "";
}

export function resultAdapter(item: MediaResultFacts): string | null {
  if (item.adapter) return item.adapter;
  return typeof item.provider === "string" && item.provider.startsWith("media:") ? item.provider.slice(6) || null : null;
}

export type ResultCost =
  | { kind: "billed"; usd: number }
  | { kind: "estimate"; usd: number }
  /** The price list could not settle the row, so the saved figure is the most it could have been. */
  | { kind: "ceiling"; usd: number };

/** What the provider reported charging when it said; otherwise the estimate saved at submit time. Null when the row has neither. */
export function resultCost(item: MediaResultFacts): ResultCost | null {
  if (typeof item.billed?.usd === "number") return { kind: "billed", usd: item.billed.usd };
  if (typeof item.estimate?.usd === "number") return { kind: item.estimate.basis === "exact" ? "estimate" : "ceiling", usd: item.estimate.usd };
  return null;
}

export type RemakePlan =
  | { ok: true; selection: MediaSelection; adjusted: Adjustment[]; inputsDropped: boolean; voiceNeeded: boolean }
  | { ok: false; reason: "not-media" | "model-gone" };

/**
 * The selection that makes this result again: the same model, the same route pinned, and the settings
 * it was made with, re-checked against today's catalog. A route the catalog no longer lists falls back
 * to Automatic and the change is reported with the rest. Input images are not kept with a result, so
 * a result made from images asks for them again; a voice is not kept either, so speech asks for one.
 */
export function remakePlan(item: MediaResultFacts, models: readonly MediaModel[]): RemakePlan {
  if (!isMediaResult(item)) return { ok: false, reason: "not-media" };
  const kind = item.mediaType === "video" ? "video" : item.mediaType === "audio" ? "audio" : "image";
  const model = models.find((entry) => entry.id === item.model && entry.kind === kind);
  if (!model) return { ok: false, reason: "model-gone" };
  const settings = item.media ?? {};
  const inputs = settings.inputRoles?.length ?? 0;
  const task = typeof settings.task === "string" && isClassicTask(settings.task) ? settings.task : inferTask(kind, inputs);
  const adapter = resultAdapter(item);
  const stillListed = adapter !== null && model.routes.some((route) => route.adapter === adapter);
  const resolved = resolveRoute(model, stillListed ? { adapter: adapter!, routeMode: "pinned", task } : { routeMode: "auto", task });
  if (!resolved) return { ok: false, reason: "model-gone" };
  const made: MediaSelection = { kind, model: model.id, adapter: adapter ?? resolved.route.adapter, task };
  if (typeof settings.durationSec === "number") made.durationSec = settings.durationSec;
  if (typeof settings.resolution === "string") made.resolution = settings.resolution;
  if (typeof settings.quality === "string") made.quality = settings.quality;
  if (typeof settings.aspectRatio === "string") made.aspectRatio = settings.aspectRatio;
  if (typeof settings.seed === "number") made.seed = settings.seed;
  if (typeof settings.audio === "boolean") made.audio = settings.audio;
  const pinned = stillListed && resolved.route.adapter === adapter;
  const next = reconcileSelection(model, resolved.route, task, made, pinned ? "pinned" : "auto");
  const voiceNeeded = formProblem(resolved.route, next.selection)?.code === "voice";
  return { ok: true, selection: next.selection, adjusted: next.adjusted, inputsDropped: inputs > 0, voiceNeeded };
}
