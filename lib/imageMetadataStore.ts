import { thrownFields, type CodedError } from "./errInfo.js";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { buildIma2MetadataPayload, buildIma2Xmp, parseIma2Xmp, type MetadataContext } from "./imageMetadata.js";

const SUPPORTED_FORMATS = new Set(["png", "jpeg", "jpg", "webp"]);

export function normalizeImageMetadataFormat(format: unknown) {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return normalized;
}

export function isSupportedMetadataFormat(format: unknown) {
  return SUPPORTED_FORMATS.has(String(format || "").toLowerCase());
}

type MetadataFormat = "png" | "jpeg" | "webp";

function isMetadataFormat(format: string): format is MetadataFormat {
  return format === "png" || format === "jpeg" || format === "webp";
}

export interface MetadataEmbedResult {
  buffer: Buffer;
  embedded: boolean;
  metadata?: ReturnType<typeof buildIma2MetadataPayload>;
  warning?: unknown;
  code?: unknown;
}

export async function embedImageMetadata(buffer: Buffer, format: unknown, metadata: unknown, context: MetadataContext = {}): Promise<MetadataEmbedResult> {
  const normalizedFormat = normalizeImageMetadataFormat(format);
  if (!isMetadataFormat(normalizedFormat)) {
    const err: CodedError = new Error(`Unsupported image metadata format: ${format}`);
    err.code = "IMAGE_METADATA_UNSUPPORTED_FORMAT";
    throw err;
  }
  const payload = buildIma2MetadataPayload(metadata, context);
  const xmp = buildIma2Xmp(payload);
  const next = await sharp(buffer)
    .toFormat(normalizedFormat)
    .withXmp(xmp)
    .toBuffer();
  return { buffer: next, embedded: true, metadata: payload };
}

export async function embedImageMetadataBestEffort(buffer: Buffer, format: unknown, metadata: unknown, context: MetadataContext = {}): Promise<MetadataEmbedResult> {
  try {
    return await embedImageMetadata(buffer, format, metadata, context);
  } catch (error: unknown) {
    const errorFields = thrownFields(error);
    return {
      buffer,
      embedded: false,
      warning: errorFields.message || "metadata embedding failed",
      code: errorFields.code || "IMAGE_METADATA_EMBED_FAILED",
    };
  }
}

export async function readEmbeddedImageMetadata(buffer: Buffer) {
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const xmpString = meta.xmpAsString || (meta.xmp ? meta.xmp.toString("utf8") : "");
  const xmp = parseIma2Xmp(xmpString);
  if (xmp) return { metadata: xmp, source: "xmp", warnings: [] };

  for (const comment of meta.comments || []) {
    const text = comment?.text || "";
    const parsed = parseIma2Xmp(text);
    if (parsed) return { metadata: parsed, source: "png-comment", warnings: [] };
  }

  return {
    metadata: null,
    source: null,
    warnings: ["No ima2 metadata found in this image."],
  };
}

export async function readEmbeddedImageMetadataFromFile(path: string) {
  return readEmbeddedImageMetadata(await readFile(path));
}
