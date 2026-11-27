import type { MediaSelection } from "./mediaSelection";
import { parseMediaSelection } from "./mediaSelectionStore";

export type FailureCategory = "auth" | "quota" | "rate-limit" | "invalid-request" | "moderation" | "not-found" | "upstream" | "timeout" | "unknown";
/** The one thing to do next: fix the key, top up at the provider, run it again, change the prompt, or change the settings. */
export type FailureAction = "key" | "billing" | "retry" | "prompt" | "settings";

const CATEGORIES: readonly string[] = ["auth", "quota", "rate-limit", "invalid-request", "moderation", "not-found", "upstream", "timeout", "unknown"];

/** The server's category when it sent one; otherwise the same mapping it uses, read from the HTTP status. */
export function failureCategory(input: { category?: unknown; status?: unknown; code?: unknown }): FailureCategory {
  if (typeof input.category === "string" && CATEGORIES.includes(input.category)) return input.category as FailureCategory;
  if (input.code === "MEDIA_KEY_MISSING") return "auth";
  const status = typeof input.status === "number" ? input.status : 0;
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate-limit";
  if (status === 422) return "moderation";
  if (status === 404) return "not-found";
  if (status === 504 || status === 408) return "timeout";
  if (status === 400) return "invalid-request";
  return status >= 500 ? "upstream" : "unknown";
}

/** Null when nothing the person can do here would change the outcome. */
export function failureAction(category: FailureCategory, retryable: boolean): FailureAction | null {
  if (category === "auth") return "key";
  if (category === "quota") return "billing";
  if (category === "moderation") return "prompt";
  if (category === "invalid-request" || category === "not-found") return "settings";
  if (category === "rate-limit" || category === "timeout") return "retry";
  return retryable ? "retry" : null;
}

/** A failed media job, kept until it is dismissed or the next job succeeds, so a reload does not lose the reason. */
export interface MediaFailure {
  requestId: string;
  at: number;
  category: FailureCategory;
  retryable: boolean;
  code: string;
  /** The provider's own words, already stripped of secrets by the server. Empty when only the job record survived a reload. */
  message: string;
  adapter: string;
  prompt: string;
  /** What was being run, so "try again" runs the same thing. */
  selection: MediaSelection | null;
}

export function buildMediaFailure(error: unknown, context: { requestId: string; prompt: string; selection: MediaSelection | null; adapter?: string; at?: number }): MediaFailure {
  const e = (error ?? {}) as { code?: unknown; status?: unknown; category?: unknown; retryable?: unknown; message?: unknown; adapter?: unknown };
  return {
    requestId: context.requestId, at: context.at ?? Date.now(), category: failureCategory(e), retryable: e.retryable === true,
    code: typeof e.code === "string" && e.code ? e.code : "UNKNOWN", message: typeof e.message === "string" ? e.message : "",
    adapter: typeof e.adapter === "string" && e.adapter ? e.adapter : context.adapter ?? context.selection?.adapter ?? "",
    prompt: context.prompt, selection: context.selection,
  };
}

export function parseMediaFailure(raw: unknown): MediaFailure | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.requestId !== "string" || !v.requestId || typeof v.at !== "number" || typeof v.code !== "string") return null;
  return {
    requestId: v.requestId, at: v.at, category: failureCategory({ category: v.category }), retryable: v.retryable === true, code: v.code,
    message: typeof v.message === "string" ? v.message.slice(0, 2000) : "", adapter: typeof v.adapter === "string" ? v.adapter : "",
    prompt: typeof v.prompt === "string" ? v.prompt : "", selection: parseMediaSelection(v.selection),
  };
}
