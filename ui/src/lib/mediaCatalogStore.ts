import { useEffect, useSyncExternalStore } from "react";
import { jsonFetch } from "./api-core";
import type { MediaAdapter, MediaModel } from "./mediaCatalog";

export interface MediaCatalogState {
  status: "idle" | "loading" | "ready" | "error";
  models: MediaModel[];
  adapters: MediaAdapter[];
  error: string;
}

let state: MediaCatalogState = { status: "idle", models: [], adapters: [], error: "" };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: MediaCatalogState): void {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * One catalog for every media surface in the classic UI. Nothing calls this until a person opens the
 * model window or already has a media model selected, so the default classic flow keeps its old requests.
 */
export function loadMediaCatalog(force = false): Promise<void> {
  if (pending) return pending;
  if (state.status === "ready" && !force) return Promise.resolve();
  if (state.status !== "ready") set({ ...state, status: "loading", error: "" });
  pending = jsonFetch<{ models: MediaModel[]; adapters: MediaAdapter[] }>("/api/media/catalog")
    .then((body) => set({ status: "ready", models: body.models ?? [], adapters: body.adapters ?? [], error: "" }))
    .catch((error: unknown) => set({ ...state, status: state.models.length ? "ready" : "error", error: error instanceof Error ? error.message : String(error) }))
    .finally(() => { pending = null; });
  return pending;
}

export function getMediaCatalog(): MediaCatalogState {
  return state;
}

/** Test hook: forget the loaded catalog. */
export function resetMediaCatalog(): void {
  pending = null;
  set({ status: "idle", models: [], adapters: [], error: "" });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useMediaCatalog(active: boolean): MediaCatalogState {
  const snapshot = useSyncExternalStore(subscribe, getMediaCatalog, getMediaCatalog);
  useEffect(() => { if (active) void loadMediaCatalog(); }, [active]);
  return snapshot;
}
