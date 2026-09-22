import { useCallback, type RefObject } from "react";
import {
  createCanvasVersion,
  deleteCanvasAnnotations,
  postEdit,
  recordCanvasAnnotationBake,
  revertCanvasAnnotations,
  saveCanvasAnnotations,
  updateCanvasVersion,
} from "../../lib/api";
import { renderMergedCanvasImage } from "../../lib/canvas/mergeRenderer";
import {
  blobToDataUrl,
  renderMaskFromBoxes,
} from "../../lib/canvas/maskRenderer";
import { buildMemoEditInstructions } from "../../lib/canvas/memoPrompt";
import {
  downloadCanvasBlob,
  exportCanvasAs,
  exportCanvasImage,
  makeCanvasExportFilename,
  type CanvasExportFormat,
} from "../../lib/canvas/exportRenderer";
import { objectKeyMatches } from "../../lib/canvas/objectKeys";
import { useAppStore } from "../../store/useAppStore";
import type { Format, GenerateItem, ImageModel, Moderation, Provider, Quality } from "../../types";
import type { ReasoningEffort } from "../../lib/reasoning";
import {
  loadCleanSourceDataUrl,
  responseToGenerateItem,
  withSourcePrompt,
} from "./canvasModeHelpers";

interface UseCanvasModeSessionArgs {
  imageElementRef: RefObject<HTMLImageElement | null>;
  currentImage: GenerateItem | null;
  canvasDisplayImage: GenerateItem | null;
  canvasSourceImageRef: RefObject<GenerateItem | null>;
  lastMergedDataUrlRef: RefObject<string | null>;
  lastCleanDataUrlRef: RefObject<string | null>;
  canvasVersionItem: GenerateItem | null;
  annotations: any;
  exportBackground: string;
  exportMatteColor: string;
  quality: Quality;
  format: Format;
  moderation: Moderation;
  provider: Provider;
  imageModel: ImageModel;
  reasoningEffort: ReasoningEffort;
  promptMode: "auto" | "direct";
  webSearchEnabled: boolean;
  getResolvedSize: () => string;
  setCanvasVersionItem: (item: GenerateItem | null) => void;
  setCanvasSaveState: (state: "idle" | "saving" | "saved" | "error") => void;
  setIsApplying: (value: boolean) => void;
  setIsExporting: (value: boolean) => void;
  setIsEditingWithMask: (value: boolean) => void;
  setIsTransparencyRunning: (value: boolean) => void;
  applyMergedCanvasImage: (item: GenerateItem) => void;
  addGeneratedHistoryItem: (item: GenerateItem) => Promise<void> | void;
  attachCanvasVersionReference: (item: GenerateItem, overrideSource?: string) => Promise<void>;
  closeCanvas: () => void;
  resetCanvasSession: () => void;
  showToast: (message: string, error?: boolean) => void;
  t: (key: string) => string;
}

export function useCanvasModeSession({
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
}: UseCanvasModeSessionArgs) {
  const imageToolModel = useAppStore((s) => s.imageToolModel);
  const saveCanvasVersionAndUseReference = useCallback(async (): Promise<GenerateItem | null> => {
    if (!imageElementRef.current || !currentImage) return null;
    const source = canvasSourceImageRef.current ?? currentImage;
    if (!source?.filename) {
      showToast(t("canvas.version.failed"), true);
      return null;
    }
    setIsApplying(true);
    setCanvasSaveState("saving");
    try {
      const merged = await renderMergedCanvasImage({
        imageElement: imageElementRef.current,
        paths: annotations.paths,
        boxes: annotations.boxes,
        memos: annotations.memos,
      });
      lastMergedDataUrlRef.current = merged.dataUrl;
      const cleanDataUrl = await loadCleanSourceDataUrl(source);
      lastCleanDataUrlRef.current = cleanDataUrl;
      const result = canvasVersionItem?.filename
        ? await updateCanvasVersion(canvasVersionItem.filename, {
            image: merged.blob,
            sourceFilename: source.canvasSourceFilename ?? source.filename,
            prompt: source.prompt,
          })
        : await createCanvasVersion({
            sourceFilename: source.filename,
            image: merged.blob,
            prompt: source.prompt,
          });
      const snapshot = annotations.toPayload();
      const annotationOnlyAtBake = !canvasVersionItem || Boolean(canvasVersionItem.annotationOnly);
      const bakedResult = await recordCanvasAnnotationBake(
        result.item.filename!,
        snapshot,
        annotationOnlyAtBake,
      );
      const savedItem = withSourcePrompt(bakedResult.item, source);
      setCanvasVersionItem(savedItem);
      applyMergedCanvasImage(savedItem);
      await attachCanvasVersionReference(savedItem, cleanDataUrl);
      // Annotations reach the model as text instructions, never as pixels:
      // surface the memo instructions as a removable composer chip so the
      // next generation carries the annotation intent alongside the clean
      // reference image.
      const memoInstructions = buildMemoEditInstructions(annotations.memos);
      const chipId = `canvas-annotations:${source.canvasSourceFilename ?? source.filename}`;
      const { insertPromptToComposer, removeInsertedPromptFromComposer } = useAppStore.getState();
      removeInsertedPromptFromComposer(chipId);
      if (memoInstructions) {
        insertPromptToComposer({
          id: chipId,
          name: t("canvas.annotationInstructionsChip"),
          text: memoInstructions,
          placement: "after",
        });
      }
      await deleteCanvasAnnotations(source.filename).catch(() => {});
      annotations.resetLocal();
      annotations.markSaved();
      setCanvasSaveState("saved");
      showToast(t("canvas.version.saved"));
      return savedItem;
    } catch {
      setCanvasSaveState("error");
      showToast(t("canvas.version.failed"), true);
      return null;
    } finally {
      setIsApplying(false);
    }
  }, [
    annotations,
    applyMergedCanvasImage,
    attachCanvasVersionReference,
    canvasSourceImageRef,
    canvasVersionItem?.filename,
    currentImage,
    imageElementRef,
    lastMergedDataUrlRef,
    lastCleanDataUrlRef,
    setCanvasSaveState,
    setCanvasVersionItem,
    setIsApplying,
    showToast,
    t,
  ]);

  const handleApplyCanvas = async (): Promise<void> => {
    await saveCanvasVersionAndUseReference();
  };

  const handleRevertAnnotations = async (): Promise<void> => {
    if (!canvasVersionItem?.filename || !canvasVersionItem.annotationsBaked) return;
    if (!canvasVersionItem.annotationOnly && !window.confirm(t("canvas.revert.mixedConfirm"))) return;
    setIsApplying(true);
    setCanvasSaveState("saving");
    try {
      const result = await revertCanvasAnnotations(canvasVersionItem.filename);
      const source = canvasSourceImageRef.current ?? currentImage ?? canvasVersionItem;
      const revertedItem = withSourcePrompt(result.item, source);
      setCanvasVersionItem(revertedItem);
      applyMergedCanvasImage(revertedItem);
      lastMergedDataUrlRef.current = null;
      if (result.annotationOnly && result.snapshot) {
        annotations.load(result.snapshot);
        const sourceFilename = revertedItem.canvasSourceFilename ?? source.filename;
        if (sourceFilename) await saveCanvasAnnotations(sourceFilename, result.snapshot);
        showToast(t("canvas.revert.restored"));
      } else {
        annotations.resetLocal();
        showToast(t("canvas.revert.completed"));
      }
      setCanvasSaveState("saved");
    } catch {
      setCanvasSaveState("error");
      showToast(t("canvas.revert.failed"), true);
    } finally {
      setIsApplying(false);
    }
  };

  const handleCloseCanvas = async (): Promise<void> => {
    if (annotations.hasAnnotations || annotations.isDirty) {
      const saved = await saveCanvasVersionAndUseReference();
      if (!saved) return;
    }
    closeCanvas();
    resetCanvasSession();
  };

  const handleExportCanvas = async (format: CanvasExportFormat = "png"): Promise<void> => {
    if (!imageElementRef.current || !currentImage) return;
    setIsExporting(true);
    try {
      const matte = exportBackground === "matte";
      const blob = await exportCanvasAs(
        format,
        {
          imageElement: imageElementRef.current,
          paths: annotations.paths,
          boxes: annotations.boxes,
          memos: annotations.memos,
          background: matte
            ? { mode: "matte", color: exportMatteColor }
            : { mode: "alpha" },
        },
        { paths: annotations.paths, boxes: annotations.boxes, memos: annotations.memos },
      );
      downloadCanvasBlob(blob, makeCanvasExportFilename({ matte, format }));
    } catch {
      showToast(t("canvas.toolbar.exportFailed"), true);
    } finally {
      setIsExporting(false);
    }
  };

  const handleTraceCanvas = async (): Promise<void> => {
    if (!imageElementRef.current || !currentImage?.filename) return;
    setIsExporting(true);
    try {
      const matte = exportBackground === "matte";
      const blob = await exportCanvasImage({
        imageElement: imageElementRef.current,
        paths: annotations.paths,
        boxes: annotations.boxes,
        memos: annotations.memos,
        background: matte
          ? { mode: "matte", color: exportMatteColor }
          : { mode: "alpha" },
      });
      const { item: target } = await createCanvasVersion({
        sourceFilename: canvasSourceImageRef.current?.filename ?? currentImage.filename,
        image: blob,
        prompt: currentImage.prompt,
      });
      useAppStore.getState().setVectorizeTarget(target);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t("canvas.toolbar.tracePrepareFailed");
      showToast(message, true);
    } finally {
      setIsExporting(false);
    }
  };

  const handleEditWithMask = async (): Promise<void> => {
    if (!imageElementRef.current || !canvasDisplayImage || annotations.boxes.length === 0) return;
    setIsEditingWithMask(true);
    try {
      const memosForPrompt = annotations.memos;
      let editImage = lastCleanDataUrlRef.current;
      // The NovelAI lane is text-to-image only and answers NAI_EDIT_UNSUPPORTED,
      // so fail here with an explanation rather than after a round trip.
      if (provider === "nai") {
        showToast(t("toast.naiEditUnsupported"), true);
        return;
      }
      if (annotations.isDirty || annotations.hasAnnotations) {
        const saved = await saveCanvasVersionAndUseReference();
        if (!saved) return;
        editImage = lastCleanDataUrlRef.current;
      }
      if (!editImage) {
        editImage = await loadCleanSourceDataUrl(canvasSourceImageRef.current ?? canvasDisplayImage);
      }
      const selectedBoxes = annotations.boxes.filter((box: { id: string }) =>
        annotations.selectedIds.some((id: string) => objectKeyMatches(id, "box", box.id)),
      );
      const maskBlob = await renderMaskFromBoxes({
        imageElement: imageElementRef.current,
        boxes: selectedBoxes.length > 0 ? selectedBoxes : annotations.boxes,
      });
      const memoInstructions = buildMemoEditInstructions(memosForPrompt);
      const basePrompt = (canvasDisplayImage.prompt ?? currentImage?.prompt ?? "").trim();
      const prompt = [basePrompt, memoInstructions].filter(Boolean).join("\n\n");
      if (!prompt.trim()) {
        showToast(t("toast.noPromptToFork"), true);
        return;
      }
      const inheritedSize = canvasDisplayImage.size ?? currentImage?.size ?? null;
      const editSize = inheritedSize && /^\d+x\d+$/.test(inheritedSize) ? inheritedSize : getResolvedSize();
      const response = await postEdit({
        image: editImage,
        mask: await blobToDataUrl(maskBlob),
        prompt,
        quality,
        size: editSize,
        format,
        moderation,
        provider,
        n: 1,
        model: imageModel,
        ...(provider === "api" && imageToolModel ? { imageToolModel } : {}),
        reasoningEffort,
        mode: promptMode,
        webSearchEnabled,
      });
      await addGeneratedHistoryItem(responseToGenerateItem(response, prompt));
    } catch (err) {
      const code = (err as { code?: string }).code;
      showToast(
        code === "EDIT_MASK_NOT_SUPPORTED"
          ? t("canvas.toolbar.editMaskUnsupported")
          : t("canvas.toolbar.editMaskFailed"),
        true,
      );
    } finally {
      setIsEditingWithMask(false);
    }
  };

  /**
   * One-click GPT i2i background transparency. Uses the validated prompt-nudge
   * path (forced background:"transparent" is rejected by the OAuth
   * gpt-image-2-codex variant with 400; "auto" + explicit instructions works —
   * devlog 260821 probe). The server verifies real pixel alpha on the result
   * and reports it as alphaVerified.
   */
  const handleGptTransparency = async (): Promise<void> => {
    if (!canvasDisplayImage && !currentImage) return;
    setIsTransparencyRunning(true);
    try {
      // Always derive from the image the user is actually looking at.
      // lastCleanDataUrlRef can go stale after a canvas apply (it is only
      // written by saveCanvasVersionAndUseReference), so never trust it here.
      const editImage = await loadCleanSourceDataUrl(
        canvasDisplayImage ?? canvasSourceImageRef.current ?? currentImage!,
      );
      const inheritedSize = canvasDisplayImage?.size ?? currentImage?.size ?? null;
      const editSize = inheritedSize && /^\d+x\d+$/.test(inheritedSize) ? inheritedSize : getResolvedSize();
      // Always route through the OAuth lane; the workspace provider/model may
      // be a non-GPT lane (Grok, Gemini...), so never forward its model id.
      const response = await postEdit({
        image: editImage,
        prompt:
          "Remove the background completely. Output a PNG with a fully transparent background (real alpha channel). Keep the subject pixel-identical — do not redraw, restyle, or crop the subject.",
        quality: "high",
        size: editSize,
        format,
        moderation,
        provider: "oauth" as Provider,
        n: 1,
        mode: "direct",
        webSearchEnabled: false,
      });
      const item = responseToGenerateItem(
        response,
        canvasDisplayImage?.prompt ?? currentImage?.prompt ?? "transparent background",
      );
      await addGeneratedHistoryItem(item);
      showToast(
        item.alphaVerified
          ? t("canvas.toolbar.transparencyVerified")
          : item.alphaReason === "undetectable"
            ? t("canvas.toolbar.transparencyUnverifiable")
            : t("canvas.toolbar.transparencyNoAlpha"),
        !item.alphaVerified,
      );
    } catch (err) {
      console.error("[canvas] gpt transparency failed", err);
      const code = (err as { code?: string }).code;
      showToast(
        code
          ? `${t("canvas.toolbar.transparencyFailed")} (${code})`
          : t("canvas.toolbar.transparencyFailed"),
        true,
      );
    } finally {
      setIsTransparencyRunning(false);
    }
  };

  return {
    saveCanvasVersionAndUseReference,
    handleApplyCanvas,
    handleRevertAnnotations,
    handleCloseCanvas,
    handleExportCanvas,
    handleTraceCanvas,
    handleEditWithMask,
    handleGptTransparency,
  };
}
