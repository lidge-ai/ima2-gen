import type { MediaPrice, MediaTask } from "../../contract.js";

/** One OpenRouter video model with the capability lists its catalog publishes. */
export interface OpenRouterCatalogEntry {
  id: string;
  upstream: string;
  label: string;
  vendor: string;
  tasks: readonly MediaTask[];
  resolutions: readonly string[];
  /** Positive durations in seconds; allowAutoDuration means -1 is also accepted. */
  durations: readonly number[];
  allowAutoDuration: boolean;
  aspectRatios: readonly string[];
  frames: readonly string[];
  audio: boolean;
  seed: boolean;
  pricing: readonly MediaPrice[];
}
