import { CanvasToolbar } from "./CanvasToolbar";
import type { useCanvasAnnotations } from "../../hooks/useCanvasAnnotations";
import type { useCanvasBackgroundCleanup } from "./useCanvasBackgroundCleanup";
import type { CanvasExportBackground, HexColor } from "../../types/canvas";
import type { CanvasExportFormat } from "../../lib/canvas/exportRenderer";

interface CanvasModeFloatingToolbarProps {
  annotations: ReturnType<typeof useCanvasAnnotations>;
  backgroundCleanup: ReturnType<typeof useCanvasBackgroundCleanup>;
  backgroundCleanupPreview: unknown;
  canvasState: {
    exportBackground: CanvasExportBackground;
    exportMatteColor: HexColor;
    isApplying: boolean;
    isExporting: boolean;
    isEditingWithMask: boolean;
    isTransparencyRunning: boolean;
    canRevertAnnotations: boolean;
  };
  actions: {
    handleApplyCanvas: () => Promise<void>;
    handleRevertAnnotations: () => Promise<void>;
    handleExportCanvas: (format?: CanvasExportFormat) => Promise<void>;
    handleTraceCanvas: () => Promise<void>;
    handleEditWithMask: () => Promise<void>;
    handleGptTransparency: () => Promise<void>;
    setExportBackground: (mode: CanvasExportBackground) => void;
    setExportMatteColor: (color: HexColor) => void;
  };
}

export function CanvasModeFloatingToolbar({
  annotations,
  backgroundCleanup,
  backgroundCleanupPreview,
  canvasState,
  actions,
}: CanvasModeFloatingToolbarProps) {
  return (
    <CanvasToolbar
      activeTool={annotations.activeTool}
      eraserMode={annotations.eraserMode}
      onEraserModeChange={annotations.setEraserMode}
      style={{ color: annotations.toolColor, strokeWidth: annotations.strokeWidth }}
      onStyleChange={annotations.setStyle}
      hasAnnotations={annotations.hasAnnotations}
      hasExportableContent
      onToolChange={annotations.setTool}
      onClear={annotations.clear}
      onApply={() => void actions.handleApplyCanvas()}
      onRevertAnnotations={canvasState.canRevertAnnotations
        ? () => void actions.handleRevertAnnotations()
        : undefined}
      onExport={(format) => void actions.handleExportCanvas(format)}
      onTrace={() => void actions.handleTraceCanvas()}
      onUndo={annotations.undo}
      onRedo={annotations.redo}
      canUndo={annotations.canUndo}
      canRedo={annotations.canRedo}
      onDeleteSelected={annotations.deleteSelected}
      selectedCount={annotations.selectedIds.length}
      onEditWithMask={() => void actions.handleEditWithMask()}
      canEditWithMask={annotations.boxes.length > 0}
      isEditingWithMask={canvasState.isEditingWithMask}
      onGptTransparency={() => void actions.handleGptTransparency()}
      isTransparencyRunning={canvasState.isTransparencyRunning}
      isApplying={canvasState.isApplying}
      isExporting={canvasState.isExporting}
      exportBackground={canvasState.exportBackground}
      exportMatteColor={canvasState.exportMatteColor}
      onExportBackgroundChange={actions.setExportBackground}
      onExportMatteColorChange={actions.setExportMatteColor}
      cleanupTolerance={backgroundCleanup.backgroundCleanupTolerance}
      cleanupSeedCount={backgroundCleanup.backgroundCleanupSeeds.length}
      cleanupStats={backgroundCleanup.backgroundCleanupStats}
      cleanupHasPreview={Boolean(backgroundCleanupPreview)}
      isCleanupPickingSeed={backgroundCleanup.isBackgroundCleanupPickingSeed}
      isCleanupActive={backgroundCleanup.isBackgroundCleanupActive}
      cleanupIntent={backgroundCleanup.cleanupIntent}
      cleanupTool={backgroundCleanup.cleanupTool}
      cleanupBrushRadius={backgroundCleanup.cleanupBrushRadius}
      isCleanupPreviewing={backgroundCleanup.isBackgroundCleanupPreviewing}
      isCleanupApplying={backgroundCleanup.isBackgroundCleanupApplying}
      onCleanupAutoSample={backgroundCleanup.handleBackgroundCleanupAutoSample}
      onCleanupPickSeed={backgroundCleanup.handleBackgroundCleanupPickSeed}
      onCleanupIntentChange={backgroundCleanup.setCleanupIntent}
      onCleanupToolChange={(tool) => {
        backgroundCleanup.setCleanupTool(tool);
        backgroundCleanup.setIsBackgroundCleanupActive(true);
      }}
      onCleanupBrushRadiusChange={backgroundCleanup.setCleanupBrushRadius}
      onCleanupToleranceChange={backgroundCleanup.handleBackgroundCleanupToleranceChange}
      onCleanupPreview={() => void backgroundCleanup.runBackgroundCleanupPreview()}
      onCleanupApply={() => void backgroundCleanup.handleBackgroundCleanupApply()}
      onCleanupReset={backgroundCleanup.handleBackgroundCleanupReset}
    />
  );
}
