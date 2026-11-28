import { useCallback, useEffect, useState } from "react";
import type { Element } from "@ima2/studio-kit";
import { useStudioApi } from "./context.tsx";

const CHANGED = "ima2-elements-changed";

/** Tells every open element list (the Assets tab, a picker in a form) to read the elements again. */
export function elementsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The saved elements, read when first shown and again whenever one is added, changed or removed. */
export function useElements(enabled = true) {
  const studio = useStudioApi();
  const [elements, setElements] = useState<readonly Element[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    studio.client.elements.list().then(setElements, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [studio]);
  useEffect(() => {
    if (!enabled) return;
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [enabled, load]);
  return { elements, error, loading: enabled && elements === null && !error, reload: load };
}
