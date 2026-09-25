import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type DragEvent as ReactDragEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { useAppStore } from "../../store/useAppStore";
import { MultimodeSequencePreview } from "../MultimodeSequencePreview";
import { useI18n } from "../../i18n";
import { isEditableTarget } from "../../lib/domEvents";
import { getImageModelShortLabel } from "../../lib/imageModels";
import type { GenerateItem } from "../../types";
import { useCreateBlankCanvas } from "../../hooks/useCreateBlankCanvas";
import {
  deleteCanvasAnnotations,
  fetchCanvasAnnotations,
  saveCanvasAnnotations,
} from "../../lib/api";
import { useCanvasAnnotations } from "../../hooks/useCanvasAnnotations";
import type { CanvasObjectKey } from "../../lib/canvas/objectKeys";
import { CanvasModeStage } from "./CanvasModeStage";
import { CanvasBackgroundCleanupLayer } from "./CanvasBackgroundCleanupLayer";
import { CanvasModeFloatingToolbar } from "./CanvasModeFloatingToolbar";
import { CanvasModeResultDetails } from "./CanvasModeResultDetails";
import { CanvasModeTopbar } from "./CanvasModeTopbar";
import { CanvasViewportMiniMap } from "./CanvasViewportMiniMap";
import {
  BRUSH_ERASER_CURSOR,
  OBJECT_ERASER_CURSOR,
  findCanvasVersionForSource,
  formatQualityAlias,
  formatSizeAlias,
  getCanvasDisplaySrc,
} from "./canvasModeHelpers";
import type { CanvasModeWorkspaceProps } from "./canvasModeTypes";
import { useCanvasBackgroundCleanup } from "./useCanvasBackgroundCleanup";
import { useCanvasModePointerHandlers } from "./useCanvasModePointerHandlers";
import { useCanvasModeShortcuts } from "./useCanvasModeShortcuts";
import { useCanvasModeSession } from "./useCanvasModeSession";

export function CanvasModeWorkspace(_props: CanvasModeWorkspaceProps) {
  const currentImage = useAppStore((s) => s.currentImage);
  const history = useAppStore((s) => s.history);
  const importLocalImageToHistory = useAppStore((s) => s.importLocalImageToHistory);
  const [dropActive, setDropActive] = useState(false);
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
  const quality = useAppStore((s) => s.quality);
  const format = useAppStore((s) => s.format);
  const moderation = useAppStore((s) => s.moderation);
  const provider = useAppStore((s) => s.provider);
  const imageModel = useAppStore((s) => s.imageModel);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const promptMode = useAppStore((s) => s.promptMode);
  const webSearchEnabled = useAppStore((s) => s.webSearchEnabled);
  const getResolvedSize = useAppStore((s) => s.getResolvedSize);
  const showToast = useAppStore((s) => s.showToast);
  const canvasOpen = useAppStore((s) => s.canvasOpen);
  const openCanvas = useAppStore((s) => s.openCanvas);
  const closeCanvas = useAppStore((s) => s.closeCanvas);
  const canvasZoom = useAppStore((s) => s.canvasZoom);
  const canvasPanX = useAppStore((s) => s.canvasPanX);
  const canvasPanY = useAppStore((s) => s.canvasPanY);
  const setCanvasPan = useAppStore((s) => s.setCanvasPan);
  const setCanvasZoom = useAppStore((s) => s.setCanvasZoom);
  const resetCanvasZoom = useAppStore((s) => s.resetCanvasZoom);
  const exportBackground = useAppStore((s) => s.canvasExportBackground);
  const exportMatteColor = useAppStore((s) => s.canvasExportMatteColor);
  const setExportBackground = useAppStore((s) => s.setCanvasExportBackground);
  const setExportMatteColor = useAppStore((s) => s.setCanvasExportMatteColor);
  const applyMergedCanvasImage = useAppStore((s) => s.applyMergedCanvasImage);
  const addGeneratedHistoryItem = useAppStore((s) => s.addGeneratedHistoryItem);
  const attachCanvasVersionReference = useAppStore((s) => s.attachCanvasVersionReference);
  const { t } = useI18n();
  const { creatingBlankCanvas, createBlankCanvas } = useCreateBlankCanvas();
  const annotationFrameRef = useRef<HTMLDivElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const previousImageKeyRef = useRef<string | null>(null);
  const loadedDraftKeyRef = useRef<string | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const canvasSourceImageRef = useRef<GenerateItem | null>(null);
  const lastMergedDataUrlRef = useRef<string | null>(null);
  const lastCleanDataUrlRef = useRef<string | null>(null);
  const [canvasVersionItem, setCanvasVersionItem] = useState<GenerateItem | null>(null);
  const [canvasSaveState, setCanvasSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isApplying, setIsApplying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditingWithMask, setIsEditingWithMask] = useState(false);
  const [isTransparencyRunning, setIsTransparencyRunning] = useState(false);
  const annotations = useCanvasAnnotations();

  const copyPrompt = () => {
    if (!currentImage?.prompt) return;
    void navigator.clipboard.writeText(currentImage.prompt);
    showToast(t("toast.promptCopied"));
  };

  const displayQuality = formatQualityAlias(currentImage?.quality);
  const displaySize = formatSizeAlias(currentImage?.size);
  const displayModel = getImageModelShortLabel(currentImage?.model, currentImage?.provider);
  const imageKey = currentImage?.filename ?? currentImage?.url ?? currentImage?.image ?? null;
  const latestCanvasVersion = findCanvasVersionForSource(history, currentImage);
  const canvasDisplayImage = canvasOpen ? (canvasVersionItem ?? latestCanvasVersion ?? currentImage) : currentImage;
  const baseImageSrc = canvasDisplayImage ? getCanvasDisplaySrc(canvasDisplayImage) : null;
  const backgroundCleanup = useCanvasBackgroundCleanup({
    canvasOpen,
    currentImage,
    canvasDisplayImage,
    imageElementRef,
    canvasSourceImageRef,
    lastMergedDataUrlRef,
    setCanvasSaveState,
    setCanvasVersionItem,
    applyMergedCanvasImage,
    attachCanvasVersionReference,
    showToast,
    t,
  });
  const {
    imageHasAlpha,
    backgroundCleanupSeeds,
    backgroundCleanupPreview,
    backgroundCleanupMaskOverlay,
    backgroundCleanupBrushStrokes,
    cleanupTool,
    cleanupBrushRadius,
    cleanupBrushCursor,
    isBackgroundCleanupActive,
  } = backgroundCleanup;
  const imageSrc = backgroundCleanup.backgroundCleanupPreview?.dataUrl ?? baseImageSrc;

  const resetCanvasSession = () => {
    canvasSourceImageRef.current = null;
    loadedDraftKeyRef.current = null;
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    setCanvasVersionItem(null);
    setCanvasSaveState("idle");
    backgroundCleanup.resetBackgroundCleanup();
    lastMergedDataUrlRef.current = null;
    lastCleanDataUrlRef.current = null;
    resetPointerSession();
  };

  useEffect(() => {
    if (!canvasOpen) {
      previousImageKeyRef.current = imageKey;
      resetCanvasSession();
      return;
    }

    if (previousImageKeyRef.current === null) {
      previousImageKeyRef.current = imageKey;
      canvasSourceImageRef.current = currentImage;
      setCanvasVersionItem(latestCanvasVersion);
      return;
    }

    if (previousImageKeyRef.current !== imageKey) {
      annotations.resetLocal();
      resetCanvasSession();
      canvasSourceImageRef.current = currentImage;
      setCanvasVersionItem(latestCanvasVersion);
      previousImageKeyRef.current = imageKey;
    }
  }, [annotations.resetLocal, canvasOpen, currentImage, imageKey, latestCanvasVersion]);

  useEffect(() => {
    if (!canvasOpen || !currentImage || canvasSourceImageRef.current) return;
    canvasSourceImageRef.current = currentImage;
    setCanvasVersionItem(latestCanvasVersion);
  }, [canvasOpen, currentImage, latestCanvasVersion]);

  useEffect(() => {
    if (!canvasOpen || !currentImage?.filename || currentImage.canvasVersion) return;
    const filename = currentImage.filename;
    if (loadedDraftKeyRef.current === filename) return;
    loadedDraftKeyRef.current = filename;
    let cancelled = false;
    void fetchCanvasAnnotations(filename)
      .then((res) => {
        if (!cancelled && res.annotations) annotations.load(res.annotations);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [annotations.load, canvasOpen, currentImage?.canvasVersion, currentImage?.filename]);

  useEffect(() => {
    if (!canvasOpen || !currentImage?.filename || currentImage.canvasVersion) return;
    if (!annotations.isDirty) return;
    const filename = currentImage.filename;
    if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const payload = annotations.toPayload();
      const request = annotations.hasAnnotations
        ? saveCanvasAnnotations(filename, payload)
        : deleteCanvasAnnotations(filename);
      void request
        .then(() => annotations.markSaved())
        .catch(() => {});
    }, 500);
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [
    annotations,
    annotations.hasAnnotations,
    annotations.isDirty,
    canvasOpen,
    currentImage?.canvasVersion,
    currentImage?.filename,
  ]);

  const handleViewerMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (isEditableTarget(event.target)) return;
    markGeneratedResultsSeen();
    event.currentTarget.focus();
  };

  const restoreResultFocus = useCallback(() => {
    window.requestAnimationFrame(() => resultContainerRef.current?.focus());
  }, []);

  const handleViewerWheel = (event: WheelEvent<HTMLElement>) => {
    if (!canvasOpen) return;
    event.preventDefault();
    if (event.ctrlKey) {
      setCanvasZoom(canvasZoom - event.deltaY * 0.01);
      return;
    }
    setCanvasPan(canvasPanX - event.deltaX, canvasPanY - event.deltaY);
  };

  const handleCenterDragOver = useCallback((e: ReactDragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDropActive((prev) => (prev ? prev : true));
  }, []);

  const handleCenterDragLeave = useCallback((e: ReactDragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);

  const handleCenterDrop = useCallback(
    async (e: ReactDragEvent<HTMLElement>) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDropActive(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /^image\/(png|jpeg|webp)$/.test(f.type),
      );
      if (files.length === 0) return;
      await importLocalImageToHistory(files[0]);
    },
    [importLocalImageToHistory],
  );

  const { handleApplyCanvas, handleRevertAnnotations, handleCloseCanvas, handleExportCanvas, handleTraceCanvas, handleEditWithMask, handleGptTransparency } = useCanvasModeSession({
    imageElementRef,
    currentImage,
    canvasDisplayImage,
    canvasSourceImageRef,
    lastMergedDataUrlRef,
    lastCleanDataUrlRef,
    canvasVersionItem,
    annotations,
    exportBackground,
    exportMatteColor,
    quality,
    format,
    moderation,
    provider,
    imageModel,
    reasoningEffort,
    promptMode,
    webSearchEnabled,
    getResolvedSize,
    setCanvasVersionItem,
    setCanvasSaveState,
    setIsApplying,
    setIsExporting,
    setIsEditingWithMask,
    setIsTransparencyRunning,
    applyMergedCanvasImage,
    addGeneratedHistoryItem,
    attachCanvasVersionReference,
    closeCanvas,
    resetCanvasSession,
    showToast,
    t,
  });

  const { spaceHeld, handleViewerKeyDown } = useCanvasModeShortcuts({
    canvasOpen,
    canvasZoom,
    currentImage,
    annotations,
    undoBackgroundCleanup: backgroundCleanup.undoBackgroundCleanup,
    redoBackgroundCleanup: backgroundCleanup.redoBackgroundCleanup,
    handleBackgroundCleanupEscape: backgroundCleanup.handleBackgroundCleanupEscape,
    handleCloseCanvas,
    selectHistoryShortcutTarget,
    trashHistoryItem,
    permanentlyDeleteHistoryItemByShortcut,
    setCanvasZoom,
    resetCanvasZoom,
    onCreateBlankCanvas: createBlankCanvas,
    isCreatingBlankCanvas: creatingBlankCanvas,
  });
  const canDragViewportWithSelect =
    canvasOpen &&
    canvasZoom > 1.01 &&
    annotations.activeTool === "select" &&
    !isBackgroundCleanupActive;
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<CanvasObjectKey | null>(null);
  const {
    viewportPanActive,
    resetPointerSession,
    handleAnnotationPointerDown,
    handleAnnotationPointerMove,
    handleAnnotationPointerUp,
    handleAnnotationPointerLeave,
  } = useCanvasModePointerHandlers({
    canvasOpen,
    canvasZoom,
    canvasPanX,
    canvasPanY,
    spaceHeld,
    canDragViewportWithSelect,
    isBackgroundCleanupActive,
    cleanupTool,
    annotationFrameRef,
    annotations,
    setCanvasPan,
    addBackgroundCleanupClick: backgroundCleanup.addBackgroundCleanupClick,
    startBackgroundCleanupBrushStroke: backgroundCleanup.startBackgroundCleanupBrushStroke,
    updateBackgroundCleanupBrushStroke: backgroundCleanup.updateBackgroundCleanupBrushStroke,
    endBackgroundCleanupBrushStroke: backgroundCleanup.endBackgroundCleanupBrushStroke,
    setCleanupBrushCursor: backgroundCleanup.setCleanupBrushCursor,
    setHoveredAnnotationId,
  });

  return (
    <main
      className={`canvas${canvasOpen ? " canvas--mode-open" : ""}${dropActive ? " canvas--drop-active" : ""}${spaceHeld ? " canvas--space-held" : ""}${viewportPanActive ? " canvas--pan-active" : ""}${canDragViewportWithSelect ? " canvas--zoom-hand" : ""}`}
      onDragOver={handleCenterDragOver}
      onDragLeave={handleCenterDragLeave}
      onDrop={handleCenterDrop}
    >
      {dropActive ? (
        <div className="canvas__drop-overlay" aria-hidden>
          <span className="canvas__drop-hint">{t("canvas.drop.hint")}</span>
        </div>
      ) : null}
      {canvasOpen && (
        <CanvasModeTopbar
          zoom={canvasZoom}
          modeLabel={t("canvas.modeTitle")}
          closeLabel={t("canvas.close")}
          blankCanvasLabel={t("canvas.blank.title")}
          blankCanvasAriaLabel={`${creatingBlankCanvas ? t("canvas.blank.creating") : t("canvas.blank.create")} (Shift+B)`}
          blankCanvasShortcut="Shift+B"
          blankCanvasBusy={creatingBlankCanvas}
          shortcutHint={t("canvas.toolbar.zoomShortcutHint")}
          onZoomIn={() => setCanvasZoom(canvasZoom + 0.1)}
          onZoomOut={() => setCanvasZoom(canvasZoom - 0.1)}
          onZoomReset={resetCanvasZoom}
          onCreateBlankCanvas={() => void createBlankCanvas()}
          onClose={() => void handleCloseCanvas()}
        />
      )}
      <div className={`progress-bar${activeGenerations > 0 ? " active" : ""}`} />
      {multimodeSequence ? (
        <MultimodeSequencePreview />
      ) : currentImage ? (
        <div
          ref={resultContainerRef}
          className="result-container visible"
          tabIndex={0}
          onMouseDown={handleViewerMouseDown}
          onWheel={handleViewerWheel}
          onKeyDown={handleViewerKeyDown}
          aria-label={t("canvas.imageViewerAria")}
        >
          <CanvasModeStage
            annotationFrameRef={annotationFrameRef}
            imageElementRef={imageElementRef}
            frameClassName={`canvas-annotation-frame${
              (imageHasAlpha || backgroundCleanupPreview) && canvasOpen ? " canvas-annotation-frame--alpha" : ""
            }${
              isBackgroundCleanupActive && canvasOpen ? " canvas-annotation-frame--cleanup-picking" : ""
            }${
              backgroundCleanupMaskOverlay && canvasOpen ? " canvas-annotation-frame--cleanup-mask" : ""
            }`}
            frameStyle={{
              cursor: viewportPanActive
                ? "grabbing"
                : spaceHeld || canDragViewportWithSelect
                  ? "grab"
                  : canvasOpen
                    ? isBackgroundCleanupActive
                      ? "crosshair"
                    : annotations.activeTool === "select"
                      ? hoveredAnnotationId
                        ? "move"
                        : "default"
                      : annotations.activeTool === "eraser"
                        ? annotations.eraserMode === "object"
                          ? OBJECT_ERASER_CURSOR
                          : BRUSH_ERASER_CURSOR
                        : "crosshair"
                    : "zoom-in",
              transform: canvasOpen
                ? `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`
                : undefined,
              transition: canvasOpen && !viewportPanActive ? "transform 0.2s ease" : undefined,
            }}
            imageKey={`${canvasDisplayImage?.filename ?? canvasDisplayImage?.url ?? canvasDisplayImage?.image}:${canvasDisplayImage?.canvasMergedAt ?? ""}`}
            imageSrc={imageSrc ?? currentImage.image}
            fallbackImage={currentImage.image}
            alt={t("canvas.resultAlt")}
            canvasOpen={canvasOpen}
            maskOverlayUrl={backgroundCleanupMaskOverlay?.dataUrl ?? null}
            cleanupLayer={(
              <CanvasBackgroundCleanupLayer
                seeds={backgroundCleanupSeeds}
                brushStrokes={backgroundCleanupBrushStrokes}
                brushCursor={cleanupBrushCursor}
                brushRadius={cleanupBrushRadius}
                active={isBackgroundCleanupActive}
              />
            )}
            annotations={annotations}
            hoveredAnnotationId={hoveredAnnotationId}
            onOpenCanvas={openCanvas}
            onPointerDown={handleAnnotationPointerDown}
            onPointerMove={handleAnnotationPointerMove}
            onPointerUp={handleAnnotationPointerUp}
            onPointerLeave={handleAnnotationPointerLeave}
          />
          {canvasOpen && imageSrc ? (
            <CanvasViewportMiniMap
              imageSrc={imageSrc}
              zoom={canvasZoom}
              panX={canvasPanX}
              panY={canvasPanY}
              resetLabel={t("canvas.toolbar.zoomReset")}
              onReset={resetCanvasZoom}
            />
          ) : null}
          {canvasOpen && (
            <CanvasModeFloatingToolbar
              annotations={annotations}
              backgroundCleanup={backgroundCleanup}
              backgroundCleanupPreview={backgroundCleanupPreview}
              canvasState={{
                exportBackground,
                exportMatteColor,
                isApplying,
                isExporting,
                isEditingWithMask,
                isTransparencyRunning,
                canRevertAnnotations: Boolean(canvasVersionItem?.annotationsBaked),
              }}
              actions={{
                handleApplyCanvas,
                handleRevertAnnotations,
                handleExportCanvas,
                handleTraceCanvas,
                handleEditWithMask,
                handleGptTransparency,
                setExportBackground,
                setExportMatteColor,
              }}
            />
          )}
          {canvasOpen && canvasSaveState !== "idle" ? (
            <div className={`canvas-save-state canvas-save-state--${canvasSaveState}`}>
              {canvasSaveState === "saving"
                ? t("canvas.version.saving")
                : canvasSaveState === "saved"
                  ? t("canvas.version.saved")
                  : t("canvas.version.failed")}
            </div>
          ) : null}
          <CanvasModeResultDetails
            currentImage={currentImage}
            canvasDisplayImage={canvasDisplayImage}
            canvasOpen={canvasOpen}
            displayQuality={displayQuality}
            displaySize={displaySize}
            displayModel={displayModel}
            onAfterDeleteFocus={restoreResultFocus}
            onCopyPrompt={copyPrompt}
          />
        </div>
      ) : null}
    </main>
  );
}
