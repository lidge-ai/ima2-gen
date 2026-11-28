import { messages, useT } from "../i18n.ts";
import { navigate } from "../router.ts";
import { PresetGallery } from "./create/PresetGallery.tsx";
import { CameraMoves } from "./CameraMoves.tsx";

const M = messages({ presets: "Presets", kind: "Preset kind", video: "Video", image: "Image", moves: "Camera moves" },
  { presets: "프리셋", kind: "프리셋 종류", video: "영상", image: "이미지", moves: "카메라 무브" });

export function PresetsPage({ tab }: { tab?: string }) {
  const t = useT(M);
  const kind = tab === "image" ? "image" : tab === "moves" ? "moves" : "video";
  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>{t("presets")}</h1>
        <nav className="tabs" aria-label={t("kind")}>
          <a className="tab" aria-current={kind === "video" ? "page" : undefined} href="#/presets/video">
            {t("video")}
          </a>
          <a className="tab" aria-current={kind === "image" ? "page" : undefined} href="#/presets/image">
            {t("image")}
          </a>
          <a className="tab" aria-current={kind === "moves" ? "page" : undefined} href="#/presets/moves">
            {t("moves")}
          </a>
        </nav>
      </div>
      {kind === "moves" ? <CameraMoves /> : <PresetGallery kind={kind} selected={undefined} onPick={(p) => navigate(kind, { preset: p?.id })} />}
    </div>
  );
}
