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

/**
 * One media input a task needs. Together the entries for a task are a form the route accepts: a client
 * that sends exactly these (and the required options) has a valid request. A route may take other shapes
 * too (a saved avatar id, a text-to-speech line) through vendorOptions; those are not listed here.
 */
export interface MediaInputRequirement {
  role: MediaInputRole;
  min: number;
  max: number;
  /** Tasks this applies to. Absent: every task of the spec. */
  tasks?: readonly MediaTask[];
  /** The job is billed per second of this input; with several, the longest one is the upper bound. */
  billedLength?: boolean;
}

/** The request fields every media job shares; a task on a route may take only some of them. */
export type MediaTaskFieldName = "prompt" | "negativePrompt" | "durationSec" | "resolution" | "aspectRatio" | "audio" | "seed";

/** The common fields one task takes on one route. The adapter refuses any other field of MediaTaskFieldName. */
export interface MediaTaskFields {
  accepts: readonly MediaTaskFieldName[];
  /** The task does not run without these. Each is also in accepts. */
  requires?: readonly MediaTaskFieldName[];
  /** The values this task takes, when they differ from the route's lists. Only for fields in accepts. */
  durationsSec?: readonly number[];
  resolutions?: readonly string[];
  aspectRatios?: readonly string[];
}

/** A vendorOptions key a client can show as a setting. */
export interface MediaOptionSpec {
  /** The vendorOptions key. */
  name: string;
  /** "voice": an id from the route's voice list (adapter.listVoices, GET /api/media/voices). */
  type: "enum" | "text" | "boolean" | "voice";
  /** For "enum", in the provider's spelling. */
  values?: readonly string[];
  required?: boolean;
  /** Tasks this applies to. Absent: every task of the spec. */
  tasks?: readonly MediaTask[];
  maxLength?: number;
}

/** One voice a text-to-speech route can use; id is the value of its "voice" option. */
export interface MediaVoice {
  id: string;
  name: string;
  description?: string;
  /** Language tag as the provider gives it ("en", "ko"). */
  language?: string;
  gender?: "female" | "male" | "neutral";
  /** A sample a browser can play without credentials. Absent when the provider's sample needs the key. */
  previewUrl?: string;
  /** The key's own voice (cloned or created), as opposed to the provider's library. */
  owned?: boolean;
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
    /**
     * A free length in seconds instead of a list (audio). Informational for forms: the adapter checks the value.
     * tasks limits it to some of the spec's tasks; required means the task cannot run without a length.
     */
    durationRange?: { minSec: number; maxSec: number; tasks?: readonly MediaTask[]; required?: boolean };
    resolutions?: readonly string[];
    aspectRatios?: readonly string[];
    /** Quality tiers the route accepts and prices separately ("low", "medium", "high"), in the provider's spelling. */
    qualities?: readonly string[];
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    nativeAudio?: boolean;
    negativePrompt?: boolean;
    seed?: boolean;
    /** Inputs a task needs besides the prompt (lip-sync, avatar, dubbing, subtitles). Absent: the task's usual inputs. */
    inputs?: readonly MediaInputRequirement[];
    /** vendorOptions a client can offer for this route. */
    options?: readonly MediaOptionSpec[];
    /**
     * What an edit, extend or upscale task takes on this route, where that differs from the lists above
     * (an edit that follows its source takes no length or ratio). Absent for a task: no declaration, and
     * a client falls back to the lists above as before.
     */
    taskFields?: Partial<Record<MediaTask, MediaTaskFields>>;
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
  /**
   * The route needs no key: it runs on something the user already operates (a local ComfyUI server).
   * Such a route is always "keyed" for route selection, envVars may be empty, and no key is stored,
   * validated or asked for. Whether its server is reachable is a separate question, answered at submit.
   */
  keyless?: true;
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
  /** One of spec.params.qualities. */
  quality?: string;
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
  | { status: "queued" | "running"; progress?: number; pollAfterMs?: number; /** What it is doing now, in a few words ("3 ahead in the queue", "KSampler 7/20"). */ detail?: string }
  | { status: "succeeded"; outputs: readonly MediaOutput[]; billed?: { usd?: number; units?: number; unit?: MediaPrice["unit"] } }
  | { status: "failed"; error: MediaProviderError }
  | { status: "canceled" };

/** What a job on a "local" route costs: no provider charge, only time on the user's own machine. */
export interface MediaLocalEstimate {
  /** Seconds a run is expected to take, from this machine's own past runs. null when there is no record; never guessed. */
  expectedSec: number | null;
  /** Where expectedSec came from, e.g. "median of 5 runs", or "no runs yet". */
  basis: string;
  /** The job may still be charged by someone else (a workflow that calls paid nodes). ima2 cannot price that. */
  mayBill: boolean;
}

export interface MediaProviderAdapter {
  /** Lane id, lowercase kebab: "fal", "replicate", "byteplus", "kling". */
  readonly id: string;
  readonly label: string;
  /**
   * "direct" calls the model maker; "aggregator" resells many makers under one key; "local" runs on
   * the user's own machine or server, with no provider price.
   */
  readonly route: "direct" | "aggregator" | "local";
  readonly errorPrefix: string;
  readonly credential: MediaCredentialSpec;
  /** How inputs must arrive: public URL, base64 in the body, or the adapter's own upload call. */
  readonly inputTransport: "url" | "inline" | "upload";
  /** Compiled catalog. Aggregators with huge catalogs list the curated set here. */
  listModels(): readonly MediaModelSpec[];
  /**
   * Set when listModels() changes while the server runs (workflows a user registers). The registry
   * then reads it on every lookup instead of once. Every id it returns starts with idPrefix, which no
   * other adapter's model may use, so a live model can never shadow or join a compiled one.
   */
  readonly liveModels?: { readonly idPrefix: string };
  /** For route "local": the time a run is expected to take. Absent means unknown. */
  estimateLocal?(spec: MediaModelSpec): MediaLocalEstimate;
  /** Live catalog for adapters whose upstream exposes one. */
  discoverModels?(ctx: MediaAdapterContext): Promise<readonly MediaModelSpec[]>;
  /** The voices this key can speak with, for routes with a "voice" option. A free read; never a generation. */
  listVoices?(ctx: MediaAdapterContext): Promise<readonly MediaVoice[]>;
  /** A free call that proves the key works. Never a generation. */
  validateKey(ctx: MediaAdapterContext): Promise<{ ok: boolean; reason?: string }>;
  /** Required when inputTransport is "upload". */
  uploadInput?(ctx: MediaAdapterContext, input: MediaInput): Promise<{ url: string }>;
  submit(ctx: MediaAdapterContext, request: MediaSubmitRequest): Promise<MediaJobRef>;
  poll(ctx: MediaAdapterContext, job: MediaJobRef): Promise<MediaJobState>;
  cancel?(ctx: MediaAdapterContext, job: MediaJobRef): Promise<void>;
  normalizeError(error: unknown): MediaProviderError;
}

