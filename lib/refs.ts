// lib/refs.js — reference-image validator (0.09.7).
// Extracted from server.js so unit tests can import without booting the app.

import { config } from "../config.js";

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const DATA_URL_RE = /^data:([^;,]+);base64,/i;

function approxBase64Bytes(b64: string) {
  try {
    return Buffer.from(b64, "base64").length;
  } catch {
    return Math.floor((b64.length * 3) / 4);
  }
}

export function detectImageMimeFromB64(b64: string | null | undefined) {
  if (!b64) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Identifies a video container from its leading bytes.
 *
 * ComfyUI reports a filename and a folder, never a trustworthy content type, so
 * the bytes are the only honest source: an HTML error page saved as .mp4 is the
 * exact failure this guards against.
 *
 * Returns the detected container even when ima2 cannot store it, so the caller
 * can say "this is WebM and we only keep MP4" instead of the useless "not a
 * video". Storage support is the caller's decision, not this function's.
 */
export function detectVideoMimeFromB64(b64: string | null | undefined) {
  if (!b64) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  // ISO base media (MP4/MOV): a size field, then 'ftyp' at offset 4.
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  // EBML header shared by WebM and Matroska.
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

export interface ReferenceDetail {
  index?: number;
  declaredMime?: string | null;
  detectedMime?: string | null;
  b64Chars?: number;
  approxBytes?: number | null;
  source?: string;
  warnings?: string[];
}

export function safeReferenceDiagnostics(refDetails: ReferenceDetail[] = []) {
  if (!Array.isArray(refDetails)) return [];
  return refDetails.map((ref) => ({
    index: ref.index,
    declaredMime: ref.declaredMime || null,
    detectedMime: ref.detectedMime || null,
    b64Chars: ref.b64Chars,
    approxBytes: ref.approxBytes,
    source: ref.source,
    warnings: ref.warnings || [],
  }));
}

export function summarizeReferencePayload(references: unknown) {
  if (!Array.isArray(references)) {
    return { refsCount: 0, referenceBytes: 0, referenceB64Chars: 0 };
  }
  let referenceBytes = 0;
  let referenceB64Chars = 0;
  for (const ref of references) {
    if (typeof ref !== "string") continue;
    const b64 = ref.replace(DATA_URL_RE, "");
    referenceB64Chars += b64.length;
    referenceBytes += approxBase64Bytes(b64);
  }
  return {
    refsCount: references.length,
    referenceBytes,
    referenceB64Chars,
  };
}

type RefDetail = {
  index: number;
  b64: string;
  declaredMime: string | null;
  detectedMime: string | null;
  b64Chars: number;
  approxBytes: number;
  source: string;
  warnings: string[];
};

type RefsValidationResult =
  | { error: string; code: string; refs?: undefined; refDetails?: undefined; referenceDiagnostics?: undefined }
  | { error?: undefined; code?: undefined; refs: string[]; refDetails: RefDetail[]; referenceDiagnostics: ReturnType<typeof safeReferenceDiagnostics> };

export function validateAndNormalizeRefs(references: unknown, {
  maxCount = config.limits.maxRefCount,
  maxB64Bytes = config.limits.maxRefB64Bytes,
} = {}): RefsValidationResult {
  if (!Array.isArray(references)) {
    return { error: "references must be an array", code: "REF_NOT_ARRAY" };
  }
  if (references.length > maxCount) {
    return { error: `references may not exceed ${maxCount} items`, code: "REF_TOO_MANY" };
  }
  const out: string[] = [];
  const refDetails: RefDetail[] = [];
  for (let i = 0; i < references.length; i++) {
    const r = references[i];
    if (typeof r !== "string") {
      return { error: `references[${i}] must be a string`, code: "REF_NOT_STRING" };
    }
    const dataUrlMatch = r.match(DATA_URL_RE);
    const declaredMime = dataUrlMatch?.[1]?.toLowerCase() || null;
    const b64 = r.replace(DATA_URL_RE, "");
    if (!b64) return { error: `references[${i}] is empty`, code: "REF_EMPTY" };
    if (b64.length > maxB64Bytes) {
      return { error: `references[${i}] exceeds ${maxB64Bytes} bytes`, code: "REF_TOO_LARGE" };
    }
    if (!BASE64_RE.test(b64)) {
      return { error: `references[${i}] is not valid base64`, code: "REF_NOT_BASE64" };
    }
    const detectedMime = detectImageMimeFromB64(b64);
    const warnings: string[] = [];
    if (declaredMime && detectedMime && declaredMime !== detectedMime) {
      warnings.push("mime_mismatch");
    }
    out.push(b64);
    refDetails.push({
      index: i,
      b64,
      declaredMime,
      detectedMime,
      b64Chars: b64.length,
      approxBytes: approxBase64Bytes(b64),
      source: declaredMime ? "dataUrl" : "rawBase64",
      warnings,
    });
  }
  return { refs: out, refDetails, referenceDiagnostics: safeReferenceDiagnostics(refDetails) };
}
