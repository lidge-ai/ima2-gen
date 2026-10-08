# wp3 — 88API video generation and resumption

Status: executable implementation PRD; planning only. All anchors below were read from the current
8112 tree on 2026-10-08. Apply after 010. The current tree does not yet contain 010's `lib/api88/`
files or manifest, so anchors for those additions are explicitly identified as prerequisite anchors,
not invented current line numbers. D1–D10 in 000 override older suggestions in 001–005 and the handoff.
No implementation, test execution, build, network request, or Git mutation was performed for this PRD.

## Contract and implementation order

One new per-model table drives validation, serialization and generated UI controls. Keep all 25 wire
IDs unchanged. POST once, capture `id`, durably merge it into the admitted job, emit `submitted`, wait
4 seconds, and poll every 12 seconds within the configured 900,000 ms default budget. Only `completed`
and `failed` are terminal; three consecutive unknown/missing/unrecognized states fail closed. HTTP 429
and 5xx retry only on GET, within the same deadline. No planner, Responses call, upload, model fallback,
legacy endpoint, or upstream cancellation is involved. Local cancellation stops local waiting only.

References: Veo accepts PNG/JPEG base64 data URIs, at most 20 MiB decoded per image; other families
accept publicly accessible HTTPS URLs only. Download result URLs without credentials, retaining the
exact URL string including query; validate MP4 `ftyp` and a 200 MiB cap. Resume accepts an existing task
ID and performs zero upstream POSTs. Resume has a fresh local requestId and the same SSE/202 contract.
Metadata records task, origin, exact model and known request values; unavailable resumed parameters
remain null. The selected media kind determines which key authorizes work (D2/D10).

Implement in this order: table/body/download/transport; inflight helper; dedicated route and early
dispatch; generated projection; lane-aware selection and controls; tests and generated inventories.
All NEW source/test files below are under 500 lines, and each new function is under 50 physical lines.
Existing oversized route/store functions receive small insertions only; splitting unrelated existing
code is not part of wp3. No DELETE operations are proposed.

## NEW `lib/api88/videoSpecs.ts`

Anchor: absent in the current tree (`rg --files lib/api88` reports no such directory). Full contents:

```ts
export type Api88VideoFamily = "grok" | "veo" | "omni" | "kling" | "wan" | "minimax" | "seedance" | "sd";
export type Api88VideoResolution = "480p" | "720p" | "768p" | "1080p" | "2k" | "4k";
export interface Api88VideoSpec {
  family: Api88VideoFamily;
  durations: readonly number[];
  defaultDuration: number;
  ratios: readonly string[];
  resolutions: readonly Api88VideoResolution[];
  fixedResolution: Api88VideoResolution | null;
  refs: { images: number; videos: number; audios: number; total: number | null };
  audio: "included" | "toggle" | "none";
  firstFrame: boolean;
  lastFrame: boolean;
  framesExclusive: boolean;
  veoBase64: boolean;
  referenceVideoSeconds: number | null;
  referenceAudioSeconds: number | null;
  referenceVideoMinimumSeconds: number | null;
  referenceTotalSeconds: number | null;
}

const range = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i);
const wide = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"];
const cinema = ["1:1", "21:9", "16:9", "9:16", "3:4", "4:3"];
const official = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

function fixed(
  family: Api88VideoFamily, resolution: Api88VideoResolution,
  max: number, defaultDuration: number, ratios: readonly string[],
  refs: Api88VideoSpec["refs"], overrides: Partial<Api88VideoSpec> = {},
): Api88VideoSpec {
  return {
    family, durations: range(4, max), defaultDuration, ratios,
    resolutions: [resolution], fixedResolution: resolution, refs,
    audio: "none", firstFrame: true, lastFrame: true, framesExclusive: true,
    veoBase64: false, referenceVideoSeconds: 15, referenceAudioSeconds: 15,
    referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
    ...overrides,
  };
}
const grok: Api88VideoSpec = {
  family: "grok", durations: range(1, 15), defaultDuration: 8, ratios: wide,
  resolutions: ["480p", "720p"], fixedResolution: null,
  refs: { images: 1, videos: 0, audios: 0, total: 1 }, audio: "included",
  // First-frame input is encoded as images[0], never metadata.firstFrame.
  firstFrame: true, lastFrame: false, framesExclusive: true, veoBase64: false,
  referenceVideoSeconds: null, referenceAudioSeconds: null,
  referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
};
const veo: Api88VideoSpec = {
  family: "veo", durations: [4, 6, 8], defaultDuration: 8, ratios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p"], fixedResolution: null,
  refs: { images: 3, videos: 0, audios: 0, total: 3 }, audio: "toggle",
  firstFrame: true, lastFrame: true, framesExclusive: true, veoBase64: true,
  referenceVideoSeconds: null, referenceAudioSeconds: null,
  referenceVideoMinimumSeconds: null, referenceTotalSeconds: null,
};
const small = { images: 9, videos: 3, audios: 3, total: null };
const large = { images: 30, videos: 10, audios: 10, total: null };
const wanRefs = { images: 10, videos: 5, audios: 5, total: null };
const sd2 = { ...small, total: 12 };

export const API88_VIDEO_SPECS = {
  "gemini-omni-flash": fixed("omni", "720p", 10, 5, ["16:9", "9:16"],
    { images: 10, videos: 1, audios: 0, total: null },
    { durations: range(3, 10), firstFrame: false, lastFrame: false, referenceVideoSeconds: 10 }),
  "grok-imagine-video": grok,
  "grok-imagine-video-1.5": grok,
  "kling-3.0-turbo-720p": fixed("kling", "720p", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-1080p": fixed("kling", "1080p", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-2k": fixed("kling", "2k", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "kling-3.0-turbo-4k": fixed("kling", "4k", 15, 5, ["16:9", "9:16", "1:1"], large,
    { refs: { ...large, audios: 0 }, audio: "toggle", framesExclusive: false, referenceVideoSeconds: null }),
  "minimax-h3-768p": fixed("minimax", "768p", 15, 4, ["1:1", "16:9", "9:16"], wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null, framesExclusive: false }),
  "SD2.0 480P": fixed("sd", "480p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 720P": fixed("sd", "720p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 1080P": fixed("sd", "1080p", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.0 4k": fixed("sd", "4k", 15, 5, cinema, sd2, { audio: "included" }),
  "SD2.5 480P": fixed("sd", "480p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "SD2.5 720P": fixed("sd", "720p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "SD2.5 1080P": fixed("sd", "1080p", 30, 5, ["auto", ...cinema], large,
    { audio: "toggle", referenceVideoSeconds: 30, referenceAudioSeconds: 30, referenceVideoMinimumSeconds: 2 }),
  "Seedance-2.0-720p官方版": fixed("seedance", "720p", 15, 4, official, small),
  "Seedance-2.0-fast-720p官方版": fixed("seedance", "720p", 15, 4, official, small),
  "Seedance-2.5-720p官方版": fixed("seedance", "720p", 30, 4, official, large,
    { referenceVideoSeconds: 30, referenceAudioSeconds: 30 }),
  "seedance-2.0-mini-480p": fixed("seedance", "480p", 15, 5, official, small,
    { firstFrame: false, lastFrame: false }),
  "seedance-2.0-mini-720p": fixed("seedance", "720p", 15, 5, official, small,
    { firstFrame: false, lastFrame: false }),
  "veo-3.1": veo,
  "veo-3.1-fast": veo,
  "wan3.0-video-480p": fixed("wan", "480p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null }),
  "wan3.0-video-720p": fixed("wan", "720p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceTotalSeconds: 15 }),
  "wan3.0-video-1080p": fixed("wan", "1080p", 30, 5, wide.slice(0, 5), wanRefs,
    { referenceVideoSeconds: null, referenceAudioSeconds: null }),
} satisfies Record<string, Api88VideoSpec>;
export type Api88VideoModel = keyof typeof API88_VIDEO_SPECS;
export const API88_DEFAULT_VIDEO_MODEL: Api88VideoModel = "grok-imagine-video-1.5";

export function api88VideoSpec(model: unknown): Api88VideoSpec {
  if (typeof model !== "string" || !Object.hasOwn(API88_VIDEO_SPECS, model)) {
    throw Object.assign(new Error("Unknown 88API video model"), { code: "API88_VIDEO_MODEL_INVALID", status: 400 });
  }
  return API88_VIDEO_SPECS[model as Api88VideoModel];
}
```

The handoff does not specify an Omni default; 5 is a valid UI default, not an upstream assertion.
First/last flags describe frame roles. Grok encodes its first frame as `images[0]`; Veo uses
`images` plus `metadata.video_mode`; the other supported families use metadata frame fields.
Kling and MiniMax have no documented reference-video duration bound; their null bounds must not fabricate one.

## NEW `lib/api88/videoBody.ts`

Anchor: absent. Full contents. Typed callers pass duration-tagged URL media for video/audio references;
this avoids trusting unknown aggregate lengths. Native xAI voice IDs are never mapped to audio URLs.

```ts
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
```

The public-reference guard rejects local hostnames and private IP targets; URLs remain unmodified.
It cannot prove an external hostname is anonymously fetchable without an upstream request. Such
failures remain upstream validation failures, not evidence that local upload works.

## NEW `lib/api88/videoDownload.ts`

Anchor: absent. Full contents. Reuse 010's shared byte downloader and add MP4 container validation.

```ts
import { downloadApi88Bytes } from "./download.js";
function downloadError(message: string): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code: "API88_VIDEO_DOWNLOAD_FAILED", status: 502 });
}

export async function downloadApi88Video(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw downloadError("Invalid video URL");
  const bytes = await downloadApi88Bytes(url, signal, maxBytes);
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw downloadError("Result is not an MP4 container");
  return bytes;
}
```

## NEW `lib/api88/videoTransport.ts`

Anchor: absent. Prerequisite API from 010: `api88Origin(baseUrl: string): string` exported by
`lib/api88/origin.ts`, strips the trailing slash and `/v1`. Full contents:

```ts
import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeContext } from "../runtimeContext.js";
import { api88Origin } from "./origin.js";
import { api88VideoSpec } from "./videoSpecs.js";
import { buildApi88VideoBody, type Api88VideoInput, type Api88VideoBody } from "./videoBody.js";
import { downloadApi88Video } from "./videoDownload.js";

export interface Api88VideoEvent {
  phase: "submitted" | "progress";
  providerTaskId: string;
  model: string;
  origin: string;
  progress?: number | null;
  status?: string;
}
export interface Api88VideoOptions {
  signal?: AbortSignal | undefined;
  sleep?: ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  onEvent?: ((event: Api88VideoEvent) => void | Promise<void>) | undefined;
}
export interface Api88VideoResult {
  videoBuffer: Buffer;
  providerUrl: string;
  providerTaskId: string;
  model: string;
  origin: string;
}
type VideoContext = Pick<RuntimeContext, "api88VideoKey" | "config">;
type Json = Record<string, unknown>;
interface Run {
  origin: string; headers: { Authorization: string }; deadline: number;
  signal: AbortSignal; options: Api88VideoOptions; now: () => number;
  config: RuntimeContext["config"]["api88Provider"];
}
function fail(code: string, message: string, status = 502, providerTaskId?: string): never {
  throw Object.assign(new Error(message), { code, status, ...(providerTaskId ? { providerTaskId } : {}) });
}
function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function runFor(ctx: VideoContext, options: Api88VideoOptions): Run {
  const key = ctx.api88VideoKey?.trim();
  if (!key) return fail("API88_VIDEO_KEY_MISSING", "88API video key required", 401);
  const now = options.now ?? Date.now;
  const timeout = ctx.config.api88Provider.videoTimeoutMs;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeout)]);
  return { origin: api88Origin(ctx.config.api88Provider.baseUrl), headers: { Authorization: `Bearer ${key}` },
    deadline: now() + timeout, signal, options, now, config: ctx.config.api88Provider };
}
function check(run: Run, taskId?: string): void {
  if (run.options.signal?.aborted) run.options.signal.throwIfAborted();
  if (run.signal.aborted || run.now() >= run.deadline) {
    fail("API88_VIDEO_TIMEOUT", "88API waiting budget exhausted; resume the existing task", 504, taskId);
  }
}
async function wait(run: Run, ms: number, taskId: string): Promise<void> {
  check(run, taskId);
  const remaining = run.deadline - run.now();
  const sleep = run.options.sleep ?? ((duration, signal) => delay(duration, undefined, { signal }));
  await sleep(Math.min(ms, remaining), run.signal);
  check(run, taskId);
}

async function submit(run: Run, body: Api88VideoBody): Promise<string> {
  check(run);
  let response: Response;
  let data: Json;
  try {
    response = await fetch(`${run.origin}/v1/videos`, {
      method: "POST", redirect: "error", headers: { ...run.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.any([run.signal,
        AbortSignal.timeout(Math.min(run.config.videoSubmitTimeoutMs, Math.max(1, run.deadline - run.now())))]),
    });
    if (!response.ok) return fail("API88_VIDEO_REQUEST_FAILED", `88API submit HTTP ${response.status}`, response.status);
    data = object(await response.json());
  } catch (error) {
    if ((error as { code?: string }).code === "API88_VIDEO_REQUEST_FAILED") throw error;
    return fail("API88_VIDEO_SUBMIT_UNCERTAIN", "Submit outcome uncertain; never automatically submit again", 502);
  }
  if (typeof data.id !== "string" || !data.id.length) {
    return fail("API88_VIDEO_SUBMIT_UNCERTAIN", "Submit response has no id; do not resubmit", 502);
  }
  return data.id;
}

function retryDelay(response: Response, attempt: number, now: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1000, date - now);
  }
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}
async function pollOnce(run: Run, taskId: string): Promise<Json> {
  for (let attempt = 0; ; attempt += 1) {
    check(run, taskId);
    const response = await fetch(`${run.origin}/v1/videos/${encodeURIComponent(taskId)}`, {
      method: "GET", redirect: "error", headers: run.headers, signal: AbortSignal.any([run.signal,
        AbortSignal.timeout(Math.min(run.config.videoPollTimeoutMs, Math.max(1, run.deadline - run.now())))]),
    });
    if (response.status === 429 || response.status >= 500) {
      const backoff = retryDelay(response, attempt, run.now());
      await response.body?.cancel();
      await wait(run, backoff, taskId);
      continue;
    }
    if (!response.ok) return fail("API88_VIDEO_REQUEST_FAILED", `88API poll HTTP ${response.status}`, response.status, taskId);
    return object(await response.json());
  }
}
export function api88VideoResultUrl(value: unknown): string | null {
  const root = object(value);
  const data = object(root.data);
  const containers = [root, object(root.output), data, object(data.output)];
  for (const key of ["url", "video_url", "result_url"]) {
    for (const container of containers) {
      const url = container[key];
      if (typeof url === "string" && url.length > 0) return url;
    }
  }
  return null;
}
async function poll(run: Run, taskId: string, model: string): Promise<Api88VideoResult> {
  let unknown = 0;
  await run.options.onEvent?.({ phase: "submitted", providerTaskId: taskId, model, origin: run.origin });
  await wait(run, run.config.videoFirstPollMs, taskId);
  while (true) {
    check(run, taskId);
    const data = await pollOnce(run, taskId);
    check(run, taskId);
    const status = typeof data.status === "string" ? data.status : "unknown";
    if (status === "failed") return fail("API88_VIDEO_FAILED", "88API task failed", 502, taskId);
    if (status === "completed") {
      const url = api88VideoResultUrl(data);
      if (!url) return fail("API88_VIDEO_EMPTY_RESULT", "Completed task has no result URL", 502, taskId);
      const downloadSignal = AbortSignal.any([run.signal, AbortSignal.timeout(run.config.videoDownloadTimeoutMs)]);
      const videoBuffer = await downloadApi88Video(url, downloadSignal, run.config.maxVideoBytes);
      check(run, taskId);
      return { videoBuffer, providerUrl: url, providerTaskId: taskId, model, origin: run.origin };
    }
    unknown = status === "queued" || status === "in_progress" ? 0 : unknown + 1;
    if (unknown >= run.config.videoUnknownStatusLimit) return fail("API88_VIDEO_STATUS_UNKNOWN", "Three consecutive unknown task states", 502, taskId);
    const progress = typeof data.progress === "number" && Number.isFinite(data.progress)
      ? Math.min(1, Math.max(0, data.progress / 100)) : null;
    await run.options.onEvent?.({ phase: "progress", providerTaskId: taskId, model, origin: run.origin, progress, status });
    await wait(run, run.config.videoPollIntervalMs, taskId);
  }
}
async function complete(run: Run, taskId: string, model: string): Promise<Api88VideoResult> {
  try { return await poll(run, taskId, model); }
  catch (error) {
    if (run.options.signal?.aborted) run.options.signal.throwIfAborted();
    check(run, taskId);
    if (error instanceof Error && error.name === "TimeoutError") return fail("API88_VIDEO_TIMEOUT", "88API request timed out", 504, taskId);
    const code = (error as { code?: unknown } | null)?.code;
    if (error instanceof Error && (typeof code === "string" && code.startsWith("API88_") || code === "GENERATION_CANCELED")) {
      throw Object.assign(error, { providerTaskId: taskId });
    }
    return fail("API88_VIDEO_REQUEST_FAILED", "88API poll/download response failed", 502, taskId);
  }
}
export async function generateApi88Video(
  ctx: VideoContext, input: Api88VideoInput, options: Api88VideoOptions = {},
): Promise<Api88VideoResult> {
  const body = buildApi88VideoBody(input);
  const run = runFor(ctx, options);
  const taskId = await submit(run, body);
  return complete(run, taskId, input.model);
}
export async function resumeApi88Video(
  ctx: VideoContext, taskId: string, model: string, options: Api88VideoOptions = {},
): Promise<Api88VideoResult> {
  api88VideoSpec(model);
  if (!taskId || taskId.length > 512) return fail("API88_VIDEO_INVALID_REQUEST", "Task id required (max 512 characters)", 400);
  return complete(runFor(ctx, options), taskId, model);
}
```

GET network failures fail with the saved task ID; D6 mandates retries for HTTP 429/5xx, not
unbounded network-error retries. A submit timeout/abort has an uncertain outcome; the transport
never retries it. The route's existing local cancellation semantics still take precedence for its
terminal event. A post-submit bookkeeping failure retains the id on the error and terminal metadata.

## MODIFY `lib/inflight.ts`

Current anchor lines 222–233 (leave this existing replacement helper intact):

```ts
export function updateJobAdmission(requestId: string | null | undefined, { prompt, meta }: { prompt?: string | null; meta?: Record<string, unknown> }): void {
  if (!requestId || !getJob(requestId)) return;
  const normalizedPrompt = typeof prompt === "string" ? prompt.slice(0, 500) : "";
  const normalizedMeta = normalizeMeta(meta ?? {});
  try {
    getDb()
      .prepare(`UPDATE inflight SET prompt = ?, meta = ? WHERE request_id = ?`)
      .run(normalizedPrompt, JSON.stringify(normalizedMeta), requestId);
  } catch (err: unknown) {
    logError("inflight", "update_admission:error", err);
  }
}
```

Insert directly after it. Unlike `updateJobAdmission`, write failures propagate. Its transaction
preserves prompt, phase and admission fields, and synchronizes indexed association columns.

```ts
export function mergeJobMeta(requestId: string, patch: Record<string, unknown>): boolean {
  return getDb().transaction(() => {
    const job = getJob(requestId);
    if (!job) return false;
    const meta = normalizeMeta({ ...job.meta, ...patch });
    const result = getDb().prepare(`UPDATE inflight SET meta = ?, session_id = ?,
      parent_node_id = ?, client_node_id = ? WHERE request_id = ?`)
      .run(JSON.stringify(meta), stringOrNull(meta.sessionId), stringOrNull(meta.parentNodeId),
        stringOrNull(meta.clientNodeId), requestId);
    return result.changes === 1;
  })();
}

export function mergeStoppedJobMeta(
  requestId: string, patch: { providerTaskId: string; api88Origin: string },
): boolean {
  ensureTerminalJobsRestored();
  const next = getDb().transaction(() => {
    const cutoff = Date.now() - config.inflight.terminalTtlMs;
    const memory = terminalJobs.get(requestId);
    const job = memory && memory.finishedAt > cutoff ? memory : readTerminalJob(requestId, cutoff);
    if (!job || (job.status !== "canceled" && job.errorCode !== "JOB_TRACKING_TIMEOUT")) return null;
    const updated = { ...job, meta: normalizeMeta({ ...job.meta, ...patch }) };
    writeTerminalJob(updated);
    return updated;
  })();
  if (!next) return false;
  terminalJobs.set(requestId, next);
  return true;
}
```

A1 re-verified anchors: `abortJob` at current 149–166 calls `finishJob` at 158 before aborting
the controller at 161. `finishJob` at 257–285 preserves existing stopped outcomes; SSE terminal
suppression is at `lib/ssePublish.ts:18–19`. Therefore a known late id needs a durable terminal
metadata write, not another error event. The new helper uses existing imports at `inflight.ts:5–6`
and `terminalStore.ts:59–69`: `readTerminalJob` and the throwing `writeTerminalJob` inside a
transaction. The map is updated only after commit. All outcome, phase, timestamp, duration, HTTP
status and error-code fields stay identical; only task/origin metadata changes. Unknown, completed,
and ordinary failed jobs are not altered, and no active row/controller is created.

## NEW `lib/api88/videoRouteInput.ts`

Anchor: absent. Full contents. A stored generated-image filename may resolve to its previous
provider URL for URL-only families. It may resolve to bytes only for Veo. No upload or HTTP lookup.

```ts
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
    const sidecar = await safeGeneratedFilePath(ctx.config.storage.generatedDir, `${path}.json`);
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
```

## NEW `routes/videoApi88.ts`

Anchor: absent. Full contents. `sleep`/`now` injection is only exposed to server code/tests, never
accepted from request JSON. Failed duplicate/capacity admissions do not publish on another job's bus.

```ts
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { startJob, finishJob, mergeJobMeta, mergeStoppedJobMeta, registerJobAbortController, isStartJobFailure,
  isJobCanceled, isJobTrackingExpired, setJobPhase, INFLIGHT_RETRY_AFTER_SECONDS } from "../lib/inflight.js";
import { publish } from "../lib/eventBus.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { persistVideoArtifact } from "../lib/videoArtifactPersistence.js";
import { generateVideoThumbnail } from "../lib/videoThumb.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { errInfo } from "../lib/errInfo.js";
import { logError } from "../lib/logger.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import { makeGenerationCanceledError, isGenerationCanceledError } from "../lib/generationCancel.js";
import { prepareApi88Video, type Api88PreparedVideo } from "../lib/api88/videoRouteInput.js";
import { generateApi88Video, resumeApi88Video, type Api88VideoEvent,
  type Api88VideoOptions, type Api88VideoResult } from "../lib/api88/videoTransport.js";

export interface Api88VideoRouteDependencies extends Pick<Api88VideoOptions, "sleep" | "now"> {
  thumbnail?: (path: string) => Promise<unknown>;
}
interface Job {
  req: Request; res: Response; ctx: RuntimeContext; requestId: string;
  async: boolean; owned: boolean; finished: boolean; controller: AbortController;
  taskId?: string; prepared?: Api88PreparedVideo; startedAt: number;
  dependencies: Api88VideoRouteDependencies;
}
function emit(job: Job, event: string, data: Record<string, unknown>): void {
  const payload = { requestId: job.requestId, provider: "88api", ...data };
  if (!job.res.writableEnded && !job.res.destroyed && !job.async) {
    job.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
  if (job.owned) {
    if (event === "done" || event === "error") publishJobEvent(job.requestId, event, payload);
    else publish(job.requestId, event, payload);
  }
}
function setup(req: Request, res: Response, ctx: RuntimeContext, dependencies: Api88VideoRouteDependencies): Job {
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId
    ? req.body.requestId : typeof req.body?.clientRequestId === "string" && req.body.clientRequestId
      ? req.body.clientRequestId : req.id;
  const async = req.body?.async === true;
  if (!async) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
  }
  return { req, res, ctx, dependencies, requestId, async, owned: false, finished: false,
    controller: new AbortController(), startedAt: Date.now() };
}
function admit(job: Job, prepared: Api88PreparedVideo): boolean {
  const { req, res, requestId } = job;
  const meta = { kind: "video", provider: "88api", model: prepared.model,
    sessionId: req.body?.sessionId ?? null, clientNodeId: req.body?.clientNodeId ?? null,
    presetIds: Array.isArray(req.body?.presetIds) ? req.body.presetIds : [],
    ...prepared.video, ...(prepared.taskId ? { providerTaskId: prepared.taskId } : {}) };
  const result = startJob({ requestId, kind: "video", prompt: prepared.prompt, meta, respectCanceledTombstone: true });
  if (!result) throw new Error("Video requestId required");
  if (isStartJobFailure(result)) {
    const status = result.code === "TOO_MANY_JOBS" ? 429 : result.code === "GENERATION_CANCELED" ? 499 : 409;
    if (status === 429) res.setHeader("Retry-After", String(INFLIGHT_RETRY_AFTER_SECONDS));
    const payload = { requestId, code: result.code, status, error: result.code };
    if (job.async) res.status(status).json(payload);
    else emit(job, "error", payload);
    return false;
  }
  job.owned = true;
  registerJobAbortController(requestId, job.controller);
  if (job.async) res.status(202).json({ requestId });
  return true;
}
function onEvent(job: Job, event: Api88VideoEvent): void {
  if (event.phase === "submitted") {
    job.taskId = event.providerTaskId;
    try {
      if (!mergeJobMeta(job.requestId, { providerTaskId: event.providerTaskId, api88Origin: event.origin })) {
        if (mergeStoppedJobMeta(job.requestId, { providerTaskId: event.providerTaskId, api88Origin: event.origin })) {
          throw makeGenerationCanceledError();
        }
        throw new Error("Missing admitted job");
      }
    } catch (error) {
      if (isGenerationCanceledError(error)) throw error;
      throw Object.assign(new Error("Could not persist provider task id"), { code: "API88_VIDEO_META_FAILED", status: 500 });
    }
    setJobPhase(job.requestId, "streaming");
  }
  emit(job, event.phase, { providerTaskId: event.providerTaskId, requestedModel: event.model,
    effectiveModel: event.model, api88Origin: event.origin,
    ...(event.phase === "progress" ? { progress: event.progress, status: event.status } : {}) });
}
function assertActive(job: Job): void {
  if (job.controller.signal.aborted || isJobCanceled(job.requestId) || isJobTrackingExpired(job.requestId)) {
    throw makeGenerationCanceledError();
  }
}
async function save(job: Job, result: Api88VideoResult): Promise<Record<string, unknown>> {
  assertActive(job);
  const filename = `${Date.now()}_${randomBytes(job.ctx.config.ids.generatedHexBytes).toString("hex")}.mp4`;
  const elapsed = +((Date.now() - job.startedAt) / 1000).toFixed(1);
  const video = { ...job.prepared!.video, providerTaskId: result.providerTaskId, api88Origin: result.origin };
  const metadata = {
    kind: "video", mediaType: "video", provider: "88api", providerUrl: result.providerUrl,
    providerTaskId: result.providerTaskId, api88Origin: result.origin, requestId: job.requestId,
    sessionId: job.req.body?.sessionId ?? null, clientNodeId: job.req.body?.clientNodeId ?? null,
    prompt: job.prepared!.prompt, userPrompt: job.prepared!.prompt, revisedPrompt: null,
    model: result.model, requestedModel: result.model, effectiveModel: result.model,
    createdAt: Date.now(), elapsed, video,
    presetIds: Array.isArray(job.req.body?.presetIds) ? job.req.body.presetIds : [],
  };
  const directory = job.ctx.config.storage.generatedDir;
  await mkdir(directory, { recursive: true });
  await persistVideoArtifact(directory, filename, result.videoBuffer, metadata);
  try { assertActive(job); }
  catch (error) {
    await Promise.all([unlink(join(directory, filename)), unlink(join(directory, `${filename}.json`))]
      .map((operation) => operation.catch(() => {})));
    throw error;
  }
  invalidateHistoryIndex();
  void (job.dependencies.thumbnail ?? generateVideoThumbnail)(join(job.ctx.config.storage.generatedDir, filename)).catch(() => {});
  finishJob(job.requestId, { meta: { filename, providerTaskId: result.providerTaskId } });
  job.finished = true;
  return { filename, url: `/generated/${encodeURIComponent(filename)}`, providerUrl: result.providerUrl,
    mediaType: "video", model: result.model, requestedModel: result.model, effectiveModel: result.model,
    providerTaskId: result.providerTaskId, revisedPrompt: null, elapsed, video };
}
function failure(job: Job, error: unknown): void {
  const info = errInfo(error);
  const canceled = job.controller.signal.aborted || isJobCanceled(job.requestId) || isGenerationCanceledError(error);
  const normalized = canceled ? errInfo(makeGenerationCanceledError()) : info;
  const status = normalized.status ?? 500;
  const code = normalized.code ?? "API88_VIDEO_FAILED";
  const taskId = job.taskId ?? (error as { providerTaskId?: string } | null)?.providerTaskId;
  if (job.owned && !job.finished) {
    try {
      finishJob(job.requestId, { canceled, status: "error", httpStatus: status, errorCode: code,
        meta: taskId ? { providerTaskId: taskId } : {} });
    } catch (trackingError) {
      logError("api88", "video:finish-failed", trackingError, { requestId: job.requestId });
    }
    job.finished = true;
  }
  const payload = { error: normalized.message, code, status, ...errorEnvelopeFields(normalized.raw),
    ...(taskId ? { providerTaskId: taskId } : {}) };
  if (job.async && !job.res.headersSent) job.res.status(status).json({ requestId: job.requestId, ...payload });
  else emit(job, "error", payload);
}
export async function handleApi88Video(
  req: Request, res: Response, ctx: RuntimeContext, resume = false, dependencies: Api88VideoRouteDependencies = {},
): Promise<void> {
  const job = setup(req, res, ctx, dependencies);
  try {
    if (!ctx.api88VideoKey?.trim()) throw Object.assign(new Error("88API video key required"),
      { code: "API88_VIDEO_KEY_MISSING", status: 401 });
    const prepared = await prepareApi88Video(ctx, (req.body ?? {}) as Record<string, unknown>, resume);
    job.prepared = prepared;
    if (!admit(job, prepared)) return;
    const options: Api88VideoOptions = { ...dependencies, signal: job.controller.signal,
      onEvent: (event) => onEvent(job, event) };
    const result = resume
      ? await resumeApi88Video(ctx, prepared.taskId!, prepared.model, options)
      : await generateApi88Video(ctx, prepared.input!, options);
    emit(job, "done", await save(job, result));
  } catch (error) { failure(job, error); }
  finally { if (!res.writableEnded) res.end(); }
}
export function registerApi88ResumeRoute(
  app: Express, ctx: RuntimeContext, dependencies: Api88VideoRouteDependencies = {},
): void {
  app.post("/api/video/88api/resume", (req, res) => handleApi88Video(req, res, ctx, true, dependencies));
}
```

## MODIFY `routes/video.ts`

Current import anchor line 15:

```ts
import { generateVideoViaGrok, type GrokVideoEvent } from "../lib/grokVideoAdapter.js";
```

Insert immediately before it:

```ts
import { handleApi88Video, registerApi88ResumeRoute, type Api88VideoRouteDependencies } from "./videoApi88.js";
```

Current lines 134–137:

```ts
export function registerVideoRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.post("/api/video/generate", async (req: Request, res: Response) => {
    const requestId =
```

Replace that exact prefix, retaining the existing requestId expression and remaining handler:

```ts
export function registerVideoRoutes(app: Express, ctxRaw: RouteRuntimeContext, api88Dependencies: Api88VideoRouteDependencies = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  registerApi88ResumeRoute(app, ctx, api88Dependencies);
  app.post("/api/video/generate", async (req: Request, res: Response) => {
    if (req.body?.provider === "88api") {
      await handleApi88Video(req, res, ctx, false, api88Dependencies);
      return;
    }
    const requestId =
```

This executes before the legacy SSE setup, provider allowlist (192–193), Grok normalization
(251–260), element compilation (304–353), Grok credential resolution (551–552), and planner dispatch.
Do not simply add 88api to the legacy allowlist; the early handler fully owns its job lifecycle.

## MODIFY `routes/videoExtended.ts`

Reject 88api before any credential, file/frame/planner work or admission. Current handler starts:
lines 220–221 `app.post("/api/video/edit", async ...` + `try {`; 253–254 `/api/video/extend` +
`const requestId = ...`; 350–351 `/api/video/extend/native` + `try {`; 442–443 `/api/video/analyze` +
`try {`. Add this helper after current `videoLane` (74–76):

```ts
function rejectApi88Extended(req: Request, res: Response): boolean {
  if (req.body?.provider !== "88api") return false;
  res.status(400).json({ error: "88API video edit, extend and analysis are unsupported",
    code: "API88_VIDEO_OPTION_UNSUPPORTED", status: 400 });
  return true;
}
```

Exact after-prefixes (remaining bodies unchanged):

```ts
  app.post("/api/video/edit", async (req: Request, res: Response) => {
    if (rejectApi88Extended(req, res)) return;
    try {
```

```ts
  app.post("/api/video/extend", async (req: Request, res: Response) => {
    if (rejectApi88Extended(req, res)) return;
    const requestId = normalizeBodyRequestId(req.body?.requestId, req.id);
```

```ts
  app.post("/api/video/extend/native", async (req: Request, res: Response) => {
    if (rejectApi88Extended(req, res)) return;
    try {
```

```ts
  app.post("/api/video/analyze", async (req: Request, res: Response) => {
    if (rejectApi88Extended(req, res)) return;
    try {
```

Parent-derived last-frame extension already rejects non-Grok providers at current lines 308–309.
The `/api/video/frame` endpoint stays available: it is local frame extraction, not provider generation.

## MODIFY `lib/providers/registry.ts` (010 prerequisite manifest)

Current comparison anchor lines 154–155:

```ts
    id: "atlascloud",
    surfaces: ["generate", "edit", "multimode", "node"],
```

88api itself is absent today. In 010's newly inserted `id: "88api"` object, replace only its
`surfaces` property with this exact after-code:

```ts
    surfaces: ["generate", "edit", "multimode", "node", "video"],
```

Its 25 video entries must use `supports: { generate: true, edit: true, mask: false, streaming: false }`:
`edit: true` is the existing registry convention for reference input (surfaceSupport.ts 17–27 uses it
for `video.references`); it does not advertise an `/api/video/edit` operation. If 010 already used the
shared `EDIT` constant, retain it. Set its `referenceLimits` after-code to:

```ts
    referenceLimits: { video: 30 },
```

The current 010 draft (lines 149 and 38) uses `referenceLimits: {}`; preserve that image policy.
The video number is the maximum table capacity, not per-model permission. Server validation and UI
reference limits narrow it by selected model.
D8 catalog/credential locks already belong to 010, and 020 must not undo them.

## MODIFY `lib/capabilities.ts`

Current line 18:

```ts
import { PROVIDER_SURFACES } from "./providers/surfaceSupport.js";
```

Append import:

```ts
import { API88_VIDEO_SPECS } from "./api88/videoSpecs.js";
```

Current lines 128–130:

```ts
      videoModels: {
        supported: ["grok-imagine-video", "grok-imagine-video-1.5"],
        aliases: {
```

Replace prefix with exact after-code (retain `aliases` and legacy xAI fields):

```ts
      videoModels: {
        supported: ["grok-imagine-video", "grok-imagine-video-1.5"],
        byProvider: {
          "88api": { supported: Object.keys(API88_VIDEO_SPECS), specs: API88_VIDEO_SPECS },
        },
        aliases: {
```

Legacy flat fields stay xAI-specific for old CLI clients. New clients read the provider projection;
never interpret xAI's flat duration/resolution range as 88API limits.

## MODIFY `lib/errors/providerMap.ts`

Current line 135–136 anchor (010 may have inserted image errors before the closing object):

```ts
  ATLASCLOUD_UPLOAD_NO_URL: "INTERNAL_STATE_ERROR",
} as const satisfies Record<string, GenerationErrorClass>;
```

Insert these properties before the closing object. If 010 already added `API88_VIDEO_KEY_MISSING`,
retain that single entry instead of introducing a duplicate.

```ts
  API88_VIDEO_KEY_MISSING: "AUTH_INVALID",
  API88_VIDEO_MODEL_INVALID: "INVALID_REQUEST",
  API88_VIDEO_INVALID_REQUEST: "INVALID_REQUEST",
  API88_VIDEO_OPTION_UNSUPPORTED: "CAPABILITY_UNSUPPORTED",
  API88_VIDEO_REFERENCE_NEEDS_URL: "CAPABILITY_UNSUPPORTED",
  API88_VIDEO_REQUEST_FAILED: "NETWORK_FAILURE",
  API88_VIDEO_SUBMIT_UNCERTAIN: "NETWORK_FAILURE",
  API88_VIDEO_TIMEOUT: "PROVIDER_TIMEOUT",
  API88_VIDEO_FAILED: "NETWORK_FAILURE",
  API88_VIDEO_STATUS_UNKNOWN: "INTERNAL_STATE_ERROR",
  API88_VIDEO_EMPTY_RESULT: "INTERNAL_STATE_ERROR",
  API88_VIDEO_DOWNLOAD_FAILED: "NETWORK_FAILURE",
  API88_VIDEO_META_FAILED: "INTERNAL_STATE_ERROR",
```

Current line 164:

```ts
  GROK_VIDEO_REQUEST_FAILED: { clientError: "CAPABILITY_UNSUPPORTED", serverError: "NETWORK_FAILURE" },
```

Append exact property to `STATUS_DEPENDENT_CODES`:

```ts
  API88_VIDEO_REQUEST_FAILED: { clientError: "CAPABILITY_UNSUPPORTED", serverError: "NETWORK_FAILURE" },
```

401/403 classification follows this repository's status-dependent policy; missing local credentials
are explicitly `AUTH_INVALID`. 429 remains `RATE_LIMITED` through `providerErrorClass` (174–179).

## MODIFY `scripts/generate-provider-types.mjs`

The generator loads standalone TS modules from a data URL (8–18), so videoSpecs has no runtime imports.
Generate a compact UI-only projection into a separate file; do not balloon `providers.ts` with 25
pretty-printed capability objects. Current lines 5–6:

```js
const ROOT = resolve(import.meta.dirname, "..");
const TARGET = resolve(ROOT, "ui/src/generated/providers.ts");
```

After-code:

```js
const ROOT = resolve(import.meta.dirname, "..");
const TARGET = resolve(ROOT, "ui/src/generated/providers.ts");
const VIDEO_TARGET = resolve(ROOT, "ui/src/generated/api88VideoSpecs.ts");
```

Insert after current `surfaceLiteral` (25–32):

```js
function videoOutput(specs) {
  const rows = Object.entries(specs).map(([id, spec]) => {
    const value = { durations: spec.durations, defaultDuration: spec.defaultDuration,
      ratios: spec.ratios, resolutions: spec.resolutions, imageLimit: spec.refs.images,
      veoBase64: spec.veoBase64,
      imageMode: spec.family === "grok" ? "source" : spec.firstFrame ? "both" : "reference" };
    return `  ${JSON.stringify(id)}: ${JSON.stringify(value)}`;
  });
  return `// Generated by scripts/generate-provider-types.mjs. Do not edit.\n\nexport const API88_VIDEO_SPECS = {\n${rows.join(",\n")}\n} as const;\nexport type Api88VideoModel = keyof typeof API88_VIDEO_SPECS;\n`;
}
```

Replace current entire `main` (59–74):

```js
async function main() {
  const [registryModule, surfaceModule, videoModule] = await Promise.all([
    loadTsModule("lib/providers/registry.ts"),
    loadTsModule("lib/providers/surfaceSupport.ts"),
    loadTsModule("lib/api88/videoSpecs.ts"),
  ]);
  const outputs = [[TARGET, buildOutput(registryModule.REGISTRY, surfaceModule)],
    [VIDEO_TARGET, videoOutput(videoModule.API88_VIDEO_SPECS)]];
  for (const [target, expected] of outputs) {
    if (process.argv.includes("--check")) {
      const current = await readFile(target, "utf8").catch(() => "");
      if (current !== expected) {
        console.error(`${target} is stale; run node scripts/generate-provider-types.mjs`);
        process.exitCode = 1;
      }
    } else {
      await writeFile(target, expected);
    }
  }
}
```

## NEW `ui/src/generated/api88VideoSpecs.ts`

Anchor: absent. Full generated contents below. Produce through the generator, not an independent
hand-maintained table. The projection parity test below checks every field against server specs.

```ts
// Generated by scripts/generate-provider-types.mjs. Do not edit.

export const API88_VIDEO_SPECS = {
  "gemini-omni-flash": {"durations":[3,4,5,6,7,8,9,10],"defaultDuration":5,"ratios":["16:9","9:16"],"resolutions":["720p"],"imageLimit":10,"veoBase64":false,"imageMode":"reference"},
  "grok-imagine-video": {"durations":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":8,"ratios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"resolutions":["480p","720p"],"imageLimit":1,"veoBase64":false,"imageMode":"source"},
  "grok-imagine-video-1.5": {"durations":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":8,"ratios":["16:9","9:16","1:1","4:3","3:4","3:2","2:3"],"resolutions":["480p","720p"],"imageLimit":1,"veoBase64":false,"imageMode":"source"},
  "kling-3.0-turbo-720p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1"],"resolutions":["720p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "kling-3.0-turbo-1080p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1"],"resolutions":["1080p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "kling-3.0-turbo-2k": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1"],"resolutions":["2k"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "kling-3.0-turbo-4k": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1"],"resolutions":["4k"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "minimax-h3-768p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":4,"ratios":["1:1","16:9","9:16"],"resolutions":["768p"],"imageLimit":10,"veoBase64":false,"imageMode":"both"},
  "SD2.0 480P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["480p"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "SD2.0 720P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["720p"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "SD2.0 1080P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["1080p"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "SD2.0 4k": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["4k"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "SD2.5 480P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["auto","1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["480p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "SD2.5 720P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["auto","1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["720p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "SD2.5 1080P": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["auto","1:1","21:9","16:9","9:16","3:4","4:3"],"resolutions":["1080p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "Seedance-2.0-720p官方版": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":4,"ratios":["16:9","9:16","1:1","4:3","3:4","21:9"],"resolutions":["720p"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "Seedance-2.0-fast-720p官方版": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":4,"ratios":["16:9","9:16","1:1","4:3","3:4","21:9"],"resolutions":["720p"],"imageLimit":9,"veoBase64":false,"imageMode":"both"},
  "Seedance-2.5-720p官方版": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":4,"ratios":["16:9","9:16","1:1","4:3","3:4","21:9"],"resolutions":["720p"],"imageLimit":30,"veoBase64":false,"imageMode":"both"},
  "seedance-2.0-mini-480p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1","4:3","3:4","21:9"],"resolutions":["480p"],"imageLimit":9,"veoBase64":false,"imageMode":"reference"},
  "seedance-2.0-mini-720p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15],"defaultDuration":5,"ratios":["16:9","9:16","1:1","4:3","3:4","21:9"],"resolutions":["720p"],"imageLimit":9,"veoBase64":false,"imageMode":"reference"},
  "veo-3.1": {"durations":[4,6,8],"defaultDuration":8,"ratios":["16:9","9:16"],"resolutions":["720p","1080p"],"imageLimit":3,"veoBase64":true,"imageMode":"both"},
  "veo-3.1-fast": {"durations":[4,6,8],"defaultDuration":8,"ratios":["16:9","9:16"],"resolutions":["720p","1080p"],"imageLimit":3,"veoBase64":true,"imageMode":"both"},
  "wan3.0-video-480p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["16:9","9:16","1:1","4:3","3:4"],"resolutions":["480p"],"imageLimit":10,"veoBase64":false,"imageMode":"both"},
  "wan3.0-video-720p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["16:9","9:16","1:1","4:3","3:4"],"resolutions":["720p"],"imageLimit":10,"veoBase64":false,"imageMode":"both"},
  "wan3.0-video-1080p": {"durations":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"defaultDuration":5,"ratios":["16:9","9:16","1:1","4:3","3:4"],"resolutions":["1080p"],"imageLimit":10,"veoBase64":false,"imageMode":"both"}
} as const;
export type Api88VideoModel = keyof typeof API88_VIDEO_SPECS;
```

## MODIFY `ui/src/generated/providers.ts`

Current anchors `PROVIDER_MODELS` and `PROVIDER_SURFACE_SUPPORT` are generator outputs (generator
52–56). Run the amended generator after the registry modification. Exact semantic delta to 010's
existing 88api row is its video surface:

```ts
    "video": {"supported":true,"references":true,"mask":false,"streaming":false,"catalogAccess":"static"}
```

`PROVIDER_REFERENCE_LIMITS["88api"]` gains `"video": 30`. All 25 video IDs were already emitted by
010. The generator's complete after-code above supplies the exact output bytes, including any
other existing 010 output; do not hand-edit or replace the unrelated generated lane rows.

## NEW `ui/src/lib/api88Video.ts`

Anchor: absent. Full contents. A typed accessor widens tuple unions before `includes`; model values
are still the generated registry's `VideoModel` union. Reference audio voices are xAI-only.

```ts
import type { VideoModel, VideoResolutionUI } from "../types";
import { API88_VIDEO_SPECS, type Api88VideoModel } from "../generated/api88VideoSpecs";

export interface Api88UiVideoSpec {
  durations: readonly number[]; defaultDuration: number;
  ratios: readonly string[]; resolutions: readonly VideoResolutionUI[];
  imageLimit: number; veoBase64: boolean; imageMode: "source" | "both" | "reference";
}
export const API88_DEFAULT_VIDEO_MODEL: Api88VideoModel = "grok-imagine-video-1.5";
export function isApi88VideoModel(value: unknown): value is Api88VideoModel {
  return typeof value === "string" && Object.hasOwn(API88_VIDEO_SPECS, value);
}
export function api88UiVideoSpec(value: unknown): Api88UiVideoSpec | null {
  return isApi88VideoModel(value) ? API88_VIDEO_SPECS[value] : null;
}
export function api88VideoOptions(): Array<{ value: VideoModel; shortLabel: string }> {
  return (Object.keys(API88_VIDEO_SPECS) as Api88VideoModel[]).map((value) => ({ value, shortLabel: value }));
}
export function api88VideoAxes(state: {
  videoModelSelected?: string | false; videoDuration: number;
  videoResolution: VideoResolutionUI; videoAspectRatio: string;
}, hasImages = false): { duration: number; resolution: VideoResolutionUI; aspectRatio: string } {
  const spec: Api88UiVideoSpec = api88UiVideoSpec(state.videoModelSelected) ?? API88_VIDEO_SPECS[API88_DEFAULT_VIDEO_MODEL];
  return {
    duration: spec.veoBase64 && hasImages ? 8
      : spec.durations.includes(state.videoDuration) ? state.videoDuration : spec.defaultDuration,
    resolution: spec.resolutions.includes(state.videoResolution) ? state.videoResolution : spec.resolutions[0],
    aspectRatio: spec.ratios.includes(state.videoAspectRatio) ? state.videoAspectRatio : spec.ratios[0],
  };
}

export function api88AnimateFields(state: Parameters<typeof api88VideoAxes>[0] & { provider: string }): Partial<{
  duration: number; resolution: VideoResolutionUI; aspectRatio: string;
  mode: "image-to-video" | "reference-to-video";
}> {
  if (state.provider !== "88api") return {};
  const spec = api88UiVideoSpec(state.videoModelSelected) ?? API88_VIDEO_SPECS[API88_DEFAULT_VIDEO_MODEL];
  return { ...api88VideoAxes(state, true),
    mode: spec.imageMode === "reference" ? "reference-to-video" : "image-to-video" };
}
```

## MODIFY `ui/src/types.ts`

Current line 25:

```ts
export type VideoResolutionUI = "480p" | "720p" | "1080p";
```

After:

```ts
export type VideoResolutionUI = "480p" | "720p" | "1080p" | "768p" | "2k" | "4k";
```

Agent's separate `resolution?: "480p" | "720p" | "1080p"` stays unchanged. Shared node/history video
metadata already permits arbitrary string resolution and extra fields (`types.ts` 79–84).

## MODIFY `ui/src/lib/imageModels.ts`

Append after current `import { PROVIDER_MODELS } ...` (line 2):

```ts
import { api88VideoOptions, isApi88VideoModel } from "./api88Video";
```

Replace current `isVideoModelValue` and `normalizeVideoModelValue` (192–204) in full:

```ts
export function isVideoModelValue(v: unknown, provider?: string): v is VideoModel {
  if (provider === "88api") return isApi88VideoModel(v);
  const native = v === GROK_VIDEO_MODEL_BASE || v === GROK_VIDEO_MODEL_15
    || v === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS || v === GROK_VIDEO_MODEL_15_DATED_ALIAS;
  if (provider !== undefined) return (provider === "grok" || provider === "grok-api") && native;
  return native || isApi88VideoModel(v);
}

export function normalizeVideoModelValue(v: unknown, provider?: string): VideoModel | false {
  if (!isVideoModelValue(v, provider)) return false;
  if (provider === "88api") return v;
  return v === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS || v === GROK_VIDEO_MODEL_15_DATED_ALIAS
    ? GROK_VIDEO_MODEL_15 : v;
}

export function getVideoModelOptionsForProvider(provider: string): Array<{ value: VideoModel; shortLabel: string }> {
  if (provider === "88api") return api88VideoOptions();
  return provider === "grok" || provider === "grok-api" ? VIDEO_MODEL_OPTIONS : [];
}
```

Do not extend `VIDEO_MODEL_OPTIONS` itself: ImageModelSelect and legacy xAI components consume that
list without lane qualification. The new scoped getter prevents foreign rows in their native groups.

Current 281–283:

```ts
  if (provider === "grok" || provider === "grok-api") {
    return videoModel ? `${VIDEO_VALUE_PREFIX}${videoModel}` : imageModel;
  }
```

After:

```ts
  if (provider === "grok" || provider === "grok-api" || provider === "88api") {
    const selected = normalizeVideoModelValue(videoModel, provider);
    return selected ? `${VIDEO_VALUE_PREFIX}${selected}` : imageModel;
  }
```

The API88 controls below never call xAI-only `maxVideoDurationUI`/`supportsVideoResolutionUI`; their
native defaults and alias expectations remain unchanged. This is essential for the overlapping Grok
IDs, whose caps differ between providers.

Current line 216 inside `maxVideoDurationUI` is `const normalized = normalizeVideoModelValue(model);`.
Keep this native-only helper scoped after broadening the general persistence recognizer:

```ts
  const normalized = normalizeVideoModelValue(model, "grok");
```

## MODIFY `ui/src/lib/coreSelection.ts`

010 owns the added 88api image default and inference; retain that image work. Append after line 3:

```ts
import { isApi88VideoModel } from "./api88Video";
```

Current line 58:

```ts
  if (normalizeVideoModelValue(video)) return "grok";
```

After (ambiguous shared Grok IDs infer native Grok only without an explicit lane):

```ts
  if (normalizeVideoModelValue(video, "grok")) return "grok";
  if (isApi88VideoModel(video)) return "88api";
```

Current lines 86–87:

```ts
    videoModelSelected: provider === "grok" || provider === "grok-api"
      ? normalizeVideoModelValue(input.videoModelSelected) : false,
```

After:

```ts
    videoModelSelected: normalizeVideoModelValue(input.videoModelSelected, provider),
```

Current lines 149–150:

```ts
    const video = provider === "comfy" ? workflow(row.video)
      : provider === "grok" || provider === "grok-api" ? normalizeVideoModelValue(row.video) : false;
```

After:

```ts
    const video = provider === "comfy" ? workflow(row.video)
      : normalizeVideoModelValue(row.video, provider);
```

## MODIFY `ui/src/store/storeCoreSelectionImpl.ts`

Append after line 9:

```ts
import { API88_DEFAULT_VIDEO_MODEL, api88VideoAxes, api88UiVideoSpec } from "../lib/api88Video";
```

Replace current entire `setCoreVideoSelection` (59–67):

```ts
export function setCoreVideoSelection(model: string | undefined, set: StoreSet, get: StoreGet): void {
  const current = currentSelection(get);
  const provider = current.provider === "88api" ? "88api"
    : current.provider === "grok-api" ? "grok-api" : "grok";
  const fallback = provider === "88api" ? API88_DEFAULT_VIDEO_MODEL : GROK_VIDEO_MODEL_15;
  const next = reconcileCoreSelection({ provider, imageModel: current.imageModel,
    videoModelSelected: normalizeVideoModelValue(model, provider) || fallback });
  commitSelection(current, next, set);
  if (provider === "88api") {
    const axes = api88VideoAxes(get(), get().activeVideoRefCount() > 0);
    set({ videoDuration: axes.duration, videoResolution: axes.resolution, videoAspectRatio: axes.aspectRatio });
    saveVideoDefaults(axes);
    const imageMode = api88UiVideoSpec(next.videoModelSelected)?.imageMode;
    if (imageMode === "source") get().setVideoSingleRefMode("image-to-video");
    if (imageMode === "reference") get().setVideoSingleRefMode("reference-to-video");
  }
}
```

Current line 2 import:

```ts
import { saveGenerationDefaultsPatch } from "./storePersistence";
```

After:

```ts
import { saveGenerationDefaultsPatch, saveVideoDefaults } from "./storePersistence";
```

This preserves a lane-specific video selection across switches, including CJK/space IDs, and resets
incompatible parameter residue immediately when the model is picked. The per-lane memory schema stays.

## MODIFY `ui/src/lib/coreGenerationMode.ts`

Append import after line 1:

```ts
import { isVideoModelValue } from "./imageModels";
```

Current lines 13–15:

```ts
  if ((input.provider === "comfy" && input.comfyVideoWorkflow)
    || ((input.provider === "grok" || input.provider === "grok-api") && input.videoModelSelected)) {
    return "video";
```

After:

```ts
  if ((input.provider === "comfy" && input.comfyVideoWorkflow)
    || isVideoModelValue(input.videoModelSelected, input.provider)) {
    return "video";
```

## MODIFY `ui/src/lib/api-generation.ts`

Current line 277 `provider?: "grok" | "grok-api" | "comfy";` after:

```ts
  provider?: "grok" | "grok-api" | "comfy" | "88api";
```

Append after line 284 `referenceFilenames?: string[];`:

```ts
  firstFrame?: string;
  lastFrame?: string;
  videoMode?: "frames" | "reference";
  generateAudio?: boolean;
  referenceVideos?: Array<{ url: string; duration: number }>;
  referenceAudioUrls?: Array<{ url: string; duration: number }>;
```

Append after line 303 `mediaType: "video";` inside `VideoGenerateDone`:

```ts
  provider?: "grok" | "grok-api" | "comfy" | "88api";
  model?: string;
  providerTaskId?: string;
```

Current submitted callback and cast (325, 347) exact after-code:

```ts
    onSubmitted?: (d: { xaiVideoRequestId?: string; providerTaskId?: string }) => void;
```

```ts
      else if (event === "submitted") handlers.onSubmitted?.(data as { xaiVideoRequestId?: string; providerTaskId?: string });
```

## MODIFY `ui/src/store/storeVideoImpl.ts`

Append import after line 25:

```ts
import { API88_DEFAULT_VIDEO_MODEL, api88VideoAxes, api88AnimateFields } from "../lib/api88Video";
```

Current lines 42–49 are the full `videoLaneFields` function shown in 003. Replace in full:

```ts
export function videoLaneFields(state: AppState): { provider: "grok" | "grok-api" | "comfy" | "88api"; model?: string } {
  if (state.provider === "comfy" && state.comfyVideoWorkflow) {
    return { provider: "comfy", model: state.comfyVideoWorkflow };
  }
  if (state.provider === "88api") {
    return { provider: "88api", model: state.videoModelSelected || API88_DEFAULT_VIDEO_MODEL };
  }
  const provider = state.provider === "grok-api" ? "grok-api" : "grok";
  const model = typeof state.videoModelSelected === "string" ? state.videoModelSelected : undefined;
  return model ? { provider, model } : { provider };
}
```

Insert after that helper:

```ts
function api88RequestOverrides(state: AppState, hasImages: boolean): Record<string, unknown> {
  if (state.provider !== "88api") return {};
  return { ...api88VideoAxes(state, hasImages), referenceAudios: undefined,
    topic: undefined, storyboard: undefined, continueFromVideo: undefined,
    continuityLineage: undefined, elementIds: undefined };
}
```

Current request payload end (170–173):

```ts
      sessionId: requestSessionId,
      clientNodeId: nodeId ?? null,
      ...(providerUrl ? { providerUrl } : {}),
    };
```

After:

```ts
      sessionId: requestSessionId,
      clientNodeId: nodeId ?? null,
      ...(providerUrl ? { providerUrl } : {}),
      ...api88RequestOverrides(get(), refs.length > 0 || Boolean(parentSourceFilename || parentVideoFrameRef || providerUrl)),
    };
```

Do not silently support continuation: inside current line 89 `if (parentNode?.data.imageUrl) {`,
insert before line 90's video-source branch. This exits before admitting a local job:

```ts
        if (get().provider === "88api" && isVideoUrl(parentNode.data.imageUrl)) {
          get().showToast(t("video.api88ContinuationUnsupported"), true);
          return;
        }
```

The server independently rejects direct requests carrying those native options. In `animateImageImpl`
current payload lines 327–330:

```ts
      sourceFilename: filename,
      duration: 5,
      resolution: "480p",
      aspectRatio: "auto",
```

After:

```ts
      sourceFilename: filename,
      duration: 5,
      resolution: "480p",
      aspectRatio: "auto",
      ...api88RequestOverrides(get(), true),
      ...api88AnimateFields(get()),
```

A1: current `storeVideoImpl.ts:326` still has `mode: "image-to-video" as const`. Keep the old
mode for native/Comfy lanes; spreading `api88AnimateFields` last overrides it for 88API using the
generated spec. Omni and both Seedance-mini models choose `reference-to-video`; frame-capable
models choose `image-to-video`. A single generated image resolves through its public sidecar URL
on URL-only models. The server inference also chooses reference mode when `firstFrame` is false.

After each existing `mediaType: "video",` in the two `videoItem` objects (222 and 345), insert:

```ts
        provider: result.provider ?? videoLaneFields(get()).provider,
        model: result.effectiveModel ?? result.requestedModel ?? result.model ?? null,
        providerUrl: result.providerUrl ?? null,
```

After current node-completion `model: ...` at 203 insert:

```ts
                  provider: result.provider ?? videoLaneFields(get()).provider,
```

Current onSubmitted callbacks (178 and 336) after-code in both places:

```ts
        onSubmitted: ({ providerTaskId }) => {
          const inFlight = get().inFlight.map((f) => f.id === flightId
            ? { ...f, phase: "streaming", ...(providerTaskId ? { providerTaskId } : {}) } : f);
          saveInFlight(inFlight);
          set({ inFlight });
        },
```

## MODIFY `ui/src/store/storeTypes.ts`

Current `PersistedInFlight` line 75 `phase?: string;` append:

```ts
  providerTaskId?: string;
```

Replace obsolete comment lines 517–520 after-code:

```ts
   * Kept apart from static videoModelSelected: user workflow IDs are runtime catalog values,
   * while hosted video selections are recognized with both provider and exact model ID.
```

## MODIFY `ui/src/store/storePersistence.ts`

Current model restore line 250:

```ts
      model: normalizeVideoModelValue(p.model),
```

Retain this line: the unqualified recognizer now restores all registered video IDs unchanged.
Core selection reconciliation supplies provider qualification after hydration. Append import after
line 3:

```ts
import type { VideoResolutionUI } from "../types";
```

Current resolution whitelist line 252 after-code:

```ts
      resolution: ["480p", "720p", "1080p", "768p", "2k", "4k"].includes(String(p.resolution))
        ? p.resolution as VideoResolutionUI : "480p",
```

Do not rename persistence keys or change existing xAI fallback parameters.

## NEW `ui/src/components/Api88VideoControls.tsx`

Anchor: absent. Full contents. Reuse the controls kit and translated generic video labels. IDs are
literal display labels, so no 25-entry dynamic translation lookup or alias conversion is needed.

```tsx
import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLaneCatalog } from "../hooks/useLaneCatalog";
import { useI18n } from "../i18n";
import { api88UiVideoSpec, api88VideoAxes, api88VideoOptions, API88_DEFAULT_VIDEO_MODEL } from "../lib/api88Video";
import { Select } from "./controls";
import { DurationSlider } from "./controls/DurationSlider";
import { OptionGroup } from "./OptionGroup";
import type { VideoResolutionUI } from "../types";

function Api88ModelControl() {
  const { t } = useI18n();
  const selected = useAppStore((s) => s.videoModelSelected);
  const select = useAppStore((s) => s.selectVideoModel);
  const snapshot = useLaneCatalog();
  const rows = snapshot.catalog?.["88api"]?.models.video;
  const items = api88VideoOptions()
    .filter((option) => snapshot.phase !== "ready" || rows?.some((row) => row.id === option.value))
    .map((option) => {
      const row = rows?.find((entry) => entry.id === option.value);
      return { value: option.value, label: option.shortLabel,
        disabled: snapshot.phase !== "ready" || row?.executable === false,
        ...(row?.lockReason ? { title: row.lockReason } : {}) };
    });
  return <Select value={selected || API88_DEFAULT_VIDEO_MODEL} items={items}
    onChange={select} ariaLabel={t("mcp.videoModels")} />;
}

function useApi88VideoAxes() {
  const state = useAppStore();
  const refs = state.activeVideoRefCount();
  const axes = api88VideoAxes(state, refs > 0);
  const { setVideoDuration, setVideoResolution, setVideoAspectRatio } = state;
  const imageMode = api88UiVideoSpec(state.videoModelSelected)?.imageMode;
  useEffect(() => {
    if (state.videoDuration !== axes.duration) setVideoDuration(axes.duration);
    if (state.videoResolution !== axes.resolution) setVideoResolution(axes.resolution);
    if (state.videoAspectRatio !== axes.aspectRatio) setVideoAspectRatio(axes.aspectRatio);
    if (imageMode === "source" && state.videoSingleRefMode !== "image-to-video") state.setVideoSingleRefMode("image-to-video");
    if (imageMode === "reference" && state.videoSingleRefMode !== "reference-to-video") state.setVideoSingleRefMode("reference-to-video");
  }, [state.videoDuration, state.videoResolution, state.videoAspectRatio, axes.duration,
    axes.resolution, axes.aspectRatio, setVideoDuration, setVideoResolution, setVideoAspectRatio,
    imageMode, state.videoSingleRefMode, state.setVideoSingleRefMode]);
  return { state, refs, axes };
}

export function Api88VideoControls() {
  const { t } = useI18n();
  const { state, refs, axes } = useApi88VideoAxes();
  const spec = api88UiVideoSpec(state.videoModelSelected) ?? api88UiVideoSpec(API88_DEFAULT_VIDEO_MODEL)!;
  const durations = spec.veoBase64 && refs > 0 ? [8] : [...spec.durations];
  return <div className="right-panel-settings video-controls">
    <Api88ModelControl />
    <div className="option-group">
      <div className="section-title">{t("video.durationTitle")}</div>
      <DurationSlider values={durations} value={axes.duration} ariaLabel={t("video.durationTitle")}
        onChange={(value) => state.setVideoDuration(value ?? spec.defaultDuration)} />
    </div>
    <OptionGroup<VideoResolutionUI> title={t("video.resolutionTitle")}
      items={spec.resolutions.map((value) => ({ value, label: value }))}
      value={axes.resolution} onChange={state.setVideoResolution} />
    <OptionGroup<string> title={t("video.aspectTitle")}
      items={spec.ratios.map((value) => ({ value, label: value }))}
      value={axes.aspectRatio} onChange={state.setVideoAspectRatio} />
    {refs === 1 && spec.imageMode === "both" && <OptionGroup<"image-to-video" | "reference-to-video">
      title={t("video.singleRefTitle")} help={t("video.singleRefHelp")}
      items={[{ value: "image-to-video", label: t("video.singleRef.source") },
        { value: "reference-to-video", label: t("video.singleRef.reference") }]}
      value={state.videoSingleRefMode} onChange={state.setVideoSingleRefMode} />}
  </div>;
}
```

## MODIFY `ui/src/components/VideoControlsPanel.tsx`

Current line 30:

```tsx
export function VideoControlsPanel() {
```

Replace with:

```tsx
function GrokVideoControlsPanel() {
```

Append import after current line 13:

```ts
import { Api88VideoControls } from "./Api88VideoControls";
```

Append new wrapper after the existing component:

```tsx
export function VideoControlsPanel() {
  const provider = useAppStore((state) => state.provider);
  return provider === "88api" ? <Api88VideoControls /> : <GrokVideoControlsPanel />;
}
```

This gates all Grok voices, sound-intent configuration, planner HTTP requests, native series controls,
and automatic Grok 1080p model switching. Existing xAI slider source assertions remain valid.

## NEW `ui/src/lib/api88VideoSelection.ts`

Anchor: absent in the current tree. Full contents. A1 moves all video-group construction and
88api catalog checks out of the existing 505-line component. Type-only `SelectGroup` is verified
at current `ui/src/components/controls/Select.tsx:24–27`; snapshot shape is `laneCatalog.ts:3–8`.

```ts
import type { SelectGroup } from "../components/controls/Select";
import type { LaneCatalogSnapshot } from "./laneCatalog";
import { getVideoModelOptionsForProvider, VIDEO_VALUE_PREFIX } from "./imageModels";

export function coreVideoGroup(
  provider: string, snapshot: LaneCatalogSnapshot, translate: (key: string) => string,
): SelectGroup<string> | null {
  const known = getVideoModelOptionsForProvider(provider);
  if (!known.length) return null;
  const rows = snapshot.catalog?.[provider]?.models.video ?? [];
  const options = known
    .filter((option) => provider !== "88api" || snapshot.phase !== "ready"
      || rows.some((entry) => entry.id === option.value));
  if (!options.length) return null;
  return { label: translate("mcp.videoModels"), items: options.map((option) => {
    const row = rows.find((entry) => entry.id === option.value);
    return { value: `${VIDEO_VALUE_PREFIX}${option.value}`, label: option.shortLabel,
      ...(provider === "88api" && (!row || row.executable === false)
        ? { disabled: true, title: row?.lockReason ?? translate("mcp.unavailable") } : {}) };
  }) };
}

export function canSelectCoreVideo(provider: string, id: string, snapshot: LaneCatalogSnapshot): boolean {
  if (!getVideoModelOptionsForProvider(provider).some((option) => option.value === id)) return false;
  if (provider !== "88api") return true;
  const row = snapshot.catalog?.[provider]?.models.video.find((entry) => entry.id === id);
  return snapshot.phase === "ready" && Boolean(row && row.executable !== false);
}
```

## MODIFY `ui/src/components/GenProviderModelSelect.tsx`

010 already inserts `{ value: "88api", label: "88API" }` after current line 46; no duplicate entry.
Remove current import line 5 `VIDEO_MODEL_OPTIONS,` (after-code empty) and append one import after
the current imageModels import ending at line 9:

```ts
import { coreVideoGroup, canSelectCoreVideo } from "../lib/api88VideoSelection";
```

Current lines 370–371:

```ts
    const laneVideoCount = laneCatalog[provider]?.models.video.length ?? 0;
    const providerSupportsVideo = (provider === "grok" || provider === "grok-api") && laneVideoCount > 0;
```

Exact after-code:

```ts
    const videoGroup = coreVideoGroup(provider, laneSnapshot, t);
```

Current entire video group at 407–415 starts `if (providerSupportsVideo || videoModel) {` and maps
`VIDEO_MODEL_OPTIONS` with `value: `${VIDEO_PREFIX}${option.value}``. 010 only changes that group's
condition. Replace the entire existing group with this single wiring line:

```ts
    if (videoGroup) modelGroups.push(videoGroup);
```

010's fallback line at current 433 remains unchanged:

```ts
          ...(provider === "comfy" || provider === "88api" ? { disabled: true } : {}),
```

Current video-prefix handler at 288–290 is `if (value.startsWith(VIDEO_PREFIX)) {` followed by
`selectVideoModel(value.slice(VIDEO_PREFIX.length));`. Add only one guard; exact after-code:

```ts
    if (value.startsWith(VIDEO_PREFIX)) {
      if (!canSelectCoreVideo(current.provider, value.slice(VIDEO_PREFIX.length), currentSnapshot)) return;
      selectVideoModel(value.slice(VIDEO_PREFIX.length));
      return;
    }
```

These are import/call wiring changes only. Filtering, disabled-row construction and execution locks
live in the NEW helper. `routes/video.ts` likewise retains only the early dispatch and resume-route
registration shown above; all 88api validation, lifecycle and persistence stay in NEW modules.

## MODIFY `ui/src/lib/referenceLimits.ts`

Append import after line 11:

```ts
import { api88UiVideoSpec } from "./api88Video";
```

Current input field line 31 `videoModelSelected: boolean;` after-code preserves boolean compatibility
for existing tests but lets real store callers supply the selected model:

```ts
  videoModelSelected: boolean | string;
```

Current line 35:

```ts
  if (input.videoModelSelected) return Math.min(input.serverLimit, GROK_VIDEO_REF_LIMIT);
```

After:

```ts
  if (input.videoModelSelected) {
    if (input.provider === "88api") {
      const spec = api88UiVideoSpec(input.videoModelSelected);
      return spec ? Math.min(input.serverLimit, spec.imageLimit) : 0;
    }
    const limit = laneLimit(input.provider, "video");
    return Math.min(input.serverLimit, limit ?? GROK_VIDEO_REF_LIMIT);
  }
```

## MODIFY `ui/src/store/useAppStore.ts`

Current line 284:

```ts
    videoModelSelected: Boolean(get().videoModelSelected),
```

After:

```ts
    videoModelSelected: get().videoModelSelected,
```

## MODIFY `ui/src/store/storeNodeGenImpl.ts`

Current line 147:

```ts
    videoModelSelected: Boolean(s.videoModelSelected),
```

After:

```ts
    videoModelSelected: s.videoModelSelected,
```

## MODIFY `ui/src/store/storeHelpers.ts`

Current anchors 96 and 164 are both `phase: typeof ...phase === "string" ? ...phase : undefined,`.
Append after the first (inside `toPersistedInFlightJob`, 82–102):

```ts
    providerTaskId: typeof meta.providerTaskId === "string" ? meta.providerTaskId : undefined,
```

Append after the second (inside `loadInFlight` mapping, 158–171):

```ts
        providerTaskId: typeof x.providerTaskId === "string" ? x.providerTaskId : undefined,
```

`saveInFlight` (343–345) already serializes the complete list, so no writer change is needed.

## MODIFY `ui/src/components/composer/PromptComposerToolbar.tsx`

Current `DEFAULT_IMAGE_MODEL` import at line 3 becomes:

```ts
import { DEFAULT_IMAGE_MODEL } from "../../lib/imageModels";
import { loadCoreSelectionMemory } from "../../store/coreSelectionPersistence";
```

Append selectors after current line 18 `const videoModelSelected = ...`:

```ts
  const provider = useAppStore((s) => s.provider);
  const imageModel = useAppStore((s) => s.imageModel);
```

Current 59–63 after-code (leave outer click callback):

```ts
            if (videoModelSelected) {
              setImageModel(provider === "88api" ? imageModel : DEFAULT_IMAGE_MODEL);
            } else {
              selectVideoModel(provider === "88api" ? loadCoreSelectionMemory()["88api"]?.video : "grok-imagine-video-1.5");
            }
```

Current line 105 is `<div className="composer__storyboard-row">`; close is line 115 `</div>`.
Wrap that exact existing block with `{provider !== "88api" && (` and `)}`. Its opening/closing
after-code is:

```tsx
      {provider !== "88api" && <div className="composer__storyboard-row">
        <button
          type="button"
          className={`composer__tool composer__tool--storyboard${storyboardActive ? " composer__tool--on" : ""}`}
          onClick={toggleStoryboard}
          title={t("prompt.storyboardTitle")}
          aria-pressed={storyboardActive}
        >
          {t("prompt.storyboard")}
        </button>
      </div>}
```

## MODIFY `ui/src/components/GenerationControlsPanel.tsx`

Current line 174 starts `const providerCompat = isGrok`. Replace only that prefix with:

```ts
  const providerCompat = provider === "88api"
    ? { title: t("settings.api88.title"), body: t("settings.api88.compatibility") }
    : isGrok
```

Retain the existing ternary continuation at current 175–182. This explicitly reuses 010's translated
Images/chat/video compatibility description instead of the default GPT Responses description.

Current line 186:

```ts
      selectVideoModel("grok-imagine-video");
```

After:

```ts
      selectVideoModel(provider === "88api" ? undefined : "grok-imagine-video");
```

Current line 219 `{isGrok && (` after:

```tsx
      {(isGrok || provider === "88api") && (
```

010 owns the dictionary copy. The video panel is already selected at current 239–240.

## MODIFY `ui/src/lib/continueFromItem.ts`

This helper must not turn an 88API clip into native Grok continuation. Current lines 25–26:

```ts
  const isVideo = isVideoItem(item as Pick<GenerateItem, "filename" | "url" | "image">);
  const hasPrompt = Boolean(item.prompt);
```

After-code adds the guard before references, prompt or lineage are changed:

```ts
  const isVideo = isVideoItem(item as Pick<GenerateItem, "filename" | "url" | "image">);
  const hasPrompt = Boolean(item.prompt);
  if (isVideo && store.provider === "88api") {
    store.showToast(t("video.api88ContinuationUnsupported"), true);
    return { ok: false, isVideo, hasPrompt };
  }
```

Current line 45–46 fallback after-code:

```ts
    if (!store.videoModelSelected) {
      store.selectVideoModel(store.provider === "88api" ? undefined : "grok-imagine-video-1.5");
    }
```

Append `import { t } from "../i18n";` after current `continueFromItem.ts` line 4's type import.
Use `store.showToast(t("video.api88ContinuationUnsupported"), true);` in the new guard above.
The backend refuses `continueFromVideo`. A future upload/continuation phase owns its UI extension;
wp3 does not claim video edit/extend support.

## MODIFY `routes/modelsApi88.ts` (remove 010's temporary video lock)

Current tree has no `routes/modelsApi88.ts` yet. The re-read current 010 section
`NEW routes/modelsApi88.ts` defines module-private `api88Models` and exports only `api88Lane`.
Apply this wp3 edit inside that prerequisite module; retain the existing `routes/models.ts`
import/call wiring to `api88Lane`. The exact prerequisite function anchor is:

```ts
async function api88Models(ctx: RuntimeContext, kind: ProviderModelKind): Promise<McpModelEntry[]> {
  const live = await getApi88Catalog(ctx, kind);
```

Replace its prerequisite lock expression:

```ts
    const lockReason = !key ? kind === "image" ? "API88_IMAGE_KEY_MISSING" : "API88_VIDEO_KEY_MISSING"
      : kind === "video" ? "API88_VIDEO_NOT_READY" : undefined;
```

Exact after-code:

```ts
    const lockReason = !key ? "API88_IMAGE_KEY_MISSING" : undefined;
```

Its prerequisite capability field currently is:

```ts
      capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
        inputRoles: kind === "image" ? ["text", "image_references"] : ["text"] },
```

Exact after-code for the remaining image projection (video returns before it):

```ts
      capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
        inputRoles: ["text", "image_references"] },
```

The extracted module has no `capabilities()` function. Use this literal DTO shape in both
projections; do not import or invoke the private helper from `routes/models.ts`.

Add the separate video-return branch specified under `videoCatalogProjection.ts` below before this
remaining image-only projection. All video models accept image references. Per-model reference/axis details remain in the capabilities
projection and generated table; D8 registry/live intersection is preserved. No image key can unlock
video rows, and no video key can unlock image rows.

## Additional exact 010 transition edits

MODIFY `routes/video.ts`: remove 010's inserted temporary line after current 174 (010 document 1209):

```ts
      if (provider === "88api") return fail(400, "API88_VIDEO_NOT_READY", "88API video execution is available after wp3");
```

Its exact after-code is the empty string. This deletes one statement, not a file. The new dispatch
at handler entry replaces its refusal. Retain `API88_VIDEO_NOT_READY: "CAPABILITY_UNSUPPORTED",`
from 010 document 1017: 010 also added an Agent-video refusal at document 1140 using that code.
Agent video remains excluded by 000, so this still has a live emission owner. No global readiness
or generation-route/catalog lock may continue using the code after wp3.

MODIFY `lib/providers/registry.ts`: replace 010 document 123–147's 25 `supports: GENERATE_ONLY` rows
with this full exact after-code; this changes only 88api's video rows:

```ts
      { id: "gemini-omni-flash", kind: "video", supports: EDIT },
      { id: "grok-imagine-video", kind: "video", supports: EDIT },
      { id: "grok-imagine-video-1.5", kind: "video", supports: EDIT },
      { id: "kling-3.0-turbo-720p", kind: "video", supports: EDIT },
      { id: "kling-3.0-turbo-1080p", kind: "video", supports: EDIT },
      { id: "kling-3.0-turbo-2k", kind: "video", supports: EDIT },
      { id: "kling-3.0-turbo-4k", kind: "video", supports: EDIT },
      { id: "minimax-h3-768p", kind: "video", supports: EDIT },
      { id: "SD2.0 480P", kind: "video", supports: EDIT },
      { id: "SD2.0 720P", kind: "video", supports: EDIT },
      { id: "SD2.0 1080P", kind: "video", supports: EDIT },
      { id: "SD2.0 4k", kind: "video", supports: EDIT },
      { id: "SD2.5 480P", kind: "video", supports: EDIT },
      { id: "SD2.5 720P", kind: "video", supports: EDIT },
      { id: "SD2.5 1080P", kind: "video", supports: EDIT },
      { id: "Seedance-2.0-720p官方版", kind: "video", supports: EDIT },
      { id: "Seedance-2.0-fast-720p官方版", kind: "video", supports: EDIT },
      { id: "Seedance-2.5-720p官方版", kind: "video", supports: EDIT },
      { id: "seedance-2.0-mini-480p", kind: "video", supports: EDIT },
      { id: "seedance-2.0-mini-720p", kind: "video", supports: EDIT },
      { id: "veo-3.1", kind: "video", supports: EDIT },
      { id: "veo-3.1-fast", kind: "video", supports: EDIT },
      { id: "wan3.0-video-480p", kind: "video", supports: EDIT },
      { id: "wan3.0-video-720p", kind: "video", supports: EDIT },
      { id: "wan3.0-video-1080p", kind: "video", supports: EDIT },
```

## MODIFY `lib/api88/download.ts` (010 prerequisite helper)

No current-source line number: file absent. Verified prerequisite definition is 010 document
642–672. The existing helper is shared by images and video; its reader loop does not explicitly
cancel on AbortSignal. Replace that complete function with the following after-code; leave image
parsers untouched. This gives deterministic cancellation even for stubbed streams that don't
implicitly implement fetch-body abort behavior.

```ts
export async function downloadApi88Bytes(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  if (!/^https:\/\//.test(url)) throw api88Error("API88_DOWNLOAD_FAILED", "88API result URL must use HTTPS", 502);
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "follow", credentials: "omit" });
    if (!response.ok || !response.body) throw api88Error("API88_DOWNLOAD_FAILED", `88API result download HTTP ${response.status}`, 502);
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body.cancel();
      throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
    }
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
        chunks.push(chunk.value);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (typeof (error as { code?: unknown }).code === "string") throw error;
    throw api88Error("API88_DOWNLOAD_FAILED", "88API result download failed", 502);
  }
}
```

## NEW `tests/api88-video-body.test.ts`

Anchor: absent. Full contents. Snapshot expectations are independently enumerated; they are not
computed from the production spec table. Each model is checked with default text input and a real
reference body. Transport tests separately verify endpoint/key isolation.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildApi88VideoBody, type Api88VideoInput } from "../lib/api88/videoBody.ts";
import { API88_VIDEO_SPECS } from "../lib/api88/videoSpecs.ts";

const prompt = "A cube turns slowly";
const image = "https://cdn.example/reference.png?signature=a%2Fb&x=1";
const data = "data:image/png;base64,iVBORw0KGgo=";
const defaults: Array<[string, number, Record<string, unknown>]> = [
  ["gemini-omni-flash", 5, { size: "16:9" }],
  ["grok-imagine-video", 8, { size: "16:9", metadata: { resolution: "480p" } }],
  ["grok-imagine-video-1.5", 8, { size: "16:9", metadata: { resolution: "480p" } }],
  ["kling-3.0-turbo-720p", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-1080p", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-2k", 5, { ratio: "16:9" }],
  ["kling-3.0-turbo-4k", 5, { ratio: "16:9" }],
  ["minimax-h3-768p", 4, { ratio: "1:1" }],
  ["SD2.0 480P", 5, { ratio: "1:1" }],
  ["SD2.0 720P", 5, { ratio: "1:1" }],
  ["SD2.0 1080P", 5, { ratio: "1:1" }],
  ["SD2.0 4k", 5, { ratio: "1:1" }],
  ["SD2.5 480P", 5, { ratio: "auto" }],
  ["SD2.5 720P", 5, { ratio: "auto" }],
  ["SD2.5 1080P", 5, { ratio: "auto" }],
  ["Seedance-2.0-720p官方版", 4, { ratio: "16:9" }],
  ["Seedance-2.0-fast-720p官方版", 4, { ratio: "16:9" }],
  ["Seedance-2.5-720p官方版", 4, { ratio: "16:9" }],
  ["seedance-2.0-mini-480p", 5, { ratio: "16:9" }],
  ["seedance-2.0-mini-720p", 5, { ratio: "16:9" }],
  ["veo-3.1", 8, { size: "1280x720" }],
  ["veo-3.1-fast", 8, { size: "1280x720" }],
  ["wan3.0-video-480p", 5, { ratio: "16:9" }],
  ["wan3.0-video-720p", 5, { ratio: "16:9" }],
  ["wan3.0-video-1080p", 5, { ratio: "16:9" }],
];
const code = (value: unknown) => (value as { code?: string }).code;

for (const [model, duration, fields] of defaults) {
  test(`${model}: exact text and reference body snapshots`, () => {
    assert.deepEqual(buildApi88VideoBody({ model, prompt }), { model, prompt, duration, ...fields });
    const reference = model.startsWith("veo-") ? data : image;
    assert.deepEqual(buildApi88VideoBody({ model, prompt, images: [reference] }),
      { model, prompt, duration, ...fields, images: [reference] });
    assert.equal(buildApi88VideoBody({ model, prompt }).model, model);
    assert.equal("resolution" in buildApi88VideoBody({ model, prompt }), false);
  });
}
test("snapshots cover the exact 25-row inventory", () => {
  assert.equal(defaults.length, 25);
  assert.deepEqual(defaults.map(([id]) => id), Object.keys(API88_VIDEO_SPECS));
});
test("duration, ratio and fixed-resolution validation precede transport", () => {
  for (const change of [{ duration: 3 }, { aspectRatio: "auto" }, { resolution: "720p" }]) {
    assert.throws(() => buildApi88VideoBody({ model: "kling-3.0-turbo-4k", prompt, ...change }),
      (error: unknown) => code(error) === "API88_VIDEO_INVALID_REQUEST");
  }
  assert.equal(buildApi88VideoBody({ model: "SD2.5 720P", prompt, duration: 30 }).duration, 30);
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P ", prompt }),
    (error: unknown) => code(error) === "API88_VIDEO_MODEL_INVALID");
});
test("Veo encodes portrait dimensions, frames and audio under metadata", () => {
  assert.deepEqual(buildApi88VideoBody({ model: "veo-3.1", prompt, resolution: "1080p", aspectRatio: "9:16",
    firstFrame: data, lastFrame: data, generateAudio: false }), {
    model: "veo-3.1", prompt, duration: 8, size: "1080x1920", images: [data, data],
    metadata: { video_mode: "frames", generateAudio: false },
  });
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, duration: 6, images: [data] }));
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, images: [image] }));
  assert.throws(() => buildApi88VideoBody({ model: "veo-3.1", prompt, images: [data, data, data], videoMode: "frames" }));
  assert.deepEqual(buildApi88VideoBody({ model: "veo-3.1", prompt, images: [data, data, data] }).metadata,
    { video_mode: "reference" });
});
test("URL-only families refuse local input and keep URL query byte-exact", () => {
  for (const model of ["grok-imagine-video", "SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    assert.throws(() => buildApi88VideoBody({ model, prompt, images: [data] }),
      (error: unknown) => code(error) === "API88_VIDEO_REFERENCE_NEEDS_URL");
    assert.deepEqual(buildApi88VideoBody({ model, prompt, images: [image] }).images, [image]);
    assert.throws(() => buildApi88VideoBody({ model, prompt, images: ["https://127.0.0.1/a.png"] }));
  }
});
test("family reference placements, caps, exclusive frames and audio flags", () => {
  const model = "kling-3.0-turbo-720p";
  assert.deepEqual(buildApi88VideoBody({ model, prompt, generateAudio: false,
    referenceVideos: [{ url: "https://cdn.example/input.mp4", duration: 8 }] }), {
    model, prompt, duration: 5, ratio: "16:9", generate_audio: false,
    metadata: { referenceVideos: ["https://cdn.example/input.mp4"] },
  });
  const omni = buildApi88VideoBody({ model: "gemini-omni-flash", prompt,
    referenceVideos: [{ url: "https://cdn.example/input.mp4", duration: 10 }] });
  assert.equal(omni.video, "https://cdn.example/input.mp4");
  assert.equal("metadata" in omni, false);
  assert.throws(() => buildApi88VideoBody({ model: "wan3.0-video-480p", prompt, images: Array(11).fill(image) }));
  assert.throws(() => buildApi88VideoBody({ model: "minimax-h3-768p", prompt,
    referenceAudioUrls: [{ url: "https://cdn.example/audio.mp3", duration: 5 }] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.0 720P", prompt,
    images: Array(9).fill(image), referenceVideos: Array(3).fill({ url: "https://cdn.example/v.mp4", duration: 1 }),
    referenceAudioUrls: [{ url: "https://cdn.example/a.mp3", duration: 1 }] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P", prompt, firstFrame: image, images: [image] }));
  assert.throws(() => buildApi88VideoBody({ model: "SD2.5 720P", prompt, lastFrame: image }));
  const input: Api88VideoInput = { model: "SD2.5 720P", prompt, generateAudio: false };
  assert.equal(buildApi88VideoBody(input).generate_audio, false);
  assert.throws(() => buildApi88VideoBody({ model: "SD2.0 720P", prompt, generateAudio: false }));
});
```

## NEW `tests/api88-video-transport.test.ts`

Anchor: absent. Full contents. The fetch capture/restore pattern is exactly the one in current
`tests/atlascloud-provider-contract.test.ts:7–11,38–53`. No injected fetch and no real HTTP traffic.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { generateApi88Video, resumeApi88Video, api88VideoResultUrl, type Api88VideoEvent } from "../lib/api88/videoTransport.ts";
import { downloadApi88Video } from "../lib/api88/videoDownload.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex");
const resultUrl = "https://cdn.example/out.mp4?signature=x%2Fy%2Bz&expires=1";
const code = (error: unknown) => (error as { code?: string }).code;
function ctx(timeout = 900_000) {
  const context = createTestRuntimeContext({ api88ImageKey: "image-only-secret", api88VideoKey: "video-only-secret" });
  return { ...context, config: { ...context.config, api88Provider: {
    ...context.config.api88Provider, baseUrl: "https://gateway.example/v1/", videoTimeoutMs: timeout,
  } } };
}
function clock() {
  let time = 0;
  const sleeps: number[] = [];
  return { now: () => time, sleeps,
    sleep: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); sleeps.push(ms); time += ms; } };
}
interface Call { url: string; method: string; body?: Record<string, unknown>; }
function upstream(states: Array<Record<string, unknown> | Response>, calls: Call[], taskId = "task/a b") {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    assert.ok(!url.includes("/v1/responses"));
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url === resultUrl) {
      assert.equal(headers.get("authorization"), null);
      assert.equal(init?.redirect, "follow");
      assert.equal(init?.credentials, "omit");
      return new Response(mp4);
    }
    assert.equal(headers.get("authorization"), "Bearer video-only-secret");
    assert.equal(headers.get("cookie"), null);
    if (url === "https://gateway.example/v1/videos" && method === "POST") return Response.json({ id: taskId });
    assert.equal(url, `https://gateway.example/v1/videos/${encodeURIComponent(taskId)}`);
    assert.equal(method, "GET");
    const value = states[index++] ?? states.at(-1)!;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
}
const input = { model: "grok-imagine-video-1.5", prompt: "A cube", duration: 4, aspectRatio: "16:9", resolution: "480p" };

test("queued → in_progress → completed waits 4s then 12s, submitted precedes polling", async () => {
  const calls: Call[] = [];
  const events: Api88VideoEvent[] = [];
  const time = clock();
  upstream([{ status: "queued", progress: 100 }, { status: "in_progress", progress: 50 },
    { status: "completed", url: resultUrl }], calls);
  const videoOnly = ctx(); videoOnly.api88ImageKey = undefined;
  const result = await generateApi88Video(videoOnly, input, { ...time, onEvent: (event) => {
    events.push(event);
    if (event.phase === "submitted") assert.equal(calls.length, 1);
  } });
  assert.deepEqual(time.sleeps, [4000, 12_000, 12_000]);
  assert.deepEqual(events.map((event) => event.phase), ["submitted", "progress", "progress"]);
  assert.equal(events[1].progress, 1);
  assert.equal(events[2].progress, 0.5);
  assert.equal(result.providerTaskId, "task/a b");
  assert.equal(result.providerUrl, resultUrl);
  assert.deepEqual(result.videoBuffer, mp4);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
test("failed status rejects even when progress is 100", async () => {
  const calls: Call[] = [];
  upstream([{ status: "failed", progress: 100, url: resultUrl }], calls);
  await assert.rejects(generateApi88Video(ctx(), input, clock()), (error: unknown) => code(error) === "API88_VIDEO_FAILED");
  assert.equal(calls.length, 2);
});
test("three consecutive unknown states fail; a known state resets the counter", async () => {
  const calls: Call[] = [];
  upstream([{ status: "unknown" }, { status: "unknown" }, { status: "queued" },
    { status: "unknown" }, { status: "unexpected" }, {}], calls);
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_STATUS_UNKNOWN");
  assert.equal(calls.filter((call) => call.method === "GET").length, 6);
});
test("waiting timeout never resubmits and retains taskId", async () => {
  const calls: Call[] = [];
  const time = clock();
  upstream([{ status: "queued" }], calls);
  await assert.rejects(generateApi88Video(ctx(16_000), input, time), (error: unknown) => {
    assert.equal((error as { providerTaskId?: string }).providerTaskId, "task/a b");
    return code(error) === "API88_VIDEO_TIMEOUT";
  });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(time.sleeps, [4000, 12_000]);
});
test("ambiguous submit network failure is never retried", async () => {
  let posts = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "POST"); posts += 1;
    throw new TypeError("Socket disappeared after send");
  }) as typeof fetch;
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_SUBMIT_UNCERTAIN");
  assert.equal(posts, 1);
});
test("submit AbortSignal timeout is uncertain and has no second POST", async () => {
  let posts = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    posts += 1;
    assert.ok(init?.signal);
    throw new DOMException("Request timed out after send", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_SUBMIT_UNCERTAIN");
  assert.equal(posts, 1);
});
test("submit HTTP 429 and missing id do not retry", async () => {
  for (const response of [Response.json({}, { status: 429 }), Response.json({ task_id: "legacy-is-not-an-id" })]) {
    let posts = 0;
    globalThis.fetch = (async () => { posts += 1; return response; }) as typeof fetch;
    await assert.rejects(generateApi88Video(ctx(), input, clock()), (error: unknown) =>
      ["API88_VIDEO_REQUEST_FAILED", "API88_VIDEO_SUBMIT_UNCERTAIN"].includes(code(error) ?? ""));
    assert.equal(posts, 1);
  }
});
test("poll HTTP 429 honors Retry-After, 5xx backoff only retries GET", async () => {
  const calls: Call[] = [];
  const time = clock();
  upstream([Response.json({}, { status: 429, headers: { "Retry-After": "7" } }),
    Response.json({}, { status: 503 }), { status: "completed", url: resultUrl }], calls);
  await generateApi88Video(ctx(), input, time);
  assert.deepEqual(time.sleeps, [4000, 7000, 2000]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
test("URL key preference includes nested output/data and keeps query unchanged", () => {
  assert.equal(api88VideoResultUrl({ url: "u", video_url: "v", result_url: "r" }), "u");
  assert.equal(api88VideoResultUrl({ video_url: "v", output: { url: "u" } }), "u");
  assert.equal(api88VideoResultUrl({ video_url: "v", result_url: "r" }), "v");
  assert.equal(api88VideoResultUrl({ data: { output: { result_url: resultUrl } } }), resultUrl);
  assert.equal(api88VideoResultUrl({ status: "completed" }), null);
});
test("resume performs no POST and preserves opaque model/task ids", async () => {
  for (const model of ["SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    const calls: Call[] = [];
    upstream([{ status: "completed", output: { data: "unused", result_url: resultUrl } }], calls);
    const result = await resumeApi88Video(ctx(), "task/a b", model, clock());
    assert.equal(result.model, model);
    assert.equal(calls.some((call) => call.method === "POST"), false);
  }
});
test("space and CJK IDs are sent byte-exact in JSON", async () => {
  for (const model of ["SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    const calls: Call[] = [];
    upstream([{ status: "completed", video_url: resultUrl }], calls);
    await generateApi88Video(ctx(), { model, prompt: "A cube" }, clock());
    assert.equal(calls[0].body?.model, model);
    assert.deepEqual(Buffer.from(String(calls[0].body?.model)), Buffer.from(model));
  }
});
test("image-only or blank video key fails closed without fetch", async () => {
  globalThis.fetch = (async () => { assert.fail("No network when video key is absent"); }) as typeof fetch;
  for (const key of [undefined, "", " "]) {
    const context = ctx(); context.api88VideoKey = key;
    await assert.rejects(generateApi88Video(context, input, clock()),
      (error: unknown) => code(error) === "API88_VIDEO_KEY_MISSING");
    await assert.rejects(resumeApi88Video(context, "saved-task", input.model, clock()),
      (error: unknown) => code(error) === "API88_VIDEO_KEY_MISSING");
  }
});
test("invalid MP4 and declared/streamed oversize never persist or resubmit", async () => {
  for (const response of [new Response("<html>no video</html>"),
    new Response(mp4, { headers: { "Content-Length": String(200 * 1024 * 1024 + 1) } }),
    new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const chunk = new Uint8Array(1024 * 1024);
      for (let i = 0; i < 201; i += 1) controller.enqueue(chunk);
      controller.close();
    } }))]) {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return response;
    }) as typeof fetch;
    await assert.rejects(downloadApi88Video(resultUrl, new AbortController().signal, 200 * 1024 * 1024));
  }
});
test("abort during a stalled body cancels its reader promptly", async () => {
  const controller = new AbortController();
  let canceled = false;
  globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
    start() { queueMicrotask(() => controller.abort()); },
    cancel() { canceled = true; },
  }))) as typeof fetch;
  await assert.rejects(downloadApi88Video(resultUrl, controller.signal, 200 * 1024 * 1024));
  assert.equal(canceled, true);
});
```

## NEW `tests/api88-video-route.test.ts`

Anchor: absent. Full contents. Directly invoke registered handlers with request/response doubles;
there is no localhost HTTP server and no fallback to the original fetch. SQLite/output state is
isolated before importing runtime modules (same pattern as `tests/inflight.test.ts:7–26`).

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Express, Request, Response } from "express";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ima2-api88-video-"));
const oldConfig = process.env.IMA2_CONFIG_DIR;
const oldDb = process.env.IMA2_DB_PATH;
process.env.IMA2_CONFIG_DIR = root;
process.env.IMA2_DB_PATH = join(root, "sessions.db");
const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
const { registerVideoRoutes } = await import("../routes/video.ts");
const { registerVideoExtendedRoutes } = await import("../routes/videoExtended.ts");
const { listJobs, listTerminalJobs, _resetForTests, startJob, finishJob, mergeJobMeta,
  mergeStoppedJobMeta, abortJob, purgeStaleJobs } = await import("../lib/inflight.ts");
const { config } = await import("../config.ts");
const { readTerminalJob } = await import("../lib/jobs/terminalStore.ts");
const { prepareApi88Video } = await import("../lib/api88/videoRouteInput.ts");
const { buildApi88VideoBody } = await import("../lib/api88/videoBody.ts");
const { closeDb } = await import("../lib/db.ts");
const { API88_VIDEO_SPECS } = await import("../lib/api88/videoSpecs.ts");
const { api88VideoModelsForContext } = await import("../lib/api88/videoCatalogProjection.ts");
const originalFetch = globalThis.fetch;
const bytes = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex");
const artifact = "https://cdn.example/video.mp4?sig=A%2FB&keep=1";
test.beforeEach(() => { _resetForTests(); });
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => {
  closeDb(); rmSync(root, { recursive: true, force: true });
  if (oldConfig === undefined) delete process.env.IMA2_CONFIG_DIR; else process.env.IMA2_CONFIG_DIR = oldConfig;
  if (oldDb === undefined) delete process.env.IMA2_DB_PATH; else process.env.IMA2_DB_PATH = oldDb;
});
type Handler = (req: Request, res: Response) => unknown;
function app() {
  const handlers = new Map<string, Handler>();
  const express = { post(path: string, handler: Handler) { handlers.set(path, handler); return this; } } as unknown as Express;
  return { express, handlers };
}
function response() {
  const state = { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false,
    jsonBody: null as Record<string, unknown> | null, chunks: [] as string[], headers: new Map<string, string>(),
    setHeader(key: string, value: string) { this.headers.set(key, value); },
    status(value: number) { this.statusCode = value; return this; },
    json(value: Record<string, unknown>) { this.jsonBody = value; this.headersSent = true; this.writableEnded = true; return this; },
    write(value: string) { this.chunks.push(value); return true; },
    flushHeaders() { this.headersSent = true; },
    end() { this.writableEnded = true; },
  };
  return { state, res: state as unknown as Response };
}
function context() {
  const ctx = createTestRuntimeContext({ rootDir: root, api88VideoKey: "video-key", api88ImageKey: "image-key" });
  return { ...ctx, config: { ...ctx.config, storage: { ...ctx.config.storage, generatedDir: join(root, "generated") },
    api88Provider: { ...ctx.config.api88Provider, baseUrl: "https://api.example" } } };
}
function fixture() {
  const local = app();
  let time = 0;
  registerVideoRoutes(local.express, context(), { now: () => time,
    sleep: async (ms) => { time += ms; }, thumbnail: async () => undefined });
  return local;
}
function events(chunks: string[]) {
  return chunks.join("").split("\n\n").filter(Boolean).map((block) => {
    const name = /^event: (.+)$/m.exec(block)![1];
    const data = JSON.parse(/^data: (.+)$/m.exec(block)![1]) as Record<string, unknown>;
    return { name, data };
  });
}
function upstream(requestId: string, calls: string[]) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url); calls.push(`${init?.method ?? "GET"} ${target}`);
    assert.ok(!target.includes("/v1/responses"));
    const authorization = new Headers(init?.headers).get("authorization");
    if (target === artifact) { assert.equal(authorization, null); return new Response(bytes); }
    assert.equal(authorization, "Bearer video-key");
    if (init?.method === "POST") {
      assert.equal(target, "https://api.example/v1/videos");
      assert.equal(JSON.parse(String(init.body)).model, "SD2.5 720P");
      return Response.json({ id: "task-id" });
    }
    assert.equal(target, "https://api.example/v1/videos/task-id");
    const active = listJobs({ kind: "video" }).find((job) => job.requestId === requestId)!;
    assert.equal(active.meta.providerTaskId, "task-id", "id must be persisted before first poll");
    assert.equal(active.meta.api88Origin, "https://api.example");
    assert.equal(active.meta.sessionId, "session-1");
    assert.equal(active.meta.clientNodeId, "node-1");
    assert.equal(active.meta.model, "SD2.5 720P");
    assert.equal(active.prompt, "A cube");
    return Response.json({ status: "completed", url: artifact });
  }) as typeof fetch;
}
for (const async of [false, true]) {
  test(`generation ${async ? "202" : "legacy SSE"} persists task/model/url provenance`, async () => {
    const local = fixture();
    const calls: string[] = [];
    const id = `generate-${async}`;
    const res = response(); upstream(id, calls);
    await local.handlers.get("/api/video/generate")!({ id, body: {
      requestId: id, async, provider: "88api", model: "SD2.5 720P", prompt: "A cube",
      duration: 30, resolution: "720p", aspectRatio: "auto", sessionId: "session-1", clientNodeId: "node-1",
    } } as Request, res.res);
    assert.equal(res.state.statusCode, async ? 202 : 200);
    if (async) assert.equal(res.state.jsonBody?.requestId, id);
    else {
      const streamed = events(res.state.chunks);
      assert.deepEqual(streamed.map((event) => event.name), ["submitted", "done"]);
      assert.equal(streamed[0].data.providerTaskId, "task-id");
      assert.equal(streamed[1].data.provider, "88api");
    }
    const terminal = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id)!;
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.meta.providerTaskId, "task-id");
    const filename = String(terminal.meta.filename);
    const sidecar = JSON.parse(readFileSync(join(context().config.storage.generatedDir, `${filename}.json`), "utf8"));
    assert.equal(sidecar.provider, "88api");
    assert.equal(sidecar.model, "SD2.5 720P");
    assert.equal(sidecar.video.duration, 30);
    assert.equal(sidecar.video.providerTaskId, "task-id");
    assert.equal(sidecar.providerUrl, artifact);
    assert.equal(sidecar.video.xaiVideoRequestId, undefined);
    assert.ok(!JSON.stringify(sidecar).includes("video-key"));
    const output = readdirSync(context().config.storage.generatedDir);
    assert.ok(output.includes(filename));
    assert.ok(output.includes(`${filename}.json`));
    assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
  });
}
test("resume route has zero upstream POST and preserves task association", async () => {
  const local = fixture(); const res = response(); const calls: string[] = [];
  upstream("resume", calls);
  await local.handlers.get("/api/video/88api/resume")!({ id: "resume", body: {
    taskId: "task-id", model: "SD2.5 720P", prompt: "A cube", sessionId: "session-1", clientNodeId: "node-1",
  } } as Request, res.res);
  assert.equal(calls.some((call) => call.startsWith("POST")), false);
  assert.deepEqual(events(res.state.chunks).map((event) => event.name), ["submitted", "done"]);
  assert.equal(listTerminalJobs({ kind: "video" }).find((job) => job.requestId === "resume")!.status, "completed");
});
test("missing video key blocks before admission and no credential substitution occurs", async () => {
  const local = app(); const ctx = context(); ctx.api88VideoKey = undefined;
  registerVideoRoutes(local.express, ctx);
  globalThis.fetch = (async () => { assert.fail("Missing video key must never fetch"); }) as typeof fetch;
  const res = response();
  await local.handlers.get("/api/video/generate")!({ id: "missing", body: { async: true, provider: "88api",
    model: "SD2.5 720P", prompt: "A cube" } } as Request, res.res);
  assert.equal(res.state.statusCode, 401);
  assert.equal(res.state.jsonBody?.code, "API88_VIDEO_KEY_MISSING");
  assert.equal(listJobs({ kind: "video" }).length, 0);
});
test("video catalog readiness is media-key-specific after removing wp2 lock", () => {
  const ctx = context(); ctx.api88ImageKey = undefined;
  const ids = new Set(Object.keys(API88_VIDEO_SPECS));
  assert.equal(api88VideoModelsForContext(ctx, ids).every((row) => row.executable), true);
  ctx.api88VideoKey = undefined; ctx.api88ImageKey = "image-only";
  assert.equal(api88VideoModelsForContext(ctx, ids).every((row) => !row.executable && row.lockReason === "API88_VIDEO_KEY_MISSING"), true);
});
test("meta merge preserves admission fields and terminal recovery id", () => {
  startJob({ requestId: "merge", kind: "video", prompt: "Original prompt",
    meta: { sessionId: "session-1", clientNodeId: "node-1", model: "SD2.5 720P", provider: "88api" } });
  assert.equal(mergeJobMeta("merge", { providerTaskId: "saved-id" }), true);
  const job = listJobs({ kind: "video" })[0];
  assert.equal(job.prompt, "Original prompt");
  assert.equal(job.meta.clientNodeId, "node-1");
  finishJob("merge", { status: "error", httpStatus: 504, errorCode: "API88_VIDEO_TIMEOUT" });
  assert.equal(listTerminalJobs({ kind: "video" })[0].meta.providerTaskId, "saved-id");
  assert.equal(mergeJobMeta("merge", { providerTaskId: "replacement" }), false);
});
test("reference-only generated-image and provider-URL inputs infer reference mode", async () => {
  const ctx = context();
  mkdirSync(ctx.config.storage.generatedDir, { recursive: true });
  const filename = "reference-only.png";
  const url = "https://cdn.example/reference.png?sig=A%2FB&keep=1";
  writeFileSync(join(ctx.config.storage.generatedDir, filename), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(ctx.config.storage.generatedDir, `${filename}.json`), JSON.stringify({ providerUrl: url }));
  globalThis.fetch = (async () => { assert.fail("Reference resolution must not fetch or submit"); }) as typeof fetch;
  for (const model of ["gemini-omni-flash", "seedance-2.0-mini-480p", "seedance-2.0-mini-720p"]) {
    for (const source of [{ sourceFilename: filename }, { providerUrl: url }]) {
      const prepared = await prepareApi88Video(ctx, { model, prompt: "A cube", ...source }, false);
      assert.equal(prepared.video.mode, "reference-to-video");
      assert.deepEqual(prepared.input?.images, [url]);
      assert.equal(prepared.input?.firstFrame, undefined);
      assert.deepEqual(buildApi88VideoBody(prepared.input!).images, [url]);
    }
  }
});
for (const outcome of ["canceled", "expired"] as const) {
  test(`known task accepted before ${outcome} retains durable metadata without execution`, async () => {
    const id = `late-${outcome}`;
    const local = fixture();
    const res = response();
    const calls: string[] = [];
    let before: ReturnType<typeof listTerminalJobs>[number] | undefined;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      assert.equal(init?.method, "POST");
      assert.equal(String(url), "https://api.example/v1/videos");
      const accepted = Response.json({ id: "accepted-before-stop" });
      const decode = accepted.json.bind(accepted);
      accepted.json = async () => {
        const decoded: unknown = await decode();
        if (outcome === "canceled") abortJob(id);
        else purgeStaleJobs(Date.now() + config.inflight.ttlMs + 1000);
        before = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id);
        return decoded;
      };
      return accepted;
    }) as typeof fetch;
    await local.handlers.get("/api/video/generate")!({ id, body: {
      requestId: id, provider: "88api", model: "SD2.5 720P", prompt: "A cube",
      sessionId: "session-1", clientNodeId: "node-1",
    } } as Request, res.res);
    assert.ok(before);
    const after = listTerminalJobs({ kind: "video" }).find((job) => job.requestId === id)!;
    assert.deepEqual({ ...after, meta: before.meta }, before, "outcome and timestamps must not change");
    assert.equal(after.meta.providerTaskId, "accepted-before-stop");
    assert.equal(after.meta.api88Origin, "https://api.example");
    assert.equal(after.meta.sessionId, "session-1");
    assert.equal(after.meta.clientNodeId, "node-1");
    assert.deepEqual(readTerminalJob(id, 0), after, "late metadata must be persisted, not just kept in memory");
    assert.equal(listJobs({ kind: "video" }).length, 0);
    assert.deepEqual(calls, ["POST https://api.example/v1/videos"], "no poll, download or second submit after stop");
    assert.equal(events(res.state.chunks).some((event) => event.name === "done"), false);
  });
}
test("late metadata never modifies completed or unknown jobs", () => {
  const patch = { providerTaskId: "late-id", api88Origin: "https://api.example" };
  assert.equal(mergeStoppedJobMeta("missing", patch), false);
  startJob({ requestId: "completed", kind: "video" });
  finishJob("completed");
  const before = listTerminalJobs({ kind: "video" })[0];
  assert.equal(mergeStoppedJobMeta("completed", patch), false);
  assert.deepEqual(listTerminalJobs({ kind: "video" })[0], before);
});
test("extended operations reject 88api before any upstream fetch", async () => {
  const local = app(); registerVideoExtendedRoutes(local.express, context());
  globalThis.fetch = (async () => { assert.fail("88API extended operations must not fetch"); }) as typeof fetch;
  for (const path of ["/api/video/edit", "/api/video/extend", "/api/video/extend/native", "/api/video/analyze"]) {
    const res = response();
    await local.handlers.get(path)!({ id: path, body: { provider: "88api", prompt: "A cube" } } as Request, res.res);
    assert.equal(res.state.statusCode, 400);
    assert.equal(res.state.jsonBody?.code, "API88_VIDEO_OPTION_UNSUPPORTED");
  }
});
```

The catalog helper used by this test is defined immediately below. Keep the route suite separate
from the xAI-only `_videoExecutionFixture`, whose auth/endpoint assertions would reject 88API.

## NEW `lib/api88/videoCatalogProjection.ts`

Anchor: absent. Full contents. A pure projection lets tests verify D8/D10 without invoking the catalog
HTTP loader. The actual `/api/models` handler continues to own loading/caching; no second key probe.

```ts
import type { RuntimeContext } from "../runtimeContext.js";
import { API88_VIDEO_SPECS } from "./videoSpecs.js";
export function api88VideoModelsForContext(ctx: Pick<RuntimeContext, "api88VideoKey">, live: ReadonlySet<string> | null) {
  const key = ctx.api88VideoKey?.trim();
  return Object.keys(API88_VIDEO_SPECS).filter((id) => live === null || live.has(id)).map((id) => ({
    id, label: id, executable: Boolean(key),
    ...(!key ? { lockReason: "API88_VIDEO_KEY_MISSING" } : {}),
  }));
}
```

MODIFY `routes/modelsApi88.ts`: append after this exact prerequisite import from 010's
current extracted-module section (the source file is absent until 010 lands):

```ts
import { api88Key, getApi88Catalog } from "../lib/api88/catalog.js";
```

Exact inserted import:

```ts
import { api88VideoModelsForContext } from "../lib/api88/videoCatalogProjection.js";
```

Inside the extracted module's private `api88Models`, immediately after
`const live = await getApi88Catalog(ctx, kind);`,
insert the exact return branch before image projection:

```ts
  if (kind === "video") return api88VideoModelsForContext(ctx, live).map((row): McpModelEntry => ({
    ...row, capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
      inputRoles: ["text", "image_references"] },
  }));
```

The remaining image projection's `lockReason` therefore becomes exactly:

```ts
    const lockReason = !key ? "API88_IMAGE_KEY_MISSING" : undefined;
```

This is the same final expression specified earlier; there is no dead wp2 video lock.
Specs/registry equality is held by the next test, making the pure projection equivalent to registry
intersection while preserving 010's image filtering.

## NEW `tests/api88-video-ui-contract.test.ts`

Anchor: absent. Full contents. Static spec/model-selection behaviors are exercised as values; source
assertions only pin the route and component boundaries that cannot be mounted by node:test.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API88_VIDEO_SPECS as server } from "../lib/api88/videoSpecs.ts";
import { API88_VIDEO_SPECS as ui } from "../ui/src/generated/api88VideoSpecs.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { normalizeVideoModelValue, getVideoModelOptionsForProvider, resolveCoreModelValue } from "../ui/src/lib/imageModels.ts";
import { api88VideoAxes, api88AnimateFields } from "../ui/src/lib/api88Video.ts";
import { reconcileCoreSelection, filterCoreSelectionMemory } from "../ui/src/lib/coreSelection.ts";
import { effectiveCoreGenerationMode } from "../ui/src/lib/coreGenerationMode.ts";
import { effectiveReferenceLimit } from "../ui/src/lib/referenceLimits.ts";
import { loadVideoDefaults, saveVideoDefaults } from "../ui/src/store/storePersistence.ts";
import { coreVideoGroup, canSelectCoreVideo } from "../ui/src/lib/api88VideoSelection.ts";
import type { LaneCatalogSnapshot } from "../ui/src/lib/laneCatalog.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("registry and generated projection are complete and field-exact", () => {
  assert.deepEqual(getProvider("88api").models.filter((row) => row.kind === "video").map((row) => row.id), Object.keys(server));
  assert.deepEqual(Object.keys(ui), Object.keys(server));
  for (const [id, spec] of Object.entries(server)) {
    assert.deepEqual(ui[id as keyof typeof ui], { durations: spec.durations, defaultDuration: spec.defaultDuration,
      ratios: spec.ratios, resolutions: spec.resolutions, imageLimit: spec.refs.images, veoBase64: spec.veoBase64,
      imageMode: spec.family === "grok" ? "source" : spec.firstFrame ? "both" : "reference" });
  }
});
test("all 25 byte-exact selections stay on 88api and render a video-prefixed value", () => {
  for (const id of Object.keys(ui)) {
    assert.equal(normalizeVideoModelValue(id, "88api"), id);
    const selected = reconcileCoreSelection({ provider: "88api", imageModel: "gpt-image-2", videoModelSelected: id });
    assert.equal(selected.provider, "88api");
    assert.equal(selected.videoModelSelected, id);
    assert.equal(resolveCoreModelValue({ provider: "88api", imageModel: "gpt-image-2", videoModel: id,
      comfyVideoWorkflow: "stale-comfy" }), `video:${id}`);
    assert.equal(effectiveCoreGenerationMode({ provider: "88api", uiMode: "classic", multimode: true, videoModelSelected: id }), "video");
  }
  assert.equal(normalizeVideoModelValue("grok-imagine-video-1.5-preview", "88api"), false);
  assert.equal(normalizeVideoModelValue("grok-imagine-video-1.5-preview", "grok"), "grok-imagine-video-1.5");
  assert.equal(normalizeVideoModelValue("SD2.5 720P", "grok"), false);
  assert.equal(normalizeVideoModelValue("SD2.5 720P ", "88api"), false);
});
test("picker options are per provider, with no Grok rows under unrelated lanes", () => {
  assert.equal(getVideoModelOptionsForProvider("88api").length, 25);
  assert.deepEqual(getVideoModelOptionsForProvider("grok").map((row) => row.value),
    ["grok-imagine-video", "grok-imagine-video-1.5"]);
  for (const lane of ["oauth", "api", "gemini-api", "comfy"]) assert.deepEqual(getVideoModelOptionsForProvider(lane), []);
});
test("extracted picker helper retains exact IDs, live intersection and video-key locks", () => {
  const snapshot: LaneCatalogSnapshot = { phase: "ready", observedAt: 1, error: null, catalog: {
    "88api": { status: "ready", models: { image: [], video: [
      { id: "SD2.5 720P", label: "SD2.5 720P", executable: true },
      { id: "Seedance-2.0-720p官方版", label: "Seedance-2.0-720p官方版", executable: false, lockReason: "API88_VIDEO_KEY_MISSING" },
    ] } },
  } };
  const group = coreVideoGroup("88api", snapshot, (key) => key)!;
  assert.deepEqual(group.items.map((row) => row.value), ["video:SD2.5 720P", "video:Seedance-2.0-720p官方版"]);
  assert.equal(group.items[1].disabled, true);
  assert.equal(canSelectCoreVideo("88api", "SD2.5 720P", snapshot), true);
  assert.equal(canSelectCoreVideo("88api", "Seedance-2.0-720p官方版", snapshot), false);
  assert.equal(canSelectCoreVideo("88api", "veo-3.1", snapshot), false);
  assert.equal(coreVideoGroup("oauth", snapshot, (key) => key), null);
});
test("axes expose 30s and fixed 4k, and Veo references require 8s", () => {
  const base = { videoDuration: 30, videoResolution: "4k" as const, videoAspectRatio: "21:9" };
  assert.deepEqual(api88VideoAxes({ ...base, videoModelSelected: "SD2.5 720P" }),
    { duration: 30, resolution: "720p", aspectRatio: "21:9" });
  assert.deepEqual(api88VideoAxes({ ...base, videoModelSelected: "kling-3.0-turbo-4k" }),
    { duration: 5, resolution: "4k", aspectRatio: "16:9" });
  assert.deepEqual(api88VideoAxes({ videoModelSelected: "veo-3.1", videoDuration: 4,
    videoResolution: "1080p", videoAspectRatio: "9:16" }, true),
    { duration: 8, resolution: "1080p", aspectRatio: "9:16" });
});
test("animate payload overrides its legacy mode according to the selected 88API spec", () => {
  for (const model of ["gemini-omni-flash", "seedance-2.0-mini-480p", "seedance-2.0-mini-720p"]) {
    const state = { provider: "88api", videoModelSelected: model, videoDuration: 5,
      videoResolution: "480p" as const, videoAspectRatio: "auto" };
    const payload = { mode: "image-to-video" as const, sourceFilename: "reference-only.png",
      duration: 5, resolution: "480p", aspectRatio: "auto", ...api88AnimateFields(state) };
    assert.equal(payload.mode, "reference-to-video");
    assert.equal(payload.sourceFilename, "reference-only.png");
    assert.equal(payload.resolution, ui[model as keyof typeof ui].resolutions[0]);
  }
  const frameState = { provider: "88api", videoModelSelected: "veo-3.1", videoDuration: 4,
    videoResolution: "720p" as const, videoAspectRatio: "16:9" };
  assert.equal(api88AnimateFields(frameState).mode, "image-to-video");
  assert.equal(api88AnimateFields(frameState).duration, 8);
  assert.deepEqual(api88AnimateFields({ ...frameState, provider: "grok" }), {});
  const source = read("ui/src/store/storeVideoImpl.ts");
  assert.match(source, /mode: "image-to-video" as const,[\s\S]*?\.\.\.api88RequestOverrides\(get\(\), true\),\s*\.\.\.api88AnimateFields\(get\(\)\)/);
});
test("reference cap belongs to the selected provider and model", () => {
  const base = { provider: "88api" as const, serverLimit: 50, mcpProvider: null };
  for (const [id, cap] of [["grok-imagine-video-1.5", 1], ["veo-3.1", 3],
    ["wan3.0-video-480p", 10], ["kling-3.0-turbo-720p", 30]] as const) {
    assert.equal(effectiveReferenceLimit({ ...base, videoModelSelected: id }), cap);
    assert.equal(effectiveReferenceLimit({ ...base, serverLimit: 2, videoModelSelected: id }), Math.min(2, cap));
  }
  assert.equal(effectiveReferenceLimit({ ...base, videoModelSelected: "unknown" }), 0);
});
test("per-lane memory and parameter persistence preserve spaces/CJK and fixed resolution", () => {
  const memory = filterCoreSelectionMemory({ "88api": { kind: "video", image: "gpt-image-2", video: "Seedance-2.0-720p官方版" } });
  assert.equal(memory["88api"]?.video, "Seedance-2.0-720p官方版");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    saveVideoDefaults({ model: "SD2.5 720P", duration: 30, resolution: "720p", aspectRatio: "21:9" });
    assert.deepEqual(loadVideoDefaults(), { model: "SD2.5 720P", duration: 30, resolution: "720p",
      aspectRatio: "21:9", singleRefMode: "image-to-video" });
    saveVideoDefaults({ model: "kling-3.0-turbo-4k", resolution: "4k" });
    assert.equal(loadVideoDefaults().resolution, "4k");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
test("route dispatch and controls isolate 88api from xAI planning and normalize only by its table", () => {
  const route = read("routes/video.ts");
  assert.ok(route.indexOf('req.body?.provider === "88api"') < route.indexOf("normalizeGrokVideoModel(rawModel"));
  assert.ok(route.indexOf("await handleApi88Video") < route.indexOf("await resolveGrokCredential"));
  const panel = read("ui/src/components/VideoControlsPanel.tsx");
  assert.match(panel, /provider === "88api" \? <Api88VideoControls \/> : <GrokVideoControlsPanel \/>/);
  const api88Panel = read("ui/src/components/Api88VideoControls.tsx");
  assert.match(api88Panel, /values=\{durations\}/);
  assert.match(api88Panel, /spec\.resolutions\.map/);
  assert.match(api88Panel, /spec\.ratios\.map/);
  assert.doesNotMatch(api88Panel, /VoicePicker|SoundIntentPicker|grok-planner|GROK_VIDEO_MODEL_15/);
  const store = read("ui/src/store/storeVideoImpl.ts");
  assert.match(store, /provider: "88api", model: state\.videoModelSelected \|\| API88_DEFAULT_VIDEO_MODEL/);
  assert.match(store, /providerTaskId/);
  const picker = read("ui/src/components/GenProviderModelSelect.tsx");
  assert.match(picker, /const videoGroup = coreVideoGroup\(provider, laneSnapshot, t\)/);
  assert.match(picker, /if \(videoGroup\) modelGroups\.push\(videoGroup\)/);
  assert.match(picker, /canSelectCoreVideo\(current\.provider, value\.slice\(VIDEO_PREFIX\.length\), currentSnapshot\)/);
});
```

## Existing tests: exact expected-list and source-contract edits

These are wp3 deltas after 010; don't reapply 010's lane/key/image roster edits. Current-tree anchors
are quoted below. Existing xAI-only tests keep their native lists and caps unchanged.

1. MODIFY `tests/provider-surface-support.test.ts`, current expected matrix lines 23–40, especially
   line 27 `agy: standard, "gemini-api": standard, atlascloud: standard, minimax: standard,`.
   010 inserts `"88api": standard`. Replace only that inserted row with:

   ```ts
     "88api": { ...standard, video: image },
   ```

   Its unsupported-image oracle at current 77 is handled by 010 (only `grok-imagine-edit` is globally
   unsupported). Do not change it to the three shared Grok IDs or back to `[]`.

2. MODIFY `tests/provider-registry-parity.test.ts`, current line 68:

   ```ts
       assert.deepEqual(referenceLimits("video"), { grok: 14, "grok-api": 14 });
   ```

   Exact after-code:

   ```ts
       assert.deepEqual(referenceLimits("video"), { grok: 14, "grok-api": 14, "88api": 30 });
   ```

   Image/edit reference lists do not gain an invented 88api cap. Core IDs and image roster already
   changed in 010 and remain unchanged in wp3. New UI parity test pins all 25 video IDs separately.

3. MODIFY `tests/capabilities-lane-contract.test.ts`, current `EXPECTED_SURFACES` (9–31).
   010's inserted 88api entry has the four image surfaces true and video false. Replace the single
   prerequisite video property with this exact after-code:

   ```ts
       video: { supported: true, references: true, mask: false, streaming: false, catalogAccess: "static" },
   ```

   The exact key roster at current 41–43 already includes 88api after 010; no new lane here.

4. MODIFY `tests/agent-mode-frontend-contract.test.ts`, current line 22:

   ```ts
       assert.match(videoTypes, /VideoResolutionUI = "480p" \| "720p" \| "1080p"/);
   ```

   Exact after-code:

   ```ts
       assert.match(videoTypes, /VideoResolutionUI = "480p" \| "720p" \| "1080p" \| "768p" \| "2k" \| "4k"/);
   ```

   Current line 38 `assert.match(persistence, /p\.resolution === "1080p"/);` after:

   ```ts
       assert.match(persistence, /\["480p", "720p", "1080p", "768p", "2k", "4k"\]\.includes/);
   ```

   Keep lines 21 and 29–37: Agent still only supports native Grok resolutions; the Grok child
   component still contains its native switching/720p-reset code.

5. MODIFY `tests/error-class-coverage.test.ts`, current scanner line 34:

   ```ts
   const PROVIDER_CODE_PATTERN = /\b(?:MINIMAX|GEMINI_API|GROK|AGY|ATLASCLOUD|NAI)_[A-Z0-9_]+\b/g;
   ```

   010 adds API88 to the pattern; retain it. Add these two exact non-error constants to
   `LEXICAL_EXCEPTIONS` (current declaration 35; 010 may already add its image constants):

   ```ts
     "API88_VIDEO_SPECS",
     "API88_DEFAULT_VIDEO_MODEL",
   ```

   These are data constants, not unmapped emitted errors. Keep all actual video error literals mapped.

6. MODIFY `tests/api88-catalog-contract.test.ts` added by 010 (source absent today; verified in 010's
   section headed `NEW tests/api88-catalog-contract.test.ts`). Rename the first test to
   `"registry has 10 image and 25 exact video IDs and all five surfaces"`. Its current prerequisite
   assertion `assert.deepEqual([...manifest.surfaces], ["generate", "edit", "multimode", "node"]);`
   becomes exactly:

   ```ts
     assert.deepEqual([...manifest.surfaces], ["generate", "edit", "multimode", "node", "video"]);
   ```

   Inside `DTO kind locks and readiness`, replace the current prerequisite loop:

   ```ts
       for (const row of lane.models.video) {
         assert.equal(row.executable, false);
         assert.equal(row.lockReason, ctx.api88VideoKey ? "API88_VIDEO_NOT_READY" : "API88_VIDEO_KEY_MISSING");
       }
       assert.equal(lane.surfaces?.video.supported, false);
   ```

   Exact after-code:

   ```ts
       for (const row of lane.models.video) {
         assert.equal(row.executable, Boolean(ctx.api88VideoKey));
         assert.equal(row.lockReason, ctx.api88VideoKey ? undefined : "API88_VIDEO_KEY_MISSING");
       }
       assert.equal(lane.surfaces?.video.supported, true);
   ```

7. MODIFY `tests/api88-image-surfaces-contract.test.ts` added by 010 (source absent today; verified
   in 010's section with this exact filename). Rename `"seven visible rows, lane hints, hidden-model
   restoration and wp2 video lock"` to `"seven visible image rows and independent video selection"`.
   Replace its last prerequisite statement:

   ```ts
     assert.equal(reconcileCoreSelection({ provider: "88api", videoModelSelected: "grok-imagine-video-1.5" }).videoModelSelected, false);
   ```

   After-code:

   ```ts
     assert.equal(reconcileCoreSelection({ provider: "88api", videoModelSelected: "grok-imagine-video-1.5" }).videoModelSelected, "grok-imagine-video-1.5");
   ```

   Replace the complete prerequisite test named `"video route refuses 88api before Grok model and
   credential resolution"`, which searches for `API88_VIDEO_NOT_READY`, with:

   ```ts
   test("video route dispatches 88api before Grok model and credential resolution", () => {
     const source = readFileSync(new URL("../routes/video.ts", import.meta.url), "utf8");
     const guard = source.indexOf('if (req.body?.provider === "88api")');
     assert.ok(guard >= 0);
     assert.ok(guard < source.indexOf("normalizeGrokVideoModel(rawModel"));
     assert.ok(guard < source.indexOf("await resolveGrokCredential"));
     assert.doesNotMatch(source, /API88_VIDEO_NOT_READY/);
   });
   ```

No other existing expected provider/model lists change in wp3. In particular:
`provider-registry-contract`, `models-endpoint-contract` lane-key roster, core-selection image default
roster, CLI image union and provider adapter auth reasons were 010 changes. `duration-slider-contract`,
`video-defaults-persistence-contract`, `xai-video-model-alias-contract`, `video-ref2v-duration-contract`,
and `capabilities-video-modes-contract` retain their xAI assertions. NEW UI tests cover API88's wider
range. Run those existing tests as regressions instead of broadening native-only oracles.

## MODIFY four-locale `settings.api88.compatibility` copy (A1)

Affected files: `ui/src/i18n/en.json`, `ui/src/i18n/ko.json`, `ui/src/i18n/zh-Hans.json`,
`ui/src/i18n/zh-Hant.json`. Current source has no `settings.api88` yet; all four insertion anchors
are current line 1467 `"apiKeys": {`. After 010, replace only `settings.api88.compatibility`.
The exact prerequisite strings below were re-read in 010's four-dictionary section; do not change
010 or the other settings members. No new translation key or dynamic resolver is introduced.

English prerequisite current snippet:

```json
  "compatibility": "GPT images use the Images API; Gemini images use chat completions. Masks, transparent backgrounds and video execution are unavailable in this phase."
```

Exact after-code:

```json
  "compatibility": "GPT images use the Images API; Gemini images use chat completions. Video generation is available with a separate video key. Masks, transparent backgrounds and video edit, extension and analysis are unsupported."
```

Korean prerequisite:

```json
  "compatibility": "GPT 이미지는 Images API, Gemini 이미지는 chat completions를 사용합니다. 이 단계에서는 마스크, 투명 배경, 영상 실행을 지원하지 않습니다."
```

Exact after-code:

```json
  "compatibility": "GPT 이미지는 Images API, Gemini 이미지는 chat completions를 사용합니다. 영상 생성에는 별도의 영상 키가 필요합니다. 마스크, 투명 배경, 영상 편집·연장·분석은 지원하지 않습니다."
```

Simplified Chinese prerequisite:

```json
  "compatibility": "GPT 图像使用 Images API，Gemini 图像使用 chat completions。本阶段不支持蒙版、透明背景和视频执行。"
```

Exact after-code:

```json
  "compatibility": "GPT 图像使用 Images API，Gemini 图像使用 chat completions。视频生成需要独立的视频密钥。不支持蒙版、透明背景以及视频编辑、延长和分析。"
```

Traditional Chinese prerequisite:

```json
  "compatibility": "GPT 圖像使用 Images API，Gemini 圖像使用 chat completions。本階段不支援遮罩、透明背景和影片執行。"
```

Exact after-code:

```json
  "compatibility": "GPT 圖像使用 Images API，Gemini 圖像使用 chat completions。影片生成需要獨立的影片金鑰。不支援遮罩、透明背景以及影片編輯、延長和分析。"
```

## MODIFY localized continuation copy

Files: `ui/src/i18n/en.json`, `ui/src/i18n/ko.json`, `ui/src/i18n/zh-Hans.json`,
`ui/src/i18n/zh-Hant.json`. All current anchors are line 1306, inside the existing `video` object.
Insert one member immediately after the existing member; no dotted root keys.

English current snippet and exact after-code:

```json
    "continuationFallbackT2V": "The continuation frame could not be extracted. Generation will continue as text-to-video.",
    "api88ContinuationUnsupported": "88API video continuation is not supported. Start a new video with a prompt or an image reference.",
```

Korean:

```json
    "continuationFallbackT2V": "이어갈 영상의 마지막 프레임을 추출하지 못했습니다. 텍스트-비디오 방식으로 계속 생성합니다.",
    "api88ContinuationUnsupported": "88API는 영상 이어 만들기를 지원하지 않습니다. 프롬프트나 참고 이미지로 새 영상을 만들어 주세요.",
```

Simplified Chinese:

```json
    "continuationFallbackT2V": "无法提取连续帧。生成将继续以文本到视频的形式进行。",
    "api88ContinuationUnsupported": "88API 暂不支持视频续接。请使用提示词或参考图片生成新视频。",
```

Traditional Chinese:

```json
    "continuationFallbackT2V": "無法提取連續幀。生成將繼續以文字到影片的形式進行。",
    "api88ContinuationUnsupported": "88API 暫不支援影片續接。請使用提示詞或參考圖片生成新影片。",
```

The existing first member in each block is the anchor; the second is the only delta.
Both callers use a literal `t("video.api88ContinuationUnsupported")`, so no dynamic-key signature
registry needs editing. Run the dictionary contract listed below.

## MODIFY `docs/migration/runtime-test-inventory.md` (generated)

Current line 7: `Total: 552 (runtime: 251, contract: 301)`; current runtime section lines 9–32
contains `tests/api-request-budget.test.ts` before `tests/asset-character-bindings.test.ts`.
After 010's four new runtime test files, this PRD adds exactly these four sorted runtime entries:

```md
- `tests/api88-video-body.test.ts`
- `tests/api88-video-route.test.ts`
- `tests/api88-video-transport.test.ts`
- `tests/api88-video-ui-contract.test.ts`
```

Run `node scripts/classify-tests.mjs` to produce the exact full output with the current tree's
unrelated test entries preserved. Its existing implementation (38–55) determines ordering, formatting
and counts. If only 010 and this PRD's new tests are added to today's 552-test tree, exact total after:

```md
Total: 560 (runtime: 259, contract: 301)
```

No handwritten test registry or runner/include changes are needed; discovery is nonrecursive under
`tests/` and all four files import runtime surfaces directly.

## MODIFY `structure/01-file-function-map.md` (generated line-count cells)

Current checked rows include line 90:

```md
| `routes/video.ts` | 689 | `POST /api/video/generate` SSE: Grok video T2V/I2V/Ref2V, active prompt guard, continuation lineage, sidecar persistence |
```

And line 167:

```md
| `lib/inflight.ts` | 462 | SQLite-backed active job registry for classic/node/multimode, abort controllers, cancel state, and terminal job snapshots that survive a restart |
```

Refresh numeric cells with `node scripts/refresh-structure-line-counts.mjs`. The generator (26–29,
37–52) replaces each existing cell with `readFileSync(path).split("\n").length`, preserving the rest
of each row. This is the exact executable replacement algorithm; numbers cannot truthfully be fixed
before the combined 010/020 source is present. Parent may separately add architecture rows for the
new modules, but doing so is not needed for this drift gate. No unrelated structure prose changes.

## Plan deviations

No locked D1–D10 decision changes. The planned generation surface follows the fixed D6/D7 wire,
key isolation, D8 intersection, lane-local D9 defaults and media-specific D10 readiness. The upstream
handoff's first/last-frame semantics require source/reference roles in the body, not just ref counts;
this plan maps them explicitly. Veo first/last inputs become `images` in frames mode, Grok's first
frame becomes `images[0]`, and supported other families use metadata frame fields.

Research corrections and implementation prerequisites:

* 010's completed draft is now readable. Its `referenceLimits: {}` must remain unchanged for images;
  wp3 adds only `video: 30`. Its two temporary video refusals, generation guard and DTO lock, and
  their actual test expectations are removed/replaced explicitly above. Video registry rows gain
  reference support. `API88_VIDEO_NOT_READY` remains mapped solely for 010's excluded Agent-video
  guard; deleting its mapping would break emitted/mapped parity.
* 010's configuration provides `videoSubmitTimeoutMs`, `videoFirstPollMs`, `videoPollIntervalMs`,
  `videoPollTimeoutMs`, `videoTimeoutMs`, `videoDownloadTimeoutMs`, `maxVideoBytes` and
  `videoUnknownStatusLimit`. The transport consumes those exact fields; it does not reuse Grok config.
  `downloadApi88Bytes(url, signal, maxBytes)` and `api88Origin(value)` match the actual 010 draft.
* Omni's default duration and SD2.5's unstated default use 5 seconds as valid app choices. No upstream
  default is asserted. MiniMax/Kling reference-video duration limits are unspecified and stay null;
  Wan 720p has its documented combined 15-second limit, while undocumented other Wan media-duration
  limits stay null. Smaller Wan 480p image/video/audio caps remain exactly 10/5/5 as D7 requires.
* New adjacent implementation files: `lib/api88/videoDownload.ts`, `videoRouteInput.ts`,
  `videoCatalogProjection.ts`, `routes/videoApi88.ts`, `ui/src/lib/api88Video.ts`,
  `ui/src/lib/api88VideoSelection.ts`, `ui/src/components/Api88VideoControls.tsx`, and
  `ui/src/generated/api88VideoSpecs.ts`.
  Required adjacent MODIFY paths beyond the request's named examples are `routes/modelsApi88.ts`,
  `lib/api88/download.ts`, `lib/errors/providerMap.ts`, `ui/src/types.ts`,
  `ui/src/store/storeTypes.ts`, `storeHelpers.ts`, `useAppStore.ts`, `storeNodeGenImpl.ts`,
  `ui/src/lib/coreSelection.ts`, `ui/src/components/GenerationControlsPanel.tsx`,
  `ui/src/components/composer/PromptComposerToolbar.tsx`, `ui/src/lib/continueFromItem.ts`,
  the four dictionaries, and the two generated documentation files above. They are necessary
  implementation dependencies; this planning leaf writes only this single document.
* CLI parameter expansion needs a separate parent-owned scope decision. Current
  `bin/lib/videoMcp.ts:105–112` still has these exact statements:

  ```ts
  const duration = parseInteger(args.duration, 5, "--duration");
  if (duration < 1 || duration > 15) die(2, "--duration must be between 1 and 15");
  const resolution = String(args.resolution ?? "480p");
  if (!VALID_RESOLUTIONS.has(resolution)) die(2, "--resolution must be one of: 480p, 720p, 1080p");
  const aspectRatio = String(args["aspect-ratio"] ?? "auto");
  if (!VALID_ASPECT_RATIOS.has(aspectRatio)) die(2, "--aspect-ratio must be one of: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto");
  if (refs.length > 7) die(2, "max 7 --ref attachments for video");
  ```

  This PRD delivers full model-specific options through Web UI and `/api/video/generate`; it cannot
  claim CLI support for 30 seconds/2k/4k/21:9. The wp4 Grok 4-second 480p 16:9 CLI smoke remains
  inside existing accepted CLI ranges. `lib/videoGenerationRequest.ts:131–139` also remains the
  native agent/CLI normalization contract; Agent-mode 88API video is explicitly outside 000's scope.
  The CLI also always fills `duration: 5`, `resolution: "480p"`, and `aspectRatio: "auto"` when flags
  are absent (`videoMcp.ts:106–110,142–145`). These defaults are invalid for several 88API models;
  accepted-range CLI calls must pass the model's valid axes explicitly until the parent expands
  that CLI validator/defaulting scope. This is a concrete integration limitation, not a claimed
  CLI-ready delivery. D9's global `NO_DEFAULT_MODEL` behavior is unchanged.

These findings are reported, not silently fixed with broader CLI/agent work. No upstream protocol
infeasibility was found from the supplied evidence. Runtime behavior and visual correctness remain
unverified until the parent implements and runs the commands below.

## Verification

Run from `/Users/jun/.codex/worktrees/8112/ima2-gen` **after implementation**, in this order. These
commands are instructions for the parent, not claims that this planning leaf ran them.

```sh
node scripts/generate-provider-types.mjs
node scripts/classify-tests.mjs
node scripts/refresh-structure-line-counts.mjs
node scripts/generate-provider-types.mjs --check
npm run test:inventory
node scripts/refresh-structure-line-counts.mjs --check
npm run typecheck
npm run typecheck:tests
npm run lint
node --experimental-test-module-mocks --import tsx --test tests/api88-video-body.test.ts tests/api88-video-transport.test.ts tests/api88-video-route.test.ts tests/api88-video-ui-contract.test.ts
node --experimental-test-module-mocks --import tsx --test tests/api88-provider-contract.test.ts tests/api88-catalog-contract.test.ts tests/api88-keys-config-contract.test.ts tests/api88-image-surfaces-contract.test.ts
node --experimental-test-module-mocks --import tsx --test tests/provider-registry-contract.test.ts tests/provider-registry-parity.test.ts tests/provider-surface-support.test.ts tests/capabilities-lane-contract.test.ts tests/capabilities-video-modes-contract.test.ts tests/models-endpoint-contract.test.ts tests/error-class-coverage.test.ts tests/i18n-dictionary-contract.test.ts
node --experimental-test-module-mocks --import tsx --test tests/core-selection-reconcile.test.ts tests/core-selection-actions.test.ts tests/core-selection-memory.test.ts tests/core-selection-transport.test.ts tests/core-generation-mode.test.ts tests/model-select-lane-gating.test.ts tests/reference-limits.test.ts tests/inflight.test.ts tests/inflight-persistence.test.ts
node --experimental-test-module-mocks --import tsx --test tests/agent-mode-frontend-contract.test.ts tests/duration-slider-contract.test.ts tests/video-defaults-persistence-contract.test.ts tests/xai-video-model-alias-contract.test.ts tests/video-ref2v-duration-contract.test.ts tests/videoRoute.test.ts tests/videoExtendedRoute.test.ts tests/grokVideoDownload.test.ts
npm --prefix ui run build
rg -n '/v1/responses|/v1/video/generations|task_id|callback_url' lib/api88
rg -n 'API88_VIDEO_NOT_READY' routes ui/src
rg -n 'API88_VIDEO_NOT_READY' lib/agentImageVideoGen.ts lib/errors/providerMap.ts
```

The first two `rg` commands must return no matches (exit 1 is the successful absence result).
The last must match only 010's Agent-video refusal and its error-map entry. Do not
run `npm test`: 000 excludes the full suite. All new tests must fail on unexpected fetch targets and
use only synthetic credentials. No paid generation calls belong to wp3's verification.

Visual check after the UI build: on the existing local studio, select 88API with video-only, image-only,
both and neither key; check lane selection versus operation readiness, catalog intersection, fixed
resolution models, SD2.5's 30 seconds/21:9, Veo's reference duration of 8, and preservation of the two
opaque space/CJK IDs after reload. Check Grok's controls still show native voice/planner options and
88API's controls show only its supported choices. Capture the 88API video model picker and two model
control states for PR screenshot evidence. Keep screenshots off the implementation branch; attach
through the existing PR-assets workflow only when the parent reaches its authorized PR/push phase.

## Audit fold (A1)

* Blocker 1: `lib/api88/videoRouteInput.ts::modeFor` now infers reference mode for Omni and both
  Seedance-mini models with a lone source filename/provider URL. `ui/src/lib/api88Video.ts` adds
  `api88AnimateFields`; `animateImageImpl` spreads it last to override its legacy opening-frame mode.
  `tests/api88-video-route.test.ts` covers generated images carrying public sidecar URLs and direct
  provider URLs; `tests/api88-video-ui-contract.test.ts` covers the actual animate payload override.
* Blocker 2: `lib/inflight.ts` adds `mergeStoppedJobMeta`, a checked transactional persistence of late
  task/origin metadata into an existing canceled/expired record. `routes/videoApi88.ts::onEvent`
  invokes it when the active merge loses the race, then stops before phase advancement/polling.
  The route tests stop the job after decoding an accepted id but before submit bookkeeping, cover
  cancellation and tracking expiry, compare persisted and in-memory records, preserve outcome and
  timestamps, and assert exactly one POST with no subsequent upstream traffic or success event.
* 010 audit nit 2: the four-locale `settings.api88.compatibility` section replaces the prerequisite
  phase-one copy with video generation/separate-key wording while retaining unsupported-feature
  boundaries. Current dictionary insertion anchors and all four prerequisite strings were re-read.
* Parent's oversized-file decision: `routes/video.ts` keeps only import, early-dispatch and resume
  registration wiring. `GenProviderModelSelect.tsx` now calls the NEW `api88VideoSelection.ts` helper
  for filtering, group construction and execution locks; no non-trivial wp3 logic is added there.
  The UI contract tests cover that helper's exact IDs, live intersection, locks and wiring calls.
* Only this document was edited. Affected anchors were re-verified with local source reads; builds,
  tests, network calls and Git writes were not run. 030-specific blockers/nits remain parent-owned.
* Cross-doc re-audit: both DTO edit points and the video-projection import now target
  `routes/modelsApi88.ts`, matching 010's private `api88Models` and exported `api88Lane` exactly.
  Both capability projections use the literal `verified-contract` DTO with empty aspect/parameter
  lists and `inputRoles: ["text", "image_references"]`; no nonexistent `capabilities()` call remains.
  `McpModelEntry` is the existing type import and annotates the new video map callback.
  The required-path list was corrected; `routes/models.ts` retains 010's minimal import/call wiring.
