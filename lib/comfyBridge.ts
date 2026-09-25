import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";

export const COMFY_ERROR = {
  URL_NOT_LOCAL: "COMFY_URL_NOT_LOCAL",
  IMAGE_INVALID: "COMFY_IMAGE_INVALID",
  IMAGE_NOT_FOUND: "COMFY_IMAGE_NOT_FOUND",
  UPLOAD_FAILED: "COMFY_UPLOAD_FAILED",
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

class ComfyBridgeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ComfyBridgeError";
    this.code = code;
    this.status = status;
  }
}

function bridgeError(code: string, message: string, status: number) {
  return new ComfyBridgeError(code, message, status);
}

export function isComfyBridgeError(error: unknown): error is ComfyBridgeError {
  return error instanceof ComfyBridgeError;
}

export function normalizeComfyOrigin(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL is not configured.", 400);
  }
  const trimmed = rawUrl.trim();
  const rawHost = trimmed.match(/^http:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:?#]+)/i)?.[1] ?? "";
  if (
    rawHost === "localhost." ||
    /^\d+$/.test(rawHost) ||
    /^0x/i.test(rawHost) ||
    /^0[0-9]+/.test(rawHost) ||
    (/^[0-9.]+$/.test(rawHost) && rawHost.split(".").length !== 4) ||
    rawHost.split(".").some((part) => part.length > 1 && part.startsWith("0"))
  ) {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL is not local.", 400);
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL is invalid.", 400);
  }
  if (url.protocol !== "http:") {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL must use HTTP.", 400);
  }
  if (url.username || url.password || !url.port) {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL is not local.", 400);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL is not local.", 400);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw bridgeError(COMFY_ERROR.URL_NOT_LOCAL, "ComfyUI URL must be an origin.", 400);
  }
  return url.origin;
}

function hasEncodedSeparator(filename: string): boolean {
  try {
    const decoded = decodeURIComponent(filename);
    return decoded.includes("/") || decoded.includes("\\");
  } catch {
    return true;
  }
}

function validateFilename(filename: unknown): string {
  if (typeof filename !== "string" || !filename.trim()) {
    throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "A generated filename is required.", 400);
  }
  if (
    isAbsolute(filename) ||
    filename !== basename(filename) ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(filename) ||
    hasEncodedSeparator(filename)
  ) {
    throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "Generated filename is invalid.", 400);
  }
  return filename;
}

function isInsideDirectory(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface ImageType { ext: string; mime: string; }

function sniffImage(buffer: Buffer): ImageType {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "Generated file is not a supported image.", 400);
}

function sanitizeBaseName(filename: string): string {
  const raw = basename(filename, extname(filename));
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "image";
}

interface ComfyCtx {
  config: {
    storage: { generatedDir: string };
    comfy: { defaultUrl: string; uploadTimeoutMs: number; maxUploadBytes: number };
  };
}

interface GeneratedImage {
  buffer: Buffer;
  imageType: ImageType;
  sourceFilename: string;
  uploadFilename: string;
}

async function readGeneratedImage(ctx: ComfyCtx, filename: unknown): Promise<GeneratedImage> {
  const safeFilename = validateFilename(filename);
  const generatedDir = await realpath(ctx.config.storage.generatedDir);
  const candidatePath = join(ctx.config.storage.generatedDir, safeFilename);
  try {
    await access(candidatePath, fsConstants.F_OK);
  } catch {
    throw bridgeError(COMFY_ERROR.IMAGE_NOT_FOUND, "Generated image was not found.", 404);
  }
  let candidateReal;
  try {
    candidateReal = await realpath(candidatePath);
  } catch {
    throw bridgeError(COMFY_ERROR.IMAGE_NOT_FOUND, "Generated image was not found.", 404);
  }
  if (!isInsideDirectory(generatedDir, candidateReal)) {
    throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "Generated filename is invalid.", 400);
  }
  const info = await stat(candidateReal);
  if (!info.isFile()) {
    throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "Generated filename is invalid.", 400);
  }
  if (info.size > ctx.config.comfy.maxUploadBytes) {
    throw bridgeError(COMFY_ERROR.IMAGE_INVALID, "Generated image is too large.", 400);
  }
  const buffer = await readFile(candidateReal);
  const imageType = sniffImage(buffer);
  return {
    buffer,
    imageType,
    sourceFilename: safeFilename,
    uploadFilename: `ima2_${Date.now()}_${sanitizeBaseName(safeFilename)}.${imageType.ext}`,
  };
}

/**
 * Uploads bytes into a ComfyUI instance's input/ folder and returns the name it
 * assigned — which may differ from what we sent, since ComfyUI appends " (n)"
 * on a name clash unless overwrite is set.
 *
 * Extracted from exportImageToComfy so the generate path can stage a reference
 * image for a LoadImage node without going through the saved-image reader:
 * i2i references arrive as base64 in a request, not as files on disk.
 */
export async function uploadBufferToComfy(
  origin: string,
  buffer: Buffer,
  baseName: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const imageType = sniffImage(buffer);
  return postToComfy(
    origin,
    {
      buffer,
      imageType,
      sourceFilename: baseName,
      uploadFilename: `ima2_${Date.now()}_${sanitizeBaseName(baseName)}.${imageType.ext}`,
    },
    timeoutMs,
    fetchImpl,
  );
}

async function postToComfy(origin: string, image: GeneratedImage, timeoutMs: number, fetchImpl: ComfyUploadFetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(image.buffer)], { type: image.imageType.mime }), image.uploadFilename);
    form.append("type", "input");
    const res = await fetchImpl(`${origin}/upload/image`, {
      method: "POST",
      body: form,
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      throw bridgeError(COMFY_ERROR.UPLOAD_FAILED, "Could not upload image to ComfyUI.", 502);
    }
    if (!res.ok) {
      throw bridgeError(COMFY_ERROR.UPLOAD_FAILED, "Could not upload image to ComfyUI.", 502);
    }
    const data = await res.json().catch(() => null) as { name?: unknown } | null;
    if (!data || typeof data.name !== "string" || !data.name.trim()) {
      throw bridgeError(COMFY_ERROR.UPLOAD_FAILED, "Could not upload image to ComfyUI.", 502);
    }
    return data.name;
  } catch (error) {
    if (isComfyBridgeError(error)) throw error;
    throw bridgeError(COMFY_ERROR.UPLOAD_FAILED, "Could not upload image to ComfyUI.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

interface ExportInput { filename: unknown; }
/** The subset of fetch the upload relies on, so callers can inject a stub. */
type ComfyUploadFetch = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
interface ExportOptions { comfyUrl?: string; fetchImpl?: ComfyUploadFetch; }

export async function exportImageToComfy(ctx: ComfyCtx, input: ExportInput, options: ExportOptions = {}) {
  const origin = normalizeComfyOrigin(options.comfyUrl ?? ctx.config.comfy.defaultUrl);
  const image = await readGeneratedImage(ctx, input.filename);
  const uploadedFilename = await postToComfy(
    origin,
    image,
    ctx.config.comfy.uploadTimeoutMs,
    options.fetchImpl,
  );
  return {
    ok: true,
    sourceFilename: image.sourceFilename,
    uploadedFilename,
  };
}
