import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
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

export function useStudio<T>(select: (state: StudioState) => T): T {
  const studio = useStudioApi();
  return useSyncExternalStore(studio.subscribe, () => select(studio.getState()));
}
