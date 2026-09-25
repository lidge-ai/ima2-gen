import type { useCanvasAnnotations } from "../../hooks/useCanvasAnnotations";
import type { CSSProperties, PointerEventHandler, ReactNode, RefObject } from "react";
import type { CanvasObjectKey } from "../../lib/canvas/objectKeys";
import { CanvasAnnotationLayer } from "./CanvasAnnotationLayer";
import { CanvasMemoOverlay } from "./CanvasMemoOverlay";

interface CanvasModeStageProps {
  annotationFrameRef: RefObject<HTMLDivElement | null>;
  imageElementRef: RefObject<HTMLImageElement | null>;
  frameClassName: string;
  frameStyle: CSSProperties;
  imageKey: string;
  imageSrc: string;
  fallbackImage: string;
  alt: string;
  canvasOpen: boolean;
  maskOverlayUrl: string | null;
  cleanupLayer?: ReactNode;
  annotations: ReturnType<typeof useCanvasAnnotations>;
  hoveredAnnotationId?: CanvasObjectKey | null;
  onOpenCanvas: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

export function CanvasModeStage({
  annotationFrameRef,
  imageElementRef,
  frameClassName,
  frameStyle,
  imageKey,
  imageSrc,
  fallbackImage,
  alt,
  canvasOpen,
  maskOverlayUrl,
  cleanupLayer,
  annotations,
  hoveredAnnotationId = null,
  onOpenCanvas,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
}: CanvasModeStageProps) {
  return (
    <div
      ref={annotationFrameRef}
      className={frameClassName}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={frameStyle}
    >
      <img
        ref={imageElementRef}
        className="result-img"
        key={imageKey}
        src={imageSrc ?? fallbackImage}
        alt={alt}
        decoding="async"
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpenCanvas();
        }}
      />
      {canvasOpen && maskOverlayUrl ? (
        <img
          className="canvas-background-cleanup-mask"
          src={maskOverlayUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      ) : null}
      {canvasOpen ? cleanupLayer : null}
      {canvasOpen && (
        <>
          <CanvasAnnotationLayer
            paths={annotations.paths}
            boxes={annotations.boxes}
            memos={annotations.memos}
            selectedIds={annotations.selectedIds}
            selectionBox={annotations.selectionBox}
            hoveredId={hoveredAnnotationId}
            activePath={annotations.activePath}
            activeBox={annotations.activeBox}
          />
          <CanvasMemoOverlay
            memos={annotations.memos}
            activeMemoId={annotations.activeMemoId}
            onUpdate={annotations.updateMemo}
            onDelete={annotations.deleteMemo}
            onFocus={annotations.focusMemo}
            onCommit={annotations.commitMemoEdit}
          />
        </>
      )}
    </div>
  );
}
