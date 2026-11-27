import { useI18n } from "../../i18n";
import type { GenerateItem } from "../../types";

/**
 * A sound result on the stage: what it is, what was asked for, and the browser's own player.
 * Pointer and wheel events stop here so the stage's zoom and pan do not take the player's scrubber.
 */
export function MediaAudioResult({ item, src, model }: { item: GenerateItem; src: string; model: string | null }) {
  const { t } = useI18n();
  const prompt = (item.userPrompt ?? item.prompt ?? "").trim();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div className="result-audio" onPointerDown={stop} onDoubleClick={stop} onWheel={stop} onMouseDown={stop}>
      <div className="result-audio__head">
        <span className="result-audio__mark" aria-hidden="true">♪</span>
        <span className="result-audio__title">{model ?? t("canvas.audioResult")}</span>
      </div>
      {prompt ? <p className="result-audio__prompt">{prompt}</p> : null}
      <audio className="result-audio__player" key={item.filename ?? src} src={src} controls preload="metadata" aria-label={t("canvas.audioResult")} />
    </div>
  );
}
