import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import {
  buildVideoSoundIntentPrompt,
  isVideoSoundIntentPrompt,
  VIDEO_SOUND_INTENT_PRESETS,
} from "../lib/videoSoundIntent";

export function SoundIntentPicker() {
  const { t } = useI18n();
  const insertedPrompts = useAppStore((s) => s.insertedPrompts);
  const insertPromptToComposer = useAppStore((s) => s.insertPromptToComposer);
  const removeInsertedPromptFromComposer = useAppStore((s) => s.removeInsertedPromptFromComposer);
  const activeSoundPrompt = insertedPrompts.find((prompt) => isVideoSoundIntentPrompt(prompt.id));

  const clearSoundIntent = () => {
    for (const prompt of insertedPrompts) {
      if (isVideoSoundIntentPrompt(prompt.id)) removeInsertedPromptFromComposer(prompt.id);
    }
  };

  const selectSoundIntent = (preset: (typeof VIDEO_SOUND_INTENT_PRESETS)[number]) => {
    const next = buildVideoSoundIntentPrompt(preset);
    clearSoundIntent();
    if (activeSoundPrompt?.id !== next.id) insertPromptToComposer(next);
  };

  return (
    <div className="option-group">
      <div className="section-title">{t("video.soundIntentTitle")}</div>
      <div className="composer__hint">{t("video.soundIntentHelp")}</div>
      <div className="option-row" role="group" aria-label={t("video.soundIntentTitle")}>
        {VIDEO_SOUND_INTENT_PRESETS.map((preset) => {
          const prompt = buildVideoSoundIntentPrompt(preset);
          const active = activeSoundPrompt?.id === prompt.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`option-btn${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => selectSoundIntent(preset)}
            >
              {t(preset.labelKey)}
            </button>
          );
        })}
        {activeSoundPrompt ? (
          <button
            type="button"
            className="option-btn"
            aria-label={t("video.soundIntent.clear")}
            onClick={clearSoundIntent}
          >
            {t("video.soundIntent.clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
