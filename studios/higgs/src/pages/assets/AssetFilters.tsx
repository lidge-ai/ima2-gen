import { useStudio } from "../../studio/context.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { Tab } from "./AssetsPage.tsx";

const tabs: readonly Tab[] = ["all", "images", "videos", "audio", "saved"];
const labels: Record<Tab, string> = { all: "All", images: "Images", videos: "Videos", audio: "Audio", saved: "Saved" };

function ModelFilter({
  model,
  setModel,
  models,
}: {
  model: string;
  setModel: (value: string) => void;
  models: readonly string[];
}) {
  const catalog = useStudio((state) => state.catalog);
  const options = models.map((id) => {
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
    <div className="assets-model">
      <SettingTile
        caption="Filter by model"
        accessibleLabel="Filter by model"
        value={model}
        onChange={setModel}
        options={[{ value: "", label: "All models" }, ...options]}
      />
    </div>
  );
}

export function AssetFilters({
  tab,
  model,
  setModel,
  models,
  density,
  setDensity,
}: {
  tab: Tab;
  model: string;
  setModel: (value: string) => void;
  models: readonly string[];
  density: string;
  setDensity: (value: "comfortable" | "compact") => void;
}) {
  return (
    <div className="assets-filters">
      <nav className="tabs assets-tabs" aria-label="Asset filters">
        {tabs.map((value) => (
          <a key={value} className="tab" href={"#/assets/" + value} aria-current={tab === value ? "page" : undefined}>
            {labels[value]}
          </a>
        ))}
      </nav>
      <ModelFilter model={model} setModel={setModel} models={models} />
      <div className="assets-density" role="group" aria-label="Grid density">
        {(["comfortable", "compact"] as const).map((value) => (
          <button
            key={value}
            className="btn"
            type="button"
            aria-pressed={density === value}
            onClick={() => setDensity(value)}
          >
            {value === "comfortable" ? "Comfortable" : "Compact"}
          </button>
        ))}
      </div>
    </div>
  );
}
