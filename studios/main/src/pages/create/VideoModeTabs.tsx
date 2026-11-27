import { messages, useT } from "../../i18n.ts";

const M = messages(
  { mode: "Video mode", create: "Create video", edit: "Edit video", speak: "Talking video" },
  { mode: "영상 모드", create: "영상 생성", edit: "영상 편집", speak: "말하는 영상" },
);

export type VideoMode = "create" | "edit" | "speak";

/** The three ways to make a video. "speak" appears only when the catalog has a model that can do it. */
export function VideoModeTabs({ mode, modes, onPick }: { mode: VideoMode; modes: readonly VideoMode[]; onPick: (mode: VideoMode) => void }) {
  const t = useT(M);
  return (
    <div className="panel-tabs" role="group" aria-label={t("mode")}>
      {modes.map((value) => (
        <button key={value} type="button" aria-pressed={mode === value} onClick={() => { if (value !== mode) onPick(value); }}>
          {t(value)}
        </button>
      ))}
    </div>
  );
}
