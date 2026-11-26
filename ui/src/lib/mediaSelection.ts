import type { MediaModel, MediaRoute } from "./mediaCatalog";
import { resolutionRank } from "./mediaModelList";
import { routeTasks, type ClassicTask } from "./mediaTasks";

/** Classic media lane selection. A null selection keeps the existing core lane. */
export interface MediaSelection {
  kind: "image" | "video";
  model: string;
  /** The route that runs. With routeMode "auto" it is re-derived from the catalog whenever keys change. */
  adapter: string;
  task: string;
  /** "auto" follows direct-first; "pinned" (or absent, for selections saved before this field) keeps the adapter. */
  routeMode?: "auto" | "pinned";
  /** Names kept with the selection so the closed controls can show them without loading the catalog. */
  label?: string;
  vendor?: string;
  /** The running route's provider name and square mark, for the same reason. */
  routeLabel?: string;
  routeMark?: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  audio?: boolean;
  negativePrompt?: string;
  seed?: number;
}

export interface MediaSelectionState {
  mediaSelection: MediaSelection | null;
  /** Sets and saves the selection. `adjusted` replaces the "changed to fit" note; omit it to leave the note as it is. */
  setMediaSelection: (selection: MediaSelection | null, adjusted?: Adjustment[]) => void;
  /** Settings the last model or route change could not keep. */
  mediaAdjustments: Adjustment[];
  dismissMediaAdjustments: () => void;
  /** The model window; `kind` limits it to one output type. Null when closed. */
  mediaPicker: { kind?: "image" | "video" } | null;
  openMediaPicker: (kind?: "image" | "video") => void;
  closeMediaPicker: () => void;
  /** The last failed media job, kept through reloads until dismissed or a later job succeeds. */
  mediaFailure: import("./mediaFailure").MediaFailure | null;
  setMediaFailure: (failure: import("./mediaFailure").MediaFailure | null) => void;
  dismissMediaFailure: () => void;
  /** Runs the failed job's model, settings and prompt again. */
  retryMediaFailure: () => Promise<void>;
  /** The provider lane whose key is being replaced after it was rejected; null when no replacement is open. */
  mediaKeyPrompt: string | null;
  promptMediaKey: (failure: import("./mediaFailure").MediaFailure) => void;
  closeMediaKeyPrompt: () => void;
  /** Restores a media result's model, route, settings and prompt so it can be generated again. Nothing is sent. */
  remakeMediaResult: (item: import("../types").GenerateItem) => Promise<void>;
}

export type AdjustedField = "task" | "durationSec" | "resolution" | "aspectRatio" | "audio" | "seed" | "negativePrompt";
export interface Adjustment { field: AdjustedField; from: string; to: string | null }

export const MAX_SEED = 2_147_483_647;

/** A whole number a provider accepts as a seed, or undefined for anything else (empty, fractions, negatives). */
export function parseSeed(text: string): number | undefined {
  if (!/^\d{1,10}$/.test(text.trim())) return undefined;
  const value = Number(text.trim());
  return value <= MAX_SEED ? value : undefined;
}

function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 5 s when the route offers it (the length most prices are quoted for), otherwise its shortest clip. */
export function defaultDuration(allowed: readonly number[] | undefined): number | undefined {
  if (!allowed?.length) return undefined;
  return allowed.includes(5) ? 5 : Math.min(...allowed);
}

/** 720p for video when listed; otherwise the lowest listed resolution, which is also the cheapest tier. */
export function defaultResolution(allowed: readonly string[] | undefined): string | undefined {
  if (!allowed?.length) return undefined;
  const hd = allowed.find((label) => sameLabel(label, "720p"));
  if (hd) return hd;
  const ranked = allowed.map((label) => ({ label, rank: resolutionRank(label) })).filter((entry) => entry.rank > 0).sort((a, b) => a.rank - b.rank);
  return ranked[0]?.label ?? allowed[0];
}

function keepDuration(previous: number | undefined, allowed: readonly number[] | undefined): number | undefined {
  if (!allowed?.length) return undefined;
  if (previous === undefined) return defaultDuration(allowed);
  // The nearest listed length keeps the intent ("about 10 s") better than jumping back to the default.
  return allowed.reduce((best, value) => (Math.abs(value - previous) < Math.abs(best - previous) ? value : best), allowed[0]!);
}

function keepLabel(previous: string | undefined, allowed: readonly string[] | undefined, fallback: string | undefined): string | undefined {
  if (!allowed?.length) return undefined;
  if (previous === undefined) return fallback;
  return allowed.find((label) => sameLabel(label, previous)) ?? fallback;
}

/**
 * The selection for a model and route, keeping every earlier setting the route still allows.
 * A setting the route does not list is replaced by a listed value (or dropped), and the change is
 * reported so the panel can say what moved. The prompt and the reference tray are not touched.
 */
export function reconcileSelection(model: MediaModel, route: MediaRoute, wantedTask: string, previous: MediaSelection | null,
  routeMode: "auto" | "pinned"): { selection: MediaSelection; adjusted: Adjustment[] } {
  const tasks = routeTasks(route);
  const task: string = (tasks as string[]).includes(wantedTask) ? wantedTask : tasks[0] ?? route.tasks[0] ?? wantedTask;
  const params = route.params;
  const next: MediaSelection = { kind: model.kind as "image" | "video", model: model.id, adapter: route.adapter, task, routeMode, label: model.label, vendor: model.logo?.name || model.vendor, routeLabel: route.label };
  if (route.logo?.urls.mark) next.routeMark = route.logo.urls.mark;
  const durationSec = keepDuration(previous?.durationSec, params.durationsSec);
  const resolution = keepLabel(previous?.resolution, params.resolutions, defaultResolution(params.resolutions));
  const aspectRatio = keepLabel(previous?.aspectRatio, params.aspectRatios, undefined);
  if (durationSec !== undefined) next.durationSec = durationSec;
  if (resolution !== undefined) next.resolution = resolution;
  if (aspectRatio !== undefined) next.aspectRatio = aspectRatio;
  if (params.nativeAudio && previous?.audio !== undefined) next.audio = previous.audio;
  if (params.negativePrompt && previous?.negativePrompt) next.negativePrompt = previous.negativePrompt;
  if (params.seed && previous?.seed !== undefined) next.seed = previous.seed;
  if (!previous) return { selection: next, adjusted: [] };
  const adjusted: Adjustment[] = [];
  const note = (field: AdjustedField, from: unknown, to: unknown) => {
    if (from === undefined || from === "" || from === false || from === to) return;
    if (typeof from === "string" && typeof to === "string" && sameLabel(from, to)) return;
    adjusted.push({ field, from: String(from), to: to === undefined ? null : String(to) });
  };
  if (previous.kind === next.kind) note("task", previous.task, next.task);
  note("durationSec", previous.durationSec, next.durationSec);
  note("resolution", previous.resolution, next.resolution);
  note("aspectRatio", previous.aspectRatio, next.aspectRatio);
  note("audio", previous.audio, next.audio);
  note("seed", previous.seed, next.seed);
  note("negativePrompt", previous.negativePrompt ? "set" : undefined, next.negativePrompt ? "set" : undefined);
  return { selection: next, adjusted };
}

export type { ClassicTask };
