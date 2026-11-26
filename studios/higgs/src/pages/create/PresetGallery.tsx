import { useState } from "react";
import { PRESETS, type Preset } from "../../data/presets.ts";
import { Icon } from "../../ui/Icon.tsx";

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
  return (
    <div className="tabs" role="tablist" aria-label="Preset category">
      {[null, ...categories].map((c) => (
        <button
          key={c ?? "all"}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === c}
          onClick={() => onChange(c)}
        >
          {c ?? "All"}
        </button>
      ))}
    </div>
  );
}

function PresetTile({ preset, selected, onPick }: { preset: Preset; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" className="preset-tile" aria-pressed={selected} onClick={onPick}>
      {preset.sampleKind === "video" ? (
        <video src={preset.sample} muted loop autoPlay playsInline aria-hidden />
      ) : (
        <img src={preset.sample} alt="" loading="lazy" />
      )}
      <span className="preset-tile-label">{preset.label}</span>
      <span className="preset-tile-sub">{preset.category}</span>
    </button>
  );
}

export function PresetGallery({ kind, selected, onPick, onClose }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const ofKind = PRESETS.filter((p) => p.kind === kind);
  const categories = [...new Set(ofKind.map((p) => p.category))];
  const needle = query.toLowerCase();
  const shown = ofKind.filter((p) => (!category || p.category === category) && p.label.toLowerCase().includes(needle));
  return (
    <section className="gallery" aria-label="Presets">
      <div className="gallery-head">
        <CategoryTabs categories={categories} value={category} onChange={setCategory} />
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search presets"
            aria-label="Search presets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {onClose ? (
          <button type="button" className="btn btn-ghost" aria-label="Close presets" onClick={onClose}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      <div className="gallery-grid">
        <button
          type="button"
          className="preset-tile preset-general"
          aria-pressed={selected === undefined}
          onClick={() => onPick(undefined)}
        >
          <img src="samples/landscape.jpg" alt="" loading="lazy" />
          <span className="preset-tile-label">General</span>
          <span className="preset-tile-sub">Your prompt, no preset</span>
        </button>
        {shown.map((preset) => (
          <PresetTile key={preset.id} preset={preset} selected={selected === preset.id} onPick={() => onPick(preset)} />
        ))}
      </div>
    </section>
  );
}
