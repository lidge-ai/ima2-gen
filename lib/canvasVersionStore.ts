import type { CodedError } from "./errInfo.js";
import { mkdir, writeFile, readFile, lstat, realpath } from "fs/promises";
import { basename, dirname, resolve, parse, sep } from "path";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import type { RuntimeContext } from "./runtimeContext.js";

interface CanvasMeta {
  kind: string;
  provider: string;
  format: string;
  prompt: string | null | undefined;
  userPrompt: string | null | undefined;
  promptMode: string;
  createdAt: number;
  canvasMergedAt: number;
  canvasVersion: boolean;
  canvasSourceFilename: string | null;
  canvasEditableFilename: string;
  annotationsBaked?: boolean;
  annotationSnapshot?: CanvasAnnotationSnapshot | null;
  annotationOnly?: boolean;
  size?: string | null;
  quality?: string | null;
  model?: string | null;
  moderation?: string | null;
  revisedPrompt?: string | null;
}

interface StoredGeneratedMeta {
  prompt?: string | null;
  userPrompt?: string | null;
  promptMode?: string | null;
  provider?: string | null;
  quality?: string | null;
  size?: string | null;
  model?: string | null;
  moderation?: string | null;
  createdAt?: number;
  canvasMergedAt?: number;
  canvasSourceFilename?: string | null;
  annotationsBaked?: boolean;
  annotationSnapshot?: CanvasAnnotationSnapshot | null;
  annotationOnly?: boolean;
}

interface CanvasAnnotationSnapshot {
  paths: unknown[];
  boxes: unknown[];
  memos: unknown[];
}

interface CanvasInput {
  buffer: unknown;
  sourceFilename?: string | null;
  prompt?: string | null;
  pixelEdited?: boolean;
}

const PNG_SIGNATURE = "89504e470d0a1a0a";

function assertPngBuffer(buffer: unknown): asserts buffer is Buffer {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err: CodedError = new Error("PNG body is required");
    err.status = 400;
    err.code = "EMPTY_CANVAS_VERSION";
    throw err;
  }
  if (buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    const err: CodedError = new Error("Canvas version body must be a PNG image");
    err.status = 400;
    err.code = "CANVAS_VERSION_NOT_PNG";
    throw err;
  }
}

function assertSafeFilename(filename: string) {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename !== basename(filename) ||
    filename.includes("..") ||
    !/^canvas-[a-zA-Z0-9._-]+\.png$/.test(filename)
  ) {
    const err: CodedError = new Error("Invalid canvas version filename");
    err.status = 400;
    err.code = "INVALID_CANVAS_VERSION_FILENAME";
    throw err;
  }
}

function safeSourceBase(sourceFilename: string | null | undefined) {
  const parsed = parse(basename(String(sourceFilename || "image")));
  const safe = parsed.name.replace(/[^a-zA-Z0-9_-]+/g, "-");
  let start = 0;
  let end = safe.length;
  while (start < end && safe[start] === "-") start++;
  while (end > start && safe[end - 1] === "-") end--;
  return safe.slice(start, Math.min(end, start + 80)) || "image";
}

function ensureInsideGeneratedDir(generatedDir: string, filename: string) {
  const full = resolve(generatedDir, filename);
  const root = resolve(generatedDir);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (full === root || !full.startsWith(prefix)) {
    const err: CodedError = new Error("Canvas version path escapes generated directory");
    err.status = 400;
    err.code = "CANVAS_VERSION_PATH_ESCAPE";
    throw err;
  }
  return full;
}

/** Existing leaves must be regular files; only a new output leaf may be absent. */
async function checkedCanvasPath(generatedDir: string, filename: string, allowMissing = false) {
  const lexical = ensureInsideGeneratedDir(generatedDir, filename);
  const root = await realpath(generatedDir);
  const parent = await realpath(dirname(lexical));
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (parent !== root && !parent.startsWith(prefix)) {
    throw Object.assign(new Error("Canvas path escapes generated directory"), { status: 400, code: "CANVAS_VERSION_PATH_ESCAPE" });
  }
  const full = resolve(parent, basename(lexical));
  try {
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw Object.assign(new Error("Canvas path must be a regular file"), { status: 400, code: "CANVAS_VERSION_PATH_ESCAPE" });
    }
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return full;
}

function makeCanvasFilename(sourceFilename: string | null | undefined) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const rand = randomBytes(3).toString("hex");
  return `canvas-${safeSourceBase(sourceFilename)}-${stamp}-${rand}.png`;
}

async function writeCanvasPng(ctx: RuntimeContext, filename: string, buffer: Buffer, meta: CanvasMeta) {
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const full = await checkedCanvasPath(ctx.config.storage.generatedDir, filename, true);
  const sidecar = await checkedCanvasPath(ctx.config.storage.generatedDir, `${filename}.json`, true);
  const embedded = await embedImageMetadataBestEffort(buffer, "png", meta, {
    version: ctx.packageVersion,
  });
  await writeFile(full, embedded.buffer);
  await writeFile(sidecar, JSON.stringify(meta)).catch(() => {});
  invalidateHistoryIndex();
}

async function readGeneratedMetadata(ctx: RuntimeContext, filename: string | null | undefined): Promise<StoredGeneratedMeta | null> {
  if (!filename) return null;
  try {
    const full = ensureInsideGeneratedDir(ctx.config.storage.generatedDir, basename(filename));
    const sidecar = await checkedCanvasPath(ctx.config.storage.generatedDir, `${full}.json`);
    return JSON.parse(await readFile(sidecar, "utf8")) as StoredGeneratedMeta;
  } catch {
    return null;
  }
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

function toGenerateItem(filename: string, meta: CanvasMeta) {
  const url = `/generated/${encodeURIComponent(filename)}`;
  return {
    image: url,
    url,
    thumb: url,
    filename,
    prompt: meta.prompt || undefined,
    userPrompt: meta.userPrompt || meta.prompt || null,
    revisedPrompt: null,
    promptMode: meta.promptMode || "direct",
    provider: meta.provider || "canvas",
    quality: meta.quality || null,
    size: meta.size || null,
    format: "png",
    moderation: meta.moderation || null,
    model: meta.model || null,
    usage: null,
    createdAt: meta.createdAt,
    kind: "edit",
    canvasMergedAt: meta.canvasMergedAt,
    canvasVersion: true,
    canvasSourceFilename: meta.canvasSourceFilename || null,
    canvasEditableFilename: filename,
    annotationsBaked: Boolean(meta.annotationsBaked),
    annotationSnapshot: meta.annotationSnapshot ?? null,
    annotationOnly: Boolean(meta.annotationOnly),
  };
}

function assertAnnotationSnapshot(value: unknown): asserts value is CanvasAnnotationSnapshot {
  const snapshot = value as CanvasAnnotationSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.paths) || !Array.isArray(snapshot.boxes) || !Array.isArray(snapshot.memos)) {
    const err: CodedError = new Error("Invalid canvas annotation snapshot");
    err.status = 400;
    err.code = "INVALID_CANVAS_ANNOTATION_SNAPSHOT";
    throw err;
  }
}

export async function createCanvasVersion(ctx: RuntimeContext, input: CanvasInput) {
  assertPngBuffer(input.buffer);
  const sourceFilename = basename(String(input.sourceFilename || ""));
  if (!sourceFilename) {
    const err: CodedError = new Error("sourceFilename is required");
    err.status = 400;
    err.code = "CANVAS_SOURCE_REQUIRED";
    throw err;
  }
  const filename = makeCanvasFilename(sourceFilename);
  const now = Date.now();
  const sourceMeta = await readGeneratedMetadata(ctx, sourceFilename);
  const prompt = firstString(input.prompt, sourceMeta?.userPrompt, sourceMeta?.prompt);
  const meta = {
    kind: "edit",
    provider: "canvas",
    format: "png",
    prompt,
    userPrompt: prompt,
    promptMode: sourceMeta?.promptMode || "direct",
    createdAt: now,
    canvasMergedAt: now,
    canvasVersion: true,
    canvasSourceFilename: sourceFilename,
    canvasEditableFilename: filename,
    annotationsBaked: false,
    annotationSnapshot: null,
    annotationOnly: false,
  };
  await writeCanvasPng(ctx, filename, input.buffer, meta);
  return toGenerateItem(filename, meta);
}

export async function updateCanvasVersion(ctx: RuntimeContext, filename: string, input: CanvasInput) {
  assertSafeFilename(filename);
  assertPngBuffer(input.buffer);
  await checkedCanvasPath(ctx.config.storage.generatedDir, filename).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
    const err: CodedError = new Error("Canvas version not found");
    err.status = 404;
    err.code = "CANVAS_VERSION_NOT_FOUND";
    throw err;
  });
  const now = Date.now();
  const sourceFilename = typeof input.sourceFilename === "string"
    ? basename(input.sourceFilename)
    : null;
  const sourceMeta = await readGeneratedMetadata(ctx, sourceFilename);
  const previousMeta = await readGeneratedMetadata(ctx, filename);
  const prompt = firstString(
    input.prompt,
    sourceMeta?.userPrompt,
    sourceMeta?.prompt,
    previousMeta?.userPrompt,
    previousMeta?.prompt,
  );
  const meta = {
    kind: "edit",
    provider: "canvas",
    format: "png",
    prompt,
    userPrompt: prompt,
    promptMode: sourceMeta?.promptMode || previousMeta?.promptMode || "direct",
    createdAt: now,
    canvasMergedAt: now,
    canvasVersion: true,
    canvasSourceFilename: sourceFilename,
    canvasEditableFilename: filename,
    annotationsBaked: Boolean(previousMeta?.annotationsBaked),
    annotationSnapshot: previousMeta?.annotationSnapshot ?? null,
    annotationOnly: Boolean(previousMeta?.annotationOnly) && !input.pixelEdited,
  };
  await writeCanvasPng(ctx, filename, input.buffer, meta);
  return toGenerateItem(filename, meta);
}

export async function recordCanvasAnnotationBake(
  ctx: RuntimeContext,
  filename: string,
  snapshot: unknown,
  annotationOnly: boolean,
) {
  assertSafeFilename(filename);
  assertAnnotationSnapshot(snapshot);
  const previousMeta = await readGeneratedMetadata(ctx, filename);
  if (!previousMeta) {
    const err: CodedError = new Error("Canvas version not found");
    err.status = 404;
    err.code = "CANVAS_VERSION_NOT_FOUND";
    throw err;
  }
  const full = await checkedCanvasPath(ctx.config.storage.generatedDir, filename);
  const buffer = await readFile(full);
  const meta = {
    ...previousMeta,
    kind: "edit",
    provider: "canvas",
    format: "png",
    prompt: previousMeta.prompt,
    userPrompt: previousMeta.userPrompt,
    promptMode: previousMeta.promptMode || "direct",
    createdAt: previousMeta.createdAt || Date.now(),
    canvasMergedAt: previousMeta.canvasMergedAt || Date.now(),
    canvasVersion: true,
    canvasSourceFilename: previousMeta.canvasSourceFilename || null,
    canvasEditableFilename: filename,
    annotationsBaked: true,
    annotationSnapshot: snapshot,
    annotationOnly,
  } satisfies CanvasMeta;
  await writeCanvasPng(ctx, filename, buffer, meta);
  return toGenerateItem(filename, meta);
}

export async function revertCanvasAnnotations(ctx: RuntimeContext, filename: string) {
  assertSafeFilename(filename);
  const previousMeta = await readGeneratedMetadata(ctx, filename);
  const sourceFilename = previousMeta?.canvasSourceFilename;
  if (!previousMeta?.annotationsBaked || !sourceFilename) {
    const err: CodedError = new Error("Canvas version has no baked annotations");
    err.status = 409;
    err.code = "CANVAS_ANNOTATIONS_NOT_BAKED";
    throw err;
  }
  const sourceFull = await checkedCanvasPath(ctx.config.storage.generatedDir, basename(sourceFilename));
  const cleanPng = await sharp(await readFile(sourceFull)).png().toBuffer();
  const snapshot = previousMeta.annotationSnapshot ?? null;
  const annotationOnly = Boolean(previousMeta.annotationOnly);
  const now = Date.now();
  const meta = {
    ...previousMeta,
    kind: "edit",
    provider: "canvas",
    format: "png",
    prompt: previousMeta.prompt,
    userPrompt: previousMeta.userPrompt,
    promptMode: previousMeta.promptMode || "direct",
    createdAt: now,
    canvasMergedAt: now,
    canvasVersion: true,
    canvasSourceFilename: sourceFilename,
    canvasEditableFilename: filename,
    annotationsBaked: false,
    annotationSnapshot: null,
    annotationOnly: false,
  } satisfies CanvasMeta;
  await writeCanvasPng(ctx, filename, cleanPng, meta);
  return { item: toGenerateItem(filename, meta), snapshot, annotationOnly };
}
