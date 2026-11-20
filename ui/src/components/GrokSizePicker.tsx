import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "2:1", label: "2:1" },
  { value: "1:2", label: "1:2" },
  { value: "auto", label: "Auto" },
] as const;

const RESOLUTIONS = [
  { value: "1k", label: "1K" },
  { value: "1.5k", label: "1.5K" },
  { value: "2k", label: "2K" },
] as const;

export function GrokSizePicker() {
  const { t } = useI18n();
  const grokAspectRatio = useAppStore((s) => s.grokAspectRatio);
  const grokResolution = useAppStore((s) => s.grokResolution);
  const setGrokAspectRatio = useAppStore((s) => s.setGrokAspectRatio);
  const setGrokResolution = useAppStore((s) => s.setGrokResolution);

  return (
    <div className="option-group grok-size-picker">
      <div className="section-title">{t("size.grokAspectTitle")}</div>
      <div className="grok-size-picker__aspects">
        {ASPECT_RATIOS.map((ar) => (
          <button
            key={ar.value}
            type="button"
            className={`option-btn grok-size-picker__aspect${grokAspectRatio === ar.value ? " active" : ""}`}
            onClick={() => setGrokAspectRatio(ar.value)}
          >
            {ar.label}
          </button>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 8 }}>{t("size.grokResolutionTitle")}</div>
      <div className="grok-size-picker__resolutions">
        {RESOLUTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={`option-btn grok-size-picker__res${grokResolution === r.value ? " active" : ""}`}
            onClick={() => setGrokResolution(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
