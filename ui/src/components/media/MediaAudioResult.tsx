import { useI18n } from "../../i18n";
import type { GenerateItem } from "../../types";

/**
 * A sound result on the stage: the model that made it and the browser's own player. The prompt is
 * already shown under the result, as for pictures. Pointer and wheel events stop here so the stage's
 * zoom and pan do not take the player's scrubber.
 */
export function MediaAudioResult({ item, src, model }: { item: GenerateItem; src: string; model: string | undefined }) {
  const { t } = useI18n();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div className="result-audio" onPointerDown={stop} onDoubleClick={stop} onWheel={stop} onMouseDown={stop}>
      <div className="result-audio__head">
        <span className="result-audio__mark" aria-hidden="true">♪</span>
        <span className="result-audio__title">{model ?? t("canvas.audioResult")}</span>
      </div>
      <audio className="result-audio__player" key={item.filename ?? src} src={src} controls preload="metadata" aria-label={t("canvas.audioResult")} />
    </div>
  );
}
