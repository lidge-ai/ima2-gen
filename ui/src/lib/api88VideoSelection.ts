import type { SelectGroup } from "../components/controls/Select";
import type { LaneCatalogSnapshot } from "./laneCatalog";
import { getVideoModelOptionsForProvider, VIDEO_VALUE_PREFIX } from "./imageModels";

export function coreVideoGroup(
  provider: string, snapshot: LaneCatalogSnapshot, translate: (key: string) => string,
): SelectGroup<string> | null {
  const known = getVideoModelOptionsForProvider(provider);
  if (!known.length) return null;
  const rows = snapshot.catalog?.[provider]?.models.video ?? [];
  const options = known
    .filter((option) => provider !== "88api" || snapshot.phase !== "ready"
      || rows.some((entry) => entry.id === option.value));
  if (!options.length) return null;
  return { label: translate("mcp.videoModels"), items: options.map((option) => {
    const row = rows.find((entry) => entry.id === option.value);
    return { value: `${VIDEO_VALUE_PREFIX}${option.value}`, label: option.shortLabel,
      ...(provider === "88api" && (snapshot.phase !== "ready" || !row || row.executable === false)
        ? { disabled: true, title: row?.lockReason ?? translate("mcp.unavailable") } : {}) };
  }) };
}

export function canSelectCoreVideo(provider: string, id: string, snapshot: LaneCatalogSnapshot): boolean {
  if (!getVideoModelOptionsForProvider(provider).some((option) => option.value === id)) return false;
  if (provider !== "88api") return true;
  const row = snapshot.catalog?.[provider]?.models.video.find((entry) => entry.id === id);
  return snapshot.phase === "ready" && Boolean(row && row.executable !== false);
}
