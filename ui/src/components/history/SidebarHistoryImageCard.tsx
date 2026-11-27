import type { DragEvent } from "react";
import type { GenerateItem } from "../../types";
import { getGalleryItemKey } from "../../lib/galleryNavigation";
import { isVideoItem } from "../../lib/videoMedia";
import { isAudioItem } from "../../lib/audioMedia";
import { AudioThumbPlaceholder } from "../AudioThumbPlaceholder";
import { buildVideoDragPayload } from "../../lib/videoContinuity";
import { VideoThumbPlaceholder } from "../VideoThumbPlaceholder";

type SidebarHistoryImageCardProps = {
  item: GenerateItem;
  active: boolean;
  selectLabel: string;
  deleteLabel: string;
  setRef: (key: string, node: HTMLButtonElement | null) => void;
  onSelect: (item: GenerateItem) => void;
  onDelete: (item: GenerateItem) => void;
};

export function SidebarHistoryImageCard({
  item,
  active,
  selectLabel,
  deleteLabel,
  setRef,
  onSelect,
  onDelete,
}: SidebarHistoryImageCardProps) {
  const key = getGalleryItemKey(item);
  const isVideo = isVideoItem(item);
  const isAudio = isAudioItem(item);

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(
      "application/ima2-ref",
      JSON.stringify(isVideo ? buildVideoDragPayload(item) : { image: item.url || item.image, filename: item.filename }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="sidebar-history__item">
      <button
        ref={(node) => setRef(key, node)}
        type="button"
        className={`sidebar-history__thumb${active ? " active" : ""}${isVideo || isAudio ? " sidebar-history__thumb--video" : ""}`}
        onClick={() => onSelect(item)}
        aria-label={selectLabel}
        title={item.prompt ?? ""}
        draggable={!isAudio}
        onDragStart={onDragStart}
      >
        {isAudio ? <AudioThumbPlaceholder /> : isVideo ? (
          <>
            {item.thumb ? (
              <img src={item.thumb} alt="" loading="lazy" decoding="async" />
            ) : (
              <VideoThumbPlaceholder />
            )}
            <span className="sidebar-history__play-badge" aria-hidden="true">▶</span>
          </>
        ) : (
          <img
            src={item.thumb || item.url || item.image}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </button>
      <button
        type="button"
        className="sidebar-history__delete"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete(item);
        }}
        aria-label={deleteLabel}
        title={deleteLabel}
      >
        x
      </button>
    </div>
  );
}
