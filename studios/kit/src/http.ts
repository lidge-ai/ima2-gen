import type { ApiErrorBody, MediaProviderError } from "./types.ts";

export interface HttpOptions {
  /** Server origin, e.g. "http://127.0.0.1:3333". Empty string means same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Readonly<Record<string, string>>;
}

export class StudioApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly category: MediaProviderError["category"] | undefined;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = body.code;
    this.category = body.category;
    this.details = body.details;
  }
}

export class Http {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(options: HttpOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  url(path: string, query?: Readonly<Record<string, string | number | boolean | undefined>>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return this.baseUrl + path + (qs ? "?" + qs : "");
  }

  async request<T>(method: string, path: string, init: { body?: unknown; raw?: BodyInit; contentType?: string; headers?: Record<string, string>; signal?: AbortSignal; query?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.headers, ...init.headers };
    let body: BodyInit | undefined;
    if (init.raw !== undefined) {
      body = init.raw;
      if (init.contentType) headers["Content-Type"] = init.contentType;
    } else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers["Content-Type"] = "application/json";
    }
    const requestInit: RequestInit = { method, headers };
    if (body !== undefined) requestInit.body = body;
    if (init.signal) requestInit.signal = init.signal;
    const response = await this.fetchImpl(this.url(path, init.query), requestInit);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : undefined;
    if (!response.ok) throw new StudioApiError(response.status, errorBody(parsed, response));
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "NON_JSON_RESPONSE", message: text.slice(0, 200) } };
  }
}

function errorBody(parsed: unknown, response: Response): ApiErrorBody["error"] {
  const candidate = (parsed as Partial<ApiErrorBody> | undefined)?.error;
  if (candidate && typeof candidate.code === "string" && typeof candidate.message === "string") return candidate;
  return { code: "HTTP_" + response.status, message: response.statusText || "Request failed" };
}
