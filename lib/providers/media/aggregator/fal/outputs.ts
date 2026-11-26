/**
 * Reads fal result bodies. Output keys are model-specific ("video", "images",
 * "audio_file"), so this collects every top-level File object ({ url,
 * content_type }) and URL list, skipping auxiliary frames.
 */
import type { MediaKind, MediaOutput } from "../../contract.js";
import { asRecord, asString } from "../shared/http.js";
import { defaultMime, kindFromMime, mimeFromUrl } from "../shared/inputs.js";

/** Secondary artifacts a model may return next to the requested output. */
const AUXILIARY_KEYS = new Set(["last_frame", "first_frame", "thumbnail", "thumbnail_url", "poster", "preview", "seed", "timings"]);

function fileFrom(value: unknown, keyHint: string): { url: string; contentType?: string } | undefined {
  if (typeof value === "string") {
    return /^https?:\/\//.test(value) && /url|video|image|audio|file/.test(keyHint) ? { url: value } : undefined;
  }
  const record = asRecord(value);
  const url = asString(record.url);
  if (!url) return undefined;
  const contentType = asString(record.content_type);
  return contentType ? { url, contentType } : { url };
}

export function extractFalOutputs(body: unknown, kind: MediaKind): MediaOutput[] {
  const outputs: MediaOutput[] = [];
  for (const [key, value] of Object.entries(asRecord(body))) {
    if (AUXILIARY_KEYS.has(key)) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const file = fileFrom(item, key);
      if (!file) continue;
      const mimeType = file.contentType ?? mimeFromUrl(file.url, defaultMime(kind));
      outputs.push({ kind: kindFromMime(mimeType, kind), url: file.url, mimeType });
    }
  }
  return outputs;
}
