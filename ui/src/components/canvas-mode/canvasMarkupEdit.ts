import { postEdit } from "../../lib/api";
import { complexityRequestField, isImageToolModel } from "../../lib/imageModels";
import { blobToDataUrl } from "../../lib/canvas/maskRenderer";
import { renderMarkupLayer } from "../../lib/canvas/markupRenderer";
import { buildMemoEditInstructions } from "../../lib/canvas/memoPrompt";
import { useAppStore } from "../../store/useAppStore";
import type { GenerateItem } from "../../types";
import { loadCleanSourceDataUrl, responseToGenerateItem } from "./canvasModeHelpers";
import type { UseCanvasModeSessionArgs } from "./useCanvasModeSession";

type MarkupArgs = Pick<UseCanvasModeSessionArgs,
  "imageElementRef" | "currentImage" | "canvasDisplayImage" | "canvasSourceImageRef" |
  "lastCleanDataUrlRef" | "annotations" | "quality" | "format" | "moderation" | "provider" |
  "imageModel" | "reasoningEffort" | "promptMode" | "webSearchEnabled" | "getResolvedSize" |
  "setIsEditingWithMarkup" | "addGeneratedHistoryItem" | "showToast" | "t"
> & {
  imageToolModel: ReturnType<typeof useAppStore.getState>["imageToolModel"];
  complexity: ReturnType<typeof useAppStore.getState>["complexity"];
  saveCanvasVersionAndUseReference: () => Promise<GenerateItem | null>;
};

const markupErrors: Record<string, string> = {
  EDIT_MARKUP_UNSUPPORTED: "canvas.toolbar.editMarkupUnsupported",
  EDIT_MARKUP_WITH_MASK: "canvas.toolbar.editMarkupWithMask",
  EDIT_MARKUP_DIMENSION_MISMATCH: "canvas.toolbar.editMarkupDimensions",
  EDIT_MARKUP_NO_ALPHA: "canvas.toolbar.editMarkupTransparency",
  EDIT_MARKUP_NO_TRANSPARENCY: "canvas.toolbar.editMarkupTransparency",
  EDIT_MARKUP_TOO_LARGE: "canvas.toolbar.editMarkupTooLarge",
  INVALID_EDIT_MARKUP: "canvas.toolbar.editMarkupInvalid",
  INVALID_EDIT_MARKUP_PNG: "canvas.toolbar.editMarkupInvalid",
};

export async function editWithMarkup(a: MarkupArgs): Promise<void> {
  const imageElement = a.imageElementRef.current;
  const displayImage = a.canvasDisplayImage;
  if (!imageElement || !displayImage || !(a.annotations.paths.length || a.annotations.boxes.length)) return;
  if (a.provider !== "api" || !isImageToolModel(a.imageToolModel)) return;
  a.setIsEditingWithMarkup(true);
  try {
    const markup = await blobToDataUrl(await renderMarkupLayer({
      imageElement, paths: a.annotations.paths, boxes: a.annotations.boxes,
    }));
    const basePrompt = (displayImage.prompt ?? a.currentImage?.prompt ?? "").trim();
    const memoInstructions = buildMemoEditInstructions(a.annotations.memos);
    const prompt = [basePrompt, memoInstructions,
      "The marks are editing instructions and must not appear in the result."].filter(Boolean).join("\n\n");
    let image = a.lastCleanDataUrlRef.current;
    if (a.annotations.isDirty || a.annotations.hasAnnotations) {
      if (!await a.saveCanvasVersionAndUseReference()) return;
      image = a.lastCleanDataUrlRef.current;
    }
    if (!image) image = await loadCleanSourceDataUrl(a.canvasSourceImageRef.current ?? displayImage);
    const inheritedSize = displayImage.size ?? a.currentImage?.size ?? null;
    const size = inheritedSize && /^\d+x\d+$/.test(inheritedSize) ? inheritedSize : a.getResolvedSize();
    const response = await postEdit({
      image, markup, prompt, quality: a.quality, size, format: a.format, moderation: a.moderation,
      provider: a.provider, n: 1, model: a.imageModel, imageToolModel: a.imageToolModel,
      ...complexityRequestField(a.provider, a.imageToolModel, a.complexity),
      reasoningEffort: a.reasoningEffort, mode: a.promptMode, webSearchEnabled: a.webSearchEnabled,
    });
    await a.addGeneratedHistoryItem(responseToGenerateItem(response, prompt));
  } catch (error) {
    const code = (error as { code?: string })?.code;
    a.showToast(a.t(code && markupErrors[code] || "canvas.toolbar.editMarkupFailed"), true);
  } finally {
    a.setIsEditingWithMarkup(false);
  }
}
