/**
 * Media provider contract for the Sume-parity lanes (devlog/_plan/261126_sume_parity_byok_aggregators).
 *
 * One shape for every BYOK vendor and aggregator that runs an asynchronous
 * generation job: submit, poll until terminal, read outputs. The adapter owns
 * the vendor wire format and its error vocabulary. The caller owns job
 * lifecycle, cancellation, retries, downloads and persistence.
 *
 * Adapters are pure with respect to I/O: every network call goes through
 * ctx.fetch, so tests inject a fake transport and never reach a paid endpoint.
 */

export type MediaKind = "image" | "video" | "audio";

export type MediaTask =
  | "text-to-image" | "image-to-image" | "image-upscale" | "image-vectorize" | "image-segment"
  | "text-to-video" | "image-to-video" | "reference-to-video" | "video-to-video" | "video-extend"
  | "video-upscale" | "lipsync" | "avatar" | "dubbing" | "subtitles"
  | "text-to-audio" | "video-to-audio";

export type MediaInputRole =
  | "first-frame" | "last-frame" | "reference-image" | "reference-video" | "reference-audio"
  | "source-image" | "source-video" | "source-audio" | "mask";

export interface MediaInput {
  role: MediaInputRole;
  /** Exactly one of url or bytes. The caller uploads or inlines per adapter.inputTransport. */
  url?: string;
  bytes?: Uint8Array;
  mimeType: string;
}

export interface MediaPrice {
  /** What one unit of usd buys. */
  unit: "second" | "image" | "request" | "megapixel" | "1k-tokens" | "minute" | "character";
  usd: number;
  /** Which variant the price applies to, e.g. "720p", "1080p+audio". Absent means all. */
  variant?: string;
  /** Official page the number was read from, and the day it was read (YYYY-MM-DD). */
  source: string;
  checkedAt: string;
}

export interface MediaModelSpec {
  /** Stable ima2 id: "<vendor>/<model>", matching Sume's public id where one exists. */
  id: string;
  /** The id sent on the wire to this adapter's upstream. */
  upstreamId: string;
  /** Model maker, independent of which adapter routes to it. */
  vendor: string;
  label: string;
  kind: MediaKind;
  tasks: readonly MediaTask[];
  params: {
    durationsSec?: readonly number[];
    resolutions?: readonly string[];
    aspectRatios?: readonly string[];
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    nativeAudio?: boolean;
    negativePrompt?: boolean;
    seed?: boolean;
  };
  /** Empty when the vendor publishes no price; never guessed. */
  pricing: readonly MediaPrice[];
  docsUrl: string;
}

export interface MediaCredentialSpec {
  /** Key name in ima2's key store and UI, e.g. "fal", "byteplus". */
  keyVocabulary: string;
  envVars: readonly string[];
  configKey: string;
  keyPrefix?: string;
  /** Where a user creates the key. */
  consoleUrl: string;
  /** Extra non-secret fields some vendors need (region, endpoint id, access-key pair). */
  extraFields?: readonly { name: string; envVar: string; secret: boolean; required: boolean }[];
}

export interface MediaAdapterContext {
  apiKey: string;
  /** Values for credential.extraFields, keyed by name. */
  extra?: Readonly<Record<string, string>>;
  baseUrl?: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export interface MediaSubmitRequest {
  /** MediaModelSpec.id */
  model: string;
  task: MediaTask;
  prompt?: string;
  negativePrompt?: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  audio?: boolean;
  count?: number;
  inputs: readonly MediaInput[];
  /** Vendor-specific passthrough, validated by the adapter. Unknown keys are refused, not dropped. */
  vendorOptions?: Readonly<Record<string, unknown>>;
}

export interface MediaJobRef {
  providerJobId: string;
  /** Hint for the first poll delay. */
  pollAfterMs?: number;
  /** Anything poll() needs besides the id (status url, model path, region). JSON-serializable. */
  resume?: Readonly<Record<string, string>>;
}

export interface MediaOutput {
  kind: MediaKind;
  /** Exactly one of url or bytes. */
  url?: string;
  bytes?: Uint8Array;
  mimeType: string;
  /** Vendor URLs often expire; ISO time when known. */
  expiresAt?: string;
  /** Headers the download needs (some vendors require the API key on the asset URL). */
  downloadHeaders?: Readonly<Record<string, string>>;
}

export interface MediaProviderError {
  /** "<ERROR_PREFIX>_<REASON>", e.g. "FAL_INSUFFICIENT_CREDIT". */
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  /** Normalized class so the UI can react without knowing the vendor. */
  category: "auth" | "quota" | "rate-limit" | "invalid-request" | "moderation" | "not-found" | "upstream" | "timeout" | "unknown";
  providerState?: string;
}

export type MediaJobState =
  | { status: "queued" | "running"; progress?: number; pollAfterMs?: number }
  | { status: "succeeded"; outputs: readonly MediaOutput[]; billed?: { usd?: number; units?: number; unit?: MediaPrice["unit"] } }
  | { status: "failed"; error: MediaProviderError }
  | { status: "canceled" };

export interface MediaProviderAdapter {
  /** Lane id, lowercase kebab: "fal", "replicate", "byteplus", "kling". */
  readonly id: string;
  readonly label: string;
  /** "direct" calls the model maker; "aggregator" resells many makers under one key. */
  readonly route: "direct" | "aggregator";
  readonly errorPrefix: string;
  readonly credential: MediaCredentialSpec;
  /** How inputs must arrive: public URL, base64 in the body, or the adapter's own upload call. */
  readonly inputTransport: "url" | "inline" | "upload";
  /** Compiled catalog. Aggregators with huge catalogs list the curated set here. */
  listModels(): readonly MediaModelSpec[];
  /** Live catalog for adapters whose upstream exposes one. */
  discoverModels?(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]>;
  /** A free call that proves the key works. Never a generation. */
  validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }>;
  /** Required when inputTransport is "upload". */
  uploadInput?(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }>;
  submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef>;
  poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState>;
  cancel?(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void>;
  normalizeError(error: unknown): MediaProviderError;
}

