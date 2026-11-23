/**
 * Reference-image edits sent to an external GPT OAuth endpoint (IMA2_NO_OAUTH_PROXY).
 *
 * ima2 builds edits as the public OpenAI multipart shape. Some OpenAI-compatible endpoints
 * (opencodex, and the Codex backend shape lib/codexBackend speaks natively) only read JSON with
 * data-URL images, so the body shape is configurable through `oauth.proxyEditsBody`:
 *   - "multipart": always send multipart;
 *   - "json": always send JSON (`{ ..., images: [{ image_url: "data:..." }] }`);
 *   - "auto" (default): send multipart; if the endpoint answers 400 or 415, retry once as JSON.
 *     A JSON success is remembered per endpoint for the life of the process, so later edits
 *     skip the multipart attempt.
 */
import { editsFormToJson } from "./normalize.js";

export type ProxyEditsBody = "auto" | "multipart" | "json";

const PROXY_EDITS_BODIES: ReadonlySet<string> = new Set(["auto", "multipart", "json"]);

export function normalizeProxyEditsBody(value: unknown): ProxyEditsBody {
  return typeof value === "string" && PROXY_EDITS_BODIES.has(value) ? value as ProxyEditsBody : "auto";
}

/** Endpoints that accepted a JSON edit after rejecting multipart. */
const jsonEditEndpoints = new Set<string>();

export function resetProxyEditsMemoryForTests(): void {
  jsonEditEndpoints.clear();
}

/** Statuses an endpoint returns when it cannot read the body shape it was sent. */
function rejectsBodyShape(status: number): boolean {
  return status === 400 || status === 415;
}

async function asJsonEdit(init: RequestInit, form: FormData): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return { ...init, headers, body: JSON.stringify(await editsFormToJson(form)) };
}

export async function proxyEditsFetch(base: string, path: string, init: RequestInit, form: FormData, mode: ProxyEditsBody): Promise<Response> {
  const url = `${base}${path}`;
  if (mode === "json" || (mode === "auto" && jsonEditEndpoints.has(base))) return fetch(url, await asJsonEdit(init, form));
  const first = await fetch(url, { ...init, body: form });
  if (mode === "multipart" || !rejectsBodyShape(first.status)) return first;
  const retry = await fetch(url, await asJsonEdit(init, form));
  if (retry.ok) {
    await first.body?.cancel();
    jsonEditEndpoints.add(base);
    return retry;
  }
  // Both shapes failed. A 400/415 on JSON as well says nothing new, so report the public-shape
  // answer; any other status (auth, rate limit, server error) means JSON got further.
  if (rejectsBodyShape(retry.status)) {
    await retry.body?.cancel();
    return first;
  }
  await first.body?.cancel();
  return retry;
}
