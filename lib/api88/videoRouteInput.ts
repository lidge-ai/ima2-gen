import { readFile } from "node:fs/promises";
import type { RuntimeContext } from "../runtimeContext.js";
import { safeGeneratedFilePath } from "../videoFrameExtract.js";
import { parseBackgroundPreset, backgroundPromptSuffix } from "../backgroundPresets.js";
import { API88_DEFAULT_VIDEO_MODEL, api88VideoSpec } from "./videoSpecs.js";
import { buildApi88VideoBody, api88ImageReference, type Api88VideoInput, type Api88ReferenceMedia } from "./videoBody.js";

type Body = Record<string, unknown>;
export interface Api88PreparedVideo {
  model: string; prompt: string; input?: Api88VideoInput; taskId?: string;
  video: Record<string, unknown>;
}
function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "API88_VIDEO_INVALID_REQUEST", status: 400 });
}
function strings(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v)) return invalid("Expected nonempty strings");
  return value as string[];
}
function optionalString(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.length) return invalid(`Invalid ${key}`);
  return value;
}
function media(value: unknown): Api88ReferenceMedia[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return invalid("Expected media array");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") return invalid("Expected media object");
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || typeof row.duration !== "number") return invalid("Media needs URL and duration");
    return { url: row.url, duration: row.duration };
  });
}
function rejectOptions(body: Body): void {
  const forbidden = ["storyboard", "continueFromVideo", "continuityLineage", "topic", "plannerModel", "elementIds", "referenceAudios"];
  const active = forbidden.filter((key) => {
    const value = body[key];
    return value !== undefined && value !== null && value !== false && value !== ""
      && (!Array.isArray(value) || value.length > 0);
  });
  if (active.length) {
    throw Object.assign(new Error(`88API does not support these native options: ${active.join(", ")}`),
      { code: "API88_VIDEO_OPTION_UNSUPPORTED", status: 400 });
  }
}
async function fileReference(ctx: RuntimeContext, filename: string, model: string): Promise<string> {
  const path = await safeGeneratedFilePath(ctx.config.storage.generatedDir, filename);
  if (!/\.(png|jpe?g)$/i.test(path)) return invalid("Generated reference must be PNG/JPEG");
  const spec = api88VideoSpec(model);
  if (spec.veoBase64) {
    const bytes = await readFile(path);
    const mime = bytes.subarray(0, 4).toString("hex") === "89504e47" ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;
    if (!mime) return invalid("Generated reference must contain PNG/JPEG bytes");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  let metadata: Record<string, unknown> = {};
  try {
    const sidecar = await safeGeneratedFilePath(ctx.config.storage.generatedDir, `${filename}.json`);
    metadata = JSON.parse(await readFile(sidecar, "utf8")) as Record<string, unknown>;
  }
  catch { /* No sidecar URL means this is a local-only reference. */ }
  if (typeof metadata.providerUrl === "string") return api88ImageReference(metadata.providerUrl, spec);
  throw Object.assign(new Error("Reference has no public provider URL"),
    { code: "API88_VIDEO_REFERENCE_NEEDS_URL", status: 400 });
}
function localDataUri(value: string, model: string): string {
  if (!api88VideoSpec(model).veoBase64 || value.startsWith("data:") || value.startsWith("https://")) return value;
  const bytes = Buffer.from(value, "base64");
  const mime = bytes.subarray(0, 4).toString("hex") === "89504e47" ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;
  if (!mime) return invalid("Veo raw base64 must contain PNG/JPEG bytes");
  return `data:${mime};base64,${value}`;
}
async function references(ctx: RuntimeContext, body: Body, model: string): Promise<string[]> {
  const source = optionalString(body, "sourceImage");
  const filename = optionalString(body, "sourceFilename");
  const providerUrl = optionalString(body, "providerUrl");
  if (source && filename) return invalid("Choose sourceImage or sourceFilename");
  const general = strings(body.referenceImages);
  const files = await Promise.all(strings(body.referenceFilenames).map((name) => fileReference(ctx, name, model)));
  const first = providerUrl ?? source ?? (filename ? await fileReference(ctx, filename, model) : undefined);
  return [...(first ? [first] : []), ...general, ...files].map((value) => localDataUri(value, model));
}
function promptFor(body: Body): string {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return invalid("Prompt required");
  const parsed = parseBackgroundPreset(body.backgroundPreset);
  if ("error" in parsed) return invalid(parsed.error);
  if (parsed.preset === "transparent") return invalid("Transparent backgrounds are image-only");
  return body.prompt + (parsed.preset ? ` ${backgroundPromptSuffix(parsed.preset, "video")}` : "");
}
function modeFor(body: Body, input: Api88VideoInput): string {
  const spec = api88VideoSpec(input.model);
  const hasImages = Boolean(input.firstFrame || input.images?.length);
  const hasMedia = hasImages || Boolean(input.referenceVideos?.length || input.referenceAudioUrls?.length);
  const general = strings(body.referenceImages).length + strings(body.referenceFilenames).length;
  const inferred = spec.family === "grok" && hasImages ? "image-to-video"
    : general || input.referenceVideos?.length || input.referenceAudioUrls?.length
    ? "reference-to-video" : hasImages ? spec.firstFrame ? "image-to-video" : "reference-to-video" : "text-to-video";
  const mode = optionalString(body, "mode") ?? inferred;
  if (!["text-to-video", "image-to-video", "reference-to-video"].includes(mode)) return invalid("Invalid video mode");
  if (mode === "text-to-video" && hasMedia) return invalid("text-to-video cannot include references");
  if (mode === "image-to-video" && !hasImages) return invalid("image-to-video requires an image");
  if (mode === "reference-to-video" && !hasMedia) return invalid("reference-to-video requires media");
  if (mode === "image-to-video" && !spec.firstFrame) return invalid("This model supports references, not locked first frames");
  if (mode === "reference-to-video" && spec.family === "grok") return invalid("88API Grok accepts only an opening image");
  return mode;
}
export async function prepareApi88Video(ctx: RuntimeContext, body: Body, resume: boolean): Promise<Api88PreparedVideo> {
  rejectOptions(body);
  const model = optionalString(body, "model") ?? (resume ? invalid("Resume requires a model") : API88_DEFAULT_VIDEO_MODEL);
  const spec = api88VideoSpec(model);
  if (resume) {
    if (body.prompt !== undefined && typeof body.prompt !== "string") return invalid("Resume prompt must be a string");
    const taskId = optionalString(body, "taskId") ?? invalid("Resume requires taskId");
    if (taskId.length > 512) return invalid("taskId too long");
    return { model, taskId, prompt: typeof body.prompt === "string" ? body.prompt : "",
      video: { mode: "resumed", duration: null, resolution: null, aspectRatio: null, refsCount: null } };
  }
  const images = await references(ctx, body, model);
  const input: Api88VideoInput = {
    model, prompt: promptFor(body), images,
    duration: body.duration === undefined ? spec.defaultDuration : Number(body.duration),
    resolution: optionalString(body, "resolution"), aspectRatio: optionalString(body, "aspectRatio"),
    firstFrame: optionalString(body, "firstFrame"), lastFrame: optionalString(body, "lastFrame"),
    referenceVideos: media(body.referenceVideos), referenceAudioUrls: media(body.referenceAudioUrls),
  };
  if (body.duration !== undefined && typeof body.duration !== "number") return invalid("duration must be a number");
  if (body.generateAudio !== undefined) {
    if (typeof body.generateAudio !== "boolean") return invalid("generateAudio must be boolean");
    input.generateAudio = body.generateAudio;
  }
  if (body.videoMode !== undefined) {
    if (body.videoMode !== "frames" && body.videoMode !== "reference") return invalid("Invalid videoMode");
    input.videoMode = body.videoMode;
  }
  const mode = modeFor(body, input);
  if (mode === "image-to-video" && images.length && !input.firstFrame) {
    input.firstFrame = images[0]!;
    input.images = images.slice(1);
  }
  if (spec.family === "veo" && images.length && input.videoMode === undefined) {
    input.videoMode = mode === "reference-to-video" ? "reference" : "frames";
  }
  buildApi88VideoBody(input);
  return { model, prompt: input.prompt, input, video: { mode, duration: input.duration,
    resolution: input.resolution ?? spec.resolutions[0], aspectRatio: input.aspectRatio ?? spec.ratios[0],
    refsCount: images.length, sourceImageFilename: body.sourceFilename ?? null,
    firstFrame: Boolean(input.firstFrame), lastFrame: Boolean(input.lastFrame), videoMode: input.videoMode ?? null,
    generateAudio: input.generateAudio ?? null, referenceVideosCount: input.referenceVideos?.length ?? 0,
    referenceAudiosCount: input.referenceAudioUrls?.length ?? 0 } };
}
