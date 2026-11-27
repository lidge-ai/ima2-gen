import type { GenerateItem } from "../types";

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|flac)$/i;

export function isAudioUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  return AUDIO_EXT.test(src.split(/[?#]/, 1)[0] ?? "") || src.startsWith("data:audio/");
}

/** A result that is sound only: there is no picture to show, zoom, copy or use as a reference. */
export function isAudioItem(item: Pick<GenerateItem, "filename" | "url" | "image" | "mediaType"> | null | undefined): boolean {
  if (!item) return false;
  if (item.mediaType === "audio") return true;
  if (item.mediaType === "video" || item.mediaType === "image") return false;
  return isAudioUrl(item.filename) || isAudioUrl(item.url) || isAudioUrl(item.image);
}
