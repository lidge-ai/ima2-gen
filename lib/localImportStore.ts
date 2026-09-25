import type { CodedError } from "./errInfo.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { mkdir, writeFile } from "fs/promises";
import { basename, join, normalize } from "path";
import { randomBytes } from "crypto";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const JPEG_SIGNATURE_HEX = "ffd8ff";
const WEBP_RIFF_HEAD = "52494646";
const WEBP_VP_TAIL = "57454250";

function detectFormat(buffer: Buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const head8 = buffer.subarray(0, 8).toString("hex");
  if (head8 === PNG_SIGNATURE_HEX) return "png";
  if (head8.startsWith(JPEG_SIGNATURE_HEX)) return "jpeg";
  if (
    buffer.subarray(0, 4).toString("hex") === WEBP_RIFF_HEAD &&
    buffer.subarray(8, 12).toString("hex") === WEBP_VP_TAIL
  ) {
    return "webp";
  }
  return null;
}

function ensureInsideGeneratedDir(generatedDir: string, filename: string) {
  const full = normalize(join(generatedDir, filename));
  const root = normalize(generatedDir);
  if (!full.startsWith(root)) {
    const err: CodedError = new Error("Imported path escapes generated directory");
    err.status = 400;
    err.code = "IMPORT_PATH_ESCAPE";
    throw err;
  }
  return full;
}

function makeImportedFilename(format: string) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const rand = randomBytes(3).toString("hex");
  return `imported-${stamp}-${rand}.${format}`;
}

function safeOriginalName(input: unknown) {
  if (typeof input !== "string" || !input) return null;
  const trimmed = input.slice(0, 200);
  return basename(trimmed);
}

export async function createLocalImport(ctx: RuntimeContext, { buffer, originalFilename }: { buffer: Buffer; originalFilename?: string | null }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err: CodedError = new Error("Image body is required");
    err.status = 400;
    err.code = "EMPTY_IMPORT";
    throw err;
  }
  const format = detectFormat(buffer);
  if (!format) {
    const err: CodedError = new Error("Only PNG, JPEG, or WebP is supported");
    err.status = 400;
    err.code = "IMPORT_BAD_FORMAT";
    throw err;
  }
  const filename = makeImportedFilename(format);
  const fullPath = ensureInsideGeneratedDir(ctx.config.storage.generatedDir, filename);
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });

  const meta = {
    schema: "ima2.generation.v1",
    app: "ima2-gen",
    version: ctx.packageVersion,
    createdAt: Date.now(),
    kind: "imported",
    canvasVersion: false,
    originalFilename: safeOriginalName(originalFilename),
    format,
  };
  const embedded = await embedImageMetadataBestEffort(buffer, format, meta, {
    version: ctx.packageVersion,
  });
  await writeFile(fullPath, embedded.buffer);
  await writeFile(`${fullPath}.json`, JSON.stringify(meta)).catch(() => {});
  invalidateHistoryIndex();

  const url = `/generated/${encodeURIComponent(filename)}`;
  return {
    filename,
    url,
    image: url,
    thumb: url,
    createdAt: meta.createdAt,
    format,
    kind: "imported",
    canvasVersion: false,
    canvasSourceFilename: null,
    canvasEditableFilename: null,
    prompt: null,
    userPrompt: null,
    revisedPrompt: null,
    promptMode: null,
    quality: null,
    size: null,
    model: null,
    provider: null,
    usage: null,
    webSearchCalls: 0,
    sessionId: null,
    nodeId: null,
    parentNodeId: null,
    refsCount: 0,
    isFavorite: false,
  };
}
