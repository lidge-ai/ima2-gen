import { isIP } from "node:net";
import { api88VideoSpec, type Api88VideoSpec } from "./videoSpecs.js";

export interface Api88ReferenceMedia { url: string; duration: number; }
export interface Api88VideoInput {
  model: string;
  prompt: string;
  duration?: number | undefined;
  aspectRatio?: string | undefined;
  resolution?: string | undefined;
  images?: string[] | undefined;
  referenceVideos?: Api88ReferenceMedia[] | undefined;
  referenceAudioUrls?: Api88ReferenceMedia[] | undefined;
  firstFrame?: string | undefined;
  lastFrame?: string | undefined;
  videoMode?: "frames" | "reference" | undefined;
  generateAudio?: boolean | undefined;
}
export type Api88VideoBody = Record<string, unknown> & { model: string; prompt: string; duration: number };
function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "API88_VIDEO_INVALID_REQUEST", status: 400 });
}

function privateReferenceIp(host: string): boolean {
  const ip = host.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  return isIP(ip) === 6 && (ip === "::" || ip === "::1" || /^f[cd]/.test(ip)
    || /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("::ffff:"));
}

export function api88PublicReference(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid("Reference must be a public HTTPS URL"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || privateReferenceIp(host)
    || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || (!isIP(host.replace(/^\[|\]$/g, "")) && !host.includes("."))) {
    return invalid("Reference must be a public HTTPS URL (no local targets)");
  }
  return value;
}

export function api88ImageReference(value: string, spec: Api88VideoSpec): string {
  if (!spec.veoBase64) {
    if (!value.startsWith("https://")) {
      throw Object.assign(new Error("This model needs a public image URL; local upload is not implemented"),
        { code: "API88_VIDEO_REFERENCE_NEEDS_URL", status: 400 });
    }
    return api88PublicReference(value);
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return invalid("Veo images require PNG/JPEG base64 data URIs");
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.toString("base64") !== match[2]!) {
    return invalid("Invalid or oversized Veo image");
  }
  const mimeMatches = match[1] === "png" ? bytes.subarray(0, 4).toString("hex") === "89504e47"
    : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!mimeMatches) return invalid("Veo MIME does not match PNG/JPEG bytes");
  return value;
}

function mediaUrls(media: Api88ReferenceMedia[], maxSeconds: number | null, minSeconds: number | null = null): string[] {
  let total = 0;
  const urls = media.map((item) => {
    if (!Number.isFinite(item.duration) || item.duration <= 0) return invalid("Reference duration is required");
    if (minSeconds !== null && item.duration < minSeconds) return invalid("Reference video is too short");
    total += item.duration;
    return api88PublicReference(item.url);
  });
  if (maxSeconds !== null && total > maxSeconds) return invalid("Reference duration limit exceeded");
  return urls;
}

function validateRefs(input: Api88VideoInput, spec: Api88VideoSpec): void {
  const counts: [number, number, number] = [(input.images ?? []).length, (input.referenceVideos ?? []).length, (input.referenceAudioUrls ?? []).length];
  if (counts[0] > spec.refs.images || counts[1] > spec.refs.videos || counts[2] > spec.refs.audios
    || (spec.refs.total !== null && counts.reduce((a, b) => a + b, 0) > spec.refs.total)) {
    return invalid("Reference count limit exceeded");
  }
  if (input.firstFrame && !spec.firstFrame) return invalid("First frame field unsupported");
  if (input.lastFrame && (!spec.lastFrame || !input.firstFrame)) return invalid("Last frame requires a supported first frame");
  if (spec.framesExclusive && (input.firstFrame || input.lastFrame) && counts.some(Boolean)) {
    return invalid("Frame inputs and general references are mutually exclusive");
  }
  if (spec.family === "minimax" && counts[2] && !counts[0] && !counts[1] && !input.firstFrame) {
    return invalid("MiniMax audio references require visual input");
  }
  if (input.generateAudio !== undefined && (typeof input.generateAudio !== "boolean" || spec.audio !== "toggle")) {
    return invalid("Audio generation switch unsupported");
  }
  if (input.videoMode !== undefined && spec.family !== "veo") return invalid("videoMode is Veo-only");
  if (spec.family === "omni" && counts[0] && counts[1]) return invalid("Omni accepts images or a video, not both");
  const seconds = [...(input.referenceVideos ?? []), ...(input.referenceAudioUrls ?? [])]
    .reduce((total, item) => total + item.duration, 0);
  if (spec.referenceTotalSeconds !== null && seconds > spec.referenceTotalSeconds) return invalid("Combined reference duration exceeded");
}

function referenceFields(input: Api88VideoInput, spec: Api88VideoSpec): Record<string, unknown> {
  const images = (input.images ?? []).map((value) => api88ImageReference(value, spec));
  const videos = mediaUrls(input.referenceVideos ?? [], spec.referenceVideoSeconds, spec.referenceVideoMinimumSeconds);
  const audios = mediaUrls(input.referenceAudioUrls ?? [], spec.referenceAudioSeconds);
  const metadata: Record<string, unknown> = {};
  if (input.firstFrame) metadata.firstFrame = api88ImageReference(input.firstFrame, spec);
  if (input.lastFrame) metadata.lastFrame = api88ImageReference(input.lastFrame, spec);
  if (videos.length && spec.family !== "omni") metadata.referenceVideos = videos;
  if (audios.length) metadata.referenceAudios = audios;
  return {
    ...(images.length ? { images } : {}),
    ...(videos.length && spec.family === "omni" ? { video: videos[0] } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function veoFields(input: Api88VideoInput, resolution: string, ratio: string): Record<string, unknown> {
  const spec = api88VideoSpec(input.model);
  const images = input.firstFrame
    ? [input.firstFrame, ...(input.lastFrame ? [input.lastFrame] : [])]
    : input.images ?? [];
  const videoMode = input.firstFrame ? "frames" : input.videoMode ?? (images.length > 1 ? "reference" : undefined);
  if (videoMode === "frames" && images.length > 2) return invalid("Veo frames mode accepts at most two images");
  if (input.videoMode && input.videoMode !== "frames" && input.firstFrame) return invalid("Frame role conflicts with videoMode");
  const [width, height] = resolution === "1080p" ? [1920, 1080] : [1280, 720];
  const metadata = {
    ...(videoMode ? { video_mode: videoMode } : {}),
    ...(input.generateAudio !== undefined ? { generateAudio: input.generateAudio } : {}),
  };
  return {
    size: ratio === "9:16" ? `${height}x${width}` : `${width}x${height}`,
    ...(images.length ? { images: images.map((v) => api88ImageReference(v, spec)) } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function buildApi88VideoBody(input: Api88VideoInput): Api88VideoBody {
  const spec = api88VideoSpec(input.model);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) return invalid("Prompt required");
  validateRefs(input, spec);
  const hasImages = Boolean(input.firstFrame || (input.images ?? []).length);
  const duration = input.duration ?? spec.defaultDuration;
  if (!Number.isInteger(duration) || !spec.durations.includes(duration)) return invalid("Duration unsupported for model");
  if (spec.family === "veo" && hasImages && duration !== 8) return invalid("Veo with images requires 8 seconds");
  const ratio = input.aspectRatio ?? spec.ratios[0]!;
  const resolution = input.resolution ?? spec.resolutions[0]!;
  if (!spec.ratios.includes(ratio)) return invalid("Aspect ratio unsupported for model");
  if (!(spec.resolutions as readonly string[]).includes(resolution)) return invalid("Resolution unsupported for model");
  const base = { model: input.model, prompt: input.prompt, duration };
  if (spec.family === "veo") return { ...base, ...veoFields(input, resolution, ratio) };
  const refs = referenceFields(input, spec);
  if (spec.family === "grok") return { ...base, size: ratio, ...refs,
    ...(input.firstFrame ? { images: [api88ImageReference(input.firstFrame, spec)] } : {}), metadata: { resolution } };
  if (spec.family === "omni") return { ...base, size: ratio, ...refs };
  return {
    ...base, ratio, ...refs,
    ...(input.generateAudio !== undefined ? { generate_audio: input.generateAudio } : {}),
  };
}
