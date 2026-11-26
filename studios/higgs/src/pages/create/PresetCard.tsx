import type { Preset } from "../../data/presets.ts";
import { Icon } from "../../ui/Icon.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";

interface Props {
  preset: Preset | undefined;
  modelLabel: string | undefined;
  vendor?: string | undefined;
  onChange: () => void;
}

export function PresetCard({ preset, modelLabel, vendor, onChange }: Props) {
  return (
    <div className="preset-card">
      {preset ? (
        preset.sampleKind === "video"
          ? <video className="preset-card-media" src={preset.sample} muted loop autoPlay playsInline aria-hidden />
          : <img className="preset-card-media" src={preset.sample} alt="" />
      ) : <img className="preset-card-media" src="samples/landscape.jpg" alt="" />}
      <div className="preset-card-text">
        <span className="preset-card-title">{preset?.label ?? "General"}</span>
        <span className="preset-card-sub">{vendor ? <VendorLogo id={vendor} size={14} /> : null}{modelLabel ?? "Any model"}</span>
      </div>
      <button type="button" className="preset-card-change" onClick={onChange}>
        <Icon name="presets" size={14} /> {preset ? "Change" : "Presets"}
      </button>
    </div>
  );
}
