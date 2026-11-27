import { messages, useT } from "../i18n.ts";
import { navigate } from "../router.ts";
import { PresetGallery } from "./create/PresetGallery.tsx";

const M = messages({ presets: "Presets", kind: "Preset kind", video: "Video", image: "Image" },
  { presets: "프리셋", kind: "프리셋 종류", video: "영상", image: "이미지" });

export function PresetsPage({ tab }: { tab?: string }) {
  const t = useT(M);
  const kind = tab === "image" ? "image" : "video";
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
        </nav>
      </div>
      <PresetGallery kind={kind} selected={undefined} onPick={(p) => navigate(kind, { preset: p?.id })} />
    </div>
  );
}
