import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { useStudio } from "../../studio/context.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { Tab } from "./AssetsPage.tsx";

const tabs: readonly Tab[] = ["all", "images", "videos", "audio", "saved"];

function ModelFilter({
  model,
  setModel,
  models,
}: {
  model: string;
  setModel: (value: string) => void;
  models: readonly string[];
}) {
  const t = useT(M);
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
        caption={t("filterModel")}
        accessibleLabel={t("filterModel")}
        value={model}
        onChange={setModel}
        options={[{ value: "", label: t("allModels") }, ...options]}
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
  const t = useT(M);
  return (
    <div className="assets-filters">
      <nav className="tabs assets-tabs" aria-label={t("filters")}>
        {tabs.map((value) => (
          <a key={value} className="tab" href={"#/assets/" + value} aria-current={tab === value ? "page" : undefined}>
            {t(value)}
          </a>
        ))}
      </nav>
      <ModelFilter model={model} setModel={setModel} models={models} />
      <div className="assets-density" role="group" aria-label={t("density")}>
        {(["comfortable", "compact"] as const).map((value) => (
          <button
            key={value}
            className="btn"
            type="button"
            aria-pressed={density === value}
            onClick={() => setDensity(value)}
          >
            {t(value)}
          </button>
        ))}
      </div>
    </div>
  );
}
