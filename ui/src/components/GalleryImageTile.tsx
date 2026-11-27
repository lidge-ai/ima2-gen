import type { DragEvent, MouseEvent } from "react";
import { useCallback, useMemo } from "react";
import type { GenerateItem } from "../types";
import { isVideoItem } from "../lib/videoMedia";
import { isAudioItem } from "../lib/audioMedia";
import { AudioThumbPlaceholder } from "./AudioThumbPlaceholder";
import { buildVideoDragPayload } from "../lib/videoContinuity";
import { VideoThumbPlaceholder } from "./VideoThumbPlaceholder";
import { CHAINING_ACTIONS, executeChaining, type ChainingActionId } from "../lib/resultChaining";
import { useAppStore } from "../store/useAppStore";
import { FavoriteStarButton } from "./controls";
import { ProvenanceChip } from "./ProvenanceChip";
import { buildProvenanceView } from "../lib/provenance";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type GalleryImageTileProps = {
  item: GenerateItem;
  active: boolean;
  itemRef: (node: HTMLElement | null) => void;
  onSelect: (item: GenerateItem) => void;
  onDelete: (item: GenerateItem, event: MouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite?: (item: GenerateItem) => void | Promise<void>;
  favoriteBusy?: boolean;
  t: TranslateFn;
};

/* Chaining overlay icons (14px stroke) */
function ChainIcon({ id }: { id: ChainingActionId }) {
  switch (id) {
    case "animate":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "edit":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case "useAsRef":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "rebake":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      );
    case "saveToAssets":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      );
  }
}

export function GalleryImageTile({ item, active, itemRef, onSelect, onDelete, onToggleFavorite, favoriteBusy = false, t }: GalleryImageTileProps) {
  const availableActions = useMemo(
    () => CHAINING_ACTIONS.filter((a) => a.available(item)),
    [item],
  );

  const handleChain = useCallback(async (actionId: ChainingActionId, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await executeChaining(
      actionId,
      item,
      () => {
        const s = useAppStore.getState();
        return {
          animateImage: s.animateImage,
          openCanvas: s.openCanvas,
          selectHistory: s.selectHistory,
          addReferences: s.addReferences,
          showToast: s.showToast,
          saveToAssets: s.saveToAssets,
        };
      },
      t,
    );
  }, [item, t]);

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("application/ima2-ref", JSON.stringify(isVideoItem(item) ? buildVideoDragPayload(item) : { image: item.url || item.image, filename: item.filename }));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      ref={itemRef}
      className={`gallery__tile-wrap${active ? " gallery__tile-wrap--active" : ""}${item.isFavorite ? " gallery__tile-wrap--favorite" : ""}`}
    >
      <button
        type="button"
        className={`gallery__tile${active ? " gallery__tile--active" : ""}`}
        onClick={() => onSelect(item)}
        title={item.prompt ?? ""}
        draggable={!isAudioItem(item)}
        onDragStart={onDragStart}
      >
        {isAudioItem(item) ? (
          <div className="gallery__tile-video-wrap"><AudioThumbPlaceholder className="gallery__tile-video" /></div>
        ) : isVideoItem(item) ? (
          <div className="gallery__tile-video-wrap">
            {item.thumb ? (
              <img
                src={item.thumb}
                alt={item.prompt ?? t("gallery.imageAltFallback")}
                loading="lazy"
                decoding="async"
                className="gallery__tile-video"
              />
            ) : (
              <VideoThumbPlaceholder className="gallery__tile-video" />
            )}
            <span className="gallery__play-badge" aria-hidden="true">▶</span>
          </div>
        ) : (
          <img
            src={item.thumb || item.image}
            alt={item.prompt ?? t("gallery.imageAltFallback")}
            loading="lazy"
            decoding="async"
          />
        )}
        {item.prompt && (
          <div className="gallery__caption">
            <span className="gallery__caption-text">{item.prompt}</span>
          </div>
        )}
      </button>
      {/* Chaining overlay — always in DOM for keyboard access; CSS controls visibility */}
      {availableActions.length > 0 ? (
        <div className="gallery__chain-overlay" role="group" aria-label={t("chain.ariaLabel")}>
          {availableActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="gallery__chain-btn"
              onClick={(e) => void handleChain(action.id, e)}
              title={t(action.labelKey)}
              aria-label={t(action.labelKey)}
            >
              <ChainIcon id={action.id} />
            </button>
          ))}
        </div>
      ) : null}
      {item.filename && onToggleFavorite && (
        <FavoriteStarButton
          variant="gallery"
          active={Boolean(item.isFavorite)}
          busy={favoriteBusy}
          label={item.isFavorite ? t("gallery.unfavoriteAria") : t("gallery.favoriteAria")}
          onToggle={() => onToggleFavorite(item)}
        />
      )}
      {item.filename && (
        <button
          type="button"
          className="gallery__delete"
          onClick={(event) => onDelete(item, event)}
          title={t("gallery.deleteTitle")}
          aria-label={t("gallery.deleteAria")}
        >
          ×
        </button>
      )}
      <ProvenanceChip view={buildProvenanceView(item)} />
    </div>
  );
}
