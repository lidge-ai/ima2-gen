import type { MediaKind, MediaModelSpec, MediaPrice, MediaProviderAdapter, MediaSubmitRequest } from "./contract.js";
import type { ResolvedMediaCredential } from "./credentials.js";
import type { InputLengthProbe } from "./inputLength.js";
import type { MediaRegistry } from "./registry.js";

export interface MediaRunnerDeps {
  registry: MediaRegistry;
  generatedDir: string;
  configFile: string;
  /** Where POST /api/media/inputs stores uploads; outside generatedDir so they stay out of history. */
  inputsDir: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Transport handed to adapters and used for downloads. Tests inject a fake. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxWaitMs?: number;
  maxInputBytes?: number;
  maxDownloadBytes?: number;
  /** Video/image thumbnails need ffmpeg/sharp; tests turn them off. */
  thumbnails?: boolean;
  /** Measures an uploaded input for jobs billed by input length; defaults to ffprobe. Tests inject a fake. */
  probeInputLength?: InputLengthProbe;
}

export interface PreparedMediaJob {
  adapter: MediaProviderAdapter;
  spec: MediaModelSpec;
  request: MediaSubmitRequest;
  credential: ResolvedMediaCredential;
}

export interface SavedMediaOutput {
  kind: MediaKind;
  filename: string;
  url: string;
  mediaType: MediaKind;
  mimeType: string;
  bytes: number;
}

export interface MediaJobResult {
  requestId: string;
  adapter: string;
  model: string;
  providerJobId: string;
  outputs: readonly SavedMediaOutput[];
  billed?: { usd?: number; units?: number; unit?: MediaPrice["unit"] };
  elapsed: number;
}

export interface MediaLaunchOptions {
  requestId: string;
  sessionId?: string | null;
  clientNodeId?: string | null;
  /** Aborting this cancels the job (used by workflows for their steps). */
  parentSignal?: AbortSignal;
  /** Extra sidecar metadata, e.g. the workflow and step that produced the file. */
  meta?: Record<string, unknown>;
  /** Published-price estimate made at submit time; saved beside the output so a result can show it. */
  estimate?: { usd: number | null; basis: string };
}

export const DEFAULT_POLL_MS = 3_000;
export const MIN_POLL_MS = 500;
export const MAX_POLL_MS = 30_000;
export const DEFAULT_MAX_WAIT_MS = 30 * 60_000;
export const MAX_POLL_RETRIES = 3;
export const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;
export const DEFAULT_MAX_INPUT_BYTES = 512 * 1024 ** 2;
