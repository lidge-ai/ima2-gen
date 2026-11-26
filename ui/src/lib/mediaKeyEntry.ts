import { jsonFetch } from "./api-core";
import type { MediaAdapter } from "./mediaCatalog";

/** Vocabularies whose key the core lanes also read; their extra fields are saved through a separate route (routes/mediaKeys.ts). */
const LEGACY_VOCABULARIES: readonly string[] = ["openai", "xai", "gemini", "atlascloud", "minimax", "nai", "vertex"];

/** Vertex takes a service-account JSON in its own settings form, not a pasted key. */
export function keyEntrySupported(adapter: Pick<MediaAdapter, "keyVocabulary">): boolean {
  return adapter.keyVocabulary !== "vertex";
}

export interface KeyDraft { apiKey: string; extra: Record<string, string> }

/** Why the draft cannot be sent yet, or null when it can. Mirrors the checks the server makes before calling the provider. */
export function keyDraftProblem(adapter: Pick<MediaAdapter, "keyPrefix" | "extraFields">, draft: KeyDraft): "empty" | "short" | "prefix" | "extra" | null {
  const key = draft.apiKey.trim();
  if (!key) return "empty";
  if (key.length < 6) return "short";
  if (adapter.keyPrefix && !key.startsWith(adapter.keyPrefix)) return "prefix";
  if (adapter.extraFields.some((field) => field.required && !field.configured && !draft.extra[field.name]?.trim())) return "extra";
  return null;
}

export interface KeyRequest { method: "POST" | "PUT"; url: string; body: Record<string, unknown> }

/**
 * The requests that check a key with the provider and then store it, in order. Checking first means a
 * rejected key is reported as rejected and nothing is written; the store route validates again on its own.
 */
export function keySaveRequests(adapter: Pick<MediaAdapter, "keyVocabulary">, draft: KeyDraft): KeyRequest[] {
  const base = "/api/keys/" + encodeURIComponent(adapter.keyVocabulary);
  const apiKey = draft.apiKey.trim();
  const extra = Object.fromEntries(Object.entries(draft.extra).map(([name, value]) => [name, value.trim()]).filter(([, value]) => value));
  const hasExtra = Object.keys(extra).length > 0;
  const requests: KeyRequest[] = [{ method: "POST", url: base + "/validate", body: { apiKey, ...(hasExtra ? { extra } : {}) } }];
  if (LEGACY_VOCABULARIES.includes(adapter.keyVocabulary)) {
    if (hasExtra) requests.push({ method: "PUT", url: base + "/extra", body: { extra } });
    requests.push({ method: "PUT", url: base, body: { apiKey } });
  } else requests.push({ method: "PUT", url: base, body: { apiKey, ...(hasExtra ? { extra } : {}) } });
  return requests;
}

export async function saveMediaKey(adapter: Pick<MediaAdapter, "keyVocabulary">, draft: KeyDraft): Promise<void> {
  for (const request of keySaveRequests(adapter, draft)) {
    await jsonFetch(request.url, { method: request.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
  }
}

export type KeySaveProblem = "rejected" | "unverified" | "format" | "extra" | "unknown";

/** What went wrong saving a key, so the screen can say it in its own words and keep the provider's text for the details. */
export function keySaveProblem(error: unknown): KeySaveProblem {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (code === "INVALID_KEY_FORMAT" || code === "KEY_TOO_SHORT" || code === "KEY_TOO_LARGE") return "format";
  if (code === "MISSING_EXTRA" || code === "INVALID_EXTRA") return "extra";
  if (code === "KEY_VALIDATION_FAILED") return /\b40[13]\b|invalid|unauthori[sz]ed|forbidden|incorrect/i.test(message) ? "rejected" : "unverified";
  return "unknown";
}
