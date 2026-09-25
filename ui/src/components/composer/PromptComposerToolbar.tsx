import { useState } from "react";
import { continueFromItem } from "../../lib/continueFromItem";
import { DEFAULT_IMAGE_MODEL } from "../../lib/imageModels";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { SavePromptPopover } from "../SavePromptPopover";
import { WebSearchToggle } from "../WebSearchToggle";

type PromptComposerToolbarProps = {
  canAddMore: boolean;
  onAttach: () => void;
};

export function PromptComposerToolbar({ canAddMore, onAttach }: PromptComposerToolbarProps) {
  const { t } = useI18n();
  const prompt = useAppStore((s) => s.prompt);
  const currentImage = useAppStore((s) => s.currentImage);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const setImageModel = useAppStore((s) => s.setImageModel);
  const promptMode = useAppStore((s) => s.promptMode);
  const setPromptMode = useAppStore((s) => s.setPromptMode);
  const storyboardActive = useAppStore((s) => s.storyboardActive);
  const toggleStoryboard = useAppStore((s) => s.toggleStoryboard);
  const [saveOpen, setSaveOpen] = useState(false);
  const isDirectMode = promptMode === "direct";

  return (
    <>
      <div className="composer__hint-row">
        <span className="composer__hint">{t("prompt.hint")}</span>
      </div>
      <div className="composer__toolbar">
        <button
          type="button"
          className="composer__tool"
          onClick={onAttach}
          disabled={!canAddMore}
          title={t("prompt.attachTitle")}
          aria-label={t("prompt.attachTitle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => currentImage && void continueFromItem(currentImage).catch(() => {})}
          disabled={!currentImage || !canAddMore}
          title={t("prompt.continueTitle")}
        >
          {t("prompt.continue")}
        </button>
        <button
          type="button"
          className={`composer__tool${videoModelSelected ? " composer__tool--on" : ""}`}
          onClick={() => {
            if (videoModelSelected) {
              setImageModel(DEFAULT_IMAGE_MODEL);
            } else {
              selectVideoModel("grok-imagine-video-1.5");
            }
          }}
          title={t("prompt.videoToggleTitle")}
          aria-label={t("prompt.videoToggleTitle")}
          aria-pressed={!!videoModelSelected}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
        <button
          type="button"
          className={`composer__tool${isDirectMode ? " composer__tool--on" : ""}`}
          onClick={() => setPromptMode(isDirectMode ? "auto" : "direct")}
          title={t("prompt.directModeTitle")}
          aria-label={t("prompt.directModeTitle")}
          aria-pressed={isDirectMode}
        >
          <span aria-hidden="true" style={{ fontWeight: 700, fontSize: 11 }}>1:1</span>
        </button>
        <WebSearchToggle variant="compact" />
        <div className="composer__tool-wrap">
          <button
            type="button"
            className="composer__tool composer__tool--full"
            onClick={() => setSaveOpen((v) => !v)}
            disabled={!prompt.trim()}
            title={t("promptLibrary.saveTitle")}
            aria-label={t("promptLibrary.saveTitle")}
          >
            {t("prompt.savePrompt")}
          </button>
          {saveOpen && (
            <SavePromptPopover
              text={prompt}
              mode={promptMode}
              onClose={() => setSaveOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="composer__storyboard-row">
        <button
          type="button"
          className={`composer__tool composer__tool--storyboard${storyboardActive ? " composer__tool--on" : ""}`}
          onClick={toggleStoryboard}
          title={t("prompt.storyboardTitle")}
          aria-pressed={storyboardActive}
        >
          {t("prompt.storyboard")}
        </button>
      </div>
    </>
  );
}
