import { useCallback, useState, type DragEvent } from "react";
import { useAppStore } from "../../store/useAppStore";

export function useCanvasImageDrop() {
  const importLocalImageToHistory = useAppStore((s) => s.importLocalImageToHistory);
  const [dropActive, setDropActive] = useState(false);
  const handleCenterDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDropActive((prev) => (prev ? prev : true));
  }, []);
  const handleCenterDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropActive(false);
  }, []);
  const handleCenterDrop = useCallback(async (e: DragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (files.length === 0) return;
    await importLocalImageToHistory(files[0]);
  }, [importLocalImageToHistory]);
  return { dropActive, handleCenterDragOver, handleCenterDragLeave, handleCenterDrop };
}
