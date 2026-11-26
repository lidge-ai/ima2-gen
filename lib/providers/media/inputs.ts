import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { MediaInput, MediaInputRole } from "./contract.js";
import { MediaJobError } from "./errors.js";
import { baseMime, extFromMime, isMediaMime, mimeFromName } from "./mime.js";

export const MEDIA_INPUT_ROLES: readonly MediaInputRole[] = [
  "first-frame", "last-frame", "reference-image", "reference-video", "reference-audio",
  "source-image", "source-video", "source-audio", "mask",
];

/** A request-side pointer to one input. Exactly one of ref, filename, url or dataUrl. */
export interface MediaInputRef {
  role: MediaInputRole;
  ref?: string;
  filename?: string;
  url?: string;
  dataUrl?: string;
  mimeType?: string;
}

export interface MediaInputDirs {
  generatedDir: string;
  inputsDir: string;
  maxBytes: number;
}

const ASSET_URL = /^asset:\/\/[A-Za-z0-9._-]{1,200}$/;
const INPUT_REF = /^input:([a-f0-9]{24}\.[a-z0-9]{2,4})$/;

function invalid(message: string): MediaJobError {
  return new MediaJobError("MEDIA_INPUT_INVALID", message);
}

/** Saves an uploaded input and returns the ref POST /api/media accepts. */
export async function storeMediaInput(inputsDir: string, bytes: Buffer, mimeType: string): Promise<{ ref: string; mimeType: string; bytes: number }> {
  const mime = baseMime(mimeType);
  if (!isMediaMime(mime)) throw new MediaJobError("MEDIA_INPUT_TYPE", `Unsupported input type: ${mime || "unknown"}`, { status: 415 });
  if (bytes.length === 0) throw invalid("Empty input");
  await mkdir(inputsDir, { recursive: true });
  const name = `${randomBytes(12).toString("hex")}.${extFromMime(mime)}`;
  await writeFile(join(inputsDir, name), bytes);
  return { ref: `input:${name}`, mimeType: mime, bytes: bytes.length };
}

function insideRoot(root: string, candidate: string): string {
  if (isAbsolute(candidate) || candidate.includes("\0")) throw invalid("Input filename must be relative");
  const full = resolve(root, candidate);
  const rel = relative(resolve(root), full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw invalid("Input filename escapes its folder");
  return full;
}

async function readBounded(full: string, maxBytes: number): Promise<Buffer> {
  const st = await stat(full).catch(() => null);
  if (!st?.isFile()) throw new MediaJobError("MEDIA_INPUT_NOT_FOUND", "Input file not found", { status: 404, category: "not-found" });
  if (st.size > maxBytes) throw new MediaJobError("MEDIA_INPUT_TOO_LARGE", "Input file too large", { status: 413 });
  return readFile(full);
}

function fromDataUrl(dataUrl: string, maxBytes: number): { bytes: Buffer; mimeType: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m || !m[2]) throw invalid("dataUrl must be base64 data: URL");
  const bytes = Buffer.from(m[3]!, "base64");
  if (bytes.length === 0) throw invalid("Empty dataUrl");
  if (bytes.length > maxBytes) throw new MediaJobError("MEDIA_INPUT_TOO_LARGE", "Input too large", { status: 413 });
  return { bytes, mimeType: baseMime(m[1]) };
}

function sourceCount(ref: MediaInputRef): number {
  return [ref.ref, ref.filename, ref.url, ref.dataUrl].filter((v) => typeof v === "string" && v.length > 0).length;
}

function checkRef(raw: unknown): MediaInputRef {
  if (!raw || typeof raw !== "object") throw invalid("Each input must be an object");
  const ref = raw as MediaInputRef;
  if (!MEDIA_INPUT_ROLES.includes(ref.role)) throw invalid(`Unknown input role: ${String(ref.role)}`);
  if (sourceCount(ref) !== 1) throw invalid("Each input needs exactly one of ref, filename, url, dataUrl");
  return ref;
}

/** Turns a request pointer into a contract MediaInput (bytes for local data, url for public https). */
export async function resolveMediaInputRef(raw: unknown, dirs: MediaInputDirs): Promise<MediaInput> {
  const ref = checkRef(raw);
  if (ref.url) {
    // asset://<id> names a vendor-side asset (BytePlus portrait assets); the adapter decides if it accepts it.
    if (!/^https:\/\//i.test(ref.url) && !ASSET_URL.test(ref.url)) throw invalid("Input url must be https or asset://<id>");
    return { role: ref.role, url: ref.url, mimeType: baseMime(ref.mimeType) || mimeFromName(ref.url) || "application/octet-stream" };
  }
  if (ref.dataUrl) {
    const { bytes, mimeType } = fromDataUrl(ref.dataUrl, dirs.maxBytes);
    return { role: ref.role, bytes: new Uint8Array(bytes), mimeType };
  }
  let full: string;
  let name: string;
  if (ref.ref) {
    const m = INPUT_REF.exec(ref.ref);
    if (!m) throw invalid("Unknown input ref");
    name = m[1]!;
    full = join(dirs.inputsDir, name);
  } else {
    name = ref.filename!;
    full = insideRoot(dirs.generatedDir, name);
  }
  const bytes = await readBounded(full, dirs.maxBytes);
  const mimeType = baseMime(ref.mimeType) || mimeFromName(name) || "application/octet-stream";
  return { role: ref.role, bytes: new Uint8Array(bytes), mimeType };
}

/** For engines that read files themselves (L6 workflows): a ref or filename becomes an absolute path, a url stays a url. */
export function resolveMediaRefPath(raw: unknown, dirs: { generatedDir: string; inputsDir: string }, field: string): { path?: string; url?: string; mimeType: string } {
  if (!raw || typeof raw !== "object") throw invalid(field + ": each item must be an object");
  const ref = raw as Omit<MediaInputRef, "role">;
  if (sourceCount({ ...ref, role: "source-image" }) !== 1 || ref.dataUrl) throw invalid(field + ": each item needs exactly one of ref, filename, url");
  if (ref.url) {
    if (!/^https:\/\//i.test(ref.url)) throw invalid(field + ": url must be https");
    return { url: ref.url, mimeType: baseMime(ref.mimeType) || mimeFromName(ref.url) || "application/octet-stream" };
  }
  let path: string;
  let name: string;
  if (ref.ref) {
    const m = INPUT_REF.exec(ref.ref);
    if (!m) throw invalid(field + ": unknown input ref");
    name = m[1]!;
    path = join(dirs.inputsDir, name);
  } else {
    name = ref.filename!;
    path = insideRoot(dirs.generatedDir, name);
  }
  return { path, mimeType: baseMime(ref.mimeType) || mimeFromName(name) || "application/octet-stream" };
}
