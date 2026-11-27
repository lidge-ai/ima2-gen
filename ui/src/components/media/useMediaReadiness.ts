import { useMediaCatalog } from "../../lib/mediaCatalogStore";
import type { MediaAdapter, MediaModel } from "../../lib/mediaCatalog";
import { generateBlocker, type GenerateBlocker } from "../../lib/mediaReadiness";
import { resolveRoute, type ResolvedRoute } from "../../lib/mediaRoutes";
import type { MediaSelection } from "../../lib/mediaSelection";
import { useAppStore } from "../../store/useAppStore";

export interface MediaReadiness {
  selection: MediaSelection;
  model: MediaModel | undefined;
  resolved: ResolvedRoute | undefined;
  /** The provider lane of the route that would run. */
  adapter: MediaAdapter | undefined;
  blocker: GenerateBlocker | null;
}

/**
 * What Generate would do with the selected media model right now. Null when the classic lane is in
 * charge (no media model, or a mode that does not use it), in which case no media data is read.
 */
export function useMediaReadiness(): MediaReadiness | null {
  const selection = useAppStore((s) => s.mediaSelection);
  const classic = useAppStore((s) => s.uiMode === "classic");
  const references = useAppStore((s) => s.referenceImages.length + (s.providerUrlReference ? 1 : 0));
  const active = selection !== null && classic;
  const catalog = useMediaCatalog(active);
  if (!selection || !classic) return null;
  const model = catalog.models.find((item) => item.id === selection.model && item.kind === selection.kind);
  const resolved = model ? resolveRoute(model, selection) : undefined;
  const adapter = resolved ? catalog.adapters.find((item) => item.id === resolved.route.adapter) : undefined;
  return { selection, model, resolved, adapter, blocker: generateBlocker(resolved, selection.task, references, selection) };
}
