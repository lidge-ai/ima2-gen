import { jsonFetch } from "./api-core";

/** One voice a text-to-speech route can use; id is the value of its "voice" option. */
export interface MediaVoice {
  id: string;
  name: string;
  description?: string;
  language?: string;
  gender?: "female" | "male" | "neutral";
  /** A sample the browser can play without credentials. */
  previewUrl?: string;
  /** The key's own voice (cloned or created). */
  owned?: boolean;
}

/** GET /api/media/voices: the provider is asked only when its key is saved; refresh skips the server's cache. */
export async function fetchMediaVoices(adapter: string, refresh = false): Promise<MediaVoice[]> {
  const body = await jsonFetch<{ voices?: MediaVoice[] }>("/api/media/voices?provider=" + encodeURIComponent(adapter) + (refresh ? "&refresh=1" : ""));
  return Array.isArray(body.voices) ? body.voices.filter((voice) => voice && typeof voice.id === "string" && typeof voice.name === "string") : [];
}

export function filterVoices(voices: readonly MediaVoice[], query: string): MediaVoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...voices];
  return voices.filter((voice) => {
    const hay = [voice.name, voice.description, voice.language, voice.gender].filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}
