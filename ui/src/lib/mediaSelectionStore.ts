import type { MediaSelection } from "./mediaSelection";
import { MEDIA_RECENT_MODELS_STORAGE_KEY, MEDIA_SELECTION_STORAGE_KEY } from "../store/persistenceRegistry";

const RECENT_LIMIT = 6;

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch { /* storage disabled: the choice lasts for this page only */ }
}

const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** Reads a saved selection, dropping anything that is not the shape this version writes. */
export function parseMediaSelection(raw: unknown): MediaSelection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if ((v.kind !== "image" && v.kind !== "video") || !text(v.model) || !text(v.adapter) || !text(v.task)) return null;
  const selection: MediaSelection = { kind: v.kind, model: v.model, adapter: v.adapter, task: v.task, routeMode: v.routeMode === "auto" ? "auto" : "pinned" };
  if (text(v.label)) selection.label = v.label;
  if (text(v.vendor)) selection.vendor = v.vendor;
  if (typeof v.durationSec === "number" && Number.isFinite(v.durationSec) && v.durationSec > 0) selection.durationSec = v.durationSec;
  if (text(v.resolution)) selection.resolution = v.resolution;
  if (text(v.aspectRatio)) selection.aspectRatio = v.aspectRatio;
  if (typeof v.audio === "boolean") selection.audio = v.audio;
  if (text(v.negativePrompt, 20_000)) selection.negativePrompt = v.negativePrompt;
  if (typeof v.seed === "number" && Number.isInteger(v.seed) && v.seed >= 0) selection.seed = v.seed;
  return selection;
}

export function loadMediaSelection(): MediaSelection | null {
  return parseMediaSelection(read(MEDIA_SELECTION_STORAGE_KEY));
}

export function saveMediaSelection(selection: MediaSelection | null): void {
  write(MEDIA_SELECTION_STORAGE_KEY, selection);
}

/** Recently picked models as "kind:id", newest first. */
export function loadRecentModels(): string[] {
  const raw = read(MEDIA_RECENT_MODELS_STORAGE_KEY);
  return Array.isArray(raw) ? raw.filter((id): id is string => text(id)).slice(0, RECENT_LIMIT) : [];
}

export function rememberModel(kind: string, id: string): string[] {
  const key = `${kind}:${id}`;
  const next = [key, ...loadRecentModels().filter((entry) => entry !== key)].slice(0, RECENT_LIMIT);
  write(MEDIA_RECENT_MODELS_STORAGE_KEY, next);
  return next;
}
