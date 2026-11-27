import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { handleHorizontalWheel } from "../lib/horizontalWheel";
import { isVideoItem, isVideoUrl } from "../lib/videoMedia";
import { isAudioItem } from "../lib/audioMedia";
import { AudioThumbPlaceholder } from "./AudioThumbPlaceholder";
import { buildVideoDragPayload } from "../lib/videoContinuity";
import {
  getGalleryItemKey,
  isGalleryVisibleItem,
  uniqueGalleryItems,
} from "../lib/galleryNavigation";
import { VideoThumbPlaceholder } from "./VideoThumbPlaceholder";

function SkeletonThumb({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div
      key={id}
      className="history-thumb history-thumb--skeleton"
      aria-label={t("common.generating")}
    />
  );
}

function CollectionSkeleton({ id, count }: { id: string; count: number }) {
  const { t } = useI18n();
  const slots = Math.min(count, 4);
  return (
    <div
      key={`coll-${id}`}
      className="history-thumb history-thumb--collection-skeleton"
      aria-label={t("history.generatingCollection", { count })}
    >
      {Array.from({ length: slots }, (_, i) => (
        <div key={i} className="collection-mini collection-mini--skeleton" />
      ))}
    </div>
  );
}

function CollectionThumb({
  sequenceId,
  images,
}: {
  sequenceId: string;
  images: Array<{ url?: string; image: string; thumb?: string }>;
}) {
  const showHistorySequence = useAppStore((s) => s.showHistorySequence);
  const previewId = useAppStore((s) => s.multimodePreviewFlightId);
  const active = previewId === `history:${sequenceId}`;
  const slots = images.slice(0, 4);
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`history-thumb history-thumb--collection${active ? " active" : ""}`}
      onClick={() => showHistorySequence(sequenceId)}
      aria-label={t("common.imageCollection", { n: images.length })}
    >
      {slots.map((img, i) => {
        const isVid = !img.thumb && (isVideoUrl(img.url) || isVideoUrl(img.image));
        return isVid ? (
          <VideoThumbPlaceholder key={i} className="collection-mini" />
        ) : (
          <img
            key={i}
            className="collection-mini"
            src={img.thumb || img.url || img.image}
            alt=""
            loading="lazy"
            decoding="async"
          />
        );
      })}
    </button>
  );
}

function useLazyHistoryThumbs(root: HTMLDivElement | null) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entered = entries.filter((entry) => entry.isIntersecting);
      if (entered.length === 0) return;
      setVisibleKeys((current) => {
        const next = new Set(current);
        for (const entry of entered) {
          const key = (entry.target as HTMLElement).dataset.historyLazyKey;
          if (key) next.add(key);
        }
        return next;
      });
    }, { root, rootMargin: "0px 200% 0px 200%" });
    observerRef.current = observer;
    for (const node of nodesRef.current.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [root]);

  const register = useCallback((key: string, node: HTMLElement | null) => {
    const previous = nodesRef.current.get(key);
    if (previous && previous !== node) observerRef.current?.unobserve(previous);
    if (node) {
      nodesRef.current.set(key, node);
      observerRef.current?.observe(node);
    } else {
      nodesRef.current.delete(key);
    }
  }, []);

  return { visibleKeys, register, supported: typeof IntersectionObserver !== "undefined" };
}

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const currentImage = useAppStore((s) => s.currentImage);
  const historyStripLayout = useAppStore((s) => s.historyStripLayout);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openGallery = useAppStore((s) => s.openGallery);
  const inFlight = useAppStore((s) => s.inFlight);
  const multimodeSequences = useAppStore((s) => s.multimodeSequences);
  const thumbRefs = useRef<Record<string, HTMLElement | null>>({});
  const [stripElement, setStripElement] = useState<HTMLDivElement | null>(null);
  const lazyThumbs = useLazyHistoryThumbs(stripElement);
  const { t } = useI18n();
  const activeKey = currentImage ? getGalleryItemKey(currentImage) : null;
  const visibleHistory = useMemo(() => {
    return uniqueGalleryItems(history.filter(isGalleryVisibleItem));
  }, [history]);

  const skeletonCards = useMemo(() => {
    const cards: Array<{ type: "skeleton" | "collection-skeleton"; id: string; count: number }> = [];
    for (const flight of inFlight) {
      const seq = multimodeSequences[flight.id];
      if (flight.kind === "multimode" && seq) {
        cards.push({ type: "collection-skeleton", id: flight.id, count: seq.requested });
        for (let i = 0; i < seq.requested; i++) {
          if (!seq.images[i]) {
            cards.push({ type: "skeleton", id: `${flight.id}_${i}`, count: 1 });
          }
        }
      } else {
        cards.push({ type: "skeleton", id: flight.id, count: 1 });
      }
    }
    return cards;
  }, [inFlight, multimodeSequences]);

  const { completedSequences, sequenceFirstKeys } = useMemo(() => {
    const seqMap = new Map<string, typeof visibleHistory>();
    const firstKeys = new Set<string>();
    for (const item of visibleHistory) {
      if (item.sequenceId && (item.sequenceTotalRequested ?? 0) > 1) {
        if (!seqMap.has(item.sequenceId)) {
          firstKeys.add(getGalleryItemKey(item));
        }
        const arr = seqMap.get(item.sequenceId) || [];
        arr.push(item);
        seqMap.set(item.sequenceId, arr);
      }
    }
    return { completedSequences: seqMap, sequenceFirstKeys: firstKeys };
  }, [visibleHistory]);

  useEffect(() => {
    if (!activeKey) return;
    thumbRefs.current[activeKey]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, visibleHistory]);

  const renderLazyThumb = (key: string, content: ReactNode) => {
    const shouldRender = lazyThumbs.supported ? lazyThumbs.visibleKeys.has(key) : true;
    return (
      <div
        key={key}
        ref={(node) => {
          thumbRefs.current[key] = node;
          lazyThumbs.register(key, node);
        }}
        className="history-thumb"
        data-history-lazy-key={key}
        aria-hidden={shouldRender ? undefined : true}
        style={{ padding: 0, overflow: "hidden" }}
      >
        {shouldRender ? content : null}
      </div>
    );
  };

  return (
    <div
      ref={setStripElement}
      className={`history-strip${
        historyStripLayout === "horizontal" ? " history-strip--horizontal" : ""
      }${historyStripLayout === "sidebar" ? " history-strip--sidebar" : ""
      }`}
      onWheel={handleHorizontalWheel}
      data-layout={historyStripLayout}
    >
      <button
        type="button"
        className="history-thumb history-thumb--add"
        onClick={openGallery}
        aria-label={t("history.openGalleryAria")}
        title={t("history.openGalleryTitle")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      {skeletonCards.map((card) =>
        card.type === "collection-skeleton" ? (
          <CollectionSkeleton key={`coll-${card.id}`} id={card.id} count={card.count} />
        ) : (
          <SkeletonThumb key={card.id} id={card.id} />
        ),
      )}
      {visibleHistory.map((item) => {
        const key = getGalleryItemKey(item);
        const active = activeKey === key;

        if (item.sequenceId && completedSequences.has(item.sequenceId) && sequenceFirstKeys.has(key)) {
          const seqImages = completedSequences.get(item.sequenceId)!;
          return [
            renderLazyThumb(`coll-${item.sequenceId}`, (
              <CollectionThumb sequenceId={item.sequenceId} images={seqImages} />
            )),
            ...seqImages.map((seqItem) => {
              const seqKey = getGalleryItemKey(seqItem);
              const seqActive = activeKey === seqKey;
              if (isVideoItem(seqItem)) {
                return renderLazyThumb(seqKey, (
                  <div
                    className={`history-thumb history-thumb--video history-thumb--fade-in${seqActive ? " active" : ""}`}
                    onClick={() => selectHistory(seqItem)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/ima2-ref", JSON.stringify(buildVideoDragPayload(seqItem)));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    {seqItem.thumb ? (
                      <img src={seqItem.thumb} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <VideoThumbPlaceholder />
                    )}
                    <span className="history-thumb__play-badge" aria-hidden="true">▶</span>
                  </div>
                ));
              }
              return renderLazyThumb(seqKey, (
                <img
                  src={seqItem.thumb || seqItem.url || seqItem.image}
                  alt=""
                  className={`history-thumb history-thumb--fade-in${seqActive ? " active" : ""}`}
                  loading="lazy"
                  decoding="async"
                  onClick={() => selectHistory(seqItem)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/ima2-ref", JSON.stringify({ image: seqItem.url || seqItem.image, filename: seqItem.filename }));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                />
              ));
            }),
          ];
        }

        if (item.sequenceId && completedSequences.has(item.sequenceId) && !sequenceFirstKeys.has(key)) {
          return null;
        }

        if (isAudioItem(item)) {
          // Sound has no picture and cannot be a reference image, so the tile is not draggable.
          return renderLazyThumb(key, (
            <div className={`history-thumb history-thumb--audio${active ? " active" : ""}`} onClick={() => selectHistory(item)}>
              <AudioThumbPlaceholder />
            </div>
          ));
        }

        if (isVideoItem(item)) {
          return renderLazyThumb(key, (
            <div
              className={`history-thumb history-thumb--video${active ? " active" : ""}`}
              onClick={() => selectHistory(item)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/ima2-ref", JSON.stringify(buildVideoDragPayload(item)));
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              {item.thumb ? (
                <img src={item.thumb} alt="" loading="lazy" decoding="async" />
              ) : (
                <VideoThumbPlaceholder />
              )}
              <span className="history-thumb__play-badge" aria-hidden="true">▶</span>
            </div>
          ));
        }
        return renderLazyThumb(key, (
          <img
            src={item.thumb || item.url || item.image}
            alt=""
            className={`history-thumb${active ? " active" : ""}`}
            loading="lazy"
            decoding="async"
            onClick={() => selectHistory(item)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/ima2-ref", JSON.stringify({ image: item.url || item.image, filename: item.filename }));
              e.dataTransfer.effectAllowed = "copy";
            }}
          />
        ));
      })}
    </div>
  );
}
