import { useI18n } from "../i18n";
import { loadMediaCatalog, useMediaCatalog } from "../lib/mediaCatalogStore";
import type { MediaSelection } from "../lib/mediaSelection";
import { useAppStore } from "../store/useAppStore";
import { MediaLogo } from "./media/MediaLogo";
import { MediaModelSettings } from "./media/MediaModelSettings";

function taskLine(selection: MediaSelection, t: (key: string) => string): string {
  const maker = selection.vendor ?? selection.model.split("/")[0] ?? "";
  return `${maker} · ${t(`mediaPicker.kind.${selection.kind}`)}`;
}

/**
 * The model entry in the generation settings. Closed, it says what media models are and opens the
 * model window; with a model selected it shows that model and its settings.
 *
 * Nothing here asks the server for media data until the window is opened or a media model is already
 * selected, so the default classic flow keeps exactly its old network traffic.
 */
export function MediaModelPicker({ kind }: { kind?: "image" | "video" }) {
  const { t } = useI18n();
  const selection = useAppStore((s) => s.mediaSelection);
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const open = useAppStore((s) => s.openMediaPicker);
  const uiMode = useAppStore((s) => s.uiMode);
  const shown = selection && (!kind || selection.kind === kind) ? selection : null;
  const catalog = useMediaCatalog(shown !== null);
  if (!shown) {
    return (
      <div className="option-group media-card">
        <div className="section-title">{t("mediaPicker.model")}</div>
        <p className="media-card__idle">{t("mediaPicker.cardIdle")}</p>
        <button type="button" className="option-btn media-picker__open" onClick={() => open(kind)}>{t("mediaPicker.open")}</button>
      </div>
    );
  }
  const model = catalog.models.find((item) => item.id === shown.model && item.kind === shown.kind);
  return (
    <div className="option-group media-card">
      <div className="section-title">{t("mediaPicker.model")}</div>
      <div className="media-card__current">
        <MediaLogo logo={model?.logo} label={shown.vendor ?? shown.model} />
        <span className="media-card__name"><strong>{shown.label ?? shown.model}</strong><small>{taskLine(shown, t)}</small></span>
      </div>
      <div className="media-card__actions">
        <button type="button" className="option-btn media-picker__open" onClick={() => open(kind)}>{t("mediaPicker.change")}</button>
        <button type="button" className="option-btn media-picker__open" onClick={() => setSelection(null)}>{t("mediaPicker.useBuiltin")}</button>
      </div>
      {uiMode === "node" ? <p className="media-card__idle" role="note">{t("mediaPicker.nodeNote")}</p> : null}
      {catalog.status === "loading" || catalog.status === "idle" ? <p className="media-card__idle" role="status">{t("mediaPicker.loading")}</p> : null}
      {catalog.status === "error" ? (
        <div className="media-inputs media-inputs--problem" role="alert">{t("mediaPicker.loadError")}{" "}
          <button type="button" className="media-link" onClick={() => void loadMediaCatalog(true)}>{t("mediaPicker.retry")}</button></div>
      ) : null}
      {catalog.status === "ready" && !model ? (
        <p className="media-inputs media-inputs--problem" role="alert">{t("mediaPicker.missingModel")}</p>
      ) : null}
      {model ? <MediaModelSettings model={model} selection={shown} /> : null}
    </div>
  );
}
