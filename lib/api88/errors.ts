export function api88Error(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}

export function api88HttpError(status: number) {
  if (status === 401 || status === 403) return api88Error("API88_AUTH_FAILED", `88API rejected credentials (HTTP ${status})`, status);
  if (status === 429) return api88Error("API88_RATE_LIMITED", "88API rate limit reached", 429);
  return api88Error("API88_REQUEST_FAILED", `88API request failed (HTTP ${status})`, status);
}

export async function api88Json(url: string, key: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  try {
    response = await fetch(url, { ...init, redirect: "error", headers });
  } catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw api88Error("API88_NETWORK_FAILED", "88API request could not reach the server", 502);
  }
  if (!response.ok) throw api88HttpError(response.status);
  try { return await response.json(); }
  catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw api88Error("API88_RESPONSE_INVALID", "88API returned invalid JSON", 502);
  }
}

export function api88Record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
