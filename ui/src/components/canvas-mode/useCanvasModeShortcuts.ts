import type { useCanvasAnnotations } from "../../hooks/useCanvasAnnotations";
import { useEffect, useState, type KeyboardEvent } from "react";
import { isEditableTarget } from "../../lib/domEvents";
import type { GenerateItem } from "../../types";

interface UseCanvasModeShortcutsArgs {
  canvasOpen: boolean;
  canvasZoom: number;
  currentImage: GenerateItem | null;
  annotations: ReturnType<typeof useCanvasAnnotations>;
  undoBackgroundCleanup: () => boolean;
  redoBackgroundCleanup: () => boolean;
  handleBackgroundCleanupEscape: () => boolean;
  handleCloseCanvas: () => Promise<void>;
  selectHistoryShortcutTarget: (action: "previous" | "next" | "first" | "last") => void;
  trashHistoryItem: (item: GenerateItem) => Promise<void> | void;
  permanentlyDeleteHistoryItemByShortcut: (item: GenerateItem) => Promise<void> | void;
  setCanvasZoom: (zoom: number) => void;
  resetCanvasZoom: () => void;
  onCreateBlankCanvas: () => Promise<void> | void;
  isCreatingBlankCanvas: boolean;
}

export function useCanvasModeShortcuts({
  canvasOpen,
  canvasZoom,
  currentImage,
  annotations,
  undoBackgroundCleanup,
  redoBackgroundCleanup,
  handleBackgroundCleanupEscape,
  handleCloseCanvas,
  selectHistoryShortcutTarget,
  trashHistoryItem,
  permanentlyDeleteHistoryItemByShortcut,
  setCanvasZoom,
  resetCanvasZoom,
  onCreateBlankCanvas,
  isCreatingBlankCanvas,
}: UseCanvasModeShortcutsArgs) {
  const [spaceHeld, setSpaceHeld] = useState(false);

  useEffect(() => {
    if (!canvasOpen) return;
    const preventCanvasPinchDefault = (event: Event): void => {
      event.preventDefault();
    };
    const preventCtrlWheelDefault = (event: globalThis.WheelEvent): void => {
      if (event.ctrlKey) event.preventDefault();
    };
    const wheelOptions: AddEventListenerOptions = { passive: false, capture: true };
    const gestureOptions: AddEventListenerOptions = { passive: false };
    window.addEventListener("wheel", preventCtrlWheelDefault, wheelOptions);
    window.addEventListener("gesturestart", preventCanvasPinchDefault, gestureOptions);
    window.addEventListener("gesturechange", preventCanvasPinchDefault, gestureOptions);
    window.addEventListener("gestureend", preventCanvasPinchDefault, gestureOptions);
    return () => {
      window.removeEventListener("wheel", preventCtrlWheelDefault, wheelOptions);
      window.removeEventListener("gesturestart", preventCanvasPinchDefault, gestureOptions);
      window.removeEventListener("gesturechange", preventCanvasPinchDefault, gestureOptions);
      window.removeEventListener("gestureend", preventCanvasPinchDefault, gestureOptions);
    };
  }, [canvasOpen]);

  useEffect(() => {
    if (!canvasOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isEditableTarget(event.target)) return;
      if (!spaceHeld) setSpaceHeld(true);
      event.preventDefault();
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasOpen, spaceHeld]);

  useEffect(() => {
    if (!canvasOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) {
        if (event.key === "Escape") {
          event.preventDefault();
          (event.target as HTMLElement).blur();
          annotations.focusMemo(null);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (handleBackgroundCleanupEscape()) return;
        void handleCloseCanvas();
        return;
      }
      if (
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        if (!isCreatingBlankCanvas && !event.repeat) void onCreateBlankCanvas();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (redoBackgroundCleanup()) return;
          annotations.redo();
          return;
        }
        if (undoBackgroundCleanup()) return;
        annotations.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    annotations,
    annotations.focusMemo,
    annotations.redo,
    annotations.undo,
    canvasOpen,
    handleCloseCanvas,
    handleBackgroundCleanupEscape,
    isCreatingBlankCanvas,
    onCreateBlankCanvas,
    redoBackgroundCleanup,
    undoBackgroundCleanup,
  ]);

  const handleViewerKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isEditableTarget(event.target)) {
      if (event.key === "Escape") {
        event.preventDefault();
        (event.target as HTMLElement).blur();
        annotations.focusMemo(null);
      }
      return;
    }

    if (canvasOpen && ["1", "2", "3", "4", "5", "6"].includes(event.key)) {
      event.preventDefault();
      const tools = ["select", "pen", "box", "arrow", "memo", "eraser"] as const;
      annotations.setTool(tools[Number(event.key) - 1]);
      return;
    }

    if (canvasOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (handleBackgroundCleanupEscape()) return;
      void handleCloseCanvas();
      return;
    }

    if (canvasOpen && event.key === "]") {
      event.preventDefault();
      setCanvasZoom(canvasZoom + 0.1);
      return;
    }

    if (canvasOpen && event.key === "[") {
      event.preventDefault();
      setCanvasZoom(canvasZoom - 0.1);
      return;
    }

    if (canvasOpen && event.key === "0") {
      event.preventDefault();
      resetCanvasZoom();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (!currentImage) return;
      if (event.target !== event.currentTarget) return;
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

  return { spaceHeld, handleViewerKeyDown };
}
