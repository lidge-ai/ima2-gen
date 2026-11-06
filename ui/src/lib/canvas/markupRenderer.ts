import type { BoundingBox, DrawingPath } from "../../types/canvas";
import { renderAnnotationPath, renderBoundingBox } from "./annotationRenderer";

export async function renderMarkupLayer(input: {
  imageElement: HTMLImageElement;
  paths: DrawingPath[];
  boxes: BoundingBox[];
}): Promise<Blob> {
  const { naturalWidth: width, naturalHeight: height } = input.imageElement;
  if (!width || !height) throw new Error("markup_source_size_unavailable");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("markup_context_unavailable");
  const size = { width, height };
  for (const path of input.paths) renderAnnotationPath(ctx, path, size);
  for (const box of input.boxes) renderBoundingBox(ctx, box, size, "committed");
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("markup_blob_unavailable")), "image/png");
  });
}
