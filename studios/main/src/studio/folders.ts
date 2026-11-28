import { useCallback, useEffect, useState } from "react";
import type { Folder } from "@ima2/studio-kit";
import { useStudioApi } from "./context.tsx";

const CHANGED = "ima2-folders-changed";

/** Tells every open folder list (the Assets toolbar, a result's folder menu) to read the folders again. */
export function foldersChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The folders, read when first shown and again whenever one is added, renamed or deleted. */
export function useFolders(enabled = true) {
  const studio = useStudioApi();
  const [folders, setFolders] = useState<readonly Folder[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    studio.client.folders.list().then(setFolders, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [studio]);
  useEffect(() => {
    if (!enabled) return;
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [enabled, load]);
  return { folders, error, loading: enabled && folders === null && !error, reload: load };
}
