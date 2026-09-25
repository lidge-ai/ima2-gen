import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import type { ImageModel } from "../types";
import { GROK_IMAGE_MODEL_OPTIONS } from "../lib/imageModels";
import { Select } from "./controls/Select";

export function GrokModelPicker() {
  const { t } = useI18n();
  const imageModel = useAppStore((s) => s.imageModel);
  const setImageModel = useAppStore((s) => s.setImageModel);

  return (
    <div className="option-group">
      <div className="section-title">{t("quality.grokModelTitle")}</div>
      <Select<ImageModel>
        ariaLabel={t("quality.grokModelTitle")}
        items={GROK_IMAGE_MODEL_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.fullLabelKey),
          sub: option.shortLabel,
        }))}
        value={imageModel}
        onChange={setImageModel}
        portal
      />
    </div>
  );
}
