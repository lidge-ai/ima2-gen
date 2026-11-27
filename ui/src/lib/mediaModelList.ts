import { resolutionChoices, type MediaModel, type MediaPrice } from "./mediaCatalog";
import { autoRoute, candidateRoutes, lowestPrice, modelRunnable } from "./mediaRoutes";
import { modelTasks, type ClassicKind, type ClassicTask } from "./mediaTasks";

/** A number that orders resolution labels ("720p", "4K", "1024x1536"); 0 when the label says nothing ("auto"). */
export function resolutionRank(label: string): number {
  const text = label.toLowerCase();
  const size = /(\d{3,5})\s*x\s*(\d{3,5})/.exec(text);
  if (size) return Math.max(Number(size[1]), Number(size[2]));
  const lines = /(\d{3,4})\s*p/.exec(text);
  if (lines) return Number(lines[1]);
  const k = /(\d+(?:\.\d+)?)\s*k/.exec(text);
  if (k) return Number(k[1]) * (Number(k[1]) >= 4 ? 540 : 1000);
  const plain = /(\d{3,5})/.exec(text);
  return plain ? Number(plain[1]) : 0;
}

/** The facts a row shows so two models can be compared without opening them. */
export interface ModelFacts {
  /** Lowest published price of the route that would run, or across every route while the model needs a key. */
  price: MediaPrice | null;
  /** Lowest and highest listed resolution, or null when no route lists any. */
  resolutions: { low: string; high: string; rank: number } | null;
  durations: { min: number; max: number } | null;
  audio: boolean;
  routes: number;
  runnable: boolean;
}

/**
 * A model the saved keys can run is described by the route that would run, so the row never promises
 * a price or a resolution the person cannot get. A model that still needs a key is described by its
 * best case across routes.
 */
export function modelFacts(model: MediaModel, task?: string): ModelFacts {
  const candidates = candidateRoutes(model, task);
  const running = autoRoute(model, task);
  const routes = running ? [running] : candidates;
  const prices = routes.map((route) => lowestPrice(route, model.kind)).filter((price): price is MediaPrice => price !== null);
  const ranked = [...new Set(routes.flatMap((route) => resolutionChoices(route).map((option) => option.label)))]
    .map((label) => ({ label, rank: resolutionRank(label) })).filter((entry) => entry.rank > 0).sort((a, b) => a.rank - b.rank);
  const seconds = routes.flatMap((route) => route.params.durationsSec ?? []);
  const low = ranked[0];
  const high = ranked[ranked.length - 1];
  return {
    price: prices.reduce<MediaPrice | null>((min, price) => (!min || price.usd < min.usd ? price : min), null),
    resolutions: low && high ? { low: low.label, high: high.label, rank: high.rank } : null,
    durations: seconds.length ? { min: Math.min(...seconds), max: Math.max(...seconds) } : null,
    audio: routes.some((route) => route.params.nativeAudio === true),
    routes: candidates.length,
    runnable: running !== undefined,
  };
}

export type ModelFeature = "mine" | "audio" | "sharp" | "long";
export type ModelSort = "catalog" | "price" | "resolution" | "duration";
/** "Sharp" means 1080p for video and 2K for images. */
export const SHARP_RANK: Record<ClassicKind, number> = { video: 1080, image: 2000 };
export const LONG_SECONDS = 10;

const FEATURE_TEST: Record<ModelFeature, (facts: ModelFacts, kind: ClassicKind) => boolean> = {
  mine: (facts) => facts.runnable,
  audio: (facts) => facts.audio,
  sharp: (facts, kind) => (facts.resolutions?.rank ?? 0) >= SHARP_RANK[kind],
  long: (facts) => (facts.durations?.max ?? 0) >= LONG_SECONDS,
};

export interface ModelFilter {
  kind: ClassicKind;
  task: ClassicTask;
  query?: string;
  features?: readonly ModelFeature[];
  vendor?: string | null;
}

function matchesQuery(model: MediaModel, query: string): boolean {
  const hay = `${model.label} ${model.id} ${model.vendor}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

/** Models of this kind that can do the task and pass the search, the feature chips and the maker. */
export function filterModels(models: readonly MediaModel[], filter: ModelFilter): MediaModel[] {
  return models.filter((model) => {
    if (model.kind !== filter.kind || !modelTasks(model).includes(filter.task)) return false;
    if (filter.vendor && model.vendor !== filter.vendor) return false;
    if (filter.query && !matchesQuery(model, filter.query)) return false;
    const facts = modelFacts(model, filter.task);
    return (filter.features ?? []).every((feature) => FEATURE_TEST[feature](facts, filter.kind));
  });
}

/** Feature chips worth showing: ones that would keep some models and drop others. */
export function offeredFeatures(models: readonly MediaModel[], kind: ClassicKind, task: ClassicTask): ModelFeature[] {
  const facts = models.map((model) => modelFacts(model, task));
  return (Object.keys(FEATURE_TEST) as ModelFeature[]).filter((feature) => {
    const kept = facts.filter((entry) => FEATURE_TEST[feature](entry, kind)).length;
    return kept > 0 && kept < facts.length;
  });
}

/** Stable sort; a model without the compared fact goes last. "catalog" keeps the server order. */
export function sortModels(models: readonly MediaModel[], sort: ModelSort, task: ClassicTask): MediaModel[] {
  if (sort === "catalog") return [...models];
  const value = (model: MediaModel): number => {
    const facts = modelFacts(model, task);
    if (sort === "price") return facts.price?.usd ?? Number.POSITIVE_INFINITY;
    if (sort === "resolution") return -(facts.resolutions?.rank ?? 0);
    return -(facts.durations?.max ?? 0);
  };
  return models.map((model, index) => ({ model, index, value: value(model) }))
    .sort((a, b) => a.value - b.value || a.index - b.index).map((entry) => entry.model);
}

export interface ModelGroups { recent: MediaModel[]; ready: MediaModel[]; needsKey: MediaModel[] }

/** Recent holds only models that run right now, so a keyless pick never floats to the top. */
export function groupModels(models: readonly MediaModel[], recentIds: readonly string[], task: ClassicTask): ModelGroups {
  const runnable = models.filter((model) => modelRunnable(model, task));
  const recent = recentIds.flatMap((id) => runnable.filter((model) => `${model.kind}:${model.id}` === id));
  return {
    recent,
    ready: runnable.filter((model) => !recent.includes(model)),
    needsKey: models.filter((model) => !modelRunnable(model, task)),
  };
}

/** Models of this kind the classic composer cannot feed (they need a video or audio input). */
export function unsupportedModels(models: readonly MediaModel[], kind: ClassicKind): MediaModel[] {
  return models.filter((model) => model.kind === kind && modelTasks(model).length === 0);
}

export type SuggestionReason = "cheapest" | "sharpest" | "longest";
export interface Suggestion { model: MediaModel; reason: SuggestionReason; facts: ModelFacts }

/**
 * Up to three runnable models, each the best on one catalog fact. Nothing is suggested when the
 * choice is already small or the fact does not separate the models.
 */
export function suggestModels(models: readonly MediaModel[], task: ClassicTask): Suggestion[] {
  const entries = models.map((model) => ({ model, facts: modelFacts(model, task) })).filter((entry) => entry.facts.runnable);
  if (entries.length < 4) return [];
  const picks: Suggestion[] = [];
  const add = (reason: SuggestionReason, value: (facts: ModelFacts) => number | null) => {
    const scored = entries.flatMap((entry) => { const score = value(entry.facts); return score === null ? [] : [{ ...entry, score }]; });
    const best = scored.reduce<(typeof scored)[number] | null>((top, entry) => (!top || entry.score > top.score ? entry : top), null);
    if (!best || scored.every((entry) => entry.score === best.score)) return;
    if (!picks.some((pick) => pick.model === best.model)) picks.push({ model: best.model, reason, facts: best.facts });
  };
  add("cheapest", (facts) => (facts.price ? -facts.price.usd : null));
  add("sharpest", (facts) => facts.resolutions?.rank ?? null);
  add("longest", (facts) => facts.durations?.max ?? null);
  return picks;
}
