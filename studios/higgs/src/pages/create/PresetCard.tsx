import { messages, useT } from "../../i18n.ts";
import { presetText } from "./defaults.ts";
import type { Preset } from "../../data/presets.ts";
import { Icon } from "../../ui/Icon.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";

const M = messages(
  {
    "general": "General",
    "any": "Any model",
    "change": "Change",
    "presets": "Presets",
  },
  {
    "general": "일반",
    "any": "모든 모델",
    "change": "변경",
    "presets": "프리셋",
  },
);

interface Props {
  preset: Preset | undefined;
  modelLabel: string | undefined;
  vendor?: string | undefined;
  onChange: () => void;
}

export function PresetCard({ preset, modelLabel, vendor, onChange }: Props) {
  const t = useT(M);
  return (
    <div className="preset-feature">
      {preset ? (
        preset.sampleKind === "video" ? (
          <video className="preset-feature-media" src={preset.sample} muted loop autoPlay playsInline aria-hidden />
        ) : (
          <img className="preset-feature-media" src={preset.sample} alt="" />
        )
      ) : (
        <img className="preset-feature-media" src="samples/landscape.jpg" alt="" />
      )}
      <div className="preset-feature-text">
        <span className="preset-feature-title">{preset ? presetText(preset.id, preset.label) : t("general")}</span>
        <span className="preset-feature-sub">
          {vendor ? <VendorLogo id={vendor} size={14} /> : null}
          {modelLabel ?? t("any")}
        </span>
      </div>
      <button type="button" className="preset-feature-change" onClick={onChange}>
        <Icon name="presets" size={14} /> {t(preset ? "change" : "presets")}
      </button>
    </div>
  );
}
