import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";

/**
 * What the empty prompt box says. A sound model uses the prompt differently from a picture model
 * (a script a voice reads, or a sound to describe), so with one selected the placeholder says which.
 */
export function useComposerPlaceholder(multimode: boolean, hasReferences: boolean): string {
  const { t } = useI18n();
  const audioUse = useAppStore((s) => (s.uiMode === "classic" && s.mediaSelection?.kind === "audio" ? s.mediaSelection.use ?? "speech" : null));
  if (audioUse) return t(audioUse === "sound" ? "prompt.placeholderSound" : "prompt.placeholderSpeech");
  if (multimode) return t(hasReferences ? "multimode.promptPlaceholderWithRefs" : "multimode.promptPlaceholder");
  return t(hasReferences ? "prompt.placeholderWithRefs" : "prompt.placeholder");
}
