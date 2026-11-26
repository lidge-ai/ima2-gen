/**
 * Request helpers: input lookup by role, data-URI encoding, vendorOptions checks
 * and model resolution against a compiled catalog.
 */
import type { MediaInput, MediaInputRole, MediaKind, MediaModelSpec, MediaSubmitRequest } from "../../contract.js";
import { invalidRequest } from "./errors.js";

export function inputsWithRole(request: MediaSubmitRequest, ...roles: MediaInputRole[]): readonly MediaInput[] {
  return request.inputs.filter((input) => roles.includes(input.role));
}

export function firstInput(request: MediaSubmitRequest, ...roles: MediaInputRole[]): MediaInput | undefined {
  for (const role of roles) {
    const found = request.inputs.find((input) => input.role === role);
    if (found) return found;
  }
  return undefined;
}

/** Public URL as-is, or bytes as a data URI. Exactly one must be present. */
export function inputToUrl(prefix: string, input: MediaInput): string {
  if (input.url && input.bytes) throw invalidRequest(prefix, `Input ${input.role} has both url and bytes`);
  if (input.url) return input.url;
  if (input.bytes) return `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  throw invalidRequest(prefix, `Input ${input.role} has neither url nor bytes`);
}

export function kindFromMime(mime: string | undefined, fallback: MediaKind): MediaKind {
  if (!mime) return fallback;
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return fallback;
}

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac",
};

/** Best-effort MIME from a URL path extension; fallback when unknown. */
export function mimeFromUrl(url: string, fallback: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Relative or opaque value: inspect it as-is.
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? fallback;
}

export function defaultMime(kind: MediaKind): string {
  return kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
}

/** Refuses vendorOptions keys outside the allow-list (the contract says refuse, not drop). */
export function checkVendorOptions(
  prefix: string, options: MediaSubmitRequest["vendorOptions"], allowed: ReadonlySet<string>,
): Record<string, unknown> {
  if (!options) return {};
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw invalidRequest(prefix, `Unsupported vendorOptions: ${unknown.join(", ")}`, "UNSUPPORTED_OPTION");
  return { ...options };
}

/** Finds the curated spec; refuses ids the adapter does not route. */
export function requireModel(prefix: string, models: readonly MediaModelSpec[], id: string): MediaModelSpec {
  const spec = models.find((model) => model.id === id);
  if (!spec) throw invalidRequest(prefix, `Model ${id} is not available on this provider`, "MODEL_UNSUPPORTED");
  return spec;
}

export function requireTask(prefix: string, spec: MediaModelSpec, request: MediaSubmitRequest): void {
  if (!spec.tasks.includes(request.task)) {
    throw invalidRequest(prefix, `Model ${spec.id} does not support ${request.task}`, "TASK_UNSUPPORTED");
  }
}

export function requirePrompt(prefix: string, request: MediaSubmitRequest): string {
  const prompt = request.prompt?.trim();
  if (!prompt) throw invalidRequest(prefix, "A prompt is required", "PROMPT_REQUIRED");
  return prompt;
}
