import { fetchApi, jsonFetch } from "./api-core";

export type StarState = "starred" | "not-starred" | "unauthenticated";
/** `state` is null once the prompt was answered (the server stops asking gh). */
export interface StarStatus { state: StarState | null; prompted: boolean; repo: string; url: string }

const STAR_ENDPOINT = "/api/github/star";
const PUBLIC_REPO_API = "https://api.github.com/repos/lidge-jun/ima2-gen";

export function fetchStarStatus(): Promise<StarStatus> {
  return jsonFetch<StarStatus>(STAR_ENDPOINT);
}

export async function starRepo(): Promise<boolean> {
  const res = await fetchApi(STAR_ENDPOINT, { method: "POST" });
  return res.ok;
}

export async function dismissStarPrompt(): Promise<void> {
  await fetchApi(`${STAR_ENDPOINT}/dismiss`, { method: "POST" });
}

/** Public star count; any failure resolves null so the dialog never shows an invented number. */
export async function fetchStarCount(): Promise<number | null> {
  try {
    const res = await fetch(PUBLIC_REPO_API, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return null;
    const body = (await res.json()) as { stargazers_count?: unknown };
    return typeof body.stargazers_count === "number" ? body.stargazers_count : null;
  } catch {
    return null;
  }
}

export interface StarPromptInput {
  status: StarStatus | null;
  head: { createdAt?: number | null; mediaType?: string | null } | null;
  mountedAt: number;
  settingsOpen: boolean;
  readinessOpen: boolean;
}

/**
 * Opens once, after the first image made in this session, for people who have not
 * starred or answered yet. A failed status read (for example 403 in LAN mode) keeps
 * it closed.
 */
export function shouldOpenStarPrompt(input: StarPromptInput): boolean {
  const { status, head } = input;
  if (!status || status.prompted || status.state === "starred") return false;
  if (input.settingsOpen || input.readinessOpen || !head) return false;
  if (head.mediaType === "video") return false;
  return typeof head.createdAt === "number" && head.createdAt >= input.mountedAt;
}
