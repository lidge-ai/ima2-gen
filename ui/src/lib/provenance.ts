import { getImageModelShortLabel } from "./imageModels";
import type { VideoContinuityLineage } from "../types";

/** How a result came to exist, as far as the UI can tell from stored metadata. */
export type ProvenanceDerivation = "t2i" | "i2i" | "t2v" | "i2v" | "v2v";

export type ProvenanceView = {
  modelLabel: string | null;
  derivation: ProvenanceDerivation | null;
  /** Source asset filename, when the result was derived from another one. */
  sourceLabel: string | null;
};

export type ProvenanceInput = {
  model?: string | null;
  provider?: string | null;
  mediaType?: string | null;
  videoContinuity?: VideoContinuityLineage | null;
  canvasSourceFilename?: string | null;
  sourceImageFilename?: string | null;
};

function deriveKind(item: ProvenanceInput): ProvenanceDerivation | null {
  const isVideo = item.mediaType === "video";
  if (isVideo) {
    // A continuity lineage means this clip continues an earlier one; a plain source
    // image means it was animated from a still.
    if (item.videoContinuity?.parentFilename) return "v2v";
    if (item.sourceImageFilename) return "i2v";
    return "t2v";
  }
  if (item.canvasSourceFilename || item.sourceImageFilename) return "i2i";
  return item.model ? "t2i" : null;
}

function sourceOf(item: ProvenanceInput): string | null {
  return (
    item.videoContinuity?.parentFilename
    ?? item.canvasSourceFilename
    ?? item.sourceImageFilename
    ?? null
  );
}

/**
 * Collapse stored generation metadata into the few facts a chip can show.
 *
 * Deliberately narrow: the full continuity chain belongs in the metadata modal, not on
 * a thumbnail. Provider is folded into the model label rather than shown separately —
 * "GPT-6 Luna · openai" says the same thing twice.
 */
export function buildProvenanceView(item: ProvenanceInput): ProvenanceView {
  return {
    modelLabel: getImageModelShortLabel(item.model, item.provider),
    derivation: deriveKind(item),
    sourceLabel: sourceOf(item),
  };
}

/** True when there is nothing worth rendering, so callers can skip the chip entirely. */
export function isEmptyProvenance(view: ProvenanceView): boolean {
  return !view.modelLabel && !view.derivation;
}
