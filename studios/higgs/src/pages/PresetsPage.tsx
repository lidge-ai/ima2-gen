import { navigate } from "../router.ts";
import { PresetGallery } from "./create/PresetGallery.tsx";

export function PresetsPage({ tab }: { tab?: string }) {
  const kind = tab === "image" ? "image" : "video";
  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>Presets</h1>
        <div className="tabs" role="tablist" aria-label="Preset kind">
          <a role="tab" className="tab" aria-selected={kind === "video"} href="#/presets/video">
            Video
          </a>
          <a role="tab" className="tab" aria-selected={kind === "image"} href="#/presets/image">
            Image
          </a>
        </div>
      </div>
      <PresetGallery kind={kind} selected={undefined} onPick={(p) => navigate(kind, { preset: p?.id })} />
    </div>
  );
}
