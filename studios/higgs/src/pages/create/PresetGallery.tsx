import { messages, useT } from "../../i18n.ts";
import { useState } from "react";
import { PRESETS, posterOf, type Preset } from "../../data/presets.ts";
import { presetText } from "./defaults.ts";
import { Icon } from "../../ui/Icon.tsx";

const M = messages(
  {
    "category": "Preset category",
    "all": "All",
    "presets": "Presets",
    "search": "Search presets",
    "close": "Close presets",
    "general": "General",
    "own": "Your prompt, no preset",
    "empty": "No presets match. Change the search or category.",
  },
  {
    "category": "프리셋 카테고리",
    "all": "전체",
    "presets": "프리셋",
    "search": "프리셋 검색",
    "close": "프리셋 닫기",
    "general": "일반",
    "own": "프리셋 없이 직접 작성",
    "empty": "일치하는 프리셋이 없어요. 검색어나 카테고리를 바꿔 보세요.",
  },
);

interface Props {
  kind: "image" | "video";
  selected: string | undefined;
  onPick: (preset: Preset | undefined) => void;
  onClose?: () => void;
}

function CategoryTabs({
  categories,
  value,
  onChange,
}: {
  categories: readonly string[];
  value: string | null;
  onChange: (c: string | null) => void;
}) {
  const t = useT(M);
  return (
    <div className="tabs" role="group" aria-label={t("category")}>
      {[null, ...categories].map((c) => (
        <button
          key={c ?? "all"}
          type="button"
          className="tab"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
        >
          {c ? presetText(c, c) : t("all")}
        </button>
      ))}
    </div>
  );
}

function PresetTile({ preset, selected, onPick }: { preset: Preset; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" className="preset-tile" aria-pressed={selected} onClick={onPick}>
      {preset.sampleKind === "video" ? (
        <video src={preset.sample} poster={posterOf(preset.sample)} preload="metadata" muted loop autoPlay playsInline aria-hidden />
      ) : (
        <img src={preset.sample} alt="" loading="lazy" />
      )}
      <span className="preset-tile-label">{presetText(preset.id, preset.label)}</span>
      <span className="preset-tile-sub">{presetText(preset.category, preset.category)}</span>
    </button>
  );
}

export function PresetGallery({ kind, selected, onPick, onClose }: Props) {
  const t = useT(M);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const ofKind = PRESETS.filter((p) => p.kind === kind);
  const categories = [...new Set(ofKind.map((p) => p.category))];
  const needle = query.toLowerCase();
  const shown = ofKind.filter((p) => (!category || p.category === category) && (p.label.toLowerCase().includes(needle) || presetText(p.id, p.label).toLowerCase().includes(needle)));
  return (
    <section className="gallery" aria-label={t("presets")}>
      <div className="gallery-head">
        <CategoryTabs categories={categories} value={category} onChange={setCategory} />
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {onClose ? (
          <button type="button" className="btn btn-ghost" aria-label={t("close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? <p className="empty-line" role="status">{t("empty")}</p> : null}
      <div className="gallery-grid">
        <button
          type="button"
          className="preset-tile preset-general"
          aria-pressed={selected === undefined}
          onClick={() => onPick(undefined)}
        >
          <img src="samples/landscape.jpg" alt="" loading="lazy" />
          <span className="preset-tile-label">{t("general")}</span>
          <span className="preset-tile-sub">{t("own")}</span>
        </button>
        {shown.map((preset) => (
          <PresetTile key={preset.id} preset={preset} selected={selected === preset.id} onPick={() => onPick(preset)} />
        ))}
      </div>
    </section>
  );
}
