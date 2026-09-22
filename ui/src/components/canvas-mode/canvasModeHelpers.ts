import type { GenerateItem, GenerateResponse } from "../../types";
import { isMultiResponse } from "../../types";
import { imageElementToPngDataUrl } from "../../lib/canvas/maskRenderer";

export const OBJECT_ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='8' fill='white' fill-opacity='0.16' stroke='black' stroke-width='3'/%3E%3Ccircle cx='14' cy='14' r='8' fill='none' stroke='white' stroke-width='1.5'/%3E%3Ccircle cx='14' cy='14' r='2' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E\") 14 14, auto";

export const BRUSH_ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='8' fill='white' fill-opacity='0.18' stroke='black' stroke-width='3'/%3E%3Ccircle cx='14' cy='14' r='8' fill='none' stroke='white' stroke-width='1.5'/%3E%3C/svg%3E\") 14 14, auto";

export function formatQualityAlias(quality: string | null | undefined): string | null {
  if (quality === "low") return "l";
  if (quality === "medium") return "m";
  if (quality === "high") return "h";
  return quality ?? null;
}

export function formatSizeAlias(size: string | null | undefined): string | null {
  if (!size) return null;
  const square = size.match(/^(\d+)x\1$/);
  if (square) return `${square[1]}²`;
  return size.replace("x", "×");
}

export function getCanvasDisplaySrc(image: GenerateItem): string {
  const src = image.url ?? image.image;
  if (!image.canvasVersion || !image.canvasMergedAt || src.startsWith("data:")) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}canvasMergedAt=${image.canvasMergedAt}`;
}

export function resolveCleanSourceUrl(source: GenerateItem): string {
  const filename = source.canvasSourceFilename ?? source.filename;
  if (filename) return `/generated/${encodeURIComponent(filename)}`;
  return source.url ?? source.image;
}

export async function loadCleanSourceDataUrl(source: GenerateItem): Promise<string> {
  const url = resolveCleanSourceUrl(source);
  if (url.startsWith("data:image/png;")) return url;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("clean_source_load_failed"));
    image.src = url;
  });
  return imageElementToPngDataUrl(image);
}

export function withSourcePrompt(item: GenerateItem, source: GenerateItem | null): GenerateItem {
  if (!item.canvasVersion || item.prompt || !source?.prompt) return item;
  return { ...item, prompt: source.prompt };
}

export function findCanvasVersionForSource(
  history: GenerateItem[],
  source: GenerateItem | null,
): GenerateItem | null {
  if (!source?.filename) return null;
  const match = history.find((item) =>
    item.canvasVersion &&
    (item.canvasSourceFilename === source.filename || item.canvasEditableFilename === source.filename)
  ) ?? null;
  return match ? withSourcePrompt(match, source) : null;
}

export function responseToGenerateItem(response: GenerateResponse, prompt: string): GenerateItem {
  if (isMultiResponse(response)) {
    const first = response.images[0];
    if (!first) throw new Error("edit_empty_response");
    return {
      ...first,
      prompt,
      reasoningEffort: response.reasoningEffort,
      provider: response.provider,
      quality: response.quality,
      size: response.size,
      moderation: response.moderation,
      model: response.model,
      imageToolModel: response.imageToolModel,
      usage: response.usage,
      alphaVerified: (response as { alphaVerified?: boolean }).alphaVerified,
      alphaReason: (response as { alphaReason?: GenerateItem["alphaReason"] }).alphaReason,
      kind: "edit",
      createdAt: Date.now(),
    };
  }
  return {
    image: response.image,
    url: response.filename ? `/generated/${response.filename}` : response.image,
    thumb: response.image,
    filename: response.filename,
    prompt,
    elapsed: response.elapsed,
    reasoningEffort: response.reasoningEffort,
    provider: response.provider,
    quality: response.quality,
    size: response.size,
    moderation: response.moderation,
    model: response.model,
    imageToolModel: response.imageToolModel,
    usage: response.usage,
    revisedPrompt: response.revisedPrompt ?? null,
    promptMode: response.promptMode ?? null,
    alphaVerified: response.alphaVerified,
    alphaReason: response.alphaReason,
    kind: "edit",
    createdAt: Date.now(),
  };
}
