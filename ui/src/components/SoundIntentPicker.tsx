import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import {
  buildVideoSoundIntentPrompt,
  isVideoSoundIntentPrompt,
  VIDEO_SOUND_INTENT_PRESETS,
  type VideoSoundIntentPreset,
} from "../lib/videoSoundIntent";

function useSoundIntentSelection() {
  const insertedPrompts = useAppStore((s) => s.insertedPrompts);
  const insert = useAppStore((s) => s.insertPromptToComposer);
  const remove = useAppStore((s) => s.removeInsertedPromptFromComposer);
  const activeId = insertedPrompts.find((prompt) => isVideoSoundIntentPrompt(prompt.id))?.id;
  const clear = () => {
    for (const prompt of insertedPrompts) {
      if (isVideoSoundIntentPrompt(prompt.id)) remove(prompt.id);
    }
  };
  const select = (preset: VideoSoundIntentPreset, name: string) => {
    const next = buildVideoSoundIntentPrompt(preset, name);
    clear();
    if (activeId !== next.id) insert(next);
  };
  return { activeId, clear, select };
}

function SoundIntentButton({ preset, selection }: {
  preset: VideoSoundIntentPreset;
  selection: ReturnType<typeof useSoundIntentSelection>;
}) {
  const { t } = useI18n();
  const label = t(preset.labelKey);
  const active = selection.activeId === buildVideoSoundIntentPrompt(preset).id;
  return (
    <button type="button" className={`option-btn${active ? " active" : ""}`}
      aria-pressed={active} onClick={() => selection.select(preset, label)}>
      {label}
    </button>
  );
}

export function SoundIntentPicker() {
  const { t } = useI18n();
  const selection = useSoundIntentSelection();
  const uiMode = useAppStore((s) => s.uiMode);
  // Node generation reads its own prompt, not these global composer chips.
  if (uiMode === "node") return null;
  return (
    <div className="option-group sound-intent-picker">
      <div className="section-title">{t("video.soundIntentTitle")}</div>
      <div className="composer__hint">{t("video.soundIntentHelp")}</div>
      <div className="option-row" role="group" aria-label={t("video.soundIntentTitle")}>
        {VIDEO_SOUND_INTENT_PRESETS.map((preset) => (
          <SoundIntentButton key={preset.id} preset={preset} selection={selection} />
        ))}
        {selection.activeId ? (
          <button type="button" className="option-btn" onClick={selection.clear}>
            {t("video.soundIntent.clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
