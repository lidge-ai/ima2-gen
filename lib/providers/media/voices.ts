import { createHash } from "node:crypto";
import type { MediaVoice } from "./contract.js";

export interface VoiceList {
  voices: readonly MediaVoice[];
  /** When the list was read from the provider (ms since epoch). */
  fetchedAt: number;
  /** True when this answer came from the cache. */
  cached: boolean;
}

export interface VoiceCache {
  get(adapterId: string, apiKey: string, load: () => Promise<readonly MediaVoice[]>, refresh?: boolean): Promise<VoiceList>;
}

const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * Voice lists per provider and key. The key itself is never stored: entries are found by a hash of it,
 * so a list read with one key is not served to another, and saving a new key reads a fresh list.
 * A failed read is not kept, and callers that arrive during a read share it instead of starting another.
 */
export function createVoiceCache(options: { ttlMs?: number; now?: () => number } = {}): VoiceCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { voices: readonly MediaVoice[]; fetchedAt: number }>();
  const pending = new Map<string, Promise<VoiceList>>();
  return {
    get(adapterId, apiKey, load, refresh = false) {
      const id = adapterId + ":" + createHash("sha256").update(apiKey).digest("hex");
      const hit = entries.get(id);
      if (hit && !refresh && now() - hit.fetchedAt < ttlMs) return Promise.resolve({ ...hit, cached: true });
      const running = pending.get(id);
      if (running) return running;
      const read = load().then((voices) => {
        const entry = { voices, fetchedAt: now() };
        entries.set(id, entry);
        return { ...entry, cached: false };
      }).finally(() => { pending.delete(id); });
      pending.set(id, read);
      return read;
    },
  };
}

/** The process-wide cache the routes use. */
export const voiceCache: VoiceCache = createVoiceCache();
