import { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { getAssetById } from "../../lib/api-assets";
import type { GenerateItem } from "../../types";
import { useAgentDialogFocus } from "../agent/useAgentDialogFocus";

type Props = {
  item: GenerateItem;
  onClose: () => void;
  /**
   * Keying, vectorize and sprite-curator actions open panels that only asset
   * workspaces mount. Surfaces without those panels (Node mode) hide them.
   */
  showAssetActions?: boolean;
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ZoomIcon({ zoomed }: { zoomed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.5 15.5 21 21M7.5 10.5h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      {!zoomed ? <path d="M10.5 7.5v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function AssetMediaLightbox({ item, onClose, showAssetActions = true }: Props) {
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  const inlineMetadata = (item as GenerateItem & { metadata?: Record<string, unknown> | null }).metadata ?? null;
  const [assetMetadata, setAssetMetadata] = useState<Record<string, unknown> | null>(inlineMetadata);
  const titleId = useId();
  const setKeyingTarget = useAppStore((s) => s.setKeyingTarget);
  const setVectorizeTarget = useAppStore((s) => s.setVectorizeTarget);
  const setCuratorTarget = useAppStore((s) => s.setCuratorTarget);
  const close = useCallback(() => onClose(), [onClose]);
  const panelRef = useAgentDialogFocus(true, close);
  const isVideo = item.mediaType === "video";
  // A transparent asset already carries alpha: there is no matte to key, and
  // keying it would only eat anti-aliased edges.
  const canKey = item.kind !== "edit" && Boolean(item.filename) && item.backgroundPreset !== "transparent";
  const metadata = inlineMetadata ?? assetMetadata;
  const spriteRunId = typeof metadata?.spriteRunId === "string" ? metadata.spriteRunId : null;
  const manifestPath = typeof metadata?.manifestPath === "string" ? metadata.manifestPath : null;
  const canCurate = Boolean(spriteRunId && manifestPath && item.filename);
  // Tracing needs a raster source, so an existing vector is excluded rather than
  // re-traced into itself.
  const canVectorize = !isVideo && Boolean(item.filename) && !/\.svg$/i.test(item.filename ?? "");
  const fallback = t(isVideo ? "assetGen.videoFallback" : "assetGen.imageFallback");
  const prompt = item.prompt?.trim() || fallback;
  const openKeying = useCallback(() => {
    setKeyingTarget(item);
    onClose();
  }, [item, onClose, setKeyingTarget]);
  const openVectorize = useCallback(() => {
    setVectorizeTarget(item);
    onClose();
  }, [item, onClose, setVectorizeTarget]);
  const openCurator = useCallback(() => {
    if (!spriteRunId || !manifestPath || !item.filename) return;
    setCuratorTarget({ runId: spriteRunId, atlasFile: item.filename, manifestFile: manifestPath });
    onClose();
  }, [item.filename, manifestPath, onClose, setCuratorTarget, spriteRunId]);

  useEffect(() => {
    setAssetMetadata(inlineMetadata);
    const assetId = item.requestId?.startsWith("asset:") ? item.requestId.slice(6) : null;
    if (!assetId || inlineMetadata) return;
    let active = true;
    getAssetById(assetId).then(({ asset }) => {
      if (active) setAssetMetadata(asset.metadata);
    }).catch(() => {
      if (active) setAssetMetadata(null);
    });
    return () => { active = false; };
  }, [inlineMetadata, item.requestId]);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, []);

  return (
    <div className="assetgen-lightbox" role="presentation">
      <button
        type="button"
        className="assetgen-lightbox__backdrop"
        aria-label={t("assetGen.closePreview")}
        onClick={close}
      />
      <section
        ref={panelRef}
        className="assetgen-lightbox__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="assetgen-lightbox__header">
          <h2 id={titleId}>{t("assetGen.previewDialogTitle", { prompt })}</h2>
          <button
            type="button"
            className="assetgen-lightbox__control"
            aria-label={t("assetGen.closePreview")}
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>
        <div
          className={[
            "assetgen-lightbox__stage",
            item.kind === "edit" ? "is-keyed" : "",
            zoomed ? "is-zoomed" : "",
          ].filter(Boolean).join(" ")}
          tabIndex={zoomed ? 0 : undefined}
        >
          {isVideo ? (
            <video
              src={item.url || item.image}
              poster={item.thumb || undefined}
              controls
              autoPlay
              muted
              playsInline
              preload="metadata"
              aria-label={prompt}
            />
          ) : (
            <img src={item.url || item.image} alt={prompt} />
          )}
        </div>
        {!isVideo || (showAssetActions && (canKey || canCurate)) ? (
          <footer className="assetgen-lightbox__footer">
            {showAssetActions && canCurate ? (
              <button type="button" className="assetgen-lightbox__zoom assetgen-lightbox__curate" onClick={openCurator}>
                {t("spriteCurator.open")}
              </button>
            ) : null}
            {showAssetActions && canKey ? (
              <button
                type="button"
                className="assetgen-lightbox__zoom assetgen-lightbox__keybtn"
                onClick={openKeying}
              >
                {t("keying.open")}
              </button>
            ) : null}
            {showAssetActions && canVectorize ? (
              <button
                type="button"
                className="assetgen-lightbox__zoom assetgen-lightbox__vectorbtn"
                onClick={openVectorize}
              >
                {t("vectorize.open")}
              </button>
            ) : null}
            {!isVideo ? (
              <button
                type="button"
                className="assetgen-lightbox__zoom"
                aria-pressed={zoomed}
                aria-label={t(zoomed ? "assetGen.zoomOut" : "assetGen.zoomIn")}
                onClick={() => setZoomed((current) => !current)}
              >
                <ZoomIcon zoomed={zoomed} />
                <span>{t(zoomed ? "assetGen.zoomOut" : "assetGen.zoomIn")}</span>
              </button>
            ) : null}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
