import { useEffect, useRef, useState } from "react";
import type {
  CanvasAnnotationStyle,
  CanvasBackgroundCleanupIntent,
  CanvasBackgroundCleanupTool,
  CanvasEraserMode,
  CanvasExportBackground,
  CanvasTool,
  HexColor,
} from "../../types/canvas";
import type { BackgroundRemovalStats } from "../../lib/canvas/backgroundRemoval";
import { useI18n } from "../../i18n";
import { CanvasBackgroundControl } from "./CanvasBackgroundControl";
import { CanvasBackgroundCleanupPanel } from "./CanvasBackgroundCleanupPanel";
import { CanvasExportMenu } from "./CanvasExportMenu";
import type { CanvasExportFormat } from "../../lib/canvas/exportRenderer";
import { CanvasStylePopover } from "./CanvasStylePopover";
import { HandIcon, PenIcon, BoxIcon, ArrowIcon, MemoIcon, EraserIcon, ChevronUpIcon, ApplyIcon, TrashIcon, UndoIcon, RedoIcon, MaskIcon, TransparencyIcon } from "./CanvasToolbarIcons";
import { CanvasMarkupButton } from "./CanvasMarkupButton";
import { CanvasToolPicker } from "./CanvasToolPicker";

type AnnotationTool = CanvasTool;

interface CanvasToolbarProps {
  activeTool: AnnotationTool;
  hasAnnotations?: boolean;
  hasExportableContent?: boolean;
  onToolChange: (tool: AnnotationTool) => void;
  eraserMode?: CanvasEraserMode;
  onEraserModeChange?: (mode: CanvasEraserMode) => void;
  style: CanvasAnnotationStyle;
  onStyleChange: (style: CanvasAnnotationStyle) => void;
  onClear: () => void;
  onApply?: () => void;
  onRevertAnnotations?: () => void;
  onExport?: (format: CanvasExportFormat) => void;
  onTrace?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onDeleteSelected?: () => void;
  selectedCount?: number;
  onEditWithMask?: () => void;
  canEditWithMask?: boolean;
  isEditingWithMask?: boolean;
  onEditWithMarkup?: () => void;
  canEditWithMarkup?: boolean;
  isEditingWithMarkup?: boolean;
  onGptTransparency?: () => void;
  isTransparencyRunning?: boolean;
  isApplying?: boolean;
  isExporting?: boolean;
  exportBackground?: CanvasExportBackground;
  exportMatteColor?: HexColor;
  onExportBackgroundChange?: (mode: CanvasExportBackground) => void;
  onExportMatteColorChange?: (color: HexColor) => void;
  cleanupTolerance?: number;
  cleanupSeedCount?: number;
  cleanupStats?: BackgroundRemovalStats | null;
  cleanupHasPreview?: boolean;
  isCleanupPickingSeed?: boolean;
  isCleanupActive?: boolean;
  cleanupIntent?: CanvasBackgroundCleanupIntent;
  cleanupTool?: CanvasBackgroundCleanupTool;
  cleanupBrushRadius?: number;
  isCleanupPreviewing?: boolean;
  isCleanupApplying?: boolean;
  onCleanupAutoSample?: () => void;
  onCleanupPickSeed?: () => void;
  onCleanupIntentChange?: (intent: CanvasBackgroundCleanupIntent) => void;
  onCleanupToolChange?: (tool: CanvasBackgroundCleanupTool) => void;
  onCleanupBrushRadiusChange?: (value: number) => void;
  onCleanupToleranceChange?: (value: number) => void;
  onCleanupPreview?: () => void;
  onCleanupApply?: () => void;
  onCleanupReset?: () => void;
}

export function CanvasToolbar({
  activeTool,
  hasAnnotations,
  hasExportableContent,
  onToolChange,
  eraserMode = "object",
  onEraserModeChange,
  style,
  onStyleChange,
  onClear,
  onApply,
  onRevertAnnotations,
  onExport,
  onTrace,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDeleteSelected,
  selectedCount = 0,
  onEditWithMask,
  canEditWithMask,
  isEditingWithMask,
  onEditWithMarkup,
  canEditWithMarkup,
  isEditingWithMarkup,
  onGptTransparency,
  isTransparencyRunning,
  isApplying,
  isExporting,
  exportBackground = "alpha",
  exportMatteColor = "#ffffff",
  onExportBackgroundChange,
  onExportMatteColorChange,
  cleanupTolerance = 28,
  cleanupSeedCount = 0,
  cleanupStats = null,
  cleanupHasPreview = false,
  isCleanupPickingSeed = false,
  isCleanupActive = false,
  cleanupIntent = "remove",
  cleanupTool = "click",
  cleanupBrushRadius = 0.018,
  isCleanupPreviewing = false,
  isCleanupApplying = false,
  onCleanupAutoSample,
  onCleanupPickSeed,
  onCleanupIntentChange,
  onCleanupToolChange,
  onCleanupBrushRadiusChange,
  onCleanupToleranceChange,
  onCleanupPreview,
  onCleanupApply,
  onCleanupReset,
}: CanvasToolbarProps) {
  const { t } = useI18n();
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const eraserRef = useRef<HTMLDivElement>(null);
  const canClear = hasAnnotations ?? false;
  const canExport = hasExportableContent ?? canClear;
  const eraserLabel = eraserMode === "object"
    ? t("canvas.toolbar.objectEraser")
    : t("canvas.toolbar.brushEraser");

  const tools = [
    { id: "select", shortcut: "1", label: t("canvas.toolbar.select"), icon: HandIcon },
    { id: "pen", shortcut: "2", label: t("canvas.toolbar.pen"), icon: PenIcon },
    { id: "box", shortcut: "3", label: t("canvas.toolbar.box"), icon: BoxIcon },
    { id: "arrow", shortcut: "4", label: t("canvas.toolbar.arrow"), icon: ArrowIcon },
    { id: "memo", shortcut: "5", label: t("canvas.toolbar.memo"), icon: MemoIcon },
  ] as const;

  useEffect(() => {
    if (!eraserMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!eraserRef.current?.contains(event.target as Node)) setEraserMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [eraserMenuOpen]);

  const selectEraserMode = (mode: CanvasEraserMode) => {
    onEraserModeChange?.(mode);
    onToolChange("eraser");
    setEraserMenuOpen(false);
  };

  return (
    <div className="canvas-toolbar" aria-label={t("canvas.toolbar.label")}>
      <CanvasToolPicker tools={tools} activeTool={activeTool} onToolChange={onToolChange} />
      <CanvasStylePopover style={style} onStyleChange={onStyleChange} />
      <div
        ref={eraserRef}
        className={`canvas-toolbar__split-button${activeTool === "eraser" ? " canvas-toolbar__split-button--active" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && eraserMenuOpen) {
            event.preventDefault();
            setEraserMenuOpen(false);
          }
        }}
      >
        <button
          type="button"
          className={`canvas-toolbar__button canvas-toolbar__button--split-main${
            activeTool === "eraser" ? " canvas-toolbar__button--active" : ""
          }`}
          onClick={() => onToolChange("eraser")}
          aria-label={`${eraserLabel} (6)`}
          aria-pressed={activeTool === "eraser"}
          title={`${eraserLabel} (6)`}
        >
          <EraserIcon />
          <span className="canvas-toolbar__shortcut" aria-hidden="true">6</span>
        </button>
        <button
          type="button"
          className="canvas-toolbar__button canvas-toolbar__button--split-menu"
          onClick={() => setEraserMenuOpen((open) => !open)}
          aria-label={t("canvas.toolbar.eraserMenu")}
          aria-haspopup="menu"
          aria-expanded={eraserMenuOpen}
          aria-controls="canvas-eraser-menu"
          title={t("canvas.toolbar.eraserMenu")}
        >
          <ChevronUpIcon />
        </button>
        {eraserMenuOpen ? (
          <div id="canvas-eraser-menu" className="canvas-toolbar__eraser-menu" role="menu">
            <button
              type="button"
              className={`canvas-toolbar__eraser-menu-item${
                eraserMode === "object" ? " canvas-toolbar__eraser-menu-item--active" : ""
              }`}
              role="menuitemradio"
              aria-checked={eraserMode === "object"}
              onClick={() => selectEraserMode("object")}
            >
              {t("canvas.toolbar.objectEraser")}
            </button>
            <button
              type="button"
              className={`canvas-toolbar__eraser-menu-item${
                eraserMode === "brush" ? " canvas-toolbar__eraser-menu-item--active" : ""
              }`}
              role="menuitemradio"
              aria-checked={eraserMode === "brush"}
              onClick={() => selectEraserMode("brush")}
            >
              {t("canvas.toolbar.brushEraser")}
            </button>
          </div>
        ) : null}
      </div>
      <span className="canvas-toolbar__divider" aria-hidden="true" />
      {onApply ? (
        <button
          type="button"
          className={`canvas-toolbar__button canvas-toolbar__button--primary${
            isApplying ? " canvas-toolbar__button--busy" : ""
          }`}
          onClick={onApply}
          disabled={!canClear || isApplying}
          aria-label={t("canvas.toolbar.apply")}
          title={t("canvas.toolbar.apply")}
        >
          <ApplyIcon />
        </button>
      ) : null}
      {onRevertAnnotations ? (
        <button
          type="button"
          className="canvas-toolbar__button"
          onClick={onRevertAnnotations}
          disabled={isApplying}
          aria-label={t("canvas.revert.action")}
          title={t("canvas.revert.action")}
        >
          <UndoIcon />
        </button>
      ) : null}
      {onEditWithMask ? (
        <button
          type="button"
          className={`canvas-toolbar__button canvas-toolbar__button--primary canvas-toolbar__button--mask${
            isEditingWithMask ? " canvas-toolbar__button--busy" : ""
          }`}
          onClick={onEditWithMask}
          disabled={!canEditWithMask || isEditingWithMask || isEditingWithMarkup}
          aria-label={canEditWithMask ? t("canvas.toolbar.editMask") : t("canvas.toolbar.editMaskDisabled")}
          title={canEditWithMask ? t("canvas.toolbar.editMask") : t("canvas.toolbar.editMaskDisabled")}
        >
          <MaskIcon />
        </button>
      ) : null}
      {onEditWithMarkup ? (
        <CanvasMarkupButton onClick={onEditWithMarkup} enabled={Boolean(canEditWithMarkup)}
          busy={Boolean(isEditingWithMarkup)} disabled={Boolean(isEditingWithMask)} />
      ) : null}
      {onUndo ? (
        <button
          type="button"
          className="canvas-toolbar__button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label={t("canvas.toolbar.undo")}
          title={t("canvas.toolbar.undo")}
        >
          <UndoIcon />
        </button>
      ) : null}
      {onRedo ? (
        <button
          type="button"
          className="canvas-toolbar__button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label={t("canvas.toolbar.redo")}
          title={t("canvas.toolbar.redo")}
        >
          <RedoIcon />
        </button>
      ) : null}
      {onDeleteSelected ? (
        <button
          type="button"
          className="canvas-toolbar__button canvas-toolbar__button--danger"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          aria-label={t("canvas.toolbar.deleteSelected")}
          title={t("canvas.toolbar.deleteSelected")}
        >
          <TrashIcon />
        </button>
      ) : null}
      {onExport && onExportBackgroundChange && onExportMatteColorChange ? (
        <CanvasBackgroundControl
          mode={exportBackground}
          matteColor={exportMatteColor}
          onModeChange={onExportBackgroundChange}
          onMatteColorChange={onExportMatteColorChange}
        />
      ) : null}
      {onCleanupAutoSample &&
      onCleanupPickSeed &&
      onCleanupIntentChange &&
      onCleanupToolChange &&
      onCleanupBrushRadiusChange &&
      onCleanupToleranceChange &&
      onCleanupPreview &&
      onCleanupApply &&
      onCleanupReset ? (
        <CanvasBackgroundCleanupPanel
          seedCount={cleanupSeedCount}
          tolerance={cleanupTolerance}
          stats={cleanupStats}
          hasPreview={cleanupHasPreview}
          isPickingSeed={isCleanupPickingSeed}
          intent={cleanupIntent}
          tool={cleanupTool}
          brushRadius={cleanupBrushRadius}
          isPreviewing={isCleanupPreviewing}
          isApplying={isCleanupApplying}
          keepOpen={isCleanupActive}
          disabled={isApplying || isExporting}
          onAutoSample={onCleanupAutoSample}
          onPickSeed={onCleanupPickSeed}
          onIntentChange={onCleanupIntentChange}
          onToolChange={onCleanupToolChange}
          onBrushRadiusChange={onCleanupBrushRadiusChange}
          onToleranceChange={onCleanupToleranceChange}
          onPreview={onCleanupPreview}
          onApply={onCleanupApply}
          onReset={onCleanupReset}
        />
      ) : null}
      {onGptTransparency ? (
        <button
          type="button"
          className={`canvas-toolbar__button canvas-toolbar__button--transparency${
            isTransparencyRunning ? " canvas-toolbar__button--busy" : ""
          }`}
          onClick={onGptTransparency}
          disabled={isTransparencyRunning || isApplying || isEditingWithMask || isEditingWithMarkup}
          aria-label={t("canvas.toolbar.gptTransparency")}
          title={t("canvas.toolbar.gptTransparency")}
        >
          {isTransparencyRunning ? <span className="canvas-toolbar__spinner" aria-hidden="true" /> : <TransparencyIcon />}
        </button>
      ) : null}
      {onExport && onTrace ? (
        <CanvasExportMenu
          onExport={onExport}
          onTrace={onTrace}
          disabled={!canExport}
          isExporting={Boolean(isExporting)}
        />
      ) : null}
      <button
        type="button"
        className="canvas-toolbar__button canvas-toolbar__button--danger"
        onClick={onClear}
        disabled={!canClear}
        aria-label={t("canvas.toolbar.clear")}
        title={t("canvas.toolbar.clear")}
      >
        <TrashIcon />
      </button>
    </div>
  );
}
