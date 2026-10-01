// What the composer can accept depends on the mode the user is in, and the rules are
// not obvious: video only reaches grok-imagine-video, while uploaded audio clips
// are not actionable in the composer because xAI gates that capability upstream.
//
// This module exists because three surfaces (PromptComposer, Canvas, ImageNode) each
// filtered dropped files with their own `type.startsWith("image/")` check. Every one of
// them dropped a non-image silently, so a user who dragged an mp3 saw nothing happen and
// had no way to tell a rejection from a broken drag.
//
// devlog/_plan/260908_xai_imagine_spec_resync/030_wp35_gui_inputs.md

export type DropRejection =
  | "not-media"
  | "audio-upload-unsupported"
  | "video-needs-base"
  | "video-single-only";

export interface SortedDrop {
  images: File[];
  videos: File[];
  rejected: Array<{ file: File; reason: DropRejection }>;
}

export interface DropContext {
  /** The selected video model id, or false when this is an image lane. */
  videoModelSelected: string | false;
}

const VIDEO_MODEL_BASE = "grok-imagine-video";

function isAudio(file: File): boolean {
  return file.type.startsWith("audio/");
}

function isVideo(file: File): boolean {
  // A .mp4 with an empty type happens on some platforms, and refusing it as "not media"
  // would be a worse answer than trying it: the route validates the real thing anyway.
  return file.type.startsWith("video/") || /\.mp4$/i.test(file.name);
}

/**
 * Sorts dropped files into the buckets the current mode can consume, and records a
 * reason for every file left out.
 *
 * The rejection reasons are a union rather than free text so the i18n files are forced
 * to carry a message for each one; a missing translation is then a type error instead of
 * a key string shown to the user.
 */
export function sortDroppedByKind(files: File[], context: DropContext): SortedDrop {
  const sorted: SortedDrop = { images: [], videos: [], rejected: [] };
  const model = context.videoModelSelected;
  const isBase = model === VIDEO_MODEL_BASE;

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      sorted.images.push(file);
      continue;
    }
    if (isAudio(file)) {
      // Uploaded clips appear to be supported by the 1.5 model spec, but xAI gates them
      // to trusted partner accounts. Do not accept them as attachments until the request
      // pipeline can actually consume them; point users to preset voices instead.
      sorted.rejected.push({ file, reason: "audio-upload-unsupported" });
      continue;
    }
    if (isVideo(file)) {
      // Editing and extending run on the base model; 1.5 answers 400 for both.
      if (!isBase) sorted.rejected.push({ file, reason: "video-needs-base" });
      // One source video per request: edits and extensions take a single input, and
      // silently using the first of several would hide which one was chosen.
      else if (sorted.videos.length > 0) sorted.rejected.push({ file, reason: "video-single-only" });
      else sorted.videos.push(file);
      continue;
    }
    sorted.rejected.push({ file, reason: "not-media" });
  }
  return sorted;
}

/**
 * The `accept` attribute for the file picker in the current mode.
 *
 * Kept in step with sortDroppedByKind so the picker cannot offer a file the drop handler
 * would then refuse.
 */
export function composerAcceptAttr(context: DropContext): string {
  const model = context.videoModelSelected;
  if (model === VIDEO_MODEL_BASE) return "image/*,video/mp4";
  return "image/*";
}

