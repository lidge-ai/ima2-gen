import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useAppStore } from "../store/useAppStore";
import { useCreateBlankCanvas } from "../hooks/useCreateBlankCanvas";
import { ResultActions } from "./ResultActions";
import { VectorizePanel } from "./assetgen/VectorizePanel";
import { ResultPromptSummary } from "./ResultPromptSummary";
import { MultimodeSequencePreview } from "./MultimodeSequencePreview";
import { ViewerControls } from "./viewer/ViewerControls";
import { FavoriteStarButton } from "./controls";
import { useI18n } from "../i18n";
import { isEditableTarget } from "../lib/domEvents";
import { getImageModelShortLabel } from "../lib/imageModels";
import { isVideoItem } from "../lib/videoMedia";
import { buildVideoDragPayload, continuitySummary } from "../lib/videoContinuity";
import { formatReasoningLabel } from "../lib/reasoning";
import { resolveResultFavorite } from "../lib/favoriteState";
import type { GenerateItem } from "../types";
import {
  useViewerTransform,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
} from "../hooks/useViewerTransform";

const LazyCanvasModeWorkspace = lazy(() =>
  import("./canvas-mode").then((module) => ({
    default: module.CanvasModeWorkspace,
  })),
);

function formatQualityAlias(quality: string | null | undefined): string | null {
  if (quality === "low") return "l";
  if (quality === "medium") return "m";
  if (quality === "high") return "h";
  return quality ?? null;
}

function formatSizeAlias(size: string | null | undefined): string | null {
  if (!size) return null;
  const square = size.match(/^(\d+)x\1$/);
  if (square) return `${square[1]}²`;
  return size.replace("x", "×");
}

function getClassicImageSrc(image: GenerateItem): string {
  const src = image.url ?? image.image;
  if (!image.canvasVersion || !image.canvasMergedAt || src.startsWith("data:")) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}canvasMergedAt=${image.canvasMergedAt}`;
}

export function Canvas() {
  const currentImage = useAppStore((s) => s.currentImage);
  const importLocalImageToHistory = useAppStore((s) => s.importLocalImageToHistory);
  const multimodeSequence = useAppStore((s) => {
    const id = s.multimodePreviewFlightId;
    return id ? s.multimodeSequences[id] ?? null : null;
  });
  const selectHistoryShortcutTarget = useAppStore((s) => s.selectHistoryShortcutTarget);
  const trashHistoryItem = useAppStore((s) => s.trashHistoryItem);
  const permanentlyDeleteHistoryItemByShortcut = useAppStore(
    (s) => s.permanentlyDeleteHistoryItemByShortcut,
  );
  const markGeneratedResultsSeen = useAppStore((s) => s.markGeneratedResultsSeen);
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const canvasOpen = useAppStore((s) => s.canvasOpen);
  const openCanvas = useAppStore((s) => s.openCanvas);
  const showToast = useAppStore((s) => s.showToast);
  const history = useAppStore((s) => s.history);
  const galleryFavorites = useAppStore((s) => s.galleryFavorites);
  const toggleGalleryFavorite = useAppStore((s) => s.toggleGalleryFavorite);
  const { t } = useI18n();
  const [dropActive, setDropActive] = useState(false);
  const [favoritePendingFilename, setFavoritePendingFilename] = useState<string | null>(null);
  const { creatingBlankCanvas, createBlankCanvas } = useCreateBlankCanvas();
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const imageKey = currentImage
    ? `${currentImage.filename ?? currentImage.url ?? currentImage.image}:${currentImage.canvasMergedAt ?? ""}`
    : null;
  const viewer = useViewerTransform(imageKey);

  const copyPrompt = (): void => {
    if (!currentImage?.prompt) return;
    void navigator.clipboard.writeText(currentImage.prompt);
    showToast(t("toast.promptCopied"));
  };

  const handleViewerKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!currentImage) return;
      if (event.target !== event.currentTarget) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) {
        void permanentlyDeleteHistoryItemByShortcut(currentImage);
        return;
      }
      void trashHistoryItem(currentImage);
      return;
    }

    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) return;
    if (event.target !== event.currentTarget) return;
    if (isEditableTarget(event.target)) return;

    event.preventDefault();
    if (event.key === "ArrowLeft") selectHistoryShortcutTarget("previous");
    else if (event.key === "ArrowRight") selectHistoryShortcutTarget("next");
    else if (event.key === "Home") selectHistoryShortcutTarget("first");
    else if (event.key === "End") selectHistoryShortcutTarget("last");
  };

  const handleViewerMouseDown = (event: MouseEvent<HTMLElement>): void => {
    if (isEditableTarget(event.target)) return;
    markGeneratedResultsSeen();
    event.currentTarget.focus();
  };

  const restoreResultFocus = useCallback((): void => {
    window.requestAnimationFrame(() => resultContainerRef.current?.focus());
  }, []);

  const toggleCurrentFavorite = async (): Promise<void> => {
    const filename = currentImage?.filename;
    if (!currentImage || !filename || favoritePendingFilename === filename) return;
    setFavoritePendingFilename(filename);
    try {
      await toggleGalleryFavorite(currentImage);
    } finally {
      setFavoritePendingFilename((pending) => (pending === filename ? null : pending));
    }
  };

  const handleCenterDragOver = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDropActive((prev) => (prev ? prev : true));
  }, []);

  const handleCenterDragLeave = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleCenterDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>): Promise<void> => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDropActive(false);
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        /^image\/(png|jpeg|webp)$/.test(file.type),
      );
      if (files.length === 0) return;
      await importLocalImageToHistory(files[0]);
    },
    [importLocalImageToHistory],
  );

  if (canvasOpen && currentImage) {
    return (
      <>
        <Suspense fallback={<main className="canvas canvas--mode-open" aria-busy="true" />}>
          <LazyCanvasModeWorkspace currentImage={currentImage} />
        </Suspense>
        <VectorizePanel />
      </>
    );
  }

  const displayQuality = formatQualityAlias(currentImage?.quality);
  const displaySize = formatSizeAlias(currentImage?.size);
  const displayModel = getImageModelShortLabel(currentImage?.model, currentImage?.provider);
  const imageSrc = currentImage ? getClassicImageSrc(currentImage) : null;
  const resultFavorite = resolveResultFavorite(
    currentImage?.filename,
    history,
    galleryFavorites,
    currentImage?.isFavorite,
  );

  return (
    <main
      className={`canvas${dropActive ? " canvas--drop-active" : ""}`}
      onDragOver={handleCenterDragOver}
      onDragLeave={handleCenterDragLeave}
      onDrop={handleCenterDrop}
    >
      {dropActive ? (
        <div className="canvas__drop-overlay" aria-hidden>
          <span className="canvas__drop-hint">{t("canvas.drop.hint")}</span>
        </div>
      ) : null}
      <div className={`progress-bar${activeGenerations > 0 ? " active" : ""}`} />
      {multimodeSequence ? (
        <MultimodeSequencePreview />
      ) : currentImage && imageSrc ? (
        <div
          ref={resultContainerRef}
          className="result-container visible"
          tabIndex={0}
          onMouseDown={handleViewerMouseDown}
          onKeyDown={handleViewerKeyDown}
          aria-label={t("canvas.imageViewerAria")}
        >
          <div
            className={`result-preview-frame canvas-annotation-frame${viewer.zoom > VIEWER_MIN_ZOOM ? " canvas-annotation-frame--zoomed" : ""}`}
            onWheel={viewer.handleWheel}
            onDoubleClick={viewer.handleDoubleClick}
            onPointerDown={viewer.handlePointerDown}
            onPointerMove={viewer.handlePointerMove}
            onPointerUp={viewer.handlePointerUp}
            onPointerCancel={viewer.handlePointerUp}
          >
            {currentImage.filename ? (
              <FavoriteStarButton
                variant="result"
                active={resultFavorite}
                busy={favoritePendingFilename === currentImage.filename}
                label={resultFavorite ? t("gallery.unfavoriteAria") : t("gallery.favoriteAria")}
                onToggle={toggleCurrentFavorite}
              />
            ) : null}
            {isVideoItem(currentImage) ? (
              <>
                <video
                  className="result-img"
                  key={imageKey ?? undefined}
                  src={imageSrc}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{
                    transform: `translate(${viewer.pan.x}px, ${viewer.pan.y}px) scale(${viewer.zoom})`,
                  }}
                />
                <div
                  className="result-drag-handle"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/ima2-ref", JSON.stringify(buildVideoDragPayload(currentImage)));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title={t("canvas.dragToComposer")}
                  aria-label={t("canvas.dragToComposer")}
                >
                  {t("canvas.dragHint")}
                </div>
              </>
            ) : (
              <>
                <img
                  className="result-img"
                  key={imageKey ?? undefined}
                  src={imageSrc!}
                  alt={t("canvas.resultAlt")}
                  decoding="async"
                  fetchPriority="high"
                  style={{
                    transform: `translate(${viewer.pan.x}px, ${viewer.pan.y}px) scale(${viewer.zoom})`,
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    openCanvas();
                  }}
                />
                <div
                  className="result-drag-handle"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/ima2-ref", JSON.stringify({ image: currentImage.url || currentImage.image, filename: currentImage.filename }));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title={t("canvas.dragToComposer")}
                  aria-label={t("canvas.dragToComposer")}
                >
                  {t("canvas.dragHint")}
                </div>
              </>
            )}
            <ViewerControls
              zoom={viewer.zoom}
              minZoom={VIEWER_MIN_ZOOM}
              maxZoom={VIEWER_MAX_ZOOM}
              onZoomIn={viewer.zoomIn}
              onZoomOut={viewer.zoomOut}
              onReset={viewer.reset}
              labels={{
                controls: t("viewer.controls"),
                zoomIn: t("viewer.zoomIn"),
                zoomOut: t("viewer.zoomOut"),
                reset: t("viewer.reset"),
              }}
            />
          </div>
          <div className="result-meta">
            {(isVideoItem(currentImage)
              ? [
                  currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
                  currentImage.video?.duration ? `${currentImage.video.duration}s clip` : null,
                  currentImage.video?.resolution ?? null,
                  currentImage.video?.aspectRatio ?? null,
                  continuitySummary(currentImage.videoContinuity),
                  displayModel,
                ]
              : [
                  currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
                  currentImage.usage
                    ? t("canvas.tokens", { n: currentImage.usage.total_tokens ?? "?" })
                    : null,
                  formatReasoningLabel(currentImage.reasoningEffort),
                  displayQuality,
                  displaySize,
                  displayModel,
                ]
            )
              .filter((value): value is string => Boolean(value))
              .join(" · ")}
          </div>
          <ResultActions onAfterDeleteFocus={restoreResultFocus} />
          {currentImage.prompt ? (
            <ResultPromptSummary prompt={currentImage.prompt} onCopy={copyPrompt} />
          ) : null}
        </div>
      ) : !currentImage ? (
        <div className="canvas__blank-entry">
          <div className="canvas__blank-sheet" aria-hidden />
          <div className="canvas__blank-copy">
            <strong>{t("canvas.blank.title")}</strong>
            <span>{t("canvas.blank.subtitle")}</span>
          </div>
          <button
            type="button"
            className="canvas__blank-button"
            onClick={() => void createBlankCanvas()}
            disabled={creatingBlankCanvas}
          >
            {creatingBlankCanvas ? t("canvas.blank.creating") : t("canvas.blank.create")}
          </button>
        </div>
      ) : null}
    </main>
  );
}
