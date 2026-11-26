import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Studio, StudioState } from "./store.ts";

const StudioContext = createContext<Studio | null>(null);

export function StudioProvider({ studio, children }: { studio: Studio; children: ReactNode }) {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

export function useStudioApi(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("useStudioApi outside StudioProvider");
  return studio;
}

/** Same value, or arrays/objects whose own entries are identical. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Subscribes to a slice of studio state. Selectors may build new arrays; the
 * previous value is kept while it is shallowly equal, so renders stay stable.
 */
export function useStudio<T>(select: (state: StudioState) => T): T {
  const studio = useStudioApi();
  const cache = useRef<{ state: StudioState; value: T } | null>(null);
  const getSnapshot = () => {
    const state = studio.getState();
    const previous = cache.current;
    const value = select(state);
    if (previous && shallowEqual(previous.value, value)) {
      cache.current = { state, value: previous.value };
      return previous.value;
    }
    cache.current = { state, value };
    return value;
  };
  return useSyncExternalStore(studio.subscribe, getSnapshot);
}
