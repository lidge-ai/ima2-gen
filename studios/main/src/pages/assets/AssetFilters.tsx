import { useEffect, useState } from "react";
import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { href } from "../../router.ts";
import { useStudio } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import { useFolders } from "../../studio/folders.ts";
import { FolderManager } from "./FolderManager.tsx";
import { FM } from "./folderMessages.ts";
import type { Tab } from "./AssetsPage.tsx";

const tabs: readonly Tab[] = ["all", "images", "videos", "audio", "saved", "elements"];
export const PERIODS = ["any", "day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export type Order = "newest" | "oldest";

/** What narrows and orders the results, besides the tab. Kept in the address, so a reload or a link shows the same list. */
export interface Narrow {
  q: string;
  model: string;
  order: Order;
  period: Period;
  /** A folder id, or "" for every result. */
  folder: string;
}
export const NO_NARROW: Narrow = { q: "", model: "", order: "newest", period: "any", folder: "" };

/** The address query for a narrowing; defaults are left out. */
export function narrowQuery(narrow: Narrow): Record<string, string | undefined> {
  return {
    q: narrow.q || undefined, model: narrow.model || undefined,
    period: narrow.period === "any" ? undefined : narrow.period, order: narrow.order === "oldest" ? "oldest" : undefined,
    folder: narrow.folder || undefined,
  };
}

const EDIT = "\u0000edit";

/** Which folder to show; the menu's last item opens the folder list. A folder in the address that no longer exists shows as "All results". */
function FolderFilter({ folder, setFolder }: { folder: string; setFolder: (value: string) => void }) {
  const t = useT(FM);
  const { folders } = useFolders();
  const [editing, setEditing] = useState(false);
  const known = (folders ?? []).some((entry) => entry.id === folder);
  return (
    <>
      <SettingTile
        variant="chip" menuPlacement="bottom" caption={t("folder")} chipText={(label) => t("folder") + ": " + label}
        value={known ? folder : ""} onChange={(value) => { if (value === EDIT) setEditing(true); else setFolder(value); }}
        options={[{ value: "", label: t("allFolders") }, ...(folders ?? []).map((entry) => ({ value: entry.id, label: entry.name })), { value: EDIT, label: t("edit"), action: true }]}
      />
      <FolderManager open={editing} onClose={() => setEditing(false)} onRemoved={(id) => { if (id === folder) setFolder(""); }} />
    </>
  );
}

function ModelFilter({ model, setModel, models }: { model: string; setModel: (value: string) => void; models: readonly string[] }) {
  const t = useT(M);
  const catalog = useStudio((state) => state.catalog);
  // The chosen model stays in the list even when the other filters leave it no results.
  const options = [...new Set([...models, ...(model ? [model] : [])])].sort().map((id) => {
    const entry = catalog?.models.find((item) => item.id === id);
    return {
      value: id,
      label: entry?.label ?? id,
      icon: (
        <span aria-hidden="true">
          <VendorLogo id={entry?.vendor ?? id.split("/")[0] ?? id} size={16} />
        </span>
      ),
    };
  });
  return (
    <SettingTile
      variant="chip" menuPlacement="bottom" caption={t("model")} chipText={(label) => t("model") + ": " + label}
      value={model} onChange={setModel} options={[{ value: "", label: t("allModels") }, ...options]}
    />
  );
}

/** The search box keeps what is typed and reports it after a short pause, so each keystroke is not a request. */
function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT(M);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = window.setTimeout(() => onChange(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <label className="search-field assets-search">
      <Icon name="search" size={15} />
      <input type="search" value={text} placeholder={t("search")} aria-label={t("search")} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

interface Props {
  tab: Tab;
  narrow: Narrow;
  setNarrow: (patch: Partial<Narrow>) => void;
  models: readonly string[];
  density: string;
  setDensity: (value: "comfortable" | "compact") => void;
}

export function AssetFilters({ tab, narrow, setNarrow, models, density, setDensity }: Props) {
  const t = useT(M);
  return (
    <div className="assets-filters">
      <nav className="tabs assets-tabs" aria-label={t("filters")}>
        {tabs.map((value) => (
          // Another tab keeps the search and filters; Elements has none of its own.
          <a key={value} className="tab" href={href("assets/" + value, value === "elements" ? undefined : narrowQuery(narrow))} aria-current={tab === value ? "page" : undefined}>
            {t(value)}
          </a>
        ))}
      </nav>
      {/* Elements are not results: they have no model, date order or layout choice. */}
      {tab === "elements" ? null : (
        <div className="assets-narrow" role="group" aria-label={t("narrow")}>
          <Search value={narrow.q} onChange={(q) => setNarrow({ q })} />
          <ModelFilter model={narrow.model} setModel={(model) => setNarrow({ model })} models={models} />
          <FolderFilter folder={narrow.folder} setFolder={(folder) => setNarrow({ folder })} />
          <SettingTile
            variant="chip" menuPlacement="bottom" caption={t("period")} chipText={(label) => t("period") + ": " + label}
            value={narrow.period} onChange={(period) => setNarrow({ period })} options={PERIODS.map((value) => ({ value, label: t(value) }))}
          />
          <SettingTile
            variant="chip" menuPlacement="bottom" caption={t("order")} chipText={(label) => t("order") + ": " + label}
            value={narrow.order} onChange={(order) => setNarrow({ order })} options={(["newest", "oldest"] as const).map((value) => ({ value, label: t(value) }))}
          />
          <div className="assets-density" role="group" aria-label={t("density")}>
            {(["comfortable", "compact"] as const).map((value) => (
              <button key={value} className="btn" type="button" aria-pressed={density === value} onClick={() => setDensity(value)}>
                {t(value)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
