// Input and output helpers shared by the L2 direct adapters.
import type { MediaInput, MediaInputRole, MediaKind, MediaOutput } from "../../contract.js";
import { fail } from "./errors.js";

export function inputsWithRole(inputs: readonly MediaInput[], ...roles: MediaInputRole[]): MediaInput[] {
  return inputs.filter((input) => roles.includes(input.role));
}

/** A public URL as-is, or bytes as a data URI. Vendors that accept either take this. */
export function urlOrDataUri(prefix: string, input: MediaInput): string {
  if (input.url) return input.url;
  if (input.bytes) return `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  return fail(prefix, "INPUT_MISSING", "invalid-request", `Input "${input.role}" has neither url nor bytes`);
}

/** Raw base64 without the data: prefix, for vendors that take bare base64. */
export function bareBase64OrUrl(prefix: string, input: MediaInput): string {
  if (input.url) return input.url;
  if (input.bytes) return Buffer.from(input.bytes).toString("base64");
  return fail(prefix, "INPUT_MISSING", "invalid-request", `Input "${input.role}" has neither url nor bytes`);
}

const EXT_MIME: Readonly<Record<string, string>> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
};

const DEFAULT_MIME: Readonly<Record<MediaKind, string>> = { video: "video/mp4", image: "image/png", audio: "audio/mpeg" };

export function mimeFromUrl(url: string, kind: MediaKind): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; read the extension from the raw string.
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const mime = ext ? EXT_MIME[ext] : undefined;
  return mime && mime.startsWith(kind) ? mime : DEFAULT_MIME[kind];
}

export function urlOutput(url: string, kind: MediaKind, expiresAt?: string): MediaOutput {
  const out: MediaOutput = { kind, url, mimeType: mimeFromUrl(url, kind) };
  if (expiresAt) out.expiresAt = expiresAt;
  return out;
}
